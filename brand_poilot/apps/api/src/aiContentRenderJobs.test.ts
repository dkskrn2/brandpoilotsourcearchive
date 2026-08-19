import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { compileCardManuscriptPlanDraftV1 } from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import { compileReelStoryboardDraftV1 } from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardSha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import {
  createAiContentRenderJobsRepository,
  enqueueAiContentRenderJobs,
  expectedAiContentAssetDimensions,
  expectedAiContentAssetStoragePath,
  parseRenderManifestUrl,
  parseRenderAssetResult,
} from "./aiContentRenderJobs.js";

describe("ai-content render job boundary helpers", () => {
  it("keeps every editorial audit insert compatible with the INSERT-only runtime role", () => {
    const source = readFileSync(new URL("./aiContentRenderJobs.ts", import.meta.url), "utf8")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(source).not.toContain("on conflict (id) do nothing");
  });

  it("records editorial diagnostics idempotently with INSERT-only audit privileges", async () => {
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (["begin", "commit", "rollback"].includes(normalized)) return { rows: [] };
        if (normalized.includes("from ai_content_generation_render_jobs where id=$1 for update")) {
          return { rows: [{
            id: "10000000-0000-4000-8000-000000000001",
            workspace_id: "20000000-0000-4000-8000-000000000001",
            brand_id: "30000000-0000-4000-8000-000000000001",
            status: "succeeded", job_kind: "image_asset", asset_index: 1,
            worker_id: "image-worker", lease_token: "lease",
            payload_json: {
              contractVersion: "ai-content-visual-session-render-job.v1",
              visualSessionBinding: {
                sourceContractVersion: "card-manuscript-plan.v1",
                sourceSha256: "a".repeat(64),
                sceneIndex: 1,
              },
            },
          }] };
        }
        if (normalized.startsWith("insert into audit_events")) {
          if (normalized.includes("from audit_events")) throw new Error("audit_select_forbidden");
          inserts.push({ sql: normalized, params });
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query: ${normalized}`);
      },
      release() {},
    };
    const repository = createAiContentRenderJobsRepository({ connect: async () => client } as never, async () => ({}) as never);
    const diagnostic = {
      contractVersion: "ai-content-editorial-render-diagnostic.v1" as const,
      sourceContractVersion: "card-manuscript-plan.v1" as const,
      sourceSha256: "a".repeat(64), sceneIndex: 1,
      compiledPromptVersion: "image-visual-session.v1" as const,
      compiledPromptSha256: "b".repeat(64),
      actualToolArgumentsObservation: "not_emitted_by_runner" as const,
      actualToolArgumentsSha256: null,
    };

    await repository.appendEditorialDiagnostic({
      jobId: "10000000-0000-4000-8000-000000000001", workerId: "image-worker", leaseToken: "lease", diagnostic,
    });
    await repository.appendEditorialDiagnostic({
      jobId: "10000000-0000-4000-8000-000000000001", workerId: "image-worker", leaseToken: "lease", diagnostic,
    });

    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.sql).toContain("on conflict do nothing");
    expect(inserts[0]!.sql).not.toContain("on conflict (id)");
    expect(inserts[0]!.params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(inserts[1]!.params[0]).toBe(inserts[0]!.params[0]);
  });

  it("stores the Card Manuscript visual-session binding without a legacy transport selector", async () => {
    const writes: unknown[][] = [];
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      writes.push(params);
      return { rows: [], rowCount: 1 };
    });
    const outline = [1, 2, 3].map((index) => ({ index, role: index === 1 ? "hook" : "detail" }));
    const manuscript = {
      contractVersion: "card-manuscript-plan.v1" as const,
      content: { caption: "Caption", hashtags: ["#deck"], cta: "Save" },
      deckNarrative: "A connected three-card deck.",
      evidenceSelection: { selectedEvidenceIds: [], excludedEvidenceIds: [] },
      scenes: [1, 2, 3].map((index) => ({
        index,
        editorialRole: "transition",
        purpose: `Purpose ${index}`,
        coreMessage: `Core ${index}`,
        headline: `Headline ${index}`,
        informationRelation: { type: "number" as const, entries: [{ role: "value" as const, label: null, value: `${index}x` }] },
        supportingTexts: [`Support ${index}`],
        footnote: null,
        evidenceIds: [],
        productImageAssetIds: [],
        avatarImageAssetIds: [],
      })),
    };
    const draft = compileCardManuscriptPlanDraftV1(manuscript, outline);
    const imagePackage = {
      contractVersion: "image-generation-package.v1" as const,
      generationId: "generation", outputFormat: "card_news" as const, purpose: "informational" as const,
      assetCount: 3, aspectRatio: "1:1" as const, channelTargets: ["instagram"] as ["instagram"],
      assets: draft.assets.map((asset) => ({ ...asset, attachmentIds: [] as string[] })),
      product: null, references: [], brandStyleImages: [], avatarStyleImageId: null,
      attachments: [], userImageInstruction: null,
      logoPolicy: {
        allowGeneratedLogo: false as const, allowReservedLogoArea: false as const,
        allowExternalReferenceLogo: false as const, allowExistingProductPackagingLogo: true as const,
      },
    };
    const cardManuscriptContract = {
      contractVersion: "card-manuscript-plan.v1" as const,
      manuscriptSha256: cardManuscriptPlanSha256(manuscript),
      plan: manuscript,
    };

    await enqueueAiContentRenderJobs({ query } as never, {
      workspaceId: "workspace", brandId: "brand", generationId: "generation", outputId: "output",
      plan: { contractVersion: "card-news-plan.v2", content: manuscript.content, imagePackage },
      finalInput: {
        outputSettings: { outputFormat: "card_news" },
        researchEvidence: { items: [] }, references: { brandStyleImages: [] },
        selectedProposal: { outline },
      } as never,
      cardManuscriptContract,
    });

    expect(writes).toHaveLength(3);
    for (const [offset, write] of writes.entries()) {
      expect(JSON.parse(String(write[5]))).toEqual({
        contractVersion: "ai-content-visual-session-render-job.v1",
        jobKind: "image_asset",
        generationId: "generation",
        outputId: "output",
        imagePackage,
        assetIndex: offset + 1,
        assetKey: `generation:${offset + 1}`,
        storagePath: `ai-content/brand/generation/output/assets/0${offset + 1}.png`,
        rendererPromptVersion: "image-visual-session.v1",
        visualSessionBinding: {
          sourceContractVersion: "card-manuscript-plan.v1",
          sourceSha256: cardManuscriptContract.manuscriptSha256,
          sceneIndex: offset + 1,
        },
      });
    }
  });

  it("stores only a version hash and scene index for a Reel Storyboard render", async () => {
    const writes: unknown[][] = [];
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      writes.push(params);
      return { rows: [], rowCount: 1 };
    });
    const outline = [{ index: 1, role: "scene" }];
    const storyboard = {
      contractVersion: "reel-storyboard.v1" as const,
      content: { caption: "Caption", hashtags: [] as string[], cta: "Save" },
      storyNarrative: "Core evidence first.",
      visualSystem: {
        paletteDirection: "High contrast", typographyDirection: "Large vertical type",
        graphicLanguage: "Editorial", imageryDirection: "Evidence first", invariants: ["Same margins"],
      },
      scenes: [{
        index: 1, editorialRole: "hook", purpose: "Lead with the conclusion", coreMessage: "Core",
        headline: "Copy", keyVisual: { type: "none" as const, entries: [] }, supportingTexts: [], footnote: null,
        visualThesis: "Make the conclusion dominant", layoutArchetype: "vertical_hook" as const,
        evidenceIds: [], productImageAssetIds: [],
      }],
    };
    const draft = compileReelStoryboardDraftV1(storyboard, outline);
    const imagePackage = {
      contractVersion: "image-generation-package.v1" as const,
      generationId: "generation",
      outputFormat: "reel" as const,
      purpose: "informational" as const,
      assetCount: 1,
      aspectRatio: "9:16" as const,
      channelTargets: ["instagram"] as ["instagram"],
      assets: draft.assets.map((asset) => ({ ...asset, attachmentIds: [] as string[] })),
      product: null, references: [], brandStyleImages: [], avatarStyleImageId: null,
      attachments: [], userImageInstruction: null,
      logoPolicy: {
        allowGeneratedLogo: false as const,
        allowReservedLogoArea: false as const,
        allowExternalReferenceLogo: false as const,
        allowExistingProductPackagingLogo: true as const,
      },
    };

    await enqueueAiContentRenderJobs({ query } as never, {
      workspaceId: "workspace", brandId: "brand", generationId: "generation", outputId: "output",
      plan: {
        contractVersion: "reel-plan.v2", outputFormat: "reel",
        content: storyboard.content, imagePackage,
      },
      finalInput: { selectedProposal: { outline } } as never,
      reelStoryboardContract: {
        contractVersion: "reel-storyboard.v1",
        storyboardSha256: reelStoryboardSha256(storyboard),
        storyboard,
      },
    });

    const payload = JSON.parse(String(writes[0]?.[5]));
    expect(payload).toEqual({
      contractVersion: "ai-content-visual-session-render-job.v1",
      jobKind: "image_asset",
      generationId: "generation",
      outputId: "output",
      imagePackage,
      assetIndex: 1,
      assetKey: "generation:1",
      storagePath: "ai-content/brand/generation/output/assets/01.png",
      rendererPromptVersion: "image-visual-session.v1",
      visualSessionBinding: {
        sourceContractVersion: "reel-storyboard.v1",
        sourceSha256: reelStoryboardSha256(storyboard),
        sceneIndex: 1,
      },
    });
    expect(payload).not.toHaveProperty("contentGenerationInput");
    expect(payload).not.toHaveProperty("contentPlan");
    expect(payload).not.toHaveProperty("reelStoryboardContract");
  });

  it("keeps a manual blog image on the existing v2 render contract", async () => {
    const writes: unknown[][] = [];
    const query = vi.fn(async (_sql: string, params: unknown[]) => {
      writes.push(params);
      return { rows: [], rowCount: 1 };
    });
    const imagePackage = {
      contractVersion: "image-generation-package.v1" as const,
      generationId: "generation", outputFormat: "blog" as const, purpose: "informational" as const,
      assetCount: 1, aspectRatio: "16:9" as const, channelTargets: ["blog_export"] as ["blog_export"],
      assets: [{
        index: 1, role: "inline", copy: "Copy", visualDirection: "Visual",
        evidenceIds: [], productImageAssetIds: [], attachmentIds: [],
      }],
      product: null, references: [], brandStyleImages: [], avatarStyleImageId: null,
      attachments: [], userImageInstruction: null,
      logoPolicy: {
        allowGeneratedLogo: false as const, allowReservedLogoArea: false as const,
        allowExternalReferenceLogo: false as const, allowExistingProductPackagingLogo: true as const,
      },
    };

    await enqueueAiContentRenderJobs({ query } as never, {
      workspaceId: "workspace", brandId: "brand", generationId: "generation", outputId: "output",
      plan: {
        contractVersion: "blog-plan.v2", imagePackage,
        content: { title: "Title", htmlTemplate: "<article><h1>Title</h1></article>", metaTitle: "Title", metaDescription: "Description", usedEvidenceIds: [] },
      },
      finalInput: { contractVersion: "content-generation-input.v3" } as never,
    });

    expect(JSON.parse(String(writes[0]?.[5]))).toMatchObject({
      contractVersion: "ai-content-render-job.v2",
      rendererPromptVersion: "image-final-pixels.v2",
    });
    expect(JSON.parse(String(writes[0]?.[5]))).not.toHaveProperty("renderSemanticBinding");
  });

  it("derives one deterministic path and exact dimensions from the frozen identity", () => {
    expect(expectedAiContentAssetStoragePath({ brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2 }))
      .toBe("ai-content/brand/generation/output/assets/02.png");
    expect(expectedAiContentAssetDimensions("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(expectedAiContentAssetDimensions("9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("accepts only the leased asset index, deterministic path, png dimensions, checksum, and https URL", () => {
    const context = { brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2, outputFormat: "card_news" as const, aspectRatio: "1:1" as const };
    const storagePath = "ai-content/brand/generation/output/assets/02.png";
    const asset = {
      index: 2, url: `https://assets.public.blob.vercel-storage.com/${storagePath}`,
      storagePath, mimeType: "image/png" as const,
      width: 1080, height: 1080, checksum: "a".repeat(64),
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
    const context = { brandId: "brand", generationId: "generation", outputId: "output", assetIndex: 2, outputFormat: "card_news" as const, aspectRatio: "1:1" as const };
    expect(() => parseRenderAssetResult({
      index: 2,
      url,
      storagePath: "ai-content/brand/generation/output/assets/02.png",
      mimeType: "image/png",
      width: 1080,
      height: 1080,
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
    const imagePackage = { outputFormat: "card_news", aspectRatio: "1:1" };
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
    const lockSequences: string[][] = [];

    const pool = {
      connect: async () => {
        const transaction = {
          id: Symbol("transaction"), localStatuses: new Map<string, string>(), insertsFinalizer: false, holdsOutputLock: false,
          lockOrder: [] as string[],
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
            lockSequences.push([...transaction.lockOrder]);
            releaseOutputLock();
            return { rows: [] };
          }
          if (normalized === "rollback") { releaseOutputLock(); return { rows: [] }; }
          if (normalized.includes("select output_id,generation_id,workspace_id,brand_id") && normalized.includes("ai_content_generation_render_jobs")) {
            const job = committed.get(String(params[0]));
            return { rows: job ? [{ output_id: identity.output, generation_id: identity.generation, workspace_id: identity.workspace, brand_id: identity.brand }] : [] };
          }
          if (normalized.includes("from ai_content_generation_outputs") && normalized.endsWith("for update")) {
            transaction.lockOrder.push("output");
            if (outputLockOwner !== null && outputLockOwner !== transaction.id) {
              await new Promise<void>((resolve) => outputLockWaiters.push(resolve));
            }
            outputLockOwner = transaction.id;
            transaction.holdsOutputLock = true;
            return { rows: [{ id: identity.output }] };
          }
          if (normalized.includes("from ai_content_generation_render_jobs where id=$1 for update")) {
            transaction.lockOrder.push("job");
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
    expect(lockSequences).toEqual([["job", "output"], ["job", "output"]]);
  });

  it("locks the parent generation before the render job and output on failure paths", async () => {
    const locks: string[] = [];
    const scope = { output_id: "output", generation_id: "generation", workspace_id: "workspace", brand_id: "brand" };
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] };
        if (normalized.includes("select output_id,generation_id,workspace_id,brand_id") && normalized.includes("ai_content_generation_render_jobs")) {
          return { rows: [scope] };
        }
        if (normalized.includes("from ai_content_generations") && normalized.endsWith("for update")) {
          locks.push("generation");
          return { rows: [{ id: scope.generation_id }] };
        }
        if (normalized.includes("from ai_content_generation_render_jobs where id=$1 for update")) {
          locks.push("job");
          return { rows: [{
            id: "job", ...scope, job_kind: "image_asset", asset_index: 1, status: "processing",
            worker_id: "image-worker", lease_token: "lease", lease_expires_at: new Date(Date.now() + 60_000),
            lease_expired: false, attempt_count: 1, max_attempts: 3,
          }] };
        }
        if (normalized.includes("from ai_content_generation_outputs") && normalized.endsWith("for update")) {
          locks.push("output");
          return { rows: [{ id: scope.output_id }] };
        }
        if (normalized.startsWith("update ai_content_generation_render_jobs set status=$2")) return { rows: [] };
        throw new Error(`unexpected query: ${normalized}`);
      },
      release() {},
    };
    const pool = { connect: async () => client };
    const repository = createAiContentRenderJobsRepository(pool as never, async () => ({}) as never);

    await repository.fail({
      jobId: "job", workerId: "image-worker", leaseToken: "lease",
      errorCode: "retryable_render_error", errorMessage: "retry", retryable: true,
    });

    expect(locks).toEqual(["generation", "job", "output"]);
  });

  it("does not roll back a render failure when the post-commit audit append fails", async () => {
    let auditAttempted = false;
    const scope = { output_id: "output", generation_id: "generation", workspace_id: "workspace", brand_id: "brand" };
    const client = {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (normalized === "begin" || normalized === "commit" || normalized === "rollback") return { rows: [] };
        if (normalized.includes("select output_id,generation_id,workspace_id,brand_id") && normalized.includes("ai_content_generation_render_jobs")) return { rows: [scope] };
        if (normalized.includes("from ai_content_generations") && normalized.endsWith("for update")) return { rows: [{ id: scope.generation_id }] };
        if (normalized.includes("from ai_content_generation_render_jobs where id=$1 for update")) return { rows: [{ id: "job", ...scope, job_kind: "image_asset", asset_index: 1, status: "processing", worker_id: "image-worker", lease_token: "lease", lease_expires_at: new Date(Date.now() + 60_000), lease_expired: false, attempt_count: 1, max_attempts: 3 }] };
        if (normalized.includes("from ai_content_generation_outputs") && normalized.endsWith("for update")) return { rows: [{ id: scope.output_id }] };
        if (normalized.startsWith("update ai_content_generation_render_jobs set status=$2")) return { rows: [] };
        if (normalized.startsWith("insert into audit_events")) {
          auditAttempted = true;
          throw new Error("audit unavailable");
        }
        throw new Error(`unexpected query: ${normalized}`);
      },
      release() {},
    };
    const repository = createAiContentRenderJobsRepository({ connect: async () => client } as never, async () => ({}) as never);

    await expect(repository.fail({
      jobId: "job", workerId: "image-worker", leaseToken: "lease",
      errorCode: "render_failed", errorMessage: "failed", retryable: true,
    })).resolves.toBeUndefined();
    expect(auditAttempted).toBe(true);
  });
});
