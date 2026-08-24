import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createAiContentVisualSessionRenderer } from "./aiContentVisualSessionRenderer.js";

function batch(outputFormat: "card_news" | "reel" = "card_news") {
  const sourceContractVersion = outputFormat === "card_news" ? "card-manuscript-plan.v1" : "reel-storyboard.v1";
  const visualSession = {
    contractVersion: "ai-content-visual-session.v1" as const, outputFormat,
    source: { contractVersion: sourceContractVersion, sha256: "a".repeat(64) }, narrative: "Narrative",
    primaryMediumPolicy: { mode: "free_once" as const, styleReferenceIds: [] as string[] },
    scenes: [1, 2].map((index) => ({ index, editorialContext: { editorialRole: "detail", purpose: `Purpose ${index}`, coreMessage: `Core ${index}` }, lockedDisplay: { headline: `Headline ${index}`, relation: { type: "related_facts", entries: [{ role: "fact", label: "A", value: "80%" }, { role: "fact", label: "B", value: "83.3%" }] }, supportingTexts: [], footnote: null }, referenceBindings: { productImageAssetIds: [], avatarImageAssetIds: [] } })),
  };
  const imagePackage = { outputFormat, product: null, brandStyleImages: [], references: [], attachments: [], userImageInstruction: null };
  return { kind: "visual_session" as const, outputId: "output", outputFormat, visualSession, jobs: [1, 2].map((assetIndex) => ({ id: `job-${assetIndex}`, generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobKind: "image_asset" as const, assetIndex, leaseToken: `lease-${assetIndex}`, attemptCount: 1, payload: { contractVersion: "ai-content-visual-session-render-job.v1" as const, jobKind: "image_asset" as const, generationId: "generation", outputId: "output", imagePackage, assetIndex, assetKey: `generation:${assetIndex}`, storagePath: `path-${assetIndex}`, rendererPromptVersion: "image-visual-session.v1" as const, visualSessionBinding: { sourceContractVersion, sourceSha256: "a".repeat(64), sceneIndex: assetIndex }, contentGenerationInput: {}, contentPlan: {}, visualSession } })) };
}

async function borderedSource(width: number, height: number): Promise<Buffer> {
  const border = 40;
  return sharp({ create: { width, height, channels: 4, background: "#00ff00" } })
    .composite([
      { input: { create: { width, height: border, channels: 4, background: "#ff0000" } }, top: 0, left: 0 },
      { input: { create: { width, height: border, channels: 4, background: "#ff0000" } }, top: height - border, left: 0 },
      { input: { create: { width: border, height, channels: 4, background: "#ff0000" } }, top: 0, left: 0 },
      { input: { create: { width: border, height, channels: 4, background: "#ff0000" } }, top: 0, left: width - border },
    ])
    .png()
    .toBuffer();
}

async function rgbAt(bytes: Buffer, left: number, top: number): Promise<number[]> {
  const pixel = await sharp(bytes).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return [...pixel];
}

describe("visual session renderer", () => {
  const workerRoot = fileURLToPath(new URL("..", import.meta.url));
  it("uses one child execution for all ordered scenes and returns no partial result", async () => {
    const runChild = vi.fn(async ({ outputFiles, workspaceDir }: { outputFiles: string[]; workspaceDir: string }) => {
      await expect(readFile(`${workspaceDir}/.codex/hooks.json`, "utf8"))
        .rejects.toMatchObject({ code: "ENOENT" });
      for (const output of outputFiles) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, await sharp({ create: { width: 1080, height: 1080, channels: 4, background: "white" } }).png().toBuffer()); }
    });
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: runChild as never });
    const result = await renderer.renderSession(batch() as never, new AbortController().signal);
    expect(runChild).toHaveBeenCalledTimes(1);
    expect(result.map(({ index }) => index)).toEqual([1, 2]);
    expect(result.timing).toEqual({ stageReferencesMs: expect.any(Number), codexStartupMs: 0, sceneGenerationMs: [0, 0] });
    expect(result.every(({ renderDiagnostic }) => renderDiagnostic.compiledPromptVersion === "image-visual-session.v1")).toBe(true);
    expect(runChild.mock.calls[0]?.[0].prompt).toContain("Call image_generation exactly once per scene");
  });

  it("turns a middle-scene child failure into one terminal session failure", async () => {
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: vi.fn(async () => { throw new Error("scene_2_failed"); }) });
    await expect(renderer.renderSession(batch() as never, new AbortController().signal)).rejects.toMatchObject({ code: "ai_content_visual_session_failed", retryable: false });
  });

  it("preserves only a safe child diagnostic code on a terminal session failure", async () => {
    const childError = new Error("ai_content_asset_render_failed:1");
    Object.defineProperty(childError, "diagnostic", {
      enumerable: false,
      value: "provider response\nai_content_visual_session_final_message_scene_invalid\ncodex_ai_content_asset_failed:1\nSECRET_TOKEN=do-not-store",
    });
    const renderer = createAiContentVisualSessionRenderer({
      workerRoot,
      readOwned: vi.fn(),
      runChild: vi.fn(async () => { throw childError; }),
    });

    const failure = await renderer.renderSession(batch() as never, new AbortController().signal)
      .then(() => null, (error: unknown) => error as Error & { diagnostic?: string });

    expect(failure).toMatchObject({
      message: "ai_content_asset_render_failed:1",
      code: "ai_content_visual_session_failed",
      retryable: false,
      diagnostic: "ai_content_visual_session_final_message_scene_invalid",
    });
    expect(JSON.stringify(failure)).not.toContain("SECRET_TOKEN");
  });

  it("preserves every Card News source edge inside a fixed square delivery canvas", async () => {
    const source = await borderedSource(1200, 800);
    const runChild = vi.fn(async ({ outputFiles }: { outputFiles: string[] }) => {
      for (const output of outputFiles) {
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, source);
      }
    });
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: runChild as never });

    const result = await renderer.renderSession(batch("card_news") as never, new AbortController().signal);

    expect(result[0]).toMatchObject({ width: 1080, height: 1080 });
    expect(await rgbAt(result[0]!.bytes, 10, 540)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 1069, 540)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 540, 190)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 540, 889)).toEqual([255, 0, 0]);
  });

  it("preserves every Reel source edge inside a fixed 9:16 delivery canvas", async () => {
    const source = await borderedSource(1122, 1402);
    const runChild = vi.fn(async ({ outputFiles }: { outputFiles: string[] }) => {
      for (const output of outputFiles) {
        await mkdir(path.dirname(output), { recursive: true });
        await writeFile(output, source);
      }
    });
    const renderer = createAiContentVisualSessionRenderer({ workerRoot, readOwned: vi.fn(), runChild: runChild as never });

    const result = await renderer.renderSession(batch("reel") as never, new AbortController().signal);

    expect(result[0]).toMatchObject({ width: 1080, height: 1920 });
    expect(await rgbAt(result[0]!.bytes, 10, 960)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 1069, 960)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 540, 295)).toEqual([255, 0, 0]);
    expect(await rgbAt(result[0]!.bytes, 540, 1624)).toEqual([255, 0, 0]);
  });

  it("stages product attachments before registered and URL images, then requires all three in tool calls", async () => {
    const input = batch("card_news");
    const attachmentId = "10000000-0000-4000-8000-000000000001";
    const registeredId = "10000000-0000-4000-8000-000000000002";
    const productId = "10000000-0000-4000-8000-000000000003";
    const versionId = "10000000-0000-4000-8000-000000000004";
    const source = await sharp({ create: { width: 512, height: 512, channels: 4, background: "white" } }).png().toBuffer();
    const checksum = createHash("sha256").update(source).digest("hex");
    input.jobs[0]!.payload.imagePackage = input.jobs[1]!.payload.imagePackage = {
      ...input.jobs[0]!.payload.imagePackage,
      product: {
        id: productId, versionId, kind: "product", name: "답례품", description: "커피와 쿠키",
        features: [], benefits: [], cautions: [], evergreenPurchaseInfo: "",
        images: [{ assetId: registeredId, role: "hero", storageUrl: "https://blob.example/product.png", storagePath: "registered.png", mimeType: "image/png", checksum }],
      },
      attachments: [{ id: attachmentId, role: "product_image", fileName: "attached.png", mimeType: "image/png", sizeBytes: source.byteLength, storageUrl: "https://blob.example/attached.png", storagePath: "attached.png", checksum }],
    } as never;
    for (const job of input.jobs) job.payload.contentPlan = {
      _privateProductVisualSourceSnapshot: {
        contractVersion: "product-visual-source-snapshot.v1", productServiceId: productId,
        versionId, kind: "product", sourceUrls: ["https://shop.example/item?token=secret"],
      },
    };
    let workspaceDir = "";
    const runChild = vi.fn(async (run: { outputFiles: string[]; workspaceDir: string; prompt: string }) => {
      workspaceDir = run.workspaceDir;
      if (process.platform !== "win32") {
        expect((await stat(path.dirname(run.workspaceDir))).mode & 0o777).toBe(0o711);
      }
      const requiredPaths = JSON.parse(await readFile(path.join(run.workspaceDir, "required-product-reference-paths.json"), "utf8")) as string[];
      expect(requiredPaths.every((referencePath) => path.isAbsolute(referencePath))).toBe(true);
      expect(requiredPaths.map((referencePath) => path.relative(run.workspaceDir, referencePath).replaceAll("\\", "/"))).toEqual([
        "inputs/attachments/attachment-1.png", "inputs/product-1.png", "inputs/product-url-1.png",
      ]);
      expect(run.prompt).toContain(JSON.stringify(requiredPaths[0]));
      expect(run.prompt).toContain("Every image_generation call MUST include every local path");
      for (const output of run.outputFiles) { await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, source); }
    });
    const acquire = vi.fn(async ({ inputDir }: { inputDir: string }) => {
      const absolutePath = path.join(inputDir, "product-url-1.png");
      await writeFile(absolutePath, source);
      const candidate = {
        candidateId: "a".repeat(64), sourcePageUrl: "https://shop.example/item?token=secret",
        imageUrl: "https://cdn.example/product.png?token=secret", discoveryMethod: "json_ld" as const,
        mimeType: "image/png" as const, width: 512, height: 512, contentSha256: checksum,
        decision: "selected" as const, reason: "url_fill",
      };
      return { references: [{ candidate, absolutePath, relativePath: "inputs/product-url-1.png" }], candidates: [candidate], events: [] };
    });
    const renderer = createAiContentVisualSessionRenderer({
      workerRoot,
      readOwned: vi.fn(async () => source),
      runChild: runChild as never,
      acquireProductUrlReferences: acquire as never,
    });

    await renderer.renderSession(input as never, new AbortController().signal);

    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({ slots: 3 }));
    await expect(readFile(workspaceDir)).rejects.toMatchObject({ code: expect.stringMatching(/ENOENT|EISDIR/) });
  });
});
