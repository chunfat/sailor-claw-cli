import assert from "node:assert/strict";
import type * as childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceService } from "./workspace-service.js";

function createTempWorkspaceRoot(): string {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "sailor-claw-cli-workspace-service-"),
  );

  return path.join(tempRoot, ".workspaces");
}

function writeWorkspaceConfig(
  workspaceRoot: string,
  workspaceName: string,
  config: unknown,
): string {
  const workspacePath = path.join(workspaceRoot, workspaceName);
  const configPath = path.join(workspacePath, "openclaw.json");

  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return configPath;
}

function readWorkspaceConfig(
  workspaceRoot: string,
  workspaceName: string,
): Record<string, unknown> {
  const configPath = path.join(workspaceRoot, workspaceName, "openclaw.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<
    string,
    unknown
  >;
}

test("ensureWorkspaceIsDockerMountable clears provenance without following symlinks on macOS", () => {
  const spawnCalls: Array<{
    command: string;
    args: readonly string[];
    options: childProcess.SpawnSyncOptionsWithStringEncoding;
  }> = [];
  class TestWorkspaceService extends WorkspaceService {
    protected override spawnSync(
      command: string,
      args: readonly string[],
      options: childProcess.SpawnSyncOptionsWithStringEncoding,
    ): childProcess.SpawnSyncReturns<string> {
      spawnCalls.push({ command, args, options });

      return {
        output: ["", "", ""],
        pid: 1,
        signal: null,
        status: 0,
        stderr: "",
        stdout: "",
      };
    }
  }

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "sailor-claw-cli-workspace-service-"),
  );
  const workspaceRoot = path.join(tempRoot, ".workspaces");
  const workspaceService = new TestWorkspaceService(workspaceRoot);
  const originalPlatform = process.platform;

  Object.defineProperty(process, "platform", { value: "darwin" });

  try {
    const workspacePath = workspaceService.getWorkspacePath("alpha");
    const pluginSkillsPath = path.join(workspacePath, "plugin-skills");
    const brokenSkillPath = path.join(pluginSkillsPath, "browser-automation");

    fs.mkdirSync(pluginSkillsPath, { recursive: true });
    fs.symlinkSync(
      "/app/dist/extensions/browser/skills/browser-automation",
      brokenSkillPath,
    );

    workspaceService.ensureWorkspaceIsDockerMountable("alpha");

    assert.equal(spawnCalls.length, 1);
    assert.deepEqual(spawnCalls[0]?.args, [
      "-d",
      "-r",
      "-s",
      "com.apple.provenance",
      workspacePath,
    ]);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setTelegramAllowFrom rewrites both Telegram allowlists for a workspace", () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const workspaceName = "alpha";
  const workspaceService = new WorkspaceService(workspaceRoot);

  try {
    writeWorkspaceConfig(workspaceRoot, workspaceName, {
      channels: {
        telegram: {
          allowFrom: ["111"],
          groups: {
            "*": {
              requireMention: true,
            },
          },
        },
      },
      commands: {
        ownerAllowFrom: ["telegram:111", "telegram:222"],
      },
      gateway: {
        auth: {
          token: "existing-token",
        },
      },
    });

    workspaceService.setTelegramAllowFrom(workspaceName, "5016077957");

    const config = readWorkspaceConfig(workspaceRoot, workspaceName);

    assert.deepEqual(config.channels, {
      telegram: {
        allowFrom: ["5016077957"],
        groups: {
          "*": {
            requireMention: true,
          },
        },
      },
    });
    assert.deepEqual(config.commands, {
      ownerAllowFrom: ["telegram:5016077957"],
    });
    assert.deepEqual(config.gateway, {
      auth: {
        token: "existing-token",
      },
    });
  } finally {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});

test("setTelegramAllowFrom creates missing Telegram config containers", () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const workspaceName = "alpha";
  const workspaceService = new WorkspaceService(workspaceRoot);

  try {
    writeWorkspaceConfig(workspaceRoot, workspaceName, {
      gateway: {
        auth: {
          token: "existing-token",
        },
      },
    });

    workspaceService.setTelegramAllowFrom(workspaceName, "123456789");

    const config = readWorkspaceConfig(workspaceRoot, workspaceName);

    assert.deepEqual(config.channels, {
      telegram: {
        allowFrom: ["123456789"],
      },
    });
    assert.deepEqual(config.commands, {
      ownerAllowFrom: ["telegram:123456789"],
    });
  } finally {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});

test("setTelegramAllowFrom rejects a non-numeric Telegram user ID", () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const workspaceName = "alpha";
  const workspaceService = new WorkspaceService(workspaceRoot);

  try {
    writeWorkspaceConfig(workspaceRoot, workspaceName, {
      channels: {},
      commands: {},
    });

    assert.throws(
      () => workspaceService.setTelegramAllowFrom(workspaceName, "abc123"),
      /Telegram user ID must be a non-empty numeric string/,
    );
  } finally {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});

test("setTelegramAllowFrom rejects a missing workspace", () => {
  const workspaceRoot = createTempWorkspaceRoot();
  const workspaceService = new WorkspaceService(workspaceRoot);

  try {
    assert.throws(
      () => workspaceService.setTelegramAllowFrom("missing", "123456789"),
      /Workspace does not exist/,
    );
  } finally {
    fs.rmSync(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});
