import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexAccountPool, type CodexAccountPool } from "@brand-pilot/worker-runtime";
import { createAiContentAssetRenderer, dimensionsForAspectRatio, runAiContentAssetChildProcess } from "./aiContentAssetRenderer.js";
import { cardDeckEditorialPlanSha256 } from "@brand-pilot/content-contracts/card-deck-editorial-plan/node";
import type { AiContentImageAssetJob } from "./aiContentRenderClient.js";
import { cloneCardDeckImageJob, cloneManualBlogImageJobV2, cloneManualImageJobV2, cloneReelStoryboardImageJob } from "../test/fixtures/manualRender.js";

const uid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (c: string) => c.repeat(64);
const accountRoots: string[] = [];

async function testAccountPool(): Promise<CodexAccountPool> {
  const root = await mkdtemp(path.join(tmpdir(), "image-asset-accounts-"));
  accountRoots.push(root);
  for (const alias of ["primary", "secondary"]) {
    const home = path.join(root, alias);
    await mkdir(home);
    await writeFile(path.join(home, "auth.json"), "{}");
  }
  return createCodexAccountPool({ root, aliases: ["primary", "secondary"] });
}

afterEach(async () => {
  await Promise.all(accountRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function job(): AiContentImageAssetJob {
  return {
    id: uid(1), generationId: uid(2), outputId: uid(3), workspaceId: uid(4), brandId: uid(5), jobKind: "image_asset", assetIndex: 2, leaseToken: "lease", attemptCount: 1,
    payload: {
      contractVersion: "ai-content-render-job.v1", jobKind: "image_asset", generationId: uid(2), outputId: uid(3), assetIndex: 2,
      assetKey: `${uid(2)}:2`, storagePath: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/02.png`,
      imagePackage: {
        contractVersion: "image-generation-package.v1", generationId: uid(2), outputFormat: "card_news", purpose: "marketing", assetCount: 3, aspectRatio: "1:1", channelTargets: ["instagram"],
        assets: [
          { index: 1, role: "hook", copy: "one", visualDirection: "one", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
          { index: 2, role: "detail", copy: "two", visualDirection: "two", evidenceIds: [], productImageAssetIds: [uid(10)], attachmentIds: [uid(20)] },
          { index: 3, role: "close", copy: "three", visualDirection: "three", evidenceIds: [], productImageAssetIds: [], attachmentIds: [] },
        ],
        product: { id: uid(8), versionId: uid(9), kind: "product", name: "Product", description: "Desc", features: [], benefits: [], cautions: [], evergreenPurchaseInfo: "Info", images: [{ assetId: uid(10), role: "hero", storageUrl: "https://owned.example/product", storagePath: "owned/product.png", mimeType: "image/png", checksum: sha("a") }] },
        references: [{ referenceItemId: uid(30), snapshotId: uid(31), roles: ["visual_composition"], title: "Reference", sourceUrl: "https://external.example/source", capturedAt: "2026-07-31T00:00:00Z", contentHash: sha("c"), text: "Frozen reference", image: { storageUrl: "https://owned.example/reference", storagePath: "owned/reference.png", mimeType: "image/png", checksum: sha("d") } }],
        brandStyleImages: [{ referenceItemId: uid(30), description: "Style", tags: ["warm"], storageUrl: "https://owned.example/style", storagePath: "owned/style.png", mimeType: "image/png", checksum: sha("e") }], avatarStyleImageId: uid(30),
        attachments: [{ id: uid(20), role: "supporting_image", fileName: "support.png", mimeType: "image/png", sizeBytes: 10, checksum: sha("b"), storageUrl: "https://owned.example/attachment", storagePath: "owned/attachment.png" }],
        userImageInstruction: null,
        logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
      },
    },
  };
}

function manualBlogJob(): any {
  const target: any = cloneManualImageJobV2();
  const imagePackage = target.payload.imagePackage;
  imagePackage.outputFormat = "blog";
  imagePackage.aspectRatio = "16:9";
  imagePackage.channelTargets = ["blog_export"];
  imagePackage.assetCount = 2;
  imagePackage.assets = [
    { ...imagePackage.assets[0], index: 1, role: "hero" },
    { ...imagePackage.assets[1], index: 2, role: "diagram" },
  ];
  target.assetIndex = 1;
  target.payload.assetIndex = 1;
  target.payload.assetKey = `${target.generationId}:1`;
  target.payload.storagePath = `ai-content/${target.brandId}/${target.generationId}/${target.outputId}/assets/01.png`;
  target.payload.contentGenerationInput.selectedProposal.outputFormat = "blog";
  target.payload.contentGenerationInput.selectedProposal.channelTargets = ["blog_export"];
  target.payload.contentGenerationInput.selectedProposal.assetCount = null;
  target.payload.contentGenerationInput.selectedProposal.outline = [{ index: 1, role: "article", headline: "차 안내", purpose: "설명" }];
  target.payload.contentGenerationInput.outputSettings = { outputFormat: "blog", channelTargets: ["blog_export"], aspectRatio: null, outputCount: 1, purpose: "marketing" };
  target.payload.contentPlan = {
    contractVersion: "blog-plan.v2",
    content: {
      title: "차 안내",
      htmlTemplate: '<article><h1>차 안내</h1><p>첫 이미지 앞 문단</p><img src="asset://01" alt="차 제품 대표 이미지"><h2>선택 기준</h2><p>첫 이미지 뒤 문단</p><img src="asset://02" alt="차 선택 기준 도식"><p>마지막 문단</p></article>',
      metaTitle: "차 안내", metaDescription: "차 제품을 안내합니다.", usedEvidenceIds: [],
    },
    imagePackage,
  };
  return target;
}

async function bindManualOwnedBytes(target: any) {
  const [attachmentPng, attachmentJpeg, attachmentWebp] = await Promise.all([
    sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer(),
    sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } }).jpeg().toBuffer(),
    sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).webp().toBuffer(),
  ]);
  const bytesByPath = new Map<string, Buffer>([
    ["owned/product.png", Buffer.from("product")],
    ["owned/style.png", Buffer.from("style")],
    ["owned/reference.png", Buffer.from("reference")],
    ["owned/attachment-one", attachmentPng],
    ["owned/attachment-two", attachmentJpeg],
    ["owned/attachment-three", attachmentWebp],
  ]);
  const checksum = (storagePath: string) => createHash("sha256").update(bytesByPath.get(storagePath)!).digest("hex");
  for (const imagePackage of [target.payload.imagePackage, target.payload.contentPlan.imagePackage]) {
    imagePackage.product.images[0].checksum = checksum("owned/product.png");
    imagePackage.brandStyleImages[0].checksum = checksum("owned/style.png");
    imagePackage.references[0].image.checksum = checksum("owned/reference.png");
    for (const attachment of imagePackage.attachments) {
      attachment.checksum = checksum(attachment.storagePath);
      attachment.sizeBytes = bytesByPath.get(attachment.storagePath)!.byteLength;
    }
  }
  const input = target.payload.contentGenerationInput;
  input.product.images[0].checksum = checksum("owned/product.png");
  input.references.brandStyleImages[0].checksum = checksum("owned/style.png");
  input.references.selected[0].image.checksum = checksum("owned/reference.png");
  for (const attachment of input.references.attachments) {
    attachment.checksum = checksum(attachment.storagePath);
    attachment.sizeBytes = bytesByPath.get(attachment.storagePath)!.byteLength;
  }
  return { bytesByPath, readOwned: vi.fn(async (storagePath: string) => bytesByPath.get(storagePath)!) };
}

describe("V3 single asset renderer", () => {
  it("maps every contract ratio to its exact dimensions", () => {
    expect(dimensionsForAspectRatio("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsForAspectRatio("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsForAspectRatio("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsForAspectRatio("9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("reads only owned storage paths, verifies checksums, stages read-only files, and keeps model-native resolution while normalizing card news to square", async () => {
    const product = await sharp({ create: { width: 4, height: 5, channels: 4, background: "red" } }).png().toBuffer();
    const attachment = await sharp({ create: { width: 4, height: 5, channels: 4, background: "blue" } }).png().toBuffer();
    const style = await sharp({ create: { width: 4, height: 5, channels: 4, background: "green" } }).png().toBuffer();
    const reference = await sharp({ create: { width: 4, height: 5, channels: 4, background: "yellow" } }).png().toBuffer();
    const rendered = await sharp({ create: { width: 8, height: 12, channels: 4, background: "white" } }).png().toBuffer();
    const input = job();
    input.payload.imagePackage.product!.images[0]!.checksum = (await import("node:crypto")).createHash("sha256").update(product).digest("hex");
    input.payload.imagePackage.attachments[0]!.checksum = (await import("node:crypto")).createHash("sha256").update(attachment).digest("hex");
    input.payload.imagePackage.brandStyleImages[0]!.checksum = (await import("node:crypto")).createHash("sha256").update(style).digest("hex");
    input.payload.imagePackage.references[0]!.image!.checksum = (await import("node:crypto")).createHash("sha256").update(reference).digest("hex");
    const readOwned = vi.fn(async (storagePath: string) => storagePath.includes("product") ? product : storagePath.includes("style") ? style : storagePath.includes("reference") ? reference : attachment);
    let inspected = false;
    const runChild = vi.fn(async ({ workspaceDir, outputFile, prompt, signal }: { workspaceDir: string; outputFile: string; prompt: string; signal: AbortSignal }) => {
      expect(signal.aborted).toBe(false);
      expect(prompt).toContain("index 2");
      expect(await readFile(path.join(workspaceDir, "AGENTS.md"), "utf8")).toContain("이미지 워커");
      const staged = path.join(workspaceDir, "inputs", "product-01.png");
      expect((await import("node:fs/promises")).stat(staged).then((s) => s.mode & 0o222)).resolves.toBe(0);
      expect(await readFile(path.join(workspaceDir, "inputs", "style-01.png"))).toEqual(style);
      expect(await readFile(path.join(workspaceDir, "inputs", "reference-01.png"))).toEqual(reference);
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
      inspected = true;
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    const result = await renderer.renderAsset(input, new AbortController().signal);

    expect(inspected).toBe(true);
    expect(readOwned.mock.calls.map(([value]) => value)).toEqual(["owned/product.png", "owned/style.png", "owned/reference.png", "owned/attachment.png"]);
    expect(runChild).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ index: 2, mimeType: "image/png", width: 8, height: 8 });
    expect((await sharp(result.bytes).metadata())).toMatchObject({ width: 8, height: 8, format: "png" });
  });

  it("stages the full immutable v2 context and every frozen attachment as read-only optional references", async () => {
    const input: any = cloneManualBlogImageJobV2();
    expect(input.payload.imagePackage.assets[1].attachmentIds).toEqual([]);
    const { bytesByPath, readOwned } = await bindManualOwnedBytes(input);
    const rendered = await sharp({ create: { width: 8, height: 12, channels: 4, background: "white" } }).png().toBuffer();
    const runChild = vi.fn(async ({ workspaceDir, outputFile, prompt }: { workspaceDir: string; outputFile: string; prompt: string }) => {
      const inputDir = path.join(workspaceDir, "inputs");
      expect(prompt).toContain("ai-content-asset-render.v2");
      expect(prompt).toMatch(/블로그/);
      expect(prompt).toContain("inputs/content-generation-input.json");
      expect(prompt).toContain("inputs/attachments/attachment-03.webp");
      expect(JSON.parse(await readFile(path.join(inputDir, "content-generation-input.json"), "utf8"))).toEqual(input.payload.contentGenerationInput);
      expect(JSON.parse(await readFile(path.join(inputDir, "content-plan.json"), "utf8"))).toEqual(input.payload.contentPlan);
      expect(JSON.parse(await readFile(path.join(inputDir, "render-contract.json"), "utf8"))).toMatchObject({
        contractVersion: "ai-content-manual-render.v2",
        rendererPromptVersion: "image-final-pixels.v2",
        workspaceId: input.workspaceId,
        brandId: input.brandId,
        currentAsset: {
          index: 2,
          role: "detail",
          copy: "두 번째 장면",
          visualDirection: "두 번째 장면 비주얼",
        },
        blogInsertionContext: expect.objectContaining({ placeholder: "asset://02" }),
      });
      expect(JSON.parse(await readFile(path.join(inputDir, "blog-insertion-context.json"), "utf8")))
        .toMatchObject({ placeholder: "asset://02" });
      await expect(readFile(path.join(inputDir, "structured-scene-copy.json"), "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      const index = JSON.parse(await readFile(path.join(inputDir, "attachments", "index.json"), "utf8"));
      expect(index).toEqual({
        contractVersion: "ai-content-attachment-index.v1",
        referenceSemantics: "optional_visual_reference",
        attachments: [
          expect.objectContaining({ index: 1, id: uid(20), originalFileName: "first unsafe name.png", path: "inputs/attachments/attachment-01.png" }),
          expect.objectContaining({ index: 2, id: uid(21), originalFileName: "../../second.jpg", path: "inputs/attachments/attachment-02.jpg" }),
          expect.objectContaining({ index: 3, id: uid(22), originalFileName: "third.webp", path: "inputs/attachments/attachment-03.webp" }),
        ],
      });
      for (const relative of [
        "content-generation-input.json", "content-plan.json", "render-contract.json", path.join("attachments", "index.json"),
        path.join("attachments", "attachment-01.png"), path.join("attachments", "attachment-02.jpg"), path.join("attachments", "attachment-03.webp"),
      ]) {
        await expect((await import("node:fs/promises")).stat(path.join(inputDir, relative)).then((stat) => stat.mode & 0o222)).resolves.toBe(0);
      }
      expect(await readFile(path.join(inputDir, "attachments", "attachment-01.png"))).toEqual(bytesByPath.get("owned/attachment-one"));
      expect(await readFile(path.join(inputDir, "attachments", "attachment-02.jpg"))).toEqual(bytesByPath.get("owned/attachment-two"));
      expect(await readFile(path.join(inputDir, "attachments", "attachment-03.webp"))).toEqual(bytesByPath.get("owned/attachment-three"));
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal)).resolves.toMatchObject({ index: 2 });

    expect(readOwned.mock.calls.map(([storagePath]) => storagePath)).toEqual([
      "owned/product.png", "owned/style.png", "owned/reference.png",
      "owned/attachment-one", "owned/attachment-two", "owned/attachment-three",
    ]);
    expect(readOwned).toHaveBeenCalledWith("owned/attachment-one", {
      maxBytes: 5_000_000,
      expectedSizeBytes: bytesByPath.get("owned/attachment-one")!.byteLength,
      expectedContentType: "image/png",
    });
    expect(readOwned).toHaveBeenCalledWith("owned/attachment-two", {
      maxBytes: 5_000_000,
      expectedSizeBytes: bytesByPath.get("owned/attachment-two")!.byteLength,
      expectedContentType: "image/jpeg",
    });
    expect(runChild).toHaveBeenCalledTimes(1);
  });

  it("stages the authoritative Reel Storyboard and deterministic compiled prompt", async () => {
    const input: any = cloneReelStoryboardImageJob();
    const { readOwned } = await bindManualOwnedBytes(input);
    const rendered = await sharp({ create: { width: 90, height: 160, channels: 4, background: "white" } }).png().toBuffer();
    let observedPrompt = "";
    const runChild = vi.fn(async ({ workspaceDir, outputFile }: { workspaceDir: string; outputFile: string }) => {
      const inputDir = path.join(workspaceDir, "inputs");
      const storyboardPath = path.join(inputDir, "reel-storyboard.json");
      const scenePath = path.join(inputDir, "reel-storyboard-current-scene.json");
      expect(JSON.parse(await readFile(storyboardPath, "utf8"))).toEqual(input.payload.reelStoryboardContract);
      expect(JSON.parse(await readFile(scenePath, "utf8"))).toEqual(input.payload.reelStoryboardCurrentScene);
      observedPrompt = await readFile(path.join(inputDir, "compiled-render-prompt.txt"), "utf8");
      expect(observedPrompt).toContain("[GLOBAL VISUAL SYSTEM]");
      expect((await (await import("node:fs/promises")).stat(storyboardPath)).mode & 0o222).toBe(0);
      expect((await (await import("node:fs/promises")).stat(scenePath)).mode & 0o222).toBe(0);
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    const result = await renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal);
    expect(result).toMatchObject({
        index: 2,
        renderDiagnostic: {
          contractVersion: "ai-content-editorial-render-diagnostic.v1",
          sourceContractVersion: "reel-storyboard.v1",
          sourceSha256: input.payload.reelStoryboardBinding.storyboardSha256,
          sceneIndex: 2,
          compiledPromptVersion: "image-reel-storyboard.v1",
          compiledPromptSha256: createHash("sha256").update(observedPrompt).digest("hex"),
          actualToolArgumentsObservation: "not_emitted_by_runner",
          actualToolArgumentsSha256: null,
        },
      });
    expect(runChild).toHaveBeenCalledTimes(1);
  });

  it("stages the authoritative card Deck and passes the exact compiled prompt to the child", async () => {
    const input: any = cloneCardDeckImageJob();
    const { readOwned } = await bindManualOwnedBytes(input);
    const rendered = await sharp({ create: { width: 8, height: 8, channels: 4, background: "white" } }).png().toBuffer();
    let observedPrompt = "";
    const runChild = vi.fn(async ({ workspaceDir, outputFile, prompt }: { workspaceDir: string; outputFile: string; prompt: string }) => {
      observedPrompt = prompt;
      const inputDir = path.join(workspaceDir, "inputs");
      expect(JSON.parse(await readFile(path.join(inputDir, "card-deck-editorial-plan.json"), "utf8")))
        .toEqual(input.payload.cardDeckContract);
      expect(JSON.parse(await readFile(path.join(inputDir, "card-deck-current-scene.json"), "utf8")))
        .toEqual(input.payload.cardDeckCurrentScene);
      expect(await readFile(path.join(inputDir, "compiled-render-prompt.txt"), "utf8")).toBe(prompt);
      expect(prompt).toContain("[GLOBAL VISUAL SYSTEM]");
      expect(prompt).toContain("[KEY VISUAL RELATION]");
      for (const relative of [
        "card-deck-editorial-plan.json", "card-deck-current-scene.json", "compiled-render-prompt.txt",
      ]) {
        expect((await (await import("node:fs/promises")).stat(path.join(inputDir, relative))).mode & 0o222).toBe(0);
      }
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    const result = await renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal);
    expect(result).toMatchObject({
        index: 2,
        renderDiagnostic: {
          contractVersion: "ai-content-editorial-render-diagnostic.v1",
          sourceContractVersion: "card-deck-editorial-plan.v1",
          sourceSha256: input.payload.cardDeckBinding.deckSha256,
          sceneIndex: 2,
          compiledPromptVersion: "image-card-deck.v1",
          compiledPromptSha256: createHash("sha256").update(observedPrompt).digest("hex"),
          actualToolArgumentsObservation: "not_emitted_by_runner",
          actualToolArgumentsSha256: null,
        },
      });
    expect(runChild).toHaveBeenCalledTimes(1);
  });

  it("does not stage an avatar for a card scene that did not select it", async () => {
    const input: any = cloneCardDeckImageJob();
    input.payload.cardDeckContract.plan.scenes[1].avatarImageAssetIds = [];
    const deckSha256 = cardDeckEditorialPlanSha256(input.payload.cardDeckContract.plan);
    input.payload.cardDeckContract.deckSha256 = deckSha256;
    input.payload.cardDeckBinding.deckSha256 = deckSha256;
    input.payload.cardDeckCurrentScene.deckSha256 = deckSha256;
    input.payload.cardDeckCurrentScene.scene = input.payload.cardDeckContract.plan.scenes[1];
    const { readOwned } = await bindManualOwnedBytes(input);
    const rendered = await sharp({ create: { width: 8, height: 8, channels: 4, background: "white" } }).png().toBuffer();
    const runChild = vi.fn(async ({ outputFile }: { outputFile: string }) => {
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal))
      .resolves.toMatchObject({ index: 2 });
    expect(readOwned.mock.calls.map(([storagePath]) => storagePath)).not.toContain("owned/style.png");
  });

  it("rejects an oversized declared v2 attachment before reading any owned blob", async () => {
    const input: any = cloneManualImageJobV2();
    for (const attachments of [
      input.payload.imagePackage.attachments,
      input.payload.contentPlan.imagePackage.attachments,
      input.payload.contentGenerationInput.references.attachments,
    ]) attachments[0].sizeBytes = 5_000_001;
    const readOwned = vi.fn();
    const runChild = vi.fn();
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal))
      .rejects.toThrow("ai_content_owned_blob_size_limit_exceeded");
    expect(readOwned).not.toHaveBeenCalled();
    expect(runChild).not.toHaveBeenCalled();
  });

  it("rejects v2 attachment bytes whose decoded image format disagrees with the declared MIME", async () => {
    const input: any = cloneManualImageJobV2();
    const { readOwned: validReadOwned } = await bindManualOwnedBytes(input);
    const jpegBytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).jpeg().toBuffer();
    const jpegChecksum = createHash("sha256").update(jpegBytes).digest("hex");
    for (const attachments of [
      input.payload.imagePackage.attachments,
      input.payload.contentPlan.imagePackage.attachments,
      input.payload.contentGenerationInput.references.attachments,
    ]) {
      attachments[0].checksum = jpegChecksum;
      attachments[0].sizeBytes = jpegBytes.byteLength;
    }
    const readOwned = vi.fn(async (storagePath: string) => storagePath === "owned/attachment-one"
      ? jpegBytes
      : validReadOwned(storagePath));
    const runChild = vi.fn();
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal))
      .rejects.toThrow("ai_content_owned_blob_content_type_mismatch");
    expect(runChild).not.toHaveBeenCalled();
  });

  it("checksum-verifies every v2 attachment even when the current asset selects none", async () => {
    const input: any = cloneManualImageJobV2();
    const { readOwned: validReadOwned } = await bindManualOwnedBytes(input);
    const readOwned = vi.fn(async (storagePath: string) => storagePath === "owned/attachment-two"
      ? Buffer.from("tampered")
      : validReadOwned(storagePath));
    const runChild = vi.fn();
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal)).rejects.toThrow("ai_content_owned_blob_checksum_mismatch");
    expect(readOwned).toHaveBeenCalledWith("owned/attachment-two", {
      maxBytes: 5_000_000,
      expectedSizeBytes: input.payload.imagePackage.attachments[1].sizeBytes,
      expectedContentType: "image/jpeg",
    });
    expect(runChild).not.toHaveBeenCalled();
  });

  it("derives and stages deterministic blog insertion context from the final HTML placeholder", async () => {
    const input = manualBlogJob();
    const { readOwned } = await bindManualOwnedBytes(input);
    const rendered = await sharp({ create: { width: 8, height: 12, channels: 4, background: "white" } }).png().toBuffer();
    const runChild = vi.fn(async ({ workspaceDir, outputFile }: { workspaceDir: string; outputFile: string }) => {
      const inputDir = path.join(workspaceDir, "inputs");
      const contract = JSON.parse(await readFile(path.join(inputDir, "render-contract.json"), "utf8"));
      const expectedInsertionContext = {
        placeholder: "asset://01",
        altText: "차 제품 대표 이미지",
        nearestHeading: "차 안내",
        previousParagraph: "첫 이미지 앞 문단",
        nextParagraph: "첫 이미지 뒤 문단",
        role: "hero",
      };
      expect(contract.blogInsertionContext).toEqual(expectedInsertionContext);
      expect(JSON.parse(await readFile(path.join(inputDir, "blog-insertion-context.json"), "utf8")))
        .toEqual(expectedInsertionContext);
      await expect((await import("node:fs/promises")).stat(path.join(inputDir, "blog-insertion-context.json")).then((stat) => stat.mode & 0o222))
        .resolves.toBe(0);
      await mkdir(path.dirname(outputFile), { recursive: true });
      await writeFile(outputFile, rendered);
    });
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned, runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal)).resolves.toMatchObject({ index: 1 });
    expect(runChild).toHaveBeenCalledTimes(1);
  });

  it("rejects a blog placeholder binding mismatch before invoking the image CLI", async () => {
    const input = manualBlogJob();
    input.payload.contentPlan.content.htmlTemplate = input.payload.contentPlan.content.htmlTemplate.replace("asset://02", "asset://01");
    const runChild = vi.fn();
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned: vi.fn(), runChild });

    await expect(renderer.renderAsset(input as AiContentImageAssetJob, new AbortController().signal)).rejects.toThrow("ai_content_blog_insertion_binding_invalid");
    expect(runChild).not.toHaveBeenCalled();
  });

  it("rejects staged checksum mismatches before starting the child", async () => {
    const input = job();
    const runChild = vi.fn();
    const renderer = createAiContentAssetRenderer({ workerRoot: path.resolve("."), readOwned: vi.fn(async () => Buffer.from("wrong")), runChild });
    await expect(renderer.renderAsset(input, new AbortController().signal)).rejects.toThrow("ai_content_owned_blob_checksum_mismatch");
    expect(runChild).not.toHaveBeenCalled();
  });
});

class FakeRenderChild extends EventEmitter {
  pid = 1234;
  kill = vi.fn(() => true);
  stderr = new PassThrough();
}

describe("V3 asset child termination", () => {
  it("requests SIGTERM and waits for wrapper exit so its owned-session finally cleanup can finish", async () => {
    const child = new FakeRenderChild();
    const signalTree = vi.fn(async () => undefined);
    const controller = new AbortController();
    const running = runAiContentAssetChildProcess(
      { command: "node", args: ["runner.mjs"], cwd: ".", env: {}, signal: controller.signal, timeoutMs: 60_000 },
      { spawnProcess: vi.fn(() => child), signalTree, platform: "linux", terminationGraceMs: 50, hardKillWaitMs: 50 },
    );
    let settled = false;
    void running.catch(() => undefined).finally(() => { settled = true; });

    controller.abort(new Error("lease_lost"));
    await vi.waitFor(() => expect(signalTree).toHaveBeenCalledWith(child, "SIGTERM"));
    expect(settled).toBe(false);
    child.emit("exit", null);

    await expect(running).rejects.toThrow("lease_lost");
    expect(signalTree).toHaveBeenCalledTimes(1);
  });

  it("uses SIGKILL only after the graceful deadline and waits for exit, settling once", async () => {
    const child = new FakeRenderChild();
    const signalTree = vi.fn(async () => undefined);
    const controller = new AbortController();
    const running = runAiContentAssetChildProcess(
      { command: "node", args: ["runner.mjs"], cwd: ".", env: {}, signal: controller.signal, timeoutMs: 60_000 },
      { spawnProcess: vi.fn(() => child), signalTree, platform: "linux", terminationGraceMs: 5, hardKillWaitMs: 50 },
    );
    let settlements = 0;
    void running.catch(() => undefined).finally(() => { settlements += 1; });

    controller.abort(new Error("lease_lost"));
    await vi.waitFor(() => expect(signalTree).toHaveBeenNthCalledWith(2, child, "SIGKILL"));
    expect(settlements).toBe(0);
    child.emit("exit", null);
    child.emit("error", new Error("late"));

    await expect(running).rejects.toThrow("lease_lost");
    await vi.waitFor(() => expect(settlements).toBe(1));
    expect(signalTree.mock.calls.map((call) => call[1])).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("retries under secondary after primary usage exhaustion without output", async () => {
    const accountPool = await testAccountPool();
    const workDir = await mkdtemp(path.join(tmpdir(), "image-asset-child-"));
    const outputFile = path.join(workDir, "asset.png");
    const primary = new FakeRenderChild();
    const secondary = new FakeRenderChild();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(secondary);
    try {
      const running = runAiContentAssetChildProcess({
        accountPool,
        command: "node",
        args: ["runner.mjs"],
        cwd: workDir,
        env: {},
        outputFile,
        signal: new AbortController().signal,
        timeoutMs: 60_000,
      }, { spawnProcess, platform: "linux" });

      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
      primary.stderr.write("You've hit your usage limit");
      primary.emit("exit", 1);
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
      await writeFile(outputFile, "png");
      secondary.emit("exit", 0);

      await expect(running).resolves.toBeUndefined();
      expect(spawnProcess.mock.calls.map((call) => call[2]?.env?.CODEX_HOME)).toEqual([
        accountPool.profiles[0]?.home,
        accountPool.profiles[1]?.home,
      ]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("does not retry a usage failure after an output file exists", async () => {
    const accountPool = await testAccountPool();
    const workDir = await mkdtemp(path.join(tmpdir(), "image-asset-child-"));
    const outputFile = path.join(workDir, "asset.png");
    const primary = new FakeRenderChild();
    const spawnProcess = vi.fn(() => primary);
    try {
      const running = runAiContentAssetChildProcess({
        accountPool,
        command: "node",
        args: ["runner.mjs"],
        cwd: workDir,
        env: {},
        outputFile,
        signal: new AbortController().signal,
        timeoutMs: 60_000,
      }, { spawnProcess, platform: "linux" });
      const assertion = expect(running).rejects.toThrow("ai_content_asset_render_failed:1");

      await writeFile(outputFile, "partial");
      primary.stderr.write("usage limit");
      primary.emit("exit", 1);

      await assertion;
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it("does not retry a generic image child failure", async () => {
    const accountPool = await testAccountPool();
    const workDir = await mkdtemp(path.join(tmpdir(), "image-asset-child-"));
    const primary = new FakeRenderChild();
    const spawnProcess = vi.fn(() => primary);
    try {
      const running = runAiContentAssetChildProcess({
        accountPool,
        command: "node",
        args: ["runner.mjs"],
        cwd: workDir,
        env: {},
        outputFile: path.join(workDir, "asset.png"),
        signal: new AbortController().signal,
        timeoutMs: 60_000,
      }, { spawnProcess, platform: "linux" });
      const assertion = expect(running).rejects.toThrow("ai_content_asset_render_failed:1");

      primary.stderr.write("image tool failed ACCOUNT_SECRET");
      primary.emit("exit", 1);

      await assertion;
      const error = await running.catch((caught: unknown) => caught);
      expect(JSON.stringify(error)).not.toContain("ACCOUNT_SECRET");
      expect(Object.keys(error as object)).not.toContain("diagnostic");
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
