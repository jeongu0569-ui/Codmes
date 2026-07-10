import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createModelTuiLaunch,
  modelConfigHome,
  vendoredModelEntry
} from "./model-config-tui.mjs";

test("vendored model TUI is scoped to AI Workspace runtime state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiw-model-tui-"));
  const fakePython = path.join(root, "python");
  await fs.writeFile(fakePython, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const launch = createModelTuiLaunch({
    repoRoot: "/repo",
    workspaceRoot: "/workspace",
    args: ["--refresh"],
    env: { AIW_RUNTIME_PYTHON: fakePython }
  });

  assert.equal(launch.command, fakePython);
  assert.deepEqual(launch.args, [vendoredModelEntry("/repo"), "--refresh"]);
  assert.equal(launch.env.HERMES_HOME, modelConfigHome("/workspace"));
  assert.match(launch.env.PYTHONPATH, /vendor\/hermes-agent/);
});
