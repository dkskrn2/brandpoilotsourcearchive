import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CardNewsAspectRatio, LocalCardNewsResult } from "./contracts.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("card_news_manifest_invalid");
  return value as Record<string, unknown>;
}

const ratioParts: Record<CardNewsAspectRatio, readonly [number, number]> = {
  "1:1": [1, 1],
  "4:5": [4, 5],
  "16:9": [16, 9],
  "9:16": [9, 16],
};

export async function loadCardNewsResult(outputDir: string, aspectRatio: CardNewsAspectRatio): Promise<LocalCardNewsResult> {
  const raw = record(JSON.parse(await readFile(path.join(outputDir, "content.json"), "utf8")));
  const files = (await readdir(outputDir)).filter((name) => /^slide-\d{2}\.png$/i.test(name)).sort();
  if (files.length < 1 || files.length > 5) throw new Error("card_news_slide_count_invalid");
  const content = record(raw.content);
  if (typeof raw.title !== "string" || !raw.title.trim() || typeof content.caption !== "string" || typeof content.cta !== "string" || !Array.isArray(content.hashtags) || content.hashtags.length > 5) throw new Error("card_news_content_invalid");
  const assets = await Promise.all(files.map(async (fileName, index) => {
    const bytes = await readFile(path.join(outputDir, fileName));
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const [ratioWidth, ratioHeight] = ratioParts[aspectRatio];
    if (metadata.format !== "png" || !metadata.width || !metadata.height || metadata.width * ratioHeight !== metadata.height * ratioWidth) throw new Error("card_news_asset_dimensions_invalid");
    return { role: "slide" as const, fileName, mimeType: "image/png" as const, width: metadata.width, height: metadata.height, index: index + 1, bytes };
  }));
  return {
    manifest: { version: "ai-content.v1", type: "card_news", title: raw.title.trim(), assets: assets.map(({ bytes: _bytes, ...asset }) => asset), content: { caption: content.caption.trim(), hashtags: content.hashtags.map(String), cta: content.cta.trim() } },
    assets,
  };
}

export async function loadAnalysis(outputDir: string) {
  const analysis = record(JSON.parse(await readFile(path.join(outputDir, "analysis.json"), "utf8")));
  if (Object.keys(analysis).length === 0) throw new Error("card_news_analysis_invalid");
  return analysis;
}
