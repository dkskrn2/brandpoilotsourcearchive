import { put } from "@vercel/blob"; import type { LocalMarketingResult } from "./contracts.js";
export interface MarketingStorage { upload(input: { brandId: string; generationId: string; outputId: string; result: LocalMarketingResult }): Promise<{ manifest: Record<string, unknown>; manifestUrl: string }>; }
export function createStorage(token: string, putImpl: typeof put = put): MarketingStorage {
  return {
    async upload({ brandId, generationId, outputId, result }) {
      const root = `brands/${brandId}/ai-content/${generationId}/marketing/${outputId}`;
      const metadata = {
        ...(result.family ? { family: result.family } : {}),
        ...(result.strategy ? { strategy: result.strategy } : {}),
        outputFormat: result.outputFormat,
      };
      const assets = result.outputFormat === "channel_text"
        ? [{
          role: "text",
          url: (await putImpl(`${root}/channel-text.txt`, result.text, {
            access: "public",
            allowOverwrite: true,
            contentType: "text/plain",
            token,
          })).url,
          fileName: "channel-text.txt",
          mimeType: "text/plain",
          index: 1,
        }]
        : [{
          role: "creative",
          url: (await putImpl(`${root}/creative.png`, result.creative, {
            access: "public",
            allowOverwrite: true,
            contentType: "image/png",
            token,
          })).url,
          fileName: "creative.png",
          mimeType: "image/png",
          width: result.dimensions.width,
          height: result.dimensions.height,
          index: 1,
        }];
      const manifest = {
        version: "ai-content.v1",
        type: "marketing",
        title: result.title,
        assets,
        content: result.content,
        ...metadata,
      };
      const stored = await putImpl(`${root}/manifest.json`, JSON.stringify(manifest), {
        access: "public",
        allowOverwrite: true,
        contentType: "application/json",
        token,
      });
      return { manifest, manifestUrl: stored.url };
    },
  };
}
