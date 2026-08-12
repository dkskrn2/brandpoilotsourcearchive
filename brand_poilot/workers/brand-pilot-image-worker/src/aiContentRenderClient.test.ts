import { describe, expect, it, vi } from "vitest";
import { createAiContentRenderClient } from "./aiContentRenderClient.js";
import { cloneCardDeckImageJob, cloneManualBlogImageJobV2, cloneReelStoryboardImageJob } from "../test/fixtures/manualRender.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function consistentlyMutatedFormatClaim(
  format: "card_news" | "blog" | "reel",
  channelTarget: "instagram" | "blog_export",
  inputAspectRatio: "1:1" | "9:16" | "16:9" | null,
  packageAspectRatio: "1:1" | "9:16" | "16:9",
): any {
  const job: any = cloneManualBlogImageJobV2();
  const imagePackage = job.payload.imagePackage;
  imagePackage.outputFormat = format;
  imagePackage.channelTargets = [channelTarget];
  imagePackage.aspectRatio = packageAspectRatio;
  job.payload.contentGenerationInput.outputSettings = {
    outputFormat: format, channelTargets: [channelTarget], aspectRatio: inputAspectRatio,
    outputCount: 1, purpose: "marketing",
  };
  job.payload.contentGenerationInput.selectedProposal.outputFormat = format;
  job.payload.contentGenerationInput.selectedProposal.channelTargets = [channelTarget];
  if (format === "card_news") {
    job.payload.contentPlan.imagePackage = imagePackage;
  } else if (format === "reel") {
    job.payload.contentPlan = {
      contractVersion: "reel-plan.v2", outputFormat: "reel",
      content: { caption: "차 제품을 소개합니다.", hashtags: ["#차"], cta: "확인하세요." },
      imagePackage,
    };
  } else {
    const images = imagePackage.assets.map((_: unknown, offset: number) => `<img src="asset://${String(offset + 1).padStart(2, "0")}" alt="차 설명 이미지 ${offset + 1}">`).join("");
    job.payload.contentGenerationInput.selectedProposal.assetCount = null;
    job.payload.contentGenerationInput.selectedProposal.outline = [{ index: 1, role: "article", headline: "차 안내", purpose: "설명" }];
    job.payload.contentPlan = {
      contractVersion: "blog-plan.v2",
      content: { title: "차 안내", htmlTemplate: `<article><h1>차 안내</h1>${images}</article>`, metaTitle: "차 안내", metaDescription: "차를 안내합니다.", usedEvidenceIds: [] },
      imagePackage,
    };
  }
  return job;
}

describe("AI content render API client", () => {
  it("uses the Task 9 endpoints and unwraps an image job without confusing a 204", async () => {
    const job = cloneCardDeckImageJob();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example/", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({ jobKind: "image_asset", assetIndex: 2 });
    await expect(client.claim("worker", 180)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.example/worker/ai-content-render-jobs/claim", expect.objectContaining({
      method: "POST", body: JSON.stringify({ workerId: "worker", leaseSeconds: 180 }),
    }));
  });

  it("sends exact heartbeat, completion, and failure bodies and reports lease loss", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "processing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "lost" }), { status: 409 }))
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });
    const lease = { id: uid(1), leaseToken: "lease" };

    await expect(client.heartbeat(lease, "worker", 180)).resolves.toBe(true);
    await expect(client.heartbeat(lease, "worker", 180)).resolves.toBe(false);
    await client.completeAsset(lease, "worker", { index: 1, url: "https://blob.example/1.png", storagePath: "path", mimeType: "image/png", width: 1080, height: 1350, checksum: "a".repeat(64) });
    await client.fail(lease, "worker", { errorCode: "render_failed", errorMessage: "failed", diagnosticCode: "ai_content_asset_final_message_invalid", retryable: true });

    expect(JSON.parse(String(fetchImpl.mock.calls[2]![1]!.body))).toEqual(expect.objectContaining({ jobKind: "image_asset", workerId: "worker", leaseToken: "lease" }));
    expect(JSON.parse(String(fetchImpl.mock.calls[3]![1]!.body))).toEqual({ workerId: "worker", leaseToken: "lease", errorCode: "render_failed", errorMessage: "failed", diagnosticCode: "ai_content_asset_final_message_invalid", retryable: true });
  });

  it("preserves a stable API error code when a render completion is rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: "ai_content_render_asset_invalid" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.completeAsset(
      { id: uid(1), leaseToken: "lease" },
      "worker",
      { index: 1, url: "https://blob.example/1.png", storagePath: "path", mimeType: "image/png", width: 1024, height: 1024, checksum: "a".repeat(64) },
    )).rejects.toThrow("ai_content_render_api_failed:400:ai_content_render_asset_invalid");
  });

  it("appends the private card Deck diagnostic with the original completed lease", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });
    const diagnostic = {
      contractVersion: "ai-content-editorial-render-diagnostic.v1" as const,
      sourceContractVersion: "card-deck-editorial-plan.v1" as const,
      sourceSha256: "a".repeat(64),
      sceneIndex: 2,
      compiledPromptVersion: "image-card-deck.v1" as const,
      compiledPromptSha256: "b".repeat(64),
      actualToolArgumentsObservation: "not_emitted_by_runner" as const,
      actualToolArgumentsSha256: null,
    };

    await client.appendRenderDiagnostic?.({ id: uid(1), leaseToken: "lease" }, "worker", diagnostic);

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example/worker/ai-content-render-jobs/${uid(1)}/diagnostic`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workerId: "worker", leaseToken: "lease", diagnostic }),
      }),
    );
  });

  it("strictly parses the hydrated manual v2 claim while preserving its canonical snapshots", async () => {
    const job = cloneManualBlogImageJobV2();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      generationId: job.generationId,
      workspaceId: job.workspaceId,
      brandId: job.brandId,
      payload: {
        contractVersion: "ai-content-render-job.v2",
        rendererPromptVersion: "image-final-pixels.v2",
        contentGenerationInput: { generationId: job.generationId },
        contentPlan: { contractVersion: "blog-plan.v2" },
      },
    });
  });

  it("strictly parses the Reel Storyboard claim and authoritative current scene", async () => {
    const job = cloneReelStoryboardImageJob();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      payload: {
        contractVersion: "ai-content-reel-storyboard-render-job.v1",
        rendererPromptVersion: "image-reel-storyboard.v1",
        reelStoryboardBinding: { contractVersion: "reel-storyboard.v1", sceneIndex: 2 },
        reelStoryboardCurrentScene: {
          contractVersion: "reel-storyboard-current-scene.v1",
          scene: { index: 2, headline: "차 맛은 온도에서 갈립니다" },
        },
      },
    });
  });

  it("strictly parses the Card Deck claim and authoritative current scene", async () => {
    const job = cloneCardDeckImageJob();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      payload: {
        contractVersion: "ai-content-card-deck-render-job.v1",
        rendererPromptVersion: "image-card-deck.v1",
        cardDeckBinding: { contractVersion: "card-deck-editorial-plan.v1", sceneIndex: 2 },
        cardDeckCurrentScene: {
          contractVersion: "card-deck-current-scene.v1",
          sceneIndex: 2,
          compatibilityRole: "detail",
          scene: { index: 2, headline: "차 맛은 온도에서 갈립니다" },
        },
      },
    });
  });

  it.each([
    ["unknown payload key", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => Object.assign(job.payload, { unexpected: true })],
    ["generation binding", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => { job.payload.contentGenerationInput.generationId = uid(99); }],
    ["workspace identity", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => { job.workspaceId = "workspace"; }],
    ["output binding", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => { job.payload.outputId = uid(99); }],
    ["storage brand binding", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => { job.payload.storagePath = job.payload.storagePath.replace(job.brandId, uid(99)); }],
    ["plan/package binding", (job: ReturnType<typeof cloneManualBlogImageJobV2>) => {
      job.payload.contentPlan.imagePackage = structuredClone(job.payload.contentPlan.imagePackage);
      job.payload.contentPlan.imagePackage!.assets[1]!.role = "wrong";
    }],
  ])("rejects a v2 claim with a mismatched %s", async (_label, mutate) => {
    const job = cloneManualBlogImageJobV2();
    mutate(job);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).rejects.toThrow("ai_content_render_job_invalid");
  });

  it.each([
    ["blog with an independent image aspect", () => consistentlyMutatedFormatClaim("blog", "blog_export", null, "16:9"), "blog-plan.v2"],
  ])("accepts fixed %s semantics", async (_label, buildJob, contractVersion) => {
    const job = buildJob();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      payload: { contentPlan: { contractVersion } },
    });
  });

  it.each([
    ["removed card-news v2 path", () => consistentlyMutatedFormatClaim("card_news", "instagram", "1:1", "1:1")],
    ["removed Reel v2 path", () => consistentlyMutatedFormatClaim("reel", "instagram", "9:16", "9:16")],
    ["blog channel", () => consistentlyMutatedFormatClaim("blog", "instagram", null, "1:1")],
    ["blog input aspect", () => consistentlyMutatedFormatClaim("blog", "blog_export", "1:1", "1:1")],
  ])("rejects a consistently rebound %s claim that violates fixed format semantics", async (_label, buildJob) => {
    const job = buildJob();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).rejects.toThrow("ai_content_render_job_invalid");
  });
});
