import { describe, expect, it } from "vitest";
import { parseAiContentVisualSessionRunnerJob, parseAiContentVisualSessionRunnerResult } from "./aiContentVisualSessionRunnerContract.js";

describe("visual session runner contract", () => {
  it("requires one ordered result for every expected scene", () => {
    const job = parseAiContentVisualSessionRunnerJob({ contractVersion: "ai-content-visual-session-render.v1", prompt: "Generate", expectedSceneIndices: [1, 2, 3] });
    expect(() => parseAiContentVisualSessionRunnerResult({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 2 }, { index: 3 }] }, job)).not.toThrow();
    expect(() => parseAiContentVisualSessionRunnerResult({ contractVersion: "ai-content-visual-session-render.v1", scenes: [{ index: 1 }, { index: 3 }] }, job)).toThrow("ai_content_visual_session_final_message_invalid");
  });
});
