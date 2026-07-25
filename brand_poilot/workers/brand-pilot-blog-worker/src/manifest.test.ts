import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { loadBlogResult } from "./manifest.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function blogDirectory(inlineImageCount = 1) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "blog-result-"));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, "content.json"), JSON.stringify({ title: "제목", summary: "요약", metaTitle: "메타 제목", metaDescription: "메타 설명", coverAlt: "대표 이미지" }));
  const inlineHtml = Array.from(
    { length: inlineImageCount },
    (_, index) => `<img src="./inline-${String(index + 1).padStart(2, "0")}.png" alt="${index + 1}단계 핵심 흐름 설명 이미지">`,
  ).join("");
  await writeFile(path.join(directory, "article.html"), `<article><h1>제목</h1><section><h2>핵심</h2><p>설명</p>${inlineHtml}</section></article>`);
  await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#fff" } }).png().toFile(path.join(directory, "cover.png"));
  await Promise.all(Array.from({ length: inlineImageCount }, (_, index) => (
    sharp({ create: { width: 1200, height: 800, channels: 3, background: "#eee" } })
      .png()
      .toFile(path.join(directory, `inline-${String(index + 1).padStart(2, "0")}.png`))
  )));
  return directory;
}

describe("blog result manifest", () => {
  it("loads a body image referenced by the HTML", async () => {
    const result = await loadBlogResult(await blogDirectory());
    expect(result.inlineImages).toHaveLength(1);
    expect(result.inlineImages[0]).toMatchObject({ fileName: "inline-01.png", width: 1200, height: 800 });
  });

  it("accepts a blog with no inline images", async () => {
    const result = await loadBlogResult(await blogDirectory(0));
    expect(result.inlineImages).toEqual([]);
  });

  it("accepts up to five sequential inline images", async () => {
    const result = await loadBlogResult(await blogDirectory(5));
    expect(result.inlineImages.map((image) => image.fileName)).toEqual([
      "inline-01.png",
      "inline-02.png",
      "inline-03.png",
      "inline-04.png",
      "inline-05.png",
    ]);
  });

  it("rejects more than five inline images", async () => {
    await expect(loadBlogResult(await blogDirectory(6))).rejects.toThrow("blog_inline_image_count_invalid");
  });
});
