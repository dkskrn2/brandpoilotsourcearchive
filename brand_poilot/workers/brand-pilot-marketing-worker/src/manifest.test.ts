import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadMarketingResult, requestedDimensions } from "./manifest.js";

describe("marketing manifest", () => {
  it("derives dimensions from the v2 creative direction", () => {
    expect(requestedDimensions({ creativeDirection: { aspectRatio: "4:5" } })).toEqual({ width: 1080, height: 1350 });
    expect(requestedDimensions({ creativeDirection: { aspectRatio: "16:9" } })).toEqual({ width: 1920, height: 1080 });
    expect(requestedDimensions({ creativeDirection: { aspectRatio: "9:16" } })).toEqual({ width: 1080, height: 1920 });
    expect(requestedDimensions({ creativeDirection: { aspectRatio: "1:1" } })).toEqual({ width: 1080, height: 1080 });
  });

  it("rejects output dimensions that differ from the request", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "marketing-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({
      content: { headline: "혜택", body: "설명", cta: "문의", concept: "대상 → 가치" },
    }));
    await writeFile(
      path.join(dir, "creative.png"),
      await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#fff" } }).png().toBuffer(),
    );
    await expect(loadMarketingResult(dir, { width: 1080, height: 1920 }, "single_image"))
      .rejects.toThrow("marketing_asset_dimensions_mismatch");
  });

  it("loads channel text without requiring a creative image", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "marketing-text-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({
      title: "채널 글",
      content: { headline: "혜택", body: "검증된 설명", cta: "자세히 보기", concept: "대상 → 가치" },
    }));
    await writeFile(path.join(dir, "channel-text.txt"), "혜택\n검증된 설명\n자세히 보기", "utf8");
    await expect(loadMarketingResult(dir, { width: 1080, height: 1080 }, "channel_text"))
      .resolves.toMatchObject({
        outputFormat: "channel_text",
        text: "혜택\n검증된 설명\n자세히 보기",
        title: "채널 글",
      });
  });
});
