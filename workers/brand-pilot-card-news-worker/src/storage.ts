import { put } from "@vercel/blob";
import type { CardNewsManifest, LocalCardNewsResult } from "./contracts.js";

export interface CardNewsStorage {
  upload(input: { brandId: string; generationId: string; outputId: string; result: LocalCardNewsResult }): Promise<{ manifest: CardNewsManifest; manifestUrl: string }>;
}

export function createStorage(token: string, putImpl: typeof put = put): CardNewsStorage {
  return {
    async upload({ brandId, generationId, outputId, result }) {
      const root = `brands/${brandId}/ai-content/${generationId}/card_news/${outputId}`;
      const assets = [];
      for (const asset of result.assets) {
        const stored = await putImpl(`${root}/${asset.fileName}`, asset.bytes, { access: "public", allowOverwrite: true, contentType: "image/png", token });
        assets.push({ ...asset, bytes: undefined, url: stored.url });
      }
      const manifest: CardNewsManifest = { ...result.manifest, assets: assets.map(({ bytes: _bytes, ...asset }) => asset) };
      await putImpl(`${root}/content.json`, JSON.stringify(manifest.content), { access: "public", allowOverwrite: true, contentType: "application/json", token });
      const storedManifest = await putImpl(`${root}/manifest.json`, JSON.stringify(manifest), { access: "public", allowOverwrite: true, contentType: "application/json", token });
      return { manifest, manifestUrl: storedManifest.url };
    },
  };
}
