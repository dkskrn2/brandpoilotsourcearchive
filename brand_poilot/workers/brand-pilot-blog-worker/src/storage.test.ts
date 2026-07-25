import { describe, expect, it, vi } from "vitest";
import { createStorage } from "./storage.js";

describe("blog storage", () => {
  it("uploads body images and rewrites their HTML sources to public URLs", async () => {
    const put = vi.fn(async (pathname: string, _body: unknown, _options: unknown) => ({ url: `https://blob.example/${pathname}` }));
    const storage = createStorage("token", put as never);
    const result = await storage.upload({
      brandId: "brand-1",
      generationId: "generation-1",
      outputId: "output-1",
      result: {
        metadata: { title: "제목", summary: "요약", metaTitle: "메타", metaDescription: "설명" },
        html: '<article><h1>제목</h1><img src="./inline-01.png" alt="본문 설명"></article>',
        cover: Buffer.from("cover"),
        inlineImages: [{ fileName: "inline-01.png", bytes: Buffer.from("inline"), width: 1200, height: 800 }]
      }
    });

    const articleCall = put.mock.calls.find(([pathname]) => String(pathname).endsWith("article.html"));
    expect(String(articleCall?.[1])).toContain("https://blob.example/brands/brand-1/ai-content/generation-1/blog/output-1/inline-01.png");
    expect(String(articleCall?.[1])).toContain("max-width:760px");
    expect(result.manifest).toMatchObject({
      assets: [
        { role: "cover", index: 1 },
        { role: "inline", fileName: "inline-01.png", index: 2 },
        { role: "html", index: 3 }
      ]
    });
  });

  it("stores cover and HTML when no inline image is necessary", async () => {
    const put = vi.fn(async (pathname: string, _body: unknown, _options: unknown) => ({ url: `https://blob.example/${pathname}` }));
    const storage = createStorage("token", put as never);
    const result = await storage.upload({
      brandId: "brand-1",
      generationId: "generation-1",
      outputId: "output-1",
      result: {
        metadata: { title: "제목", summary: "요약", metaTitle: "메타", metaDescription: "설명" },
        html: "<article><h1>제목</h1><p>본문만으로 충분한 설명</p></article>",
        cover: Buffer.from("cover"),
        inlineImages: [],
      },
    });

    expect(result.manifest).toMatchObject({
      assets: [
        { role: "cover", index: 1 },
        { role: "html", index: 2 },
      ],
    });
  });
});
