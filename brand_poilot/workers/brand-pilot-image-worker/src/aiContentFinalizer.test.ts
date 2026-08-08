import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { finalizeAiContentPackage, AiContentFinalizerError } from "./aiContentFinalizer.js";
import type { AiContentPackageFinalizeJob, AiContentRenderedAsset } from "./aiContentRenderClient.js";

const uid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function finalInput(format: "card_news" | "blog" | "reel") {
  const count = format === "blog" ? null : 2;
  return {
    contractVersion: "content-generation-input.v3", generationId: uid(2),
    brandCore: { versionId: uid(10), companyOverview: "Overview", businessDescription: "Business", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Simple", coreAppeal: "Calm" },
    brandRules: {
      versionId: uid(11), version: 1,
      content: {
        contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
        ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
        designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
      contentSha256: "b".repeat(64),
    },
    subject: { kind: "topic_text", title: "Tea" }, contentInstruction: null, product: null,
    researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "required", queries: ["tea"], capturedAt: "2026-07-31T00:00:00Z", items: [{ id: uid(30), title: "Evidence", url: "https://evidence.example/tea", publisher: null, publishedAt: null, capturedAt: "2026-07-31T00:00:00Z", claimSummary: "Tea evidence", contentHash: "a".repeat(64) }] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: { id: uid(20), conceptKey: "tea", title: "Tea guide", informationalType: "how_to", oneLineIntent: "Explain", differentiator: "Simple", differentiationAxes: ["question"], target: "Adults", customerContext: "Choosing", keyMessage: "Choose", hook: "How?", selectionReason: "Useful", evidenceIds: [uid(30)], referenceIds: [], outputFormat: format, channelTargets: [format === "blog" ? "blog_export" : "instagram"], assetCount: count, outline: count === null ? [{ index: 1, role: "article", headline: "Tea", purpose: "Explain" }] : [{ index: 1, role: "hook", headline: "One", purpose: "Open" }, { index: 2, role: "detail", headline: "Two", purpose: "Explain" }], purposeDetails: { kind: "informational", question: "How?", value: "Guide", whyNow: "Now", learningPoints: ["One"] } },
    userImageInstruction: null,
    outputSettings: { outputFormat: format, channelTargets: [format === "blog" ? "blog_export" : "instagram"], aspectRatio: format === "blog" ? null : format === "reel" ? "9:16" : "1:1", outputCount: 1, purpose: "informational" },
    capturedAt: "2026-07-31T00:00:00Z",
  };
}

function rendered(index: number): AiContentRenderedAsset {
  const bytes = Buffer.from(`png-${index}`);
  return { index, url: `https://blob.example/assets/${String(index).padStart(2, "0")}.png`, storagePath: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/${String(index).padStart(2, "0")}.png`, mimeType: "image/png", width: 1080, height: 1080, checksum: createHash("sha256").update(bytes).digest("hex") };
}

function imagePackage(format: "card_news" | "blog" | "reel", count: number) {
  return {
    contractVersion: "image-generation-package.v1", generationId: uid(2), outputFormat: format, purpose: "informational",
    assetCount: count, aspectRatio: format === "reel" ? "9:16" : "1:1", channelTargets: [format === "blog" ? "blog_export" : "instagram"],
    assets: Array.from({ length: count }, (_, offset) => ({ index: offset + 1, role: `role-${offset + 1}`, copy: `copy-${offset + 1}`, visualDirection: `visual-${offset + 1}`, evidenceIds: [], productImageAssetIds: [], attachmentIds: [] })),
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: null,
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  };
}

function job(format: "card_news" | "blog" | "reel", plan: Record<string, unknown>, assets: AiContentRenderedAsset[]): AiContentPackageFinalizeJob {
  return {
    id: uid(1), generationId: uid(2), outputId: uid(3), workspaceId: uid(4), brandId: uid(5), jobKind: "package_finalize", assetIndex: null, leaseToken: "lease", attemptCount: 1,
    payload: { contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize", generationId: uid(2), outputId: uid(3), plan, finalInput: finalInput(format), supplementalResearch: null, assets },
  };
}

function storage() {
  return {
    readOwned: vi.fn(async (path: string) => Buffer.from(path.endsWith("/01.png") ? "png-1" : "png-2")),
    uploadVideo: vi.fn(async ({ path }: { path: string }) => ({ url: `https://blob.example/${path}`, checksum: "e".repeat(64) })),
    uploadText: vi.fn(async ({ path }: { path: string }) => ({ url: `https://blob.example/${path}`, checksum: "f".repeat(64) }))
  };
}

describe("V3 non-Reel package finalizer", () => {
  it("sorts card assets and preserves planner caption, hashtags, and CTA", async () => {
    const plan = { contractVersion: "card-news-plan.v2", content: { caption: "Caption", hashtags: ["#tea"], cta: "Save" }, imagePackage: imagePackage("card_news", 2) };
    const target = job("card_news", plan, [rendered(2), rendered(1)]);
    const blob = storage();
    const result = await finalizeAiContentPackage(target, blob);

    expect(result.manifest).toMatchObject({
      version: "ai-content.v3", purpose: "informational", outputFormat: "card_news", title: "Tea guide",
      content: plan.content,
      assets: [expect.objectContaining({ index: 1, role: "slide" }), expect.objectContaining({ index: 2, role: "slide" })],
    });
    expect(blob.uploadText).toHaveBeenCalledWith(expect.objectContaining({ path: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/manifest.json`, contentType: "application/json" }));
  });

  it("replaces every blog placeholder with successful HTTPS URLs, validates HTML again, and uploads deterministic HTML", async () => {
    const body = "검증된 내용을 충분히 설명합니다. ".repeat(180);
    const htmlTemplate = `<article><h1>Tea</h1><section data-summary="true"><p>요약 하나</p><p>요약 둘</p><p>요약 셋</p></section><h2>왜 중요한가요?</h2><p>${body}<a data-evidence-id="${uid(30)}" href="https://evidence.example/tea">근거</a></p><img src="asset://01" alt="차 이미지"><section data-references="true"><a data-evidence-id="${uid(30)}" href="https://evidence.example/tea">참고</a></section></article>`;
    const plan = { contractVersion: "blog-plan.v2", content: { title: "Tea", htmlTemplate, metaTitle: "Tea meta", metaDescription: "Tea desc", usedEvidenceIds: [uid(30)] }, imagePackage: imagePackage("blog", 1) };
    const target = job("blog", plan, [rendered(1)]);
    const blob = storage();
    const result = await finalizeAiContentPackage(target, blob);

    const html = String(result.manifest.content.html);
    expect(html).toContain("https://blob.example/assets/01.png");
    expect(html).not.toContain("asset://");
    expect(blob.uploadText).toHaveBeenNthCalledWith(1, expect.objectContaining({ path: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/content.html`, contentType: "text/html; charset=utf-8" }));
    expect(result.manifest.assets).toEqual([
      expect.objectContaining({ role: "html", index: 1, mimeType: "text/html" }),
      expect.objectContaining({ role: "inline", index: 1, url: "https://blob.example/assets/01.png" }),
    ]);
  });

  it("supports an HTML-only blog manifest", async () => {
    const body = "검색 근거를 바탕으로 설명합니다. ".repeat(180);
    const htmlTemplate = `<article><h1>Tea</h1><section data-summary="true"><p>요약 하나</p><p>요약 둘</p><p>요약 셋</p></section><h2>무엇을 확인하나요?</h2><p>${body}<a data-evidence-id="${uid(30)}" href="https://evidence.example/tea">근거</a></p><section data-references="true"><a data-evidence-id="${uid(30)}" href="https://evidence.example/tea">참고</a></section></article>`;
    const plan = { contractVersion: "blog-plan.v2", content: { title: "Tea", htmlTemplate, metaTitle: "Tea meta", metaDescription: "Tea desc", usedEvidenceIds: [uid(30)] }, imagePackage: null };
    const result = await finalizeAiContentPackage(job("blog", plan, []), storage());
    expect(result.manifest.assets).toHaveLength(1);
    expect(result.manifest.assets[0]).toMatchObject({ role: "html" });
  });

  it("reuses successful scenes in index order, uses scene one as cover, and uploads one deterministic silent MP4", async () => {
    const plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "Caption", hashtags: [], cta: "CTA" }, imagePackage: imagePackage("reel", 2) };
    const blob = storage();
    const reelRenderer = { render: vi.fn(async ({ scenes }: { scenes: Array<{ bytes: Buffer }> }) => ({
      cover: { bytes: scenes[0]!.bytes, mimeType: "image/png" as const, width: 1080 as const, height: 1920 as const },
      video: { bytes: Buffer.from("mp4"), mimeType: "video/mp4" as const, width: 1080 as const, height: 1920 as const, videoCodec: "h264" as const, audioCodec: null, fps: 30 as const, durationSeconds: 8 }
    })) };
    const one = { ...rendered(1), width: 1080, height: 1920 };
    const two = { ...rendered(2), width: 1080, height: 1920 };

    const result = await finalizeAiContentPackage(job("reel", plan, [two, one]), blob, reelRenderer);

    expect(blob.readOwned).toHaveBeenNthCalledWith(1, `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/01.png`);
    expect(blob.readOwned).toHaveBeenNthCalledWith(2, `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/02.png`);
    expect(reelRenderer.render).toHaveBeenCalledTimes(1);
    expect(blob.uploadVideo).toHaveBeenCalledWith(expect.objectContaining({
      path: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/reel.mp4`,
      bytes: Buffer.from("mp4"), durationSeconds: 8, audioCodec: null
    }));
    expect(result.manifest).toMatchObject({
      version: "ai-content.v3", outputFormat: "reel",
      assets: [
        { role: "scene", index: 1, url: one.url },
        { role: "scene", index: 2, url: two.url },
        { role: "video", index: 1, fileName: "reel.mp4", mimeType: "video/mp4", durationSeconds: 8, audioCodec: null }
      ],
      content: plan.content
    });
  });

  it("fails only the Reel finalizer when FFmpeg fails and keeps successful scene assets untouched", async () => {
    const plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "Caption", hashtags: [], cta: "CTA" }, imagePackage: imagePackage("reel", 1) };
    const blob = storage();
    const reelRenderer = { render: vi.fn(async () => { throw new Error("ffmpeg_failed:1"); }) };
    const scene = { ...rendered(1), width: 1080, height: 1920 };

    await expect(finalizeAiContentPackage(job("reel", plan, [scene]), blob, reelRenderer)).rejects.toThrow("ffmpeg_failed:1");

    expect(blob.readOwned).toHaveBeenCalledTimes(1);
    expect(blob.uploadVideo).not.toHaveBeenCalled();
    expect(blob.uploadText).not.toHaveBeenCalled();
    expect(new AiContentFinalizerError("x", true).retryable).toBe(true);
  });

  it("rejects staged scene bytes that do not match the successful asset checksum", async () => {
    const plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "Caption", hashtags: [], cta: "CTA" }, imagePackage: imagePackage("reel", 1) };
    const blob = storage();
    blob.readOwned.mockResolvedValueOnce(Buffer.from("tampered"));
    const reelRenderer = { render: vi.fn() };
    const scene = { ...rendered(1), width: 1080, height: 1920 };

    await expect(finalizeAiContentPackage(job("reel", plan, [scene]), blob, reelRenderer)).rejects.toThrow("ai_content_finalizer_asset_checksum_invalid");
    expect(reelRenderer.render).not.toHaveBeenCalled();
    expect(blob.uploadVideo).not.toHaveBeenCalled();
  });

  it.each([
    ["brand", `ai-content/${uid(99)}/${uid(2)}/${uid(3)}/assets/01.png`],
    ["generation", `ai-content/${uid(5)}/${uid(99)}/${uid(3)}/assets/01.png`],
    ["output", `ai-content/${uid(5)}/${uid(2)}/${uid(99)}/assets/01.png`],
    ["index", `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/02.png`]
  ])("rejects a scene storage path with the wrong %s before reading it", async (_field, storagePath) => {
    const plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "Caption", hashtags: [], cta: "CTA" }, imagePackage: imagePackage("reel", 1) };
    const blob = storage();
    const reelRenderer = { render: vi.fn() };
    const scene = { ...rendered(1), width: 1080, height: 1920, storagePath };

    await expect(finalizeAiContentPackage(job("reel", plan, [scene]), blob, reelRenderer)).rejects.toThrow("ai_content_finalizer_asset_path_invalid");
    expect(blob.readOwned).not.toHaveBeenCalled();
    expect(reelRenderer.render).not.toHaveBeenCalled();
  });

  it("does not upload video or manifest after Reel rendering is cancelled", async () => {
    const plan = { contractVersion: "reel-plan.v2", outputFormat: "reel", content: { caption: "Caption", hashtags: [], cta: "CTA" }, imagePackage: imagePackage("reel", 1) };
    const blob = storage();
    const controller = new AbortController();
    const reelRenderer = { render: vi.fn((_input: unknown, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const scene = { ...rendered(1), width: 1080, height: 1920 };
    const running = finalizeAiContentPackage(job("reel", plan, [scene]), blob, reelRenderer, controller.signal);
    await vi.waitFor(() => expect(reelRenderer.render).toHaveBeenCalled());

    controller.abort(new Error("ai_content_worker_shutdown"));

    await expect(running).rejects.toThrow("ai_content_worker_shutdown");
    expect(blob.uploadVideo).not.toHaveBeenCalled();
    expect(blob.uploadText).not.toHaveBeenCalled();
  });
});
