export interface AiContentVisualSessionRunnerJob {
  contractVersion: "ai-content-visual-session-render.v1";
  prompt: string;
  expectedSceneIndices: number[];
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ai_content_visual_session_runner_invalid");
  return value as Record<string, unknown>;
}

export function parseAiContentVisualSessionRunnerJob(value: unknown): AiContentVisualSessionRunnerJob {
  const source = object(value);
  if (Object.keys(source).length !== 3 || source.contractVersion !== "ai-content-visual-session-render.v1"
    || typeof source.prompt !== "string" || !source.prompt.trim() || !Array.isArray(source.expectedSceneIndices)
    || source.expectedSceneIndices.length < 1 || source.expectedSceneIndices.length > 5
    || source.expectedSceneIndices.some((index, offset) => index !== offset + 1)) throw new Error("ai_content_visual_session_runner_invalid");
  return { contractVersion: "ai-content-visual-session-render.v1", prompt: source.prompt, expectedSceneIndices: [...source.expectedSceneIndices] as number[] };
}

export function parseAiContentVisualSessionRunnerResult(value: unknown, job: AiContentVisualSessionRunnerJob): void {
  const source = object(value);
  if (Object.keys(source).length !== 2 || source.contractVersion !== "ai-content-visual-session-render.v1" || !Array.isArray(source.scenes)
    || source.scenes.length !== job.expectedSceneIndices.length) throw new Error("ai_content_visual_session_final_message_invalid");
  source.scenes.forEach((item, offset) => {
    const scene = object(item);
    if (Object.keys(scene).length !== 1 || scene.index !== job.expectedSceneIndices[offset]) throw new Error("ai_content_visual_session_final_message_invalid");
  });
}
