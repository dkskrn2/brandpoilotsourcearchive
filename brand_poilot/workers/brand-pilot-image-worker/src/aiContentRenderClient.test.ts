import { describe, expect, it, vi } from "vitest";
import { createAiContentRenderClient } from "./aiContentRenderClient.js";
import { cloneManualBlogImageJobV2 } from "../test/fixtures/manualRender.js";

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function visualClaim(
  outputFormat: "card_news" | "reel" = "card_news",
  reelContractVersion: "reel-storyboard.v1" | "reel-storyboard.v2" = "reel-storyboard.v1",
) {
  const base = cloneManualBlogImageJobV2();
  const sourceContractVersion = outputFormat === "card_news" ? "card-manuscript-plan.v1" as const : reelContractVersion;
  const visualSession = {
    contractVersion: "ai-content-visual-session.v1" as const, outputFormat,
    source: { contractVersion: sourceContractVersion, sha256: "a".repeat(64) }, narrative: "Narrative",
    primaryMediumPolicy: { mode: "free_once" as const, styleReferenceIds: [] as string[] },
    scenes: [1, 2].map((index) => ({ index, editorialContext: { editorialRole: "detail", purpose: `Purpose ${index}`, coreMessage: `Core ${index}` }, lockedDisplay: { headline: `Headline ${index}`, relation: { type: "none", entries: [] }, supportingTexts: [], footnote: null }, referenceBindings: { productImageAssetIds: [], avatarImageAssetIds: [] } })),
  };
  const jobs = [1, 2].map((assetIndex) => ({
    ...base, id: uid(assetIndex), outputId: base.outputId, assetIndex, leaseToken: `lease-${assetIndex}`,
    payload: {
      contractVersion: "ai-content-visual-session-render-job.v1", jobKind: "image_asset",
      generationId: base.generationId, outputId: base.outputId, imagePackage: base.payload.imagePackage,
      assetIndex, assetKey: `${base.generationId}:${assetIndex}`,
      storagePath: `ai-content/${base.brandId}/${base.generationId}/${base.outputId}/assets/0${assetIndex}.png`,
      rendererPromptVersion: "image-visual-session.v1",
      visualSessionBinding: { sourceContractVersion, sourceSha256: "a".repeat(64), sceneIndex: assetIndex },
      contentGenerationInput: base.payload.contentGenerationInput, contentPlan: base.payload.contentPlan, visualSession,
    },
  }));
  return { kind: "visual_session" as const, outputId: base.outputId, outputFormat, visualSession, jobs };
}

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
    const job = cloneManualBlogImageJobV2();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example/", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({ jobKind: "image_asset", assetIndex: 2 });
    await expect(client.claim("worker", 180)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.example/worker/ai-content-render-jobs/claim", expect.objectContaining({
      method: "POST", body: JSON.stringify({ workerId: "worker", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"] }),
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
      sourceContractVersion: "card-manuscript-plan.v1" as const,
      sourceSha256: "a".repeat(64),
      sceneIndex: 2,
      compiledPromptVersion: "image-visual-session.v1" as const,
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

  it("strictly parses a Reel visual-session claim", async () => {
    const job = visualClaim("reel");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      kind: "visual_session", outputFormat: "reel",
      visualSession: { source: { contractVersion: "reel-storyboard.v1" } },
      jobs: [{ assetIndex: 1 }, { assetIndex: 2 }],
    });
  });

  it("strictly parses a Reel Storyboard v2 visual-session claim", async () => {
    const job = visualClaim("reel", "reel-storyboard.v2");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    const claim = await client.claim("worker", 180);
    expect(claim).toMatchObject({
      kind: "visual_session", outputFormat: "reel",
      visualSession: { source: { contractVersion: "reel-storyboard.v2" } },
    });
    expect(claim && "jobs" in claim ? claim.jobs : []).toHaveLength(2);
    expect(claim && "jobs" in claim ? claim.jobs[0] : null).toMatchObject({
      payload: { visualSessionBinding: { sourceContractVersion: "reel-storyboard.v2" } },
    });
  });

  it("strictly parses a Card Manuscript visual-session claim", async () => {
    const job = visualClaim("card_news");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job }), { status: 200 }));
    const client = createAiContentRenderClient({ apiUrl: "https://api.example", token: "token", fetchImpl });

    await expect(client.claim("worker", 180)).resolves.toMatchObject({
      kind: "visual_session", outputFormat: "card_news",
      visualSession: { source: { contractVersion: "card-manuscript-plan.v1" } },
      jobs: [{ assetIndex: 1 }, { assetIndex: 2 }],
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
