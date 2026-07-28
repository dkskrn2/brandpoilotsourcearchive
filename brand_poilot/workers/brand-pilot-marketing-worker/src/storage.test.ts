import { describe, expect, it, vi } from "vitest";
import { createStorage } from "./storage.js";

describe("marketing storage", () => {
  it("preserves the legacy single-image asset contract", async () => {
    const put = vi.fn(async (key: string) => ({ url: `https://blob.example/${key}` }));
    const storage = createStorage("token", put as never);
    const result = await storage.upload({
      brandId: "brand-1",
      generationId: "generation-1",
      outputId: "output-1",
      result: {
        outputFormat: "single_image",
        title: "광고",
        content: { headline: "혜택", body: "설명", cta: "문의", concept: "대상 → 가치" },
        creative: Buffer.from("png"),
        dimensions: { width: 1080, height: 1080 },
      },
    });
    expect(put.mock.calls.map(([key]) => key)).toEqual([
      "brands/brand-1/ai-content/generation-1/marketing/output-1/creative.png",
      "brands/brand-1/ai-content/generation-1/marketing/output-1/manifest.json",
    ]);
    expect(result.manifest).toMatchObject({
      outputFormat: "single_image",
      assets: [{
        role: "creative",
        fileName: "creative.png",
        mimeType: "image/png",
        width: 1080,
        height: 1080,
      }],
    });
  });

  it("uploads only a text artifact and manifest for channel text", async () => {
    const put = vi.fn(async (key: string) => ({ url: `https://blob.example/${key}` }));
    const storage = createStorage("token", put as never);
    const result = await storage.upload({
      brandId: "brand-1",
      generationId: "generation-1",
      outputId: "output-1",
      result: {
        outputFormat: "channel_text",
        title: "채널 글",
        content: { headline: "혜택", body: "설명", cta: "문의", concept: "대상 → 가치" },
        text: "혜택\n설명\n문의",
      },
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls.map(([key]) => key)).toEqual([
      "brands/brand-1/ai-content/generation-1/marketing/output-1/channel-text.txt",
      "brands/brand-1/ai-content/generation-1/marketing/output-1/manifest.json",
    ]);
    expect(result.manifest).toMatchObject({
      outputFormat: "channel_text",
      assets: [{ role: "text", mimeType: "text/plain" }],
    });
  });
});
