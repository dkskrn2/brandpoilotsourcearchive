export interface PreviewAdapter {
  analyze(): Promise<"succeeded">;
  generateCardNews(): Promise<"succeeded">;
}

export const PREVIEW_PHASE_DURATION_MS = 700;
export const PREVIEW_DEFAULT_DELAY_MS = PREVIEW_PHASE_DURATION_MS * 3;

export function createMockPreviewAdapter(options: {
  analysisResult?: "succeeded" | "failed";
  generationResults?: Array<"succeeded" | "failed">;
  delayMs?: number;
} = {}): PreviewAdapter {
  const queue = [...(options.generationResults ?? ["succeeded"])];
  const wait = () => new Promise<void>((resolve) => {
    window.setTimeout(resolve, options.delayMs ?? PREVIEW_DEFAULT_DELAY_MS);
  });

  return {
    async analyze() {
      await wait();
      if (options.analysisResult === "failed") {
        throw new Error("mock_analysis_failed");
      }
      return "succeeded";
    },
    async generateCardNews() {
      await wait();
      if ((queue.shift() ?? "succeeded") === "failed") {
        throw new Error("mock_generation_failed");
      }
      return "succeeded";
    },
  };
}
