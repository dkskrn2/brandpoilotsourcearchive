import { describe, expect, it } from "vitest";
import {
  parseAiContentVisualSessionFinalMessage,
  parseAiContentVisualSessionRunnerJob,
  parseAiContentVisualSessionRunnerResult,
} from "./aiContentVisualSessionRunnerContract.js";

describe("visual session runner contract", () => {
  it("requires one ordered result for every expected scene", () => {
    const job = parseAiContentVisualSessionRunnerJob({ contractVersion: "ai-content-visual-session-render.v1", prompt: "Generate", expectedSceneIndices: [1, 2, 3] });
    expect(() => parseAiContentVisualSessionRunnerResult({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 2 }, { index: 3 }] }, job)).not.toThrow();
    expect(() => parseAiContentVisualSessionRunnerResult({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 3 }] }, job)).toThrow("ai_content_visual_session_final_message_contract_invalid");
  });

  it("distinguishes invalid JSON from an invalid top-level contract", () => {
    const job = parseAiContentVisualSessionRunnerJob({ contractVersion: "ai-content-visual-session-render.v1", prompt: "Generate", expectedSceneIndices: [1, 2] });
    expect(() => parseAiContentVisualSessionFinalMessage("not-json", job)).toThrow("ai_content_visual_session_final_message_json_invalid");
    expect(() => parseAiContentVisualSessionFinalMessage(JSON.stringify({ contractVersion: "wrong", scenes: [{ index: 1 }, { index: 2 }] }), job)).toThrow("ai_content_visual_session_final_message_contract_invalid");
  });

  it("distinguishes a scene/index mismatch from a top-level contract failure", () => {
    const job = parseAiContentVisualSessionRunnerJob({ contractVersion: "ai-content-visual-session-render.v1", prompt: "Generate", expectedSceneIndices: [1, 2] });
    expect(() => parseAiContentVisualSessionFinalMessage(JSON.stringify({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 3 }] }), job)).toThrow("ai_content_visual_session_final_message_scene_invalid");
    expect(() => parseAiContentVisualSessionFinalMessage(JSON.stringify({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 2 }] }), job)).not.toThrow();
  });
});
