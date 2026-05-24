import fs from "fs";
import path from "path";

const args = process.argv.slice(2);
const command = args[0];
const workspaceName = args[1];

const workspaceRoot = path.resolve(process.cwd(), ".workspaces");

function printUsage(): void {
  console.log("Usage: sailor-claw-cli init [name]");
  console.log("\nExample:");
  console.log("  sailor-claw-cli init my-workspace");
}

function initWorkspace(name: string): void {
  const targetPath = path.join(workspaceRoot, name);

  if (!name) {
    console.error("Error: Missing workspace name.");
    printUsage();
    process.exit(1);
  }

  if (fs.existsSync(targetPath)) {
    console.error(`Workspace already exists: ${targetPath}`);
    process.exit(1);
  }

  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(
    path.join(targetPath, "README.md"),
    `# ${name}\n\nThis workspace was created by sailor-claw-cli.`
  );

  console.log(`Created workspace: ${targetPath}`);
}

if (!command) {
  printUsage();
  process.exit(0);
}

switch (command) {
  case "init":
    if (!workspaceName) {
      console.error("Error: Please provide a workspace name.");
      printUsage();
      process.exit(1);
    }
    initWorkspace(workspaceName);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
