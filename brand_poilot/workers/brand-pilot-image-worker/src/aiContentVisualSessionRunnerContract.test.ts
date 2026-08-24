import { describe, expect, it } from "vitest";
import {
  parseAiContentVisualSessionRunnerJob,
} from "./aiContentVisualSessionRunnerContract.js";

describe("visual session runner contract", () => {
  it("accepts only one ordered set of claimed scene indexes", () => {
    expect(parseAiContentVisualSessionRunnerJob({
      contractVersion: "ai-content-visual-session-render.v1",
      prompt: "Generate",
      expectedSceneIndices: [1, 2, 3],
    })).toEqual({
      contractVersion: "ai-content-visual-session-render.v1",
      prompt: "Generate",
      expectedSceneIndices: [1, 2, 3],
    });
    expect(() => parseAiContentVisualSessionRunnerJob({
      contractVersion: "ai-content-visual-session-render.v1",
      prompt: "Generate",
      expectedSceneIndices: [1, 3],
    })).toThrow("ai_content_visual_session_runner_invalid");
  });
});
