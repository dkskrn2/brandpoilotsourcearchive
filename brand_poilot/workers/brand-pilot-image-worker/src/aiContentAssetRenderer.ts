import { spawn, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ContentAspectRatioV2 } from "@brand-pilot/worker-runtime";
import { buildImageWorkerChildEnvironment } from "./childEnvironment.mjs";
import { signalProcessTree } from "./processTermination.mjs";
import { buildAiContentAssetPrompt, type StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";
import type { AiContentImageAssetJob } from "./aiContentRenderClient.js";

export interface LocallyRenderedAiContentAsset {
  index: number;
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  checksum: string;
}

export interface AiContentAssetRenderer {
  renderAsset(job: AiContentImageAssetJob, signal: AbortSignal): Promise<LocallyRenderedAiContentAsset>;
}

export type AiContentAssetChildRunner = (input: {
  workspaceDir: string;
  outputFile: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<void>;

export function dimensionsForAspectRatio(ratio: ContentAspectRatioV2): { width: number; height: number } {
  switch (ratio) {
    case "4:5": return { width: 1080, height: 1350 };
    case "16:9": return { width: 1920, height: 1080 };
    case "9:16": return { width: 1080, height: 1920 };
    default: return { width: 1080, height: 1080 };
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function extension(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

async function makeReadOnly(filePath: string): Promise<void> {
  await chmod(filePath, 0o444);
}

type AiContentAssetChild = {
  pid?: number;
  kill(signal?: NodeJS.Signals): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null) => void): unknown;
};

type SpawnAiContentAssetChild = (command: string, args: string[], options: SpawnOptions) => AiContentAssetChild;

export async function runAiContentAssetChildProcess(input: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
}, dependencies: {
  spawnProcess?: SpawnAiContentAssetChild;
  signalTree?: (child: AiContentAssetChild, signal: NodeJS.Signals) => Promise<void>;
  platform?: NodeJS.Platform;
  terminationGraceMs?: number;
  hardKillWaitMs?: number;
} = {}): Promise<void> {
  if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("ai_content_asset_render_aborted");
  await new Promise<void>((resolve, reject) => {
    const child = (dependencies.spawnProcess ?? spawn as SpawnAiContentAssetChild)(input.command, input.args, {
      shell: false,
      windowsHide: true,
      cwd: input.cwd,
      detached: (dependencies.platform ?? process.platform) !== "win32",
      stdio: "inherit",
      env: input.env,
    });
    const platform = dependencies.platform ?? process.platform;
    const signalTree = dependencies.signalTree ?? signalProcessTree;
    let settled = false;
    let stopError: Error | null = null;
    let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
    const commandTimer = setTimeout(
      () => requestStop(new Error("ai_content_asset_render_timeout")),
      input.timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(commandTimer);
      if (gracefulTimer) clearTimeout(gracefulTimer);
      if (hardKillTimer) clearTimeout(hardKillTimer);
      input.signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const hardKill = () => {
      if (settled) return;
      void signalTree(child, "SIGKILL")
        .catch(() => undefined)
        .finally(() => {
          if (!settled) {
            hardKillTimer = setTimeout(
              () => finish(stopError ?? new Error("ai_content_asset_render_aborted")),
              dependencies.hardKillWaitMs ?? 1_000,
            );
          }
        });
    };
    function requestStop(error: Error) {
      if (settled || stopError) return;
      stopError = error;
      clearTimeout(commandTimer);
      const graceful = platform === "win32"
        ? Promise.resolve().then(() => { child.kill("SIGTERM"); })
        : signalTree(child, "SIGTERM");
      void graceful
        .catch(() => undefined)
        .finally(() => {
          if (!settled) gracefulTimer = setTimeout(hardKill, dependencies.terminationGraceMs ?? 5_000);
        });
    }
    const abort = () => requestStop(input.signal.reason instanceof Error ? input.signal.reason : new Error("ai_content_asset_render_aborted"));
    input.signal.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => finish(stopError ?? error));
    child.once("exit", (code) => {
      if (stopError) finish(stopError);
      else code === 0 ? finish() : finish(new Error(`ai_content_asset_render_failed:${code ?? "unknown"}`));
    });
    if (input.signal.aborted) abort();
  });
}

async function defaultChildRunner(input: {
  workerRoot: string;
  timeoutMs: number;
  workspaceDir: string;
  outputFile: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<void> {
  if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("ai_content_asset_render_aborted");
  const jobFile = path.join(input.workspaceDir, "asset-job.json");
  await writeFile(jobFile, JSON.stringify({ prompt: input.prompt, selectedAssetCount: 1 }), { encoding: "utf8", mode: 0o444 });
  await runAiContentAssetChildProcess({
    command: process.execPath,
    args: [
      path.join(input.workerRoot, "scripts", "run-codex-ai-content-asset.mjs"),
      "--job", jobFile, "--output", input.outputFile, "--workspace", input.workspaceDir,
    ],
    cwd: input.workspaceDir,
    env: buildImageWorkerChildEnvironment(process.env),
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
}

async function normalizedPng(bytes: Buffer, dimensions: { width: number; height: number }): Promise<Buffer> {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  return sharp(bytes, { failOn: "error" })
    .resize(dimensions.width, dimensions.height, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export function createAiContentAssetRenderer({
  workerRoot,
  readOwned,
  runChild,
  timeoutMs = 20 * 60_000,
}: {
  workerRoot: string;
  readOwned(storagePath: string): Promise<Buffer>;
  runChild?: AiContentAssetChildRunner;
  timeoutMs?: number;
}): AiContentAssetRenderer {
  return {
    async renderAsset(job, signal) {
      const imagePackage = job.payload.imagePackage;
      const asset = imagePackage.assets[job.assetIndex - 1];
      if (!asset || asset.index !== job.assetIndex) throw new Error("ai_content_asset_index_invalid");
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-ai-content-asset-"));
      try {
        const workspaceDir = path.join(workDir, "workspace");
        const inputDir = path.join(workspaceDir, "inputs");
        const skillDir = path.join(workspaceDir, ".codex", "skills", "image-render");
        const outputFile = path.join(workDir, "output", "asset.png");
        await Promise.all([mkdir(inputDir, { recursive: true }), mkdir(skillDir, { recursive: true }), mkdir(path.dirname(outputFile), { recursive: true })]);
        const agentFile = path.join(workspaceDir, "AGENTS.md");
        const skillFile = path.join(skillDir, "SKILL.md");
        await Promise.all([
          copyFile(path.join(workerRoot, "AGENTS.md"), agentFile),
          copyFile(path.join(workerRoot, ".codex", "skills", "image-render", "SKILL.md"), skillFile),
        ]);
        await Promise.all([makeReadOnly(agentFile), makeReadOnly(skillFile)]);

        const staged: StagedAiContentAssetInputs = { productImages: [], styleImages: [], references: [], attachments: [] };
        const stage = async (storagePath: string, checksum: string, fileName: string): Promise<string> => {
          const bytes = await readOwned(storagePath);
          if (sha256(bytes) !== checksum.toLowerCase()) throw new Error("ai_content_owned_blob_checksum_mismatch");
          const target = path.join(inputDir, fileName);
          await writeFile(target, bytes, { mode: 0o444 });
          await makeReadOnly(target);
          return path.posix.join("inputs", fileName);
        };

        const selectedProductIds = new Set(asset.productImageAssetIds);
        for (const [offset, image] of (imagePackage.product?.images ?? []).filter((item) => selectedProductIds.has(item.assetId)).entries()) {
          staged.productImages.push({ id: image.assetId, path: await stage(image.storagePath, image.checksum, `product-${String(offset + 1).padStart(2, "0")}${extension(image.mimeType)}`) });
        }
        for (const [offset, image] of imagePackage.brandStyleImages.entries()) {
          staged.styleImages.push({ id: image.referenceItemId, path: await stage(image.storagePath, image.checksum, `style-${String(offset + 1).padStart(2, "0")}${extension(image.mimeType)}`), avatar: image.referenceItemId === imagePackage.avatarStyleImageId });
        }
        for (const [offset, reference] of imagePackage.references.entries()) {
          staged.references.push({
            id: reference.referenceItemId,
            path: reference.image ? await stage(reference.image.storagePath, reference.image.checksum, `reference-${String(offset + 1).padStart(2, "0")}${extension(reference.image.mimeType)}`) : null,
            roles: reference.roles, title: reference.title, text: reference.text,
          });
        }
        const selectedAttachmentIds = new Set(asset.attachmentIds);
        for (const [offset, attachment] of imagePackage.attachments.filter((item) => selectedAttachmentIds.has(item.id)).entries()) {
          staged.attachments.push({ id: attachment.id, path: await stage(attachment.storagePath, attachment.checksum, `attachment-${String(offset + 1).padStart(2, "0")}${extension(attachment.mimeType)}`), role: attachment.role });
        }
        if (staged.productImages.length !== selectedProductIds.size || staged.attachments.length !== selectedAttachmentIds.size) throw new Error("ai_content_asset_binding_invalid");
        if (imagePackage.avatarStyleImageId !== null && staged.styleImages.filter((item) => item.avatar).length !== 1) throw new Error("ai_content_avatar_stage_invalid");

        const prompt = buildAiContentAssetPrompt({ imagePackage, assetIndex: job.assetIndex, staged });
        await (runChild ?? ((input) => defaultChildRunner({ ...input, workerRoot, timeoutMs })))({ workspaceDir, outputFile, prompt, signal });
        const normalized = await normalizedPng(await readFile(outputFile), dimensionsForAspectRatio(imagePackage.aspectRatio));
        const dimensions = dimensionsForAspectRatio(imagePackage.aspectRatio);
        return { index: job.assetIndex, bytes: normalized, mimeType: "image/png", ...dimensions, checksum: sha256(normalized) };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}
