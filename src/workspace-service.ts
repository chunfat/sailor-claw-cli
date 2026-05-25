import { randomBytes } from "crypto";
import * as childProcess from "child_process";
import fs from "fs";
import path from "path";

const OPENCLAW_CONFIG_FILENAME = "openclaw.json";
const OPENCLAW_BOILERPLATE_PATH = path.resolve(
  process.cwd(),
  "src/boilerplates/openclaw/openclaw.json",
);

interface OpenClawConfig {
  gateway?: {
    bind?: string;
    auth?: {
      token?: string;
    };
    controlUi?: {
      allowedOrigins?: string[];
    };
  };
}

interface DockerGatewayConfigUpdate {
  updatedAllowedOrigins: boolean;
  updatedBind: boolean;
}

const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

export class WorkspaceService {
  constructor(private readonly workspaceRoot: string) {}

  createWorkspace(name: string): string {
    this.assertValidName(name);

    const workspacePath = this.getWorkspacePath(name);
    const openClawHomePath = this.getOpenClawHomePath(name);

    if (fs.existsSync(workspacePath)) {
      throw new Error(`Workspace already exists: ${workspacePath}`);
    }

    fs.mkdirSync(openClawHomePath, { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, "README.md"),
      `# ${name}\n\nThis workspace was created by sailor-claw-cli.\n`,
    );
    this.writeOpenClawConfig(openClawHomePath);
    this.ensureWorkspaceIsDockerMountable(name);

    return workspacePath;
  }

  listWorkspaces(): string[] {
    if (!fs.existsSync(this.workspaceRoot)) {
      return [];
    }

    return fs
      .readdirSync(this.workspaceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  }

  getWorkspacePath(name: string): string {
    return path.join(this.workspaceRoot, name);
  }

  workspaceExists(name: string): boolean {
    this.assertValidName(name);
    return fs.existsSync(this.getWorkspacePath(name));
  }

  assertWorkspaceExists(name: string): void {
    const workspacePath = this.getWorkspacePath(name);

    if (!this.workspaceExists(name)) {
      throw new Error(`Workspace does not exist: ${workspacePath}`);
    }
  }

  getOpenClawConfigPath(name: string): string {
    return path.join(this.getOpenClawHomePath(name), OPENCLAW_CONFIG_FILENAME);
  }

  readOpenClawConfig(name: string): OpenClawConfig {
    this.assertWorkspaceExists(name);

    const configPath = this.ensureOpenClawConfigFile(name);

    return JSON.parse(fs.readFileSync(configPath, "utf8")) as OpenClawConfig;
  }

  getOpenClawGatewayToken(name: string): string {
    const config = this.readOpenClawConfig(name);
    const token = config.gateway?.auth?.token?.trim();

    if (!token) {
      throw new Error(
        `Workspace OpenClaw config is missing gateway.auth.token: ${this.getOpenClawConfigPath(name)}`,
      );
    }

    return token;
  }

  ensureDockerGatewayConfig(
    name: string,
    hostGatewayPort: number,
  ): DockerGatewayConfigUpdate {
    const config = this.readOpenClawConfig(name);

    config.gateway ??= {};

    const updatedBind = config.gateway.bind !== "lan";
    config.gateway.bind = "lan";

    config.gateway.controlUi ??= {};
    const currentOrigins = config.gateway.controlUi.allowedOrigins ?? [];
    const preservedOrigins = currentOrigins.filter(
      (origin) => !LOCALHOST_ORIGIN_PATTERN.test(origin),
    );
    const desiredOrigins = [
      ...preservedOrigins,
      ...this.getLocalGatewayOrigins(hostGatewayPort),
    ];
    const updatedAllowedOrigins = !this.haveSameValues(
      currentOrigins,
      desiredOrigins,
    );
    config.gateway.controlUi.allowedOrigins = desiredOrigins;

    if (!updatedBind && !updatedAllowedOrigins) {
      return { updatedAllowedOrigins, updatedBind };
    }

    this.writeOpenClawConfigFile(this.getOpenClawConfigPath(name), config);
    return { updatedAllowedOrigins, updatedBind };
  }

  ensureWorkspaceIsDockerMountable(name: string): void {
    this.assertWorkspaceExists(name);
    this.clearMacOsProvenanceAttributes(this.getWorkspacePath(name));
  }

  private assertValidName(name: string): void {
    if (!name.trim()) {
      throw new Error("Missing workspace name.");
    }
  }

  getOpenClawHomePath(name: string): string {
    return path.join(this.getWorkspacePath(name));
  }

  private writeOpenClawConfig(openClawHomePath: string): void {
    const config = this.loadOpenClawBoilerplate();
    const gatewayToken = randomBytes(24).toString("hex");

    config.gateway ??= {};
    config.gateway.auth ??= {};
    config.gateway.auth.token = gatewayToken;
    fs.mkdirSync(openClawHomePath, { recursive: true });
    this.writeOpenClawConfigFile(
      path.join(openClawHomePath, OPENCLAW_CONFIG_FILENAME),
      config,
    );
  }

  private loadOpenClawBoilerplate(): OpenClawConfig {
    return JSON.parse(
      fs.readFileSync(OPENCLAW_BOILERPLATE_PATH, "utf8"),
    ) as OpenClawConfig;
  }

  private writeOpenClawConfigFile(
    configPath: string,
    config: OpenClawConfig,
  ): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  private ensureOpenClawConfigFile(name: string): string {
    const configPath = this.getOpenClawConfigPath(name);

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Workspace OpenClaw config does not exist: ${configPath}`,
      );
    }

    const stats = fs.statSync(configPath);
    if (stats.isFile()) {
      return configPath;
    }

    throw new Error(`Workspace OpenClaw config is not a file: ${configPath}`);
  }

  private getLocalGatewayOrigins(port: number): string[] {
    return [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  }

  private clearMacOsProvenanceAttributes(targetPath: string): void {
    if (process.platform !== "darwin") {
      return;
    }

    const result = this.spawnSync(
      "xattr",
      ["-d", "-r", "-s", "com.apple.provenance", targetPath],
      { encoding: "utf8" },
    );

    if (result.error) {
      throw new Error(
        `Failed to clear macOS provenance attributes from workspace: ${targetPath}. Error: ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const stderr = result.stderr.trim();
      throw new Error(
        stderr ||
          `Failed to clear macOS provenance attributes from workspace: ${targetPath}`,
      );
    }
  }

  private haveSameValues(left: string[], right: string[]): boolean {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  protected spawnSync(
    command: string,
    args: readonly string[],
    options: childProcess.SpawnSyncOptionsWithStringEncoding,
  ): childProcess.SpawnSyncReturns<string> {
    return childProcess.spawnSync(command, args, options);
  }
}
