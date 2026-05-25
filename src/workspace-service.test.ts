import assert from "node:assert/strict";
import type * as childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WorkspaceService } from "./workspace-service.js";

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
