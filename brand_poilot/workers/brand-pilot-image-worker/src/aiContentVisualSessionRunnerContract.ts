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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ai_content_visual_session_final_message_contract_invalid");
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || source.contractVersion !== "ai-content-visual-session-render.v1" || !Array.isArray(source.scenes)
    || source.scenes.length !== job.expectedSceneIndices.length) throw new Error("ai_content_visual_session_final_message_contract_invalid");
  source.scenes.forEach((item, offset) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("ai_content_visual_session_final_message_scene_invalid");
    }
    const scene = item as Record<string, unknown>;
    if (Object.keys(scene).length !== 1 || scene.index !== job.expectedSceneIndices[offset]) {
      throw new Error("ai_content_visual_session_final_message_scene_invalid");
    }
  });
}

export function parseAiContentVisualSessionFinalMessage(
  message: string,
  job: AiContentVisualSessionRunnerJob,
): void {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    throw new Error("ai_content_visual_session_final_message_json_invalid");
  }
  parseAiContentVisualSessionRunnerResult(value, job);
}
