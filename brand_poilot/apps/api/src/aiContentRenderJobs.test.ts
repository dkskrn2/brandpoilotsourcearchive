import { describe, expect, it } from "vitest";
import {
  createAiContentRenderJobsRepository,
  expectedAiContentAssetDimensions,
  expectedAiContentAssetStoragePath,
  parseRenderManifestUrl,
  parseRenderAssetResult,
} from "./aiContentRenderJobs.js";

describe("ai-content render job boundary helpers", () => {
  it("derives one deterministic path and exact dimensions from the frozen identity", () => {
    expect(expectedAiContentAssetStoragePath({ brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2 }))
      .toBe("ai-content/brand/generation/output/assets/02.png");
    expect(expectedAiContentAssetDimensions("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(expectedAiContentAssetDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("accepts only the leased asset index, deterministic path, png dimensions, checksum, and https URL", () => {
    const context = { brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2, outputFormat: "marketing_content" as const, aspectRatio: "4:5" as const };
    const storagePath = "ai-content/brand/generation/output/assets/02.png";
    const asset = {
      index: 2, url: `https://assets.public.blob.vercel-storage.com/${storagePath}`,
      storagePath, mimeType: "image/png" as const,
      width: 1080, height: 1350, checksum: "a".repeat(64),
    };
    expect(parseRenderAssetResult(asset, context)).toEqual(asset);
    for (const patch of [
      { index: 1 }, { storagePath: "ai-content/brand/generation/output/assets/01.png" },
      { mimeType: "image/webp" }, { width: 1200 }, { checksum: "bad" }, { url: "http://blob.example/render.png" },
    ]) {
      expect(() => parseRenderAssetResult({ ...asset, ...patch }, context)).toThrow("ai_content_render_asset_invalid");
    }
  });

  it.each([
    ["card_news", "1:1", 1024, 1024],
    ["reel", "9:16", 720, 1280],
    ["blog", "16:9", 1600, 900],
  ] as const)("accepts provider-sized %s assets without forcing fixed pixels", (outputFormat, aspectRatio, width, height) => {
    const storagePath = "ai-content/brand/generation/output/assets/02.png";
    const asset = {
      index: 2,
      url: `https://assets.public.blob.vercel-storage.com/${storagePath}`,
      storagePath,
      mimeType: "image/png" as const,
      width,
      height,
      checksum: "a".repeat(64),
    };

    expect(parseRenderAssetResult(asset, {
      brandId: "brand",
      generationId: "generation",
      outputId: "output",
      assetIndex: 2,
      outputFormat,
      aspectRatio,
    })).toEqual(asset);
  });

  it.each([
    ["card_news", "1:1", 1024, 1023],
    ["reel", "9:16", 720, 1279],
  ] as const)("rejects a %s asset that violates its required ratio", (outputFormat, aspectRatio, width, height) => {
    const storagePath = "ai-content/brand/generation/output/assets/02.png";
    expect(() => parseRenderAssetResult({
      index: 2,
      url: `https://assets.public.blob.vercel-storage.com/${storagePath}`,
      storagePath,
      mimeType: "image/png",
      width,
      height,
      checksum: "a".repeat(64),
    }, {
      brandId: "brand",
      generationId: "generation",
      outputId: "output",
      assetIndex: 2,
      outputFormat,
      aspectRatio,
    })).toThrow("ai_content_render_asset_invalid");
  });

  it.each([
    ["different pathname", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/assets/01.png"],
    ["encoded path confusion", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/assets%252F02.png"],
    ["unapproved host", "https://attacker.blob.vercel-storage.com/ai-content/brand/generation/output/assets/02.png"],
    ["literal dot segment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/tmp/../assets/02.png"],
    ["percent-encoded dot segment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/tmp/%2e%2e/assets/02.png"],
    ["mixed percent-encoded dot segment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/tmp/.%2e/assets/02.png"],
    ["query", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/assets/02.png?download=1"],
    ["fragment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/assets/02.png#worker-result"],
    ["non-default HTTPS port", "https://assets.public.blob.vercel-storage.com:444/ai-content/brand/generation/output/assets/02.png"],
  ])("rejects an asset URL with %s using the stable boundary error", (_case, url) => {
    const context = { brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2, outputFormat: "marketing_content" as const, aspectRatio: "4:5" as const };
    expect(() => parseRenderAssetResult({
      index: 2,
      url,
      storagePath: "ai-content/brand/generation/output/assets/02.png",
      mimeType: "image/png",
      width: 1080,
      height: 1350,
      checksum: "a".repeat(64),
    }, context)).toThrow("ai_content_render_asset_invalid");
  });

  it.each([
    ["different pathname", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/other.json"],
    ["unapproved host", "https://attacker.blob.vercel-storage.com/ai-content/brand/generation/output/manifest.json"],
    ["literal dot segment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/tmp/../manifest.json"],
    ["percent-encoded dot segment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/tmp/%2e%2e/manifest.json"],
    ["query", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/manifest.json?download=1"],
    ["fragment", "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/manifest.json#worker-result"],
    ["non-default HTTPS port", "https://assets.public.blob.vercel-storage.com:444/ai-content/brand/generation/output/manifest.json"],
  ])("rejects a completed package manifest URL with %s", (_case, manifestUrl) => {
    expect(() => parseRenderManifestUrl(manifestUrl, {
      brandId: "brand",
      generationId: "generation",
      outputId: "output",
    })).toThrow("ai_content_render_manifest_invalid");
  });

  it("accepts a completed package manifest URL at the exact deterministic Vercel Blob path", () => {
    const manifestUrl = "https://assets.public.blob.vercel-storage.com/ai-content/brand/generation/output/manifest.json";
    expect(parseRenderManifestUrl(manifestUrl, {
      brandId: "brand",
      generationId: "generation",
      outputId: "output",
    }).toString()).toBe(manifestUrl);
  });

  it("serializes concurrent last-asset completions per output so exactly one finalizer is created", async () => {
    const identity = { workspace: "workspace", brand: "brand", generation: "generation", output: "output" };
    const imagePackage = { outputFormat: "marketing_content", aspectRatio: "1:1" };
    const committed = new Map([
      ["job-1", { status: "processing", assetIndex: 1, leaseToken: "lease-1" }],
      ["job-2", { status: "processing", assetIndex: 2, leaseToken: "lease-2" }],
    ]);
    let outputLockOwner: symbol | null = null;
    const outputLockWaiters: Array<() => void> = [];
    let unlockedCountArrivals = 0;
    let releaseUnlockedCounts: (() => void) | null = null;
    const unlockedCountBarrier = new Promise<void>((resolve) => { releaseUnlockedCounts = resolve; });
    let finalizerCount = 0;

    const pool = {
      connect: async () => {
        const transaction = {
          id: Symbol("transaction"), localStatuses: new Map<string, string>(), insertsFinalizer: false, holdsOutputLock: false,
        };
        const releaseOutputLock = () => {
          if (!transaction.holdsOutputLock || outputLockOwner !== transaction.id) return;
          outputLockOwner = null;
          transaction.holdsOutputLock = false;
          outputLockWaiters.shift()?.();
        };
        const query = async (sql: string, params: unknown[] = []) => {
          const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
          if (normalized === "begin") return { rows: [] };
          if (normalized === "commit") {
            for (const [jobId, status] of transaction.localStatuses) committed.get(jobId)!.status = status;
            if (transaction.insertsFinalizer && finalizerCount === 0) finalizerCount += 1;
            releaseOutputLock();
            return { rows: [] };
          }
          if (normalized === "rollback") { releaseOutputLock(); return { rows: [] }; }
          if (normalized.includes("select output_id,generation_id,workspace_id,brand_id") && normalized.includes("ai_content_generation_render_jobs")) {
            const job = committed.get(String(params[0]));
            return { rows: job ? [{ output_id: identity.output, generation_id: identity.generation, workspace_id: identity.workspace, brand_id: identity.brand }] : [] };
          }
          if (normalized.includes("from ai_content_generation_outputs") && normalized.endsWith("for update")) {
            if (outputLockOwner !== null && outputLockOwner !== transaction.id) {
              await new Promise<void>((resolve) => outputLockWaiters.push(resolve));
            }
            outputLockOwner = transaction.id;
            transaction.holdsOutputLock = true;
            return { rows: [{ id: identity.output }] };
          }
          if (normalized.includes("from ai_content_generation_render_jobs where id=$1 for update")) {
            const jobId = String(params[0]);
            const job = committed.get(jobId);
            return { rows: job ? [{
              id: jobId, output_id: identity.output, generation_id: identity.generation,
              workspace_id: identity.workspace, brand_id: identity.brand, job_kind: "image_asset",
              asset_index: job.assetIndex, status: transaction.localStatuses.get(jobId) ?? job.status,
              worker_id: "image-worker", lease_token: job.leaseToken, lease_expires_at: new Date(Date.now() + 60_000),
              lease_expired: false, payload_json: { imagePackage },
            }] : [] };
          }
          if (normalized.startsWith("update ai_content_generation_render_jobs set status='succeeded'")) {
            transaction.localStatuses.set(String(params[0]), "succeeded");
            return { rows: [] };
          }
          if (normalized.includes("select count(*) filter(where status<>'succeeded')")) {
            if (!transaction.holdsOutputLock) {
              unlockedCountArrivals += 1;
              if (unlockedCountArrivals === 2) releaseUnlockedCounts?.();
              await unlockedCountBarrier;
            }
            const remaining = [...committed.entries()].filter(([jobId, job]) => (
              (transaction.localStatuses.get(jobId) ?? job.status) !== "succeeded"
            )).length;
            return { rows: [{ remaining }] };
          }
          if (normalized.startsWith("insert into ai_content_generation_render_jobs") && normalized.includes("'package_finalize'")) {
            transaction.insertsFinalizer = true;
            return { rows: [] };
          }
          throw new Error(`unexpected query: ${normalized}`);
        };
        return { query, release() {} };
      },
    };
    const repository = createAiContentRenderJobsRepository(pool as never, async () => ({}) as never);
    const completion = (jobId: string, index: number, leaseToken: string) => repository.completeAsset({
      jobId, workerId: "image-worker", leaseToken, jobKind: "image_asset",
      asset: { index, url: `https://assets.public.blob.vercel-storage.com/ai-content/${identity.brand}/${identity.generation}/${identity.output}/assets/0${index}.png`, storagePath: `ai-content/${identity.brand}/${identity.generation}/${identity.output}/assets/0${index}.png`, mimeType: "image/png", width: 1080, height: 1080, checksum: String(index).repeat(64) },
    });

    await Promise.all([completion("job-1", 1, "lease-1"), completion("job-2", 2, "lease-2")]);
    expect(finalizerCount).toBe(1);
  });
});
