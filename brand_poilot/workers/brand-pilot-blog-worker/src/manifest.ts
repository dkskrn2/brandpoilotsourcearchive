import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { LocalBlogImage, LocalBlogResult } from "./contracts.js";
import { validateGeneratedBlogHtml } from "./htmlValidator.js";
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("blog_content_invalid"); return value as Record<string, unknown>; }
export async function loadAnalysis(outputDir: string) { const value = record(JSON.parse(await readFile(path.join(outputDir, "analysis.json"), "utf8"))); if (!Object.keys(value).length) throw new Error("blog_analysis_invalid"); return value; }
export async function loadBlogResult(outputDir: string): Promise<LocalBlogResult> {
  const raw = record(JSON.parse(await readFile(path.join(outputDir, "content.json"), "utf8")));
  for (const key of ["title", "summary", "metaTitle", "metaDescription"] as const) if (typeof raw[key] !== "string" || !String(raw[key]).trim()) throw new Error(`blog_${key}_invalid`);
  const inlineFileNames = (await readdir(outputDir))
    .filter((fileName) => /^inline-\d{2}\.png$/.test(fileName))
    .sort();
  if (inlineFileNames.length > 5) throw new Error("blog_inline_image_count_invalid");
  inlineFileNames.forEach((fileName, index) => {
    if (fileName !== `inline-${String(index + 1).padStart(2, "0")}.png`) throw new Error("blog_inline_image_sequence_invalid");
  });
  const inlineImages: LocalBlogImage[] = await Promise.all(inlineFileNames.map(async (fileName) => {
    const bytes = await readFile(path.join(outputDir, fileName));
    const imageMetadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (imageMetadata.format !== "png" || imageMetadata.width !== 1200 || imageMetadata.height !== 800) {
      throw new Error("blog_inline_image_dimensions_invalid");
    }
    return { fileName, bytes, width: imageMetadata.width, height: imageMetadata.height };
  }));
  const html = validateGeneratedBlogHtml(
    await readFile(path.join(outputDir, "article.html"), "utf8"),
    inlineFileNames,
  ).html;
  const cover = await readFile(path.join(outputDir, "cover.png")); const metadata = await sharp(cover, { failOn: "error" }).metadata();
  if (metadata.format !== "png" || metadata.width !== 1200 || metadata.height !== 630) throw new Error("blog_cover_dimensions_invalid");
  return { metadata: { title: String(raw.title), summary: String(raw.summary), metaTitle: String(raw.metaTitle), metaDescription: String(raw.metaDescription), coverAlt: typeof raw.coverAlt === "string" ? raw.coverAlt : undefined, sections: Array.isArray(raw.sections) ? raw.sections : [] }, html, cover, inlineImages };
}
