type AiContentAssetRunnerJobV1 = {
  prompt: string;
  selectedAssetCount: 1;
};

type AiContentAssetRunnerJobV2 = {
  prompt: string;
  contractVersion: "ai-content-asset-render.v2";
  assetIndex: number;
};

export type AiContentAssetRunnerJob = AiContentAssetRunnerJobV1 | AiContentAssetRunnerJobV2;

export type AiContentAssetRenderResult =
  | { contractVersion: "ai-content-asset-render.v1"; selectedAssetCount: 1 }
  | { contractVersion: "ai-content-asset-render.v2"; assetIndex: number; status: "completed" };

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? source : null;
}

function validPrompt(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseAiContentAssetRunnerJob(value: unknown): AiContentAssetRunnerJob {
  const v1 = exactRecord(value, ["prompt", "selectedAssetCount"]);
  if (v1 && validPrompt(v1.prompt) && v1.selectedAssetCount === 1) {
    return { prompt: v1.prompt, selectedAssetCount: 1 };
  }
  const v2 = exactRecord(value, ["prompt", "contractVersion", "assetIndex"]);
  if (
    v2
    && validPrompt(v2.prompt)
    && v2.contractVersion === "ai-content-asset-render.v2"
    && Number.isInteger(v2.assetIndex)
    && Number(v2.assetIndex) >= 1
  ) {
    return {
      prompt: v2.prompt,
      contractVersion: "ai-content-asset-render.v2",
      assetIndex: Number(v2.assetIndex),
    };
  }
  throw new Error("ai_content_asset_job_invalid");
}

export function parseAiContentAssetRenderResult(
  value: unknown,
  job: AiContentAssetRunnerJob,
): AiContentAssetRenderResult {
  if ("selectedAssetCount" in job) {
    const source = exactRecord(value, ["contractVersion", "selectedAssetCount"]);
    if (source?.contractVersion === "ai-content-asset-render.v1" && source.selectedAssetCount === 1) {
      return { contractVersion: "ai-content-asset-render.v1", selectedAssetCount: 1 };
    }
  } else {
    const source = exactRecord(value, ["contractVersion", "assetIndex", "status"]);
    if (
      source?.contractVersion === "ai-content-asset-render.v2"
      && source.assetIndex === job.assetIndex
      && source.status === "completed"
    ) {
      return {
        contractVersion: "ai-content-asset-render.v2",
        assetIndex: job.assetIndex,
        status: "completed",
      };
    }
  }
  throw new Error("ai_content_asset_final_message_invalid");
}
