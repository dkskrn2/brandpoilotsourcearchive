import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { CodexAccountPool } from "@brand-pilot/worker-runtime";
import type { StagedAiContentAssetInputs } from "./aiContentAssetPrompt.js";
import { buildImageWorkerChildEnvironment } from "./childEnvironment.mjs";
import { runAiContentAssetChildProcess, type AiContentEditorialRenderDiagnostic, type LocallyRenderedAiContentAsset } from "./aiContentAssetRenderer.js";
import type { AiContentVisualSessionLease } from "./aiContentRenderClient.js";
import { compileAiContentVisualSessionPrompt } from "./aiContentVisualSessionPromptCompiler.js";
import { AI_CONTENT_OWNED_IMAGE_MAX_BYTES, type AiContentOwnedBlobReadConstraints } from "./storage.js";

export interface AiContentVisualSessionRenderer {
  renderSession(batch: AiContentVisualSessionLease, signal: AbortSignal): Promise<AiContentVisualSessionRenderedAssets>;
}

export interface AiContentVisualSessionTiming {
  stageReferencesMs: number;
  codexStartupMs: number;
  sceneGenerationMs: number[];
  uploadMs: number;
  completeMs: number;
}

export type AiContentVisualSessionRenderedAssets = Array<LocallyRenderedAiContentAsset & { renderDiagnostic: AiContentEditorialRenderDiagnostic }> & {
  timing: Pick<AiContentVisualSessionTiming, "stageReferencesMs" | "codexStartupMs" | "sceneGenerationMs">;
};

export type AiContentVisualSessionChildRunner = (input: {
  workspaceDir: string;
  outputFiles: string[];
  prompt: string;
  signal: AbortSignal;
}) => Promise<{ actualToolArguments: unknown[]; codexStartupMs?: number; sceneGenerationMs?: number[] } | void>;

function hash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function extension(mime: string): string { return mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png"; }
async function readonly(file: string): Promise<void> { await chmod(file, 0o444); }
async function writeJson(file: string, value: unknown): Promise<void> { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o444 }); await readonly(file); }
function commandArgument(value: string): string { return `"${value.replaceAll('"', '\\"')}"`; }

function safeVisualSessionDiagnosticCode(error: unknown): string | undefined {
  const record = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const message = error instanceof Error ? error.message : "";
  const diagnostic = typeof record.diagnostic === "string" ? record.diagnostic : "";
  const matches = `${message}\n${diagnostic}`.match(/\b(?:ai_content|codex|visual_session)_[a-z0-9_]{1,108}\b/g);
  const generic = new Set([
    "ai_content_asset_render_failed",
    "ai_content_visual_session_failed",
    "codex_ai_content_asset_failed",
  ]);
  return matches ? [...matches].reverse().find((code) => !generic.has(code)) ?? matches.at(-1) : undefined;
}

function visualSessionHooks(workerRoot: string) {
  const command = `${commandArgument(process.execPath)} ${commandArgument(path.join(workerRoot, "scripts", "audit-codex-visual-session-image.mjs"))}`;
  const handler = { type: "command", command, timeout: 10 };
  return {
    hooks: {
      PreToolUse: [{ matcher: ".*", hooks: [handler] }],
      PostToolUse: [{ matcher: ".*", hooks: [handler] }],
    },
  };
}

async function normalize(bytes: Buffer, format: "card_news" | "reel") {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => { throw new Error("ai_content_asset_output_not_png"); });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) throw new Error("ai_content_asset_output_not_png");
  if (format === "card_news") {
    const size = Math.min(metadata.width, metadata.height);
    const output = await sharp(bytes, { failOn: "error" }).extract({ left: Math.floor((metadata.width - size) / 2), top: Math.floor((metadata.height - size) / 2), width: size, height: size }).png({ compressionLevel: 9 }).toBuffer();
    return { bytes: output, width: size, height: size };
  }
  const unit = Math.floor(Math.min(metadata.width / 9, metadata.height / 16) / 2) * 2;
  if (unit < 1) throw new Error("ai_content_asset_output_aspect_ratio_invalid");
  const width = unit * 9; const height = unit * 16;
  const output = await sharp(bytes, { failOn: "error" }).extract({ left: Math.floor((metadata.width - width) / 2), top: Math.floor((metadata.height - height) / 2), width, height }).png({ compressionLevel: 9 }).toBuffer();
  return { bytes: output, width, height };
}

function defaultRunner(input: { accountPool: CodexAccountPool; workerRoot: string; timeoutMs: number }): AiContentVisualSessionChildRunner {
  return async ({ workspaceDir, outputFiles, prompt, signal }) => {
    const jobFile = path.join(workspaceDir, "visual-session-job.json");
    const diagnosticFile = path.join(workspaceDir, "visual-session-observation.json");
    const outputDir = path.dirname(outputFiles[0]!);
    await writeFile(jobFile, JSON.stringify({ contractVersion: "ai-content-visual-session-render.v1", prompt, expectedSceneIndices: outputFiles.map((_, offset) => offset + 1) }), { encoding: "utf8", mode: 0o444 });
    await runAiContentAssetChildProcess({
      accountPool: input.accountPool,
      command: process.execPath,
      args: [path.join(input.workerRoot, "scripts", "run-codex-ai-content-asset.mjs"), "--job", jobFile, "--output", outputDir, "--workspace", workspaceDir, "--diagnostic", diagnosticFile],
      cwd: workspaceDir, env: buildImageWorkerChildEnvironment(process.env), outputFile: outputFiles.at(-1), signal, timeoutMs: input.timeoutMs,
    });
    const observation = JSON.parse(await readFile(diagnosticFile, "utf8")) as Record<string, unknown>;
    if (observation.contractVersion !== "ai-content-editorial-tool-observation.v1"
      || observation.observation !== "observed" || !Array.isArray(observation.actualToolArguments)
      || observation.actualToolArguments.length !== outputFiles.length
      || typeof observation.codexStartupMs !== "number" || observation.codexStartupMs < 0
      || !Array.isArray(observation.sceneGenerationMs) || observation.sceneGenerationMs.length !== outputFiles.length
      || observation.sceneGenerationMs.some((value) => typeof value !== "number" || value < 0)) throw new Error("ai_content_visual_session_tool_observation_invalid");
    return { actualToolArguments: observation.actualToolArguments, codexStartupMs: observation.codexStartupMs, sceneGenerationMs: observation.sceneGenerationMs as number[] };
  };
}

export function createAiContentVisualSessionRenderer(input: {
  accountPool?: CodexAccountPool;
  workerRoot: string;
  readOwned(storagePath: string, constraints?: AiContentOwnedBlobReadConstraints): Promise<Buffer>;
  runChild?: AiContentVisualSessionChildRunner;
  timeoutMs?: number;
}): AiContentVisualSessionRenderer {
  return {
    async renderSession(batch, signal) {
      if (batch.jobs.length !== batch.visualSession.scenes.length || batch.jobs.some(({ assetIndex }, offset) => assetIndex !== offset + 1)) throw new Error("ai_content_visual_session_invalid");
      const imagePackage = batch.jobs[0]!.payload.imagePackage;
      if (batch.jobs.some(({ payload }) => JSON.stringify(payload.imagePackage) !== JSON.stringify(imagePackage))) throw new Error("ai_content_visual_session_invalid");
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-ai-visual-session-"));
      try {
        const workspaceDir = path.join(workDir, "workspace");
        const inputDir = path.join(workspaceDir, "inputs");
        const outputDir = path.join(workDir, "output");
        const skillDir = path.join(workspaceDir, ".codex", "skills", "image-render");
        const codexDir = path.join(workspaceDir, ".codex");
        await Promise.all([mkdir(inputDir, { recursive: true }), mkdir(outputDir, { recursive: true }), mkdir(skillDir, { recursive: true })]);
        const agents = path.join(workspaceDir, "AGENTS.md"); const skill = path.join(skillDir, "SKILL.md");
        await Promise.all([copyFile(path.join(input.workerRoot, "AGENTS.md"), agents), copyFile(path.join(input.workerRoot, ".codex", "skills", "image-render", "SKILL.md"), skill)]);
        await Promise.all([readonly(agents), readonly(skill), writeJson(path.join(codexDir, "hooks.json"), visualSessionHooks(input.workerRoot)), writeJson(path.join(inputDir, "visual-session.json"), batch.visualSession), writeJson(path.join(inputDir, "content-generation-input.json"), batch.jobs[0]!.payload.contentGenerationInput), writeJson(path.join(inputDir, "content-plan.json"), batch.jobs[0]!.payload.contentPlan)]);

        const stageReferencesStartedAt = Date.now();
        const staged: StagedAiContentAssetInputs = { productImages: [], styleImages: [], references: [], attachments: [] };
        const stage = async (storagePath: string, checksum: string, name: string, constraints?: AiContentOwnedBlobReadConstraints) => {
          const bytes = await input.readOwned(storagePath, constraints);
          if (bytes.byteLength > AI_CONTENT_OWNED_IMAGE_MAX_BYTES || hash(bytes) !== checksum.toLowerCase()) throw new Error("ai_content_owned_blob_checksum_mismatch");
          const target = path.join(inputDir, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { mode: 0o444 }); await readonly(target);
          return path.posix.join("inputs", name.replaceAll("\\", "/"));
        };
        const selectedProducts = new Set(batch.visualSession.scenes.flatMap(({ referenceBindings }) => referenceBindings.productImageAssetIds));
        for (const [offset, image] of (imagePackage.product?.images ?? []).filter(({ assetId }) => selectedProducts.has(assetId)).entries()) {
          staged.productImages.push({ id: image.assetId, path: await stage(image.storagePath, image.checksum, `product-${offset + 1}${extension(image.mimeType)}`) });
        }
        const selectedAvatars = new Set(batch.visualSession.scenes.flatMap(({ referenceBindings }) => referenceBindings.avatarImageAssetIds));
        const selectedStyles = imagePackage.brandStyleImages.filter((image) => !image.tags.includes("avatar") || selectedAvatars.has(image.referenceItemId));
        for (const [offset, image] of selectedStyles.entries()) staged.styleImages.push({ id: image.referenceItemId, path: await stage(image.storagePath, image.checksum, `style-${offset + 1}${extension(image.mimeType)}`), avatar: image.tags.includes("avatar") });
        for (const [offset, reference] of imagePackage.references.entries()) staged.references.push({ id: reference.referenceItemId, path: reference.image ? await stage(reference.image.storagePath, reference.image.checksum, `reference-${offset + 1}${extension(reference.image.mimeType)}`) : null, roles: reference.roles, title: reference.title, text: reference.text });
        for (const [offset, attachment] of imagePackage.attachments.entries()) staged.attachments.push({ id: attachment.id, path: await stage(attachment.storagePath, attachment.checksum, `attachments/attachment-${offset + 1}${extension(attachment.mimeType)}`, { maxBytes: AI_CONTENT_OWNED_IMAGE_MAX_BYTES, expectedSizeBytes: attachment.sizeBytes, expectedContentType: attachment.mimeType }), role: attachment.role });
        if (staged.productImages.length !== selectedProducts.size || staged.styleImages.filter(({ avatar }) => avatar).length !== selectedAvatars.size) throw new Error("ai_content_asset_binding_invalid");
        const stageReferencesMs = Date.now() - stageReferencesStartedAt;

        const prompt = compileAiContentVisualSessionPrompt({ session: batch.visualSession, userImageInstruction: imagePackage.userImageInstruction, staged });
        await writeFile(path.join(inputDir, "compiled-render-prompt.txt"), prompt, { encoding: "utf8", mode: 0o444 });
        const outputFiles = batch.jobs.map(({ assetIndex }) => path.join(outputDir, `scene-${String(assetIndex).padStart(2, "0")}.png`));
        const runner = input.runChild ?? (input.accountPool ? defaultRunner({ accountPool: input.accountPool, workerRoot: input.workerRoot, timeoutMs: input.timeoutMs ?? 20 * 60_000 }) : null);
        if (!runner) throw new Error("codex_account_pool_required");
        const toolObservation = await runner({ workspaceDir, outputFiles, prompt, signal });
        if (toolObservation && toolObservation.actualToolArguments.length !== outputFiles.length) throw new Error("ai_content_visual_session_tool_observation_invalid");
        const promptSha256 = hash(Buffer.from(prompt));
        const rendered = [];
        for (const [offset, outputFile] of outputFiles.entries()) {
          const normalized = await normalize(await readFile(outputFile), batch.outputFormat);
          rendered.push({ index: offset + 1, mimeType: "image/png" as const, ...normalized, checksum: hash(normalized.bytes), renderDiagnostic: {
            contractVersion: "ai-content-editorial-render-diagnostic.v1" as const,
            sourceContractVersion: batch.visualSession.source.contractVersion,
            sourceSha256: batch.visualSession.source.sha256,
            sceneIndex: offset + 1,
            compiledPromptVersion: "image-visual-session.v1" as const,
            compiledPromptSha256: promptSha256,
             actualToolArgumentsObservation: toolObservation ? "observed" as const : "not_emitted_by_runner" as const,
             actualToolArgumentsSha256: toolObservation ? hash(Buffer.from(JSON.stringify(toolObservation.actualToolArguments[offset]))) : null,
          } });
        }
        return Object.assign(rendered, { timing: {
          stageReferencesMs,
          codexStartupMs: toolObservation?.codexStartupMs ?? 0,
          sceneGenerationMs: toolObservation?.sceneGenerationMs ?? outputFiles.map(() => 0),
        } }) as AiContentVisualSessionRenderedAssets;
      } catch (error) {
        const wrapped = new Error(error instanceof Error ? error.message : "ai_content_visual_session_failed") as Error & { code?: string; retryable?: boolean };
        wrapped.code = "ai_content_visual_session_failed";
        wrapped.retryable = false;
        const diagnosticCode = safeVisualSessionDiagnosticCode(error);
        if (diagnosticCode) {
          Object.defineProperty(wrapped, "diagnostic", {
            configurable: false,
            enumerable: false,
            value: diagnosticCode,
            writable: false,
          });
        }
        throw wrapped;
      } finally { await rm(workDir, { recursive: true, force: true }); }
    },
  };
}
