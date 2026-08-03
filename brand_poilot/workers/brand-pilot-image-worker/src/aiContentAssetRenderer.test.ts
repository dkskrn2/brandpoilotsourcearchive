import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createAiContentAssetRenderer, dimensionsForAspectRatio, runAiContentAssetChildProcess } from "./aiContentAssetRenderer.js";
import type { AiContentImageAssetJob } from "./aiContentRenderClient.js";

const uid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (c: string) => c.repeat(64);

function job(): AiContentImageAssetJob {
  return {
    id: uid(1), generationId: uid(2), outputId: uid(3), workspaceId: uid(4), brandId: uid(5), jobKind: "image_asset", assetIndex: 2, leaseToken: "lease", attemptCount: 1,
    payload: {
      contractVersion: "ai-content-render-job.v1", jobKind: "image_asset", generationId: uid(2), outputId: uid(3), assetIndex: 2,
      assetKey: `${uid(2)}:2`, storagePath: `ai-content/${uid(5)}/${uid(2)}/${uid(3)}/assets/02.png`,
      imagePackage: {
        contractVersion: "image-generation-package.v1", generationId: uid(2), outputFormat: "card_news", purpose: "marketing", assetCount: 3, aspectRatio: "4:5", channelTargets: ["instagram"],
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

describe("V3 single asset renderer", () => {
  it("maps every contract ratio to its exact dimensions", () => {
    expect(dimensionsForAspectRatio("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsForAspectRatio("4:5")).toEqual({ width: 1080, height: 1350 });
    expect(dimensionsForAspectRatio("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsForAspectRatio("9:16")).toEqual({ width: 1080, height: 1920 });
  });

  it("reads only owned storage paths, verifies checksums, stages read-only files, and normalizes one model-native PNG to the contract ratio", async () => {
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
    expect(result).toMatchObject({ index: 2, mimeType: "image/png", width: 1080, height: 1350 });
    expect((await sharp(result.bytes).metadata())).toMatchObject({ width: 1080, height: 1350, format: "png" });
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
});
