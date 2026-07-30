import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { loadCardNewsResult } from "./manifest.js";

describe("card-news manifest", () => {
  it("accepts a square PNG at its generated dimensions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-news-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({ title: "여름 추천", content: { caption: "본문", hashtags: ["여름"], cta: "저장" } }));
    await writeFile(path.join(dir, "slide-01.png"), await sharp({ create: { width: 1254, height: 1254, channels: 3, background: "#fff" } }).png().toBuffer());
    await expect(loadCardNewsResult(dir, "1:1")).resolves.toMatchObject({
      manifest: { type: "card_news", assets: [{ width: 1254, height: 1254 }] },
    });
  });

  it.each([
    ["4:5", 1000, 1250],
    ["16:9", 1600, 900],
    ["9:16", 900, 1600],
  ] as const)("accepts the selected %s ratio", async (aspectRatio, width, height) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-news-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({ title: "x", content: { caption: "x", hashtags: [], cta: "x" } }));
    await writeFile(path.join(dir, "slide-01.png"), await sharp({ create: { width, height, channels: 3, background: "#fff" } }).png().toBuffer());
    await expect(loadCardNewsResult(dir, aspectRatio)).resolves.toMatchObject({
      manifest: { assets: [{ width, height }] },
    });
  });

  it("rejects a non-square slide", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-news-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({ title: "x", content: { caption: "x", hashtags: [], cta: "x" } }));
    await writeFile(path.join(dir, "slide-01.png"), await sharp({ create: { width: 1080, height: 1920, channels: 3, background: "#fff" } }).png().toBuffer());
    await expect(loadCardNewsResult(dir, "1:1")).rejects.toThrow("card_news_asset_dimensions_invalid");
  });

  it("rejects a square slide when 4:5 was selected", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "card-news-test-"));
    await writeFile(path.join(dir, "content.json"), JSON.stringify({ title: "x", content: { caption: "x", hashtags: [], cta: "x" } }));
    await writeFile(path.join(dir, "slide-01.png"), await sharp({ create: { width: 1254, height: 1254, channels: 3, background: "#fff" } }).png().toBuffer());
    await expect(loadCardNewsResult(dir, "4:5")).rejects.toThrow("card_news_asset_dimensions_invalid");
  });
});
