import { put } from "@vercel/blob";
import * as cheerio from "cheerio";
import type { LocalBlogResult } from "./contracts.js";
export interface BlogStorage { upload(input: { brandId: string; generationId: string; outputId: string; result: LocalBlogResult }): Promise<{ manifest: Record<string, unknown>; manifestUrl: string }>; }

const articleStyles = `
html{background:#fff;color:#172033}body{margin:0;background:#fff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
article{box-sizing:border-box;width:calc(100% - 32px);max-width:760px;margin:0 auto;padding:32px 0 56px;font-size:17px;line-height:1.8;word-break:keep-all;overflow-wrap:anywhere}
h1,h2,h3{line-height:1.35}h1{font-size:36px;margin:0 0 28px}h2{font-size:25px;margin:48px 0 16px}h3{font-size:20px;margin:32px 0 12px}
p,ul,ol,blockquote{margin:0 0 20px}img{display:block;width:100%;height:auto;margin:28px auto 10px;border-radius:8px}figure{margin:28px 0}figure img{margin:0}figcaption{margin-top:8px;color:#667085;font-size:14px}
@media(max-width:600px){article{width:min(100% - 24px,760px);padding-top:22px;font-size:16px}h1{font-size:30px}h2{font-size:22px}}
`.trim();

function publicBlogHtml(html: string, imageUrls: Map<string, string>): string {
  const $ = cheerio.load(html);
  $("article img").each((_index, element) => {
    const source = ($(element).attr("src") ?? "").trim().replace(/^\.\//, "");
    const publicUrl = imageUrls.get(source);
    if (publicUrl) $(element).attr("src", publicUrl).attr("loading", "lazy").attr("decoding", "async");
  });
  $("head").append('<meta name="viewport" content="width=device-width,initial-scale=1">');
  $("head").append(`<style data-brand-pilot-blog>${articleStyles}</style>`);
  return $.html();
}

export function createStorage(token: string, putImpl: typeof put = put): BlogStorage {
  return {
    async upload({ brandId, generationId, outputId, result }) {
      const root = `brands/${brandId}/ai-content/${generationId}/blog/${outputId}`;
      const cover = await putImpl(`${root}/cover.png`, result.cover, { access: "public", allowOverwrite: true, contentType: "image/png", token });
      const inlineAssets = [];
      const imageUrls = new Map<string, string>();
      for (const [index, image] of result.inlineImages.entries()) {
        const storedImage = await putImpl(`${root}/${image.fileName}`, image.bytes, { access: "public", allowOverwrite: true, contentType: "image/png", token });
        imageUrls.set(image.fileName, storedImage.url);
        inlineAssets.push({ role: "inline", url: storedImage.url, fileName: image.fileName, mimeType: "image/png", width: image.width, height: image.height, index: index + 2 });
      }
      const html = publicBlogHtml(result.html, imageUrls);
      const article = await putImpl(`${root}/article.html`, html, { access: "public", allowOverwrite: true, contentType: "text/html; charset=utf-8", token });
      const manifest = {
        version: "ai-content.v1",
        type: "blog",
        title: result.metadata.title,
        assets: [
          { role: "cover", url: cover.url, fileName: "cover.png", mimeType: "image/png", width: 1200, height: 630, index: 1 },
          ...inlineAssets,
          { role: "html", url: article.url, fileName: "article.html", mimeType: "text/html", index: result.inlineImages.length + 2 },
        ],
        content: { ...result.metadata, html },
      };
      const stored = await putImpl(`${root}/manifest.json`, JSON.stringify(manifest), { access: "public", allowOverwrite: true, contentType: "application/json", token });
      return { manifest, manifestUrl: stored.url };
    },
  };
}
