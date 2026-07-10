process.env.NODE_ENV = "test";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSurfaces, saveSurfaceOverride } from "./surface-registry.mjs";
import { getEffectiveToolMode } from "./tool-mode-registry.mjs";

test("surface registry exposes default surfaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-surfaces-"));
  const surfaces = await loadSurfaces(root);
  assert.deepEqual(surfaces.map((surface) => surface.id), ["chat", "notes", "code"]);
  assert.equal(surfaces.find((surface) => surface.id === "chat")?.enabled, true);
  assert.equal(surfaces.find((surface) => surface.id === "chat")?.removable, false);
});

test("surface registry can disable built-in surfaces and add plugin surfaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codmes-surfaces-"));
  await saveSurfaceOverride(root, "code", { enabled: false });
  await saveSurfaceOverride(root, "kongju-university", {
    title: "공주대학교",
    kind: "plugin",
    icon: "graduationcap",
    enabled: true,
    order: 25,
    prompt: "Use university-specific tools and context.",
    enabledTools: ["tool_discovery", "conversation_search"]
  });

  const surfaces = await loadSurfaces(root);
  const code = surfaces.find((surface) => surface.id === "code");
  const plugin = surfaces.find((surface) => surface.id === "kongju-university");
  assert.equal(code?.enabled, false);
  assert.equal(plugin?.title, "공주대학교");
  assert.equal(plugin?.kind, "plugin");
  assert.deepEqual(plugin?.enabledTools, ["tool_discovery", "conversation_search"]);
  const mode = await getEffectiveToolMode(root, "kongju-university");
  assert.equal(mode.mode, "custom");
  assert.equal(mode.enabledTools.includes("tool_discovery"), true);
  assert.equal(mode.enabledTools.includes("conversation_search"), true);
});
