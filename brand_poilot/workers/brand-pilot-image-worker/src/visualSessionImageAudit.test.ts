import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  applyVisualSessionImageHookEvent,
  assertCompleteVisualSessionImageAudit,
  createVisualSessionImageAudit,
} from "../scripts/visualSessionImageAudit.mjs";

const imageInput = (sceneIndex: number, overrides: Record<string, unknown> = {}) => ({
  prompt: `BRAND_PILOT_SCENE_INDEX=${sceneIndex}\nGenerate this scene.`,
  ...overrides,
});
const workspaceDir = path.resolve("C:/visual-session-workspace");

describe("visual-session image tool audit", () => {
  it("binds each completed image call id to exactly one ascending scene", () => {
    let audit = createVisualSessionImageAudit([1, 2]);
    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_genimagegen", toolUseId: "call-one", toolInput: imageInput(1), nowMs: 100,
    });
    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PostToolUse", toolName: "image_genimagegen", toolUseId: "call-one", toolInput: imageInput(1), nowMs: 150,
    });
    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_genimagegen", toolUseId: "call-two", toolInput: imageInput(2), nowMs: 200,
    });
    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PostToolUse", toolName: "image_genimagegen", toolUseId: "call-two", toolInput: imageInput(2), nowMs: 280,
    });

    expect(assertCompleteVisualSessionImageAudit(audit)).toEqual([
      { sceneIndex: 1, toolUseId: "call-one", arguments: imageInput(1), startedAtMs: 100, completedAtMs: 150, durationMs: 50 },
      { sceneIndex: 2, toolUseId: "call-two", arguments: imageInput(2), startedAtMs: 200, completedAtMs: 280, durationMs: 80 },
    ]);
  });

  it.each([
    ["wrong scene", { ...imageInput(2) }, "visual_session_image_scene_order_invalid"],
    ["previous generated image", imageInput(1, { num_last_images_to_include: 1 }), "visual_session_image_previous_output_reference_forbidden"],
    ["generated output path", imageInput(1, { referenced_image_paths: [path.resolve(workspaceDir, "../generated_images/call.png")] }), "visual_session_image_previous_output_reference_forbidden"],
    ["missing binding", { prompt: "Generate this scene." }, "visual_session_image_scene_binding_invalid"],
  ])("rejects %s before image generation", (_label, toolInput, expected) => {
    const audit = createVisualSessionImageAudit([1, 2]);
    expect(() => applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_gen.imagegen", toolUseId: "call-one", toolInput, workspaceDir, nowMs: 100,
    })).toThrow(expected);
  });

  it("rejects overlapping calls, retries, extras, and incomplete sessions", () => {
    let audit = createVisualSessionImageAudit([1]);
    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_gen__imagegen", toolUseId: "call-one", toolInput: imageInput(1), nowMs: 100,
    });
    expect(() => applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_gen__imagegen", toolUseId: "call-two", toolInput: imageInput(1), nowMs: 110,
    })).toThrow("visual_session_image_call_overlap_forbidden");
    expect(() => assertCompleteVisualSessionImageAudit(audit)).toThrow("visual_session_image_audit_incomplete");

    audit = applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PostToolUse", toolName: "image_gen__imagegen", toolUseId: "call-one", toolInput: imageInput(1), nowMs: 150,
    });
    expect(() => applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "image_gen__imagegen", toolUseId: "call-two", toolInput: imageInput(1), nowMs: 160,
    })).toThrow("visual_session_image_call_count_invalid");
  });

  it("ignores unrelated tool hook events", () => {
    const audit = createVisualSessionImageAudit([1]);
    expect(applyVisualSessionImageHookEvent(audit, {
      hookEventName: "PreToolUse", toolName: "shell_command", toolUseId: "shell-one", toolInput: { command: "pwd" }, nowMs: 100,
    })).toEqual(audit);
  });
});
