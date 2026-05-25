import path from "path";
import { OpenClawService } from "./src/agent-runtime/open-claw-service.js";
import { WorkspaceService } from "./src/workspace-service.js";

const args = process.argv.slice(2);
const command = args[0];
const workspaceName = args[1];
const telegramUserId = args[2];

const workspaceRoot = path.resolve(process.cwd(), ".workspaces");
const workspaceService = new WorkspaceService(workspaceRoot);
const openClawService = new OpenClawService(workspaceService);

function printUsage(): void {
  console.log("Usage: sailor-claw-cli init [name]");
  console.log("       sailor-claw-cli list");
  console.log("       sailor-claw-cli start [workspace]");
  console.log(
    "       sailor-claw-cli set-telegram-allow-from-owner [workspace] [telegram-user-id]",
  );
  console.log("\nExample:");
  console.log("  sailor-claw-cli init my-workspace");
  console.log("  sailor-claw-cli list");
  console.log("  sailor-claw-cli start my-workspace");
  console.log(
    "  sailor-claw-cli set-telegram-allow-from-owner my-workspace 123456789",
  );
}

function listWorkspaces(): void {
  const workspaces = workspaceService.listWorkspaces();

  if (workspaces.length === 0) {
    console.log(`No workspaces found under ${workspaceRoot}`);
    return;
  }

  console.log("Workspaces:");
  for (const workspace of workspaces) {
    console.log(`- ${workspace}`);
  }
}

async function main(): Promise<void> {
  if (!command) {
    printUsage();
    process.exit(0);
  }

  switch (command) {
    case "init": {
      if (!workspaceName) {
        throw new Error("Please provide a workspace name.");
      }

      const targetPath = workspaceService.createWorkspace(workspaceName);
      console.log(`Created workspace: ${targetPath}`);
      break;
    }
    case "list":
      listWorkspaces();
      break;
    case "start": {
      if (!workspaceName) {
        throw new Error("Please provide a workspace name.");
      }

      const result = await openClawService.startWorkspace(workspaceName, {
        onProgress: (message) => {
          console.log(`Starting workspace: ${message}`);
        },
      });
      console.log(`Workspace: ${workspaceName}`);
      console.log(`Container: ${result.containerName}`);
      console.log(`Container ID: ${result.containerId}`);
      console.log(`Gateway URL: http://localhost:${result.hostGatewayPort}`);
      console.log(`OPENCLAW_GATEWAY_TOKEN: ${result.gatewayToken}`);
      break;
    }
    case "set-telegram-allow-from-owner": {
      if (!workspaceName) {
        throw new Error("Please provide a workspace name.");
      }

      if (!telegramUserId) {
        throw new Error("Please provide a Telegram user ID.");
      }

      workspaceService.setTelegramAllowFrom(workspaceName, telegramUserId);
      console.log(`Workspace: ${workspaceName}`);
      console.log(`channels.telegram.allowFrom: ["${telegramUserId}"]`);
      console.log(
        `commands.ownerAllowFrom: ["telegram:${telegramUserId}"]`,
      );
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error.";
  console.error(`Error: ${message}`);
  if (
    command === "init" ||
    command === "start" ||
    command === "set-telegram-allow-from-owner"
  ) {
    printUsage();
  }
  process.exit(1);
});
