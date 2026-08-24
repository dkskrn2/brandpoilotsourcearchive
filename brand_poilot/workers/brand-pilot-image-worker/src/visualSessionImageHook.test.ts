import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const workerRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(workerRoot, "scripts", "audit-codex-visual-session-image.mjs");

function run(cwd: string, event: Record<string, unknown>) {
  return spawnSync(process.execPath, [script], { cwd, input: JSON.stringify(event), encoding: "utf8" });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Codex visual-session hook command", () => {
  it("persists an exact pre/post image call lifecycle", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "visual-hook-")); roots.push(cwd);
    await writeFile(path.join(cwd, "visual-session-job.json"), JSON.stringify({
      contractVersion: "ai-content-visual-session-render.v1", prompt: "prompt", expectedSceneIndices: [1],
    }));
    const common = {
      cwd, model: "gpt-5.6-terra", permission_mode: "default", session_id: "thread", turn_id: "turn",
      transcript_path: null, tool_name: "image_genimagegen", tool_use_id: "call-one",
      tool_input: { prompt: "BRAND_PILOT_SCENE_INDEX=1\nGenerate." },
    };
    expect(run(cwd, { ...common, hook_event_name: "PreToolUse" }).status).toBe(0);
    expect(run(cwd, { ...common, hook_event_name: "PostToolUse", tool_response: {} }).status).toBe(0);

    const audit = JSON.parse(await readFile(path.join(cwd, "visual-session-hook-audit.json"), "utf8"));
    expect(audit.calls).toMatchObject([{ toolUseId: "call-one", sceneIndex: 1, status: "completed" }]);
  });

  it("blocks an invalid image call before execution", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "visual-hook-")); roots.push(cwd);
    await writeFile(path.join(cwd, "visual-session-job.json"), JSON.stringify({
      contractVersion: "ai-content-visual-session-render.v1", prompt: "prompt", expectedSceneIndices: [1],
    }));
    const result = run(cwd, {
      cwd, hook_event_name: "PreToolUse", model: "gpt-5.6-terra", permission_mode: "default",
      session_id: "thread", turn_id: "turn", transcript_path: null, tool_name: "image_genimagegen",
      tool_use_id: "call-one", tool_input: { prompt: "No binding." },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("visual_session_image_scene_binding_invalid");
  });

  it("loads the required product paths file and blocks omitted references", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "visual-hook-")); roots.push(cwd);
    await writeFile(path.join(cwd, "visual-session-job.json"), JSON.stringify({
      contractVersion: "ai-content-visual-session-render.v1", prompt: "prompt", expectedSceneIndices: [1],
    }));
    await writeFile(path.join(cwd, "required-product-reference-paths.json"), JSON.stringify(["inputs/product-1.png"]));
    const result = run(cwd, {
      cwd, hook_event_name: "PreToolUse", model: "gpt-5.6-terra", permission_mode: "default",
      session_id: "thread", turn_id: "turn", transcript_path: null, tool_name: "image_genimagegen",
      tool_use_id: "call-one", tool_input: { prompt: "BRAND_PILOT_SCENE_INDEX=1\nGenerate." },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("visual_session_image_required_product_reference_missing");
  });
});
