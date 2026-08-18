import { spawn, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ContentAspectRatio } from "@brand-pilot/content-contracts";
import {
  codexAccountFailure,
  codexAccountSuccess,
  type CodexAccountPool,
} from "@brand-pilot/worker-runtime";
import { buildImageWorkerChildEnvironment } from "./childEnvironment.mjs";
import { signalProcessTree } from "./processTermination.mjs";
import type { StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";
import { buildAiContentManualAssetPromptV2 } from "./aiContentManualAssetPromptV2.js";
import type { AiContentImageAssetJob } from "./aiContentRenderClient.js";
import { buildAiContentManualRenderContract } from "./aiContentManualRenderContract.js";
import { AI_CONTENT_OWNED_IMAGE_MAX_BYTES, type AiContentOwnedBlobReadConstraints } from "./storage.js";

export interface LocallyRenderedAiContentAsset {
  index: number;
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  checksum: string;
  renderDiagnostic?: AiContentEditorialRenderDiagnostic;
}

export interface AiContentEditorialRenderDiagnostic {
  contractVersion: "ai-content-editorial-render-diagnostic.v1";
  sourceContractVersion: "card-manuscript-plan.v1" | "reel-storyboard.v1";
  sourceSha256: string;
  sceneIndex: number;
  compiledPromptVersion: "image-visual-session.v1";
  compiledPromptSha256: string;
  actualToolArgumentsObservation: "observed" | "not_emitted_by_runner";
  actualToolArgumentsSha256: string | null;
}

export interface AiContentAssetRenderer {
  renderAsset(job: AiContentImageAssetJob, signal: AbortSignal): Promise<LocallyRenderedAiContentAsset>;
}

export type AiContentAssetChildRunner = (input: {
  workspaceDir: string;
  outputFile: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<{ observation: "observed" | "not_emitted_by_runner"; actualToolArgumentsSha256: string | null } | void>;

export function dimensionsForAspectRatio(ratio: ContentAspectRatio): { width: number; height: number } {
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

async function writeReadOnlyJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o444 });
  await makeReadOnly(filePath);
}

type AiContentAssetChild = {
  pid?: number;
  stderr?: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number | null) => void): unknown;
};

type SpawnAiContentAssetChild = (command: string, args: string[], options: SpawnOptions) => AiContentAssetChild;

type AiContentAssetProcessInput = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  accountPool?: CodexAccountPool;
  outputFile?: string;
  signal: AbortSignal;
  timeoutMs: number;
};

type AiContentAssetProcessDependencies = {
  spawnProcess?: SpawnAiContentAssetChild;
  signalTree?: (child: AiContentAssetChild, signal: NodeJS.Signals) => Promise<void>;
  platform?: NodeJS.Platform;
  terminationGraceMs?: number;
  hardKillWaitMs?: number;
};

class AiContentAssetProcessError extends Error {
  readonly diagnostic!: string;

  constructor(message: string, diagnostic: string) {
    super(message);
    this.name = "AiContentAssetProcessError";
    Object.defineProperty(this, "diagnostic", {
      configurable: false,
      enumerable: false,
      value: diagnostic,
      writable: false,
    });
  }
}

async function runAiContentAssetChildAttempt(
  input: AiContentAssetProcessInput,
  dependencies: AiContentAssetProcessDependencies,
  captureDiagnostic: boolean,
): Promise<void> {
  if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("ai_content_asset_render_aborted");
  await new Promise<void>((resolve, reject) => {
    const child = (dependencies.spawnProcess ?? spawn as SpawnAiContentAssetChild)(input.command, input.args, {
      shell: false,
      windowsHide: true,
      cwd: input.cwd,
      detached: (dependencies.platform ?? process.platform) !== "win32",
      stdio: captureDiagnostic ? ["inherit", "inherit", "pipe"] : "inherit",
      env: input.env,
    });
    const platform = dependencies.platform ?? process.platform;
    const signalTree = dependencies.signalTree ?? signalProcessTree;
    let settled = false;
    let stopError: Error | null = null;
    let gracefulTimer: ReturnType<typeof setTimeout> | undefined;
    let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
    let diagnostic = "";
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
    if (captureDiagnostic) {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        if (diagnostic.length < 8_192) {
          diagnostic += String(chunk).slice(0, 8_192 - diagnostic.length);
        }
      });
    }
    child.once("error", (error) => finish(stopError ?? error));
    child.once("exit", (code) => {
      if (stopError) finish(stopError);
      else code === 0
        ? finish()
        : finish(captureDiagnostic
          ? new AiContentAssetProcessError(`ai_content_asset_render_failed:${code ?? "unknown"}`, diagnostic)
          : new Error(`ai_content_asset_render_failed:${code ?? "unknown"}`));
    });
    if (input.signal.aborted) abort();
  });
}

export async function runAiContentAssetChildProcess(
  input: AiContentAssetProcessInput,
  dependencies: AiContentAssetProcessDependencies = {},
): Promise<void> {
  if (!input.accountPool) {
    await runAiContentAssetChildAttempt(input, dependencies, false);
    return;
  }
  await input.accountPool.run(async (profile) => {
    try {
      await runAiContentAssetChildAttempt({
        ...input,
        accountPool: undefined,
        env: buildImageWorkerChildEnvironment({
          ...input.env,
          CODEX_HOME: profile.home,
          CODEX_GENERATED_IMAGES_DIR: path.join(profile.home, "generated_images"),
        }),
      }, dependencies, true);
      return codexAccountSuccess(undefined);
    } catch (error) {
      if (!(error instanceof AiContentAssetProcessError)) throw error;
      const acceptedOutput = input.outputFile
        ? await access(input.outputFile).then(() => true, () => false)
        : true;
      return codexAccountFailure(error, error.diagnostic, acceptedOutput);
    }
  });
}

async function defaultChildRunner(input: {
  accountPool: CodexAccountPool;
  workerRoot: string;
  timeoutMs: number;
  workspaceDir: string;
  outputFile: string;
  prompt: string;
  signal: AbortSignal;
  resultContractVersion: "ai-content-asset-render.v1" | "ai-content-asset-render.v2";
  assetIndex: number;
}): Promise<{ observation: "observed" | "not_emitted_by_runner"; actualToolArgumentsSha256: string | null }> {
  if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error("ai_content_asset_render_aborted");
  const jobFile = path.join(input.workspaceDir, "asset-job.json");
  const diagnosticFile = path.join(input.workspaceDir, "tool-observation.json");
  if (input.resultContractVersion === "ai-content-asset-render.v1") {
    await writeFile(jobFile, JSON.stringify({ prompt: input.prompt, selectedAssetCount: 1 }), { encoding: "utf8", mode: 0o444 });
  } else {
    await writeFile(jobFile, JSON.stringify({
      prompt: input.prompt,
      contractVersion: "ai-content-asset-render.v2",
      assetIndex: input.assetIndex,
    }), { encoding: "utf8", mode: 0o444 });
  }
  await runAiContentAssetChildProcess({
    accountPool: input.accountPool,
    command: process.execPath,
    args: [
      path.join(input.workerRoot, "scripts", "run-codex-ai-content-asset.mjs"),
      "--job", jobFile, "--output", input.outputFile, "--workspace", input.workspaceDir,
      "--diagnostic", diagnosticFile,
    ],
    cwd: input.workspaceDir,
    env: buildImageWorkerChildEnvironment(process.env),
    outputFile: input.outputFile,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
  const source = JSON.parse(await readFile(diagnosticFile, "utf8")) as Record<string, unknown>;
  if (source.contractVersion !== "ai-content-editorial-tool-observation.v1"
    || !["observed", "not_emitted_by_runner"].includes(String(source.observation))) {
    throw new Error("ai_content_card_deck_tool_observation_invalid");
  }
  const actualToolArgumentsSha256 = source.actualToolArguments === null
    ? null
    : sha256(Buffer.from(JSON.stringify(source.actualToolArguments)));
  return {
    observation: source.observation as "observed" | "not_emitted_by_runner",
    actualToolArgumentsSha256,
  };
}

async function normalizedPng(bytes: Buffer, dimensions: { width: number; height: number }): Promise<Buffer> {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  return sharp(bytes, { failOn: "error" })
    .resize(dimensions.width, dimensions.height, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function normalizedSquarePng(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  const size = Math.min(metadata.width, metadata.height);
  const normalized = await sharp(bytes, { failOn: "error" })
    .extract({
      left: Math.floor((metadata.width - size) / 2),
      top: Math.floor((metadata.height - size) / 2),
      width: size,
      height: size,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes: normalized, width: size, height: size };
}

async function preservedPng(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  return { bytes, width: metadata.width, height: metadata.height };
}

async function normalizedVerticalPng(bytes: Buffer): Promise<{ bytes: Buffer; width: number; height: number }> {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  const unit = Math.floor(Math.min(metadata.width / 9, metadata.height / 16) / 2) * 2;
  if (unit < 1) throw new Error("ai_content_asset_output_aspect_ratio_invalid");
  const width = unit * 9;
  const height = unit * 16;
  const normalized = await sharp(bytes, { failOn: "error" })
    .extract({ left: Math.floor((metadata.width - width) / 2), top: Math.floor((metadata.height - height) / 2), width, height })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { bytes: normalized, width, height };
}

export function createAiContentAssetRenderer({
  accountPool,
  workerRoot,
  readOwned,
  runChild,
  timeoutMs = 20 * 60_000,
}: {
  accountPool?: CodexAccountPool;
  workerRoot: string;
  readOwned(storagePath: string, constraints?: AiContentOwnedBlobReadConstraints): Promise<Buffer>;
  runChild?: AiContentAssetChildRunner;
  timeoutMs?: number;
}): AiContentAssetRenderer {
  return {
    async renderAsset(job, signal) {
      const imagePackage = job.payload.imagePackage;
      const asset = imagePackage.assets[job.assetIndex - 1];
      if (!asset || asset.index !== job.assetIndex) throw new Error("ai_content_asset_index_invalid");
      const manualRenderContract = buildAiContentManualRenderContract({
          identity: {
            id: job.id, generationId: job.generationId, outputId: job.outputId,
            workspaceId: job.workspaceId, brandId: job.brandId, assetIndex: job.assetIndex,
          },
          payload: job.payload,
        });
      for (const attachment of imagePackage.attachments) {
        if (attachment.sizeBytes > AI_CONTENT_OWNED_IMAGE_MAX_BYTES) {
          throw new Error("ai_content_owned_blob_size_limit_exceeded");
        }
      }
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

        {
          const attachmentDir = path.join(inputDir, "attachments");
          await mkdir(attachmentDir, { recursive: true });
          await Promise.all([
            writeReadOnlyJson(path.join(inputDir, "content-generation-input.json"), job.payload.contentGenerationInput),
            writeReadOnlyJson(path.join(inputDir, "content-plan.json"), job.payload.contentPlan),
            writeReadOnlyJson(path.join(inputDir, "render-contract.json"), manualRenderContract),
            ...(manualRenderContract.blogInsertionContext === null
              ? []
              : [writeReadOnlyJson(path.join(inputDir, "blog-insertion-context.json"), manualRenderContract.blogInsertionContext)]),
          ]);
        }

        const staged: StagedAiContentAssetInputs = { productImages: [], styleImages: [], references: [], attachments: [] };
        const stage = async (
          storagePath: string,
          checksum: string,
          fileName: string,
          attachmentConstraints?: { sizeBytes: number; mimeType: "image/png" | "image/jpeg" | "image/webp" },
        ): Promise<string> => {
          const bytes = attachmentConstraints
            ? await readOwned(storagePath, {
              maxBytes: AI_CONTENT_OWNED_IMAGE_MAX_BYTES,
              expectedSizeBytes: attachmentConstraints.sizeBytes,
              expectedContentType: attachmentConstraints.mimeType,
            })
            : await readOwned(storagePath);
          if (sha256(bytes) !== checksum.toLowerCase()) throw new Error("ai_content_owned_blob_checksum_mismatch");
          if (attachmentConstraints && bytes.byteLength !== attachmentConstraints.sizeBytes) throw new Error("ai_content_owned_blob_size_mismatch");
          if (attachmentConstraints) {
            const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => null);
            const expectedFormat = attachmentConstraints.mimeType === "image/jpeg"
              ? "jpeg"
              : attachmentConstraints.mimeType.slice("image/".length);
            if (metadata?.format !== expectedFormat) throw new Error("ai_content_owned_blob_content_type_mismatch");
          }
          const target = path.join(inputDir, fileName);
          await writeFile(target, bytes, { mode: 0o444 });
          await makeReadOnly(target);
          return path.posix.join("inputs", fileName);
        };

        const selectedProductIds = new Set(asset.productImageAssetIds);
        for (const [offset, image] of (imagePackage.product?.images ?? []).filter((item) => selectedProductIds.has(item.assetId)).entries()) {
          staged.productImages.push({ id: image.assetId, path: await stage(image.storagePath, image.checksum, `product-${String(offset + 1).padStart(2, "0")}${extension(image.mimeType)}`) });
        }
        const selectedStyleImages = imagePackage.brandStyleImages;
        for (const [offset, image] of selectedStyleImages.entries()) {
          staged.styleImages.push({ id: image.referenceItemId, path: await stage(image.storagePath, image.checksum, `style-${String(offset + 1).padStart(2, "0")}${extension(image.mimeType)}`), avatar: image.tags.includes("avatar") || image.referenceItemId === imagePackage.avatarStyleImageId });
        }
        for (const [offset, reference] of imagePackage.references.entries()) {
          staged.references.push({
            id: reference.referenceItemId,
            path: reference.image ? await stage(reference.image.storagePath, reference.image.checksum, `reference-${String(offset + 1).padStart(2, "0")}${extension(reference.image.mimeType)}`) : null,
            roles: reference.roles, title: reference.title, text: reference.text,
          });
        }
        const attachmentsToStage = imagePackage.attachments;
        for (const [offset, attachment] of attachmentsToStage.entries()) {
          const fileName = path.posix.join("attachments", `attachment-${String(offset + 1).padStart(2, "0")}${extension(attachment.mimeType)}`);
          staged.attachments.push({
            id: attachment.id,
            path: await stage(attachment.storagePath, attachment.checksum, fileName, {
              sizeBytes: attachment.sizeBytes,
              mimeType: attachment.mimeType,
            }),
            role: attachment.role,
          });
        }
        if (
          staged.productImages.length !== selectedProductIds.size
          || staged.attachments.length !== imagePackage.attachments.length
        ) throw new Error("ai_content_asset_binding_invalid");
        if (imagePackage.avatarStyleImageId !== null
          && !staged.styleImages.some((item) => item.id === imagePackage.avatarStyleImageId && item.avatar)) {
          throw new Error("ai_content_avatar_stage_invalid");
        }

        {
          await writeReadOnlyJson(path.join(inputDir, "attachments", "index.json"), {
            contractVersion: "ai-content-attachment-index.v1",
            referenceSemantics: "optional_visual_reference",
            attachments: imagePackage.attachments.map((attachment, offset) => ({
              index: offset + 1,
              id: attachment.id,
              role: attachment.role,
              originalFileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              checksum: attachment.checksum,
              path: staged.attachments[offset]!.path,
            })),
          });
        }

        const prompt = buildAiContentManualAssetPromptV2({ renderContract: manualRenderContract, staged });
        const childRunner = runChild ?? (accountPool
          ? ((input) => defaultChildRunner({
            ...input,
            accountPool,
            workerRoot,
            timeoutMs,
            resultContractVersion: "ai-content-asset-render.v2",
            assetIndex: job.assetIndex,
          }))
          : undefined);
        if (!childRunner) throw new Error("codex_account_pool_required");
        await childRunner({ workspaceDir, outputFile, prompt, signal });
        const outputBytes = await readFile(outputFile);
        const rendered = imagePackage.outputFormat === "blog"
          ? await preservedPng(outputBytes)
          : imagePackage.outputFormat === "card_news"
            ? await normalizedSquarePng(outputBytes)
            : imagePackage.outputFormat === "reel"
              ? await normalizedVerticalPng(outputBytes)
              : await (async () => {
            const dimensions = dimensionsForAspectRatio(imagePackage.aspectRatio);
            return { bytes: await normalizedPng(outputBytes, dimensions), ...dimensions };
          })();
        return {
          index: job.assetIndex, mimeType: "image/png", ...rendered, checksum: sha256(rendered.bytes),
        };
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
  };
}
