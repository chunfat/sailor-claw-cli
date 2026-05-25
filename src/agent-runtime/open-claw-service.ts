import fs from "fs";
import { spawnSync } from "child_process";
import net from "net";
import path from "path";
import { WorkspaceService } from "../workspace-service.js";

const OPENCLAW_IMAGE = "alpine/openclaw";
const OPENCLAW_CONTAINER_HOME = "/home/node";
const OPENCLAW_CONFIG_DIR = `${OPENCLAW_CONTAINER_HOME}/.openclaw`;
const OPENCLAW_WORKSPACE_DIR = `${OPENCLAW_CONFIG_DIR}/workspace`;
const OPENCLAW_AUTH_PROFILE_SECRET_DIR = `${OPENCLAW_CONFIG_DIR}/auth-profile-secrets`;
const OPENCLAW_GATEWAY_PORT = 18789;

export interface StartResult {
  containerName: string;
  containerId: string;
  hostGatewayPort: number;
  gatewayToken: string;
  workspacePath: string;
}

export interface StartWorkspaceOptions {
  onProgress?: (message: string) => void;
}

export class OpenClawService {
  constructor(private readonly workspaceService: WorkspaceService) {}

  async startWorkspace(
    name: string,
    options: StartWorkspaceOptions = {},
  ): Promise<StartResult> {
    const reportProgress = options.onProgress ?? (() => undefined);

    reportProgress(`Validating workspace: ${name}`);
    this.workspaceService.assertWorkspaceExists(name);

    reportProgress("Loading workspace OpenClaw config");
    const gatewayToken = this.workspaceService.getOpenClawGatewayToken(name);

    reportProgress("Checking Docker availability");
    this.assertDockerAvailable();

    const workspacePath = this.workspaceService.getWorkspacePath(name);
    const containerName = this.getContainerName(name);
    const bindOpenClawHomeDir = this.workspaceService.getOpenClawHomePath(name);
    const bindOpenClawWorkspaceDir = path.join(workspacePath, "workspace");
    const bindAuthProfileSecretDir = path.join(
      workspacePath,
      "auth-profile-secrets",
    );

    reportProgress(`Checking for existing container: ${containerName}`);
    this.assertContainerDoesNotExist(containerName);

    reportProgress("Allocating gateway port");
    const hostGatewayPort = await this.findAvailablePort();
    const gatewayConfigUpdate = this.workspaceService.ensureDockerGatewayConfig(
      name,
      hostGatewayPort,
    );
    if (gatewayConfigUpdate.updatedBind) {
      reportProgress("Updated gateway.bind to lan for Docker port publishing");
    }
    if (gatewayConfigUpdate.updatedAllowedOrigins) {
      reportProgress(
        `Updated gateway.controlUi.allowedOrigins for localhost:${hostGatewayPort}`,
      );
    }
    const envArgs = [
      "-e",
      `OPENCLAW_CONFIG_DIR=${OPENCLAW_CONFIG_DIR}`,
      "-e",
      `OPENCLAW_WORKSPACE_DIR=${OPENCLAW_WORKSPACE_DIR}`,
      "-e",
      `OPENCLAW_AUTH_PROFILE_SECRET_DIR=${OPENCLAW_AUTH_PROFILE_SECRET_DIR}`,
      "-e",
      `OPENCLAW_GATEWAY_PORT=${OPENCLAW_GATEWAY_PORT}`,
      "-e",
      "OPENCLAW_GATEWAY_BIND=lan",
    ];
    const mountArgs = [
      "--mount",
      this.buildBindMount(bindOpenClawHomeDir, OPENCLAW_CONFIG_DIR),
      "--mount",
      this.buildBindMount(bindOpenClawWorkspaceDir, OPENCLAW_WORKSPACE_DIR),
      "--mount",
      this.buildBindMount(
        bindAuthProfileSecretDir,
        OPENCLAW_AUTH_PROFILE_SECRET_DIR,
      ),
    ];

    if (process.env.TELEGRAM_BOT_TOKEN) {
      // just for demo, each agent should have its own token in production
      envArgs.push(
        "-e",
        `TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN}`,
      );
    }

    if (process.env.MINIMAX_API_KEY) {
      envArgs.push("-e", `MINIMAX_API_KEY=${process.env.MINIMAX_API_KEY}`);
      envArgs.push(
        "-e",
        `MINIMAX_API_BASE_URL=${process.env.MINIMAX_API_BASE_URL ?? "https://api.minimax.com"}`,
      );
      envArgs.push(
        "-e",
        `MINIMAX_CODE_PLAN_KEY=${process.env.MINIMAX_CODE_PLAN_KEY}`,
      );
    }

    const dockerArgs = [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-p",
      `${hostGatewayPort}:${OPENCLAW_GATEWAY_PORT}`,
      ...envArgs,
      ...mountArgs,
      OPENCLAW_IMAGE,
    ];

    this.ensureBindMountDirectoriesExist([
      bindOpenClawHomeDir,
      bindOpenClawWorkspaceDir,
      bindAuthProfileSecretDir,
    ]);
    this.workspaceService.ensureWorkspaceIsDockerMountable(name);

    reportProgress(`Starting OpenClaw container: ${containerName}`);
    reportProgress("Docker output:");
    const result = spawnSync("docker", dockerArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });

    if (result.error) {
      throw new Error(
        `Failed to start Docker container: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim() ?? "";
      throw new Error(
        stderr || "Docker failed to start the OpenClaw container.",
      );
    }

    reportProgress(`OpenClaw container started: ${containerName}`);
    return {
      containerName,
      containerId: result.stdout.trim(),
      hostGatewayPort,
      gatewayToken,
      workspacePath,
    };
  }

  private assertDockerAvailable(): void {
    const result = spawnSync("docker", ["--version"], { encoding: "utf8" });

    if (result.error) {
      throw new Error("Docker CLI is unavailable. Please install Docker.");
    }

    if (result.status !== 0) {
      throw new Error("Docker CLI is unavailable. Please install Docker.");
    }
  }

  private assertContainerDoesNotExist(containerName: string): void {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `name=^/${containerName}$`,
        "--format",
        "{{.Names}}",
      ],
      { encoding: "utf8" },
    );

    if (result.error) {
      throw new Error(
        `Failed to inspect Docker containers: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const stderr = result.stderr.trim();
      throw new Error(stderr || "Failed to inspect Docker containers.");
    }

    if (result.stdout.trim() === containerName) {
      throw new Error(`OpenClaw container already exists: ${containerName}`);
    }
  }

  private buildBindMount(sourcePath: string, targetPath: string): string {
    return `type=bind,src=${path.resolve(sourcePath)},dst=${targetPath}`;
  }

  private getContainerName(name: string): string {
    return `openclaw-${name.replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
  }

  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();

      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();

        if (!address || typeof address === "string") {
          server.close(() =>
            reject(new Error("Failed to allocate a gateway port.")),
          );
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(address.port);
        });
      });
    });
  }

  private ensureBindMountDirectoriesExist(directories: string[]): void {
    for (const dir of directories) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        throw new Error(
          `Failed to create bind mount directory: ${dir}. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

}
