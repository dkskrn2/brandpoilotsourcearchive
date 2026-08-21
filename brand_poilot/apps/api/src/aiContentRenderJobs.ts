import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import { load } from "cheerio";
import type {
  AiContentManifestV3,
  ContentAspectRatio,
  ContentGenerationInputV3,
  ContentStudioOutputFormat,
  ImageGenerationPackageV1,
} from "@brand-pilot/content-contracts";
import {
  compileCardManuscriptPlanDraftV1,
  parseCardManuscriptPlanV1,
} from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import {
  parseAiContentVisualSessionV1,
  projectCardVisualRenderSession,
  projectReelVisualRenderSession,
  type AiContentVisualSessionV1,
} from "@brand-pilot/content-contracts/visual-render-session";
import {
  compileReelStoryboardSceneV1,
  compileReelStoryboardSceneV2,
  parseReelStoryboardV1,
  parseReelStoryboardV2,
  type ReelStoryboardSceneV1,
  type ReelStoryboardSceneV2,
} from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardSha256, reelStoryboardV2Sha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import type { AiContentGenerationRecord } from "./aiContentRepository.js";
import {
  parseCardManuscriptContractV1,
  parseReelStoryboardContract,
  parseReelStoryboardContractV1,
  parseReelStoryboardContractV2,
  type CardManuscriptContractV1,
  type ReelStoryboardContract,
} from "./aiContentContracts.js";
import {
  BLOG_PASSIVE_HTML_FORBIDDEN_ATTRIBUTES,
  BLOG_PASSIVE_HTML_FORBIDDEN_TAGS,
  parseContentPlanResultV2,
  type ContentPlanResultV2,
} from "./aiContentPlanContracts.js";
import { parseActiveAiContentManifestV3 } from "./aiContentManifest.js";
import { parseContentGenerationInputV3, parseResearchEvidenceSnapshotV1 } from "./aiContentGenerationInputV3.js";
import {
  completeGenerationOperationIfTerminal,
  reverseGenerationReservationIfTerminalFailure,
} from "./aiContentGenerationOperations.js";
import {
  compileStructuredScene,
  parseStructuredSceneCopyV1,
} from "@brand-pilot/content-contracts/structured-scene-copy";

type Queryable = Pick<PoolClient, "query">;

function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

function deterministicAuditEventId(seed: string): string {
  const bytes = Buffer.from(createHash("sha256").update(seed).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}


export interface AiContentRenderedAsset {
  index: number;
  url: string;
  storagePath: string;
  mimeType: "image/png";
  width: number;
  height: number;
  checksum: string;
}

export interface AiContentRenderJob {
  id: string;
  generationId: string;
  outputId: string;
  brandId: string;
  workspaceId: string;
  jobKind: "image_asset" | "package_finalize";
  assetIndex: number | null;
  leaseToken: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

export interface AiContentVisualSessionLease {
  kind: "visual_session";
  outputId: string;
  outputFormat: "card_news" | "reel";
  visualSession: AiContentVisualSessionV1;
  jobs: AiContentRenderJob[];
}

export type AiContentRenderClaim = AiContentRenderJob | AiContentVisualSessionLease;

export interface RenderLeaseInput {
  jobId: string;
  workerId: string;
  leaseToken: string;
  leaseSeconds: number;
}

export interface RenderAssetCompletion {
  jobId: string;
  workerId: string;
  leaseToken: string;
  jobKind: "image_asset";
  asset: AiContentRenderedAsset;
}

export interface RenderPackageCompletion {
  jobId: string;
  workerId: string;
  leaseToken: string;
  jobKind: "package_finalize";
  manifest: AiContentManifestV3;
  manifestUrl: string;
}

export interface RenderFailure {
  jobId: string;
  workerId: string;
  leaseToken: string;
  errorCode: string;
  errorMessage: string;
  diagnosticCode?: string;
  retryable: boolean;
}

export interface EditorialRenderDiagnosticAppend {
  jobId: string;
  workerId: string;
  leaseToken: string;
  diagnostic: {
    contractVersion: "ai-content-editorial-render-diagnostic.v1";
    sourceContractVersion: "card-manuscript-plan.v1" | "reel-storyboard.v1" | "reel-storyboard.v2";
    sourceSha256: string;
    sceneIndex: number;
    compiledPromptVersion: "image-visual-session.v1";
    compiledPromptSha256: string;
    actualToolArgumentsObservation: "observed" | "not_emitted_by_runner";
    actualToolArgumentsSha256: string | null;
  };
}

export interface VisualSessionLeaseInput {
  outputId: string;
  workerId: string;
  leaseSeconds: number;
  jobs: Array<{ jobId: string; assetIndex: number; leaseToken: string }>;
}

export interface VisualSessionCompletion {
  outputId: string;
  workerId: string;
  jobs: Array<{ jobId: string; assetIndex: number; leaseToken: string }>;
  assets: AiContentRenderedAsset[];
  diagnostics: EditorialRenderDiagnosticAppend["diagnostic"][];
  bodySha256: string;
}

export interface VisualSessionFailure {
  outputId: string;
  workerId: string;
  jobs: Array<{ jobId: string; assetIndex: number; leaseToken: string }>;
  errorCode: string;
  errorMessage: string;
}

export interface AiContentRenderJobsRepository {
  claim(input: { workerId: string; leaseSeconds: number }): Promise<AiContentRenderJob | null>;
  claim(input: { workerId: string; leaseSeconds: number; capabilities: string[] }): Promise<AiContentRenderClaim | null>;
  heartbeat(input: RenderLeaseInput): Promise<boolean>;
  heartbeatVisualSession(input: VisualSessionLeaseInput): Promise<boolean>;
  completeVisualSession(input: VisualSessionCompletion): Promise<void>;
  failVisualSession(input: VisualSessionFailure): Promise<void>;
  completeAsset(input: RenderAssetCompletion): Promise<void>;
  completePackage(input: RenderPackageCompletion): Promise<AiContentGenerationRecord>;
  fail(input: RenderFailure): Promise<void>;
  appendEditorialDiagnostic(input: EditorialRenderDiagnosticAppend): Promise<void>;
  saveOutputResearch(input: {
    jobId: string;
    outputId: string;
    workerId: string;
    leaseToken: string;
    evidence: Record<string, unknown>;
  }): Promise<void>;
}

export function expectedAiContentAssetStoragePath(input: {
  brandId: string;
  generationId: string;
  outputId: string;
  assetIndex: number;
}): string {
  return `ai-content/${input.brandId}/${input.generationId}/${input.outputId}/assets/${String(input.assetIndex).padStart(2, "0")}.png`;
}

export function expectedAiContentManifestStoragePath(input: {
  brandId: string;
  generationId: string;
  outputId: string;
}): string {
  return `ai-content/${input.brandId}/${input.generationId}/${input.outputId}/manifest.json`;
}

export function expectedAiContentAssetDimensions(ratio: ContentAspectRatio): { width: number; height: number } {
  switch (ratio) {
    case "4:5": return { width: 1080, height: 1350 };
    case "16:9": return { width: 1920, height: 1080 };
    case "9:16": return { width: 1080, height: 1920 };
    default: return { width: 1080, height: 1080 };
  }
}

function exactVercelBlobPath(value: unknown, expectedPath: string): boolean {
  const rawUrl = String(value);
  let url: URL;
  try { url = new URL(rawUrl); } catch { return false; }
  if (url.protocol !== "https:" || url.port !== "" || !url.hostname.endsWith(".public.blob.vercel-storage.com")) return false;
  return rawUrl === `${url.origin}/${expectedPath}`;
}

function validateRenderManifestArtifactUrls(
  manifest: AiContentManifestV3,
  context: { brandId: string; generationId: string; outputId: string },
): void {
  const prefix = `ai-content/${context.brandId}/${context.generationId}/${context.outputId}`;
  for (const asset of manifest.assets) {
    const expectedPath = asset.mimeType === "text/html"
      ? `${prefix}/content.html`
      : asset.mimeType === "video/mp4"
        ? `${prefix}/reel.mp4`
        : null;
    if (expectedPath !== null && !exactVercelBlobPath(asset.url, expectedPath)) {
      throw new Error("ai_content_render_manifest_invalid");
    }
  }
}

export function parseRenderManifestUrl(
  value: unknown,
  context: { brandId: string; generationId: string; outputId: string },
): URL {
  if (!exactVercelBlobPath(value, expectedAiContentManifestStoragePath(context))) {
    throw new Error("ai_content_render_manifest_invalid");
  }
  return new URL(String(value));
}

export function parseRenderAssetResult(
  value: unknown,
  context: {
    brandId: string;
    generationId: string;
    outputId: string;
    assetIndex: number;
    outputFormat: ContentStudioOutputFormat;
    aspectRatio: ContentAspectRatio;
  },
): AiContentRenderedAsset {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const source = value as Record<string, unknown>;
    const allowed = ["index", "url", "storagePath", "mimeType", "width", "height", "checksum"];
    if (Object.keys(source).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in source))) throw new Error();
    const width = Number(source.width);
    const height = Number(source.height);
    const validDimensions = Number.isSafeInteger(width) && width > 0
      && Number.isSafeInteger(height) && height > 0
      && (context.outputFormat === "blog"
        || (context.outputFormat === "card_news" && width === height)
        || (context.outputFormat === "reel" && BigInt(width) * 16n === BigInt(height) * 9n));
    const expectedStoragePath = expectedAiContentAssetStoragePath(context);
    if (
      source.index !== context.assetIndex
      || source.storagePath !== expectedStoragePath
      || !exactVercelBlobPath(source.url, expectedStoragePath)
      || source.mimeType !== "image/png"
      || !validDimensions
      || typeof source.checksum !== "string"
      || !/^[0-9a-f]{64}$/.test(source.checksum)
    ) throw new Error();
    return source as unknown as AiContentRenderedAsset;
  } catch {
    throw new Error("ai_content_render_asset_invalid");
  }
}

export async function enqueueAiContentRenderJobs(client: Queryable, input: {
  workspaceId: string;
  brandId: string;
  generationId: string;
  outputId: string;
  plan: ContentPlanResultV2;
  finalInput: ContentGenerationInputV3;
  cardManuscriptContract?: CardManuscriptContractV1 | null;
  reelStoryboardContract?: ReelStoryboardContract | null;
}): Promise<void> {
  const imagePackage = input.plan.imagePackage;
  if (imagePackage) {
    const cardManuscript = imagePackage.outputFormat === "card_news" && input.cardManuscriptContract
      ? parseCardManuscriptContractV1(input.cardManuscriptContract)
      : null;
    if (input.cardManuscriptContract && imagePackage.outputFormat !== "card_news") {
      throw new Error("ai_content_card_manuscript_contract_invalid");
    }
    const reelStoryboard = imagePackage.outputFormat === "reel" && input.reelStoryboardContract
      ? parseReelStoryboardContract(input.reelStoryboardContract)
      : null;
    if (input.reelStoryboardContract && imagePackage.outputFormat !== "reel") {
      throw new Error("ai_content_reel_storyboard_contract_invalid");
    }
    if (imagePackage.outputFormat === "card_news" && !cardManuscript) {
      throw new Error("ai_content_card_manuscript_contract_invalid");
    }
    if (cardManuscript) {
      const plan = parseCardManuscriptPlanV1(cardManuscript.plan, input.finalInput);
      const compiled = compileCardManuscriptPlanDraftV1(plan, input.finalInput.selectedProposal.outline);
      if (cardManuscriptPlanSha256(plan) !== cardManuscript.manuscriptSha256
        || canonicalJson(compiled.assets) !== canonicalJson(imagePackage.assets.map(({ attachmentIds: _attachments, ...asset }) => asset))) {
        throw new Error("ai_content_card_manuscript_projection_mismatch");
      }
    }
    if (imagePackage.outputFormat === "reel" && !reelStoryboard) {
      throw new Error("ai_content_reel_storyboard_contract_invalid");
    }
    if (reelStoryboard) {
      const parsedStoryboard = reelStoryboard.contractVersion === "reel-storyboard.v2"
        ? parseReelStoryboardV2(reelStoryboard.storyboard, input.finalInput)
        : parseReelStoryboardV1(reelStoryboard.storyboard);
      const sourceHash = reelStoryboard.contractVersion === "reel-storyboard.v2"
        ? reelStoryboardV2Sha256(parsedStoryboard as never)
        : reelStoryboardSha256(parsedStoryboard as never);
      if (sourceHash !== reelStoryboard.storyboardSha256
        || reelStoryboard.storyboard.scenes.length !== imagePackage.assets.length) {
        throw new Error("ai_content_reel_storyboard_compilation_mismatch");
      }
      for (const [offset, scene] of parsedStoryboard.scenes.entries()) {
        const asset = imagePackage.assets[offset];
        const outline = input.finalInput.selectedProposal.outline[offset];
        if (!asset || !outline) throw new Error("ai_content_reel_storyboard_compilation_mismatch");
        const compiled = parsedStoryboard.contractVersion === "reel-storyboard.v2"
          ? compileReelStoryboardSceneV2(scene as ReelStoryboardSceneV2, outline.role)
          : compileReelStoryboardSceneV1(parsedStoryboard, scene as ReelStoryboardSceneV1, outline.role);
        const { attachmentIds: _attachmentIds, ...assetWithoutAttachments } = asset;
        if (canonicalJson(compileStructuredScene(compiled)) !== canonicalJson(assetWithoutAttachments)) {
          throw new Error("ai_content_reel_storyboard_compilation_mismatch");
        }
      }
    }
    for (const asset of imagePackage.assets) {
      const payload = {
        contractVersion: cardManuscript || reelStoryboard
          ? "ai-content-visual-session-render-job.v1"
          : "ai-content-render-job.v2",
        jobKind: "image_asset",
        generationId: input.generationId,
        outputId: input.outputId,
        imagePackage,
        assetIndex: asset.index,
        assetKey: `${input.generationId}:${asset.index}`,
        storagePath: expectedAiContentAssetStoragePath({ ...input, assetIndex: asset.index }),
        ...(cardManuscript
          ? {
              rendererPromptVersion: "image-visual-session.v1",
              visualSessionBinding: {
                sourceContractVersion: "card-manuscript-plan.v1",
                sourceSha256: cardManuscript.manuscriptSha256,
                sceneIndex: asset.index,
              },
            }
          : reelStoryboard
          ? {
              rendererPromptVersion: "image-visual-session.v1",
              visualSessionBinding: {
                sourceContractVersion: reelStoryboard.contractVersion,
                sourceSha256: reelStoryboard.storyboardSha256,
                sceneIndex: asset.index,
              },
            }
          : { rendererPromptVersion: "image-final-pixels.v2" }),
      };
      await client.query(
        `insert into ai_content_generation_render_jobs
           (generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,status,payload_json)
         values($1,$2,$3,$4,'image_asset',$5,'queued',$6::jsonb)
         on conflict (output_id,asset_index) where job_kind='image_asset' do nothing`,
        [input.generationId, input.outputId, input.workspaceId, input.brandId, asset.index, JSON.stringify(payload)],
      );
    }
  } else {
    await insertFinalizer(client, input);
  }
}

async function insertFinalizer(client: Queryable, input: {
  workspaceId: string; brandId: string; generationId: string; outputId: string;
}): Promise<void> {
  await client.query(
    `insert into ai_content_generation_render_jobs
       (generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,status,payload_json)
     values($1,$2,$3,$4,'package_finalize',null,'queued',$5::jsonb)
     on conflict (output_id) where job_kind='package_finalize' do nothing`,
    [input.generationId, input.outputId, input.workspaceId, input.brandId, JSON.stringify({
      contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize",
      generationId: input.generationId, outputId: input.outputId,
    })],
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requireExactObjectKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !(key in value))) {
    throw new Error("ai_content_render_snapshot_mismatch");
  }
}

async function manualImageAssetPayloadV2(
  client: Queryable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const storedPayload = record(row.payload_json);
  requireExactObjectKeys(storedPayload, [
    "contractVersion", "jobKind", "generationId", "outputId", "imagePackage",
    "assetIndex", "assetKey", "storagePath", "rendererPromptVersion",
  ]);
  const assetIndex = Number(row.asset_index);
  if (
    row.job_kind !== "image_asset"
    || !Number.isSafeInteger(assetIndex)
    || storedPayload.contractVersion !== "ai-content-render-job.v2"
    || storedPayload.jobKind !== "image_asset"
    || storedPayload.generationId !== String(row.generation_id)
    || storedPayload.outputId !== String(row.output_id)
    || storedPayload.assetIndex !== assetIndex
    || storedPayload.assetKey !== `${String(row.generation_id)}:${assetIndex}`
    || storedPayload.storagePath !== expectedAiContentAssetStoragePath({
      brandId: String(row.brand_id),
      generationId: String(row.generation_id),
      outputId: String(row.output_id),
      assetIndex,
    })
    || storedPayload.rendererPromptVersion !== "image-final-pixels.v2"
  ) throw new Error("ai_content_render_snapshot_mismatch");

  const state = await client.query(
    `select output.plan_json,input.input_json,research.evidence_json,
            binding.selected_proposal_id,batch.origin
       from ai_content_generation_outputs output
       join ai_content_generations generation
         on generation.id=output.generation_id
        and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
       join ai_content_generation_input_snapshots input
         on input.generation_id=output.generation_id
        and input.workspace_id=output.workspace_id and input.brand_id=output.brand_id
       join ai_content_generation_prompt_bindings binding
         on binding.generation_id=output.generation_id
        and binding.workspace_id=output.workspace_id and binding.brand_id=output.brand_id
       join ai_content_proposals proposal
         on proposal.id=binding.selected_proposal_id
        and proposal.workspace_id=binding.workspace_id and proposal.brand_id=binding.brand_id
       join ai_content_proposal_batches batch
         on batch.id=proposal.batch_id
        and batch.workspace_id=proposal.workspace_id and batch.brand_id=proposal.brand_id
       left join ai_content_output_research_snapshots research
         on research.output_id=output.id and research.generation_id=output.generation_id
        and research.workspace_id=output.workspace_id and research.brand_id=output.brand_id
      where output.id=$1 and output.generation_id=$2
        and output.workspace_id=$3 and output.brand_id=$4
      for share of generation,output`,
    [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
  );
  if (state.rows.length !== 1 || state.rows[0]?.origin !== "manual") {
    throw new Error("ai_content_render_lineage_mismatch");
  }
  const contentGenerationInput = parseContentGenerationInputV3(state.rows[0].input_json);
  if (
    contentGenerationInput.generationId !== String(row.generation_id)
    || contentGenerationInput.selectedProposal.id !== String(state.rows[0].selected_proposal_id)
  ) throw new Error("ai_content_render_lineage_mismatch");
  const contentPlan = parseContentPlanResultV2(
    state.rows[0].plan_json,
    contentGenerationInput,
    state.rows[0].evidence_json,
  );
  if (
    contentPlan.imagePackage === null
    || !isDeepStrictEqual(contentPlan.imagePackage, storedPayload.imagePackage)
    || !contentPlan.imagePackage.assets.some((asset) => asset.index === assetIndex)
  ) throw new Error("ai_content_render_snapshot_mismatch");

  return {
    ...storedPayload,
    contentGenerationInput,
    contentPlan,
  };
}

async function visualSessionImageAssetPayloadV1(
  client: Queryable,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const storedPayload = record(row.payload_json);
  requireExactObjectKeys(storedPayload, [
    "contractVersion", "jobKind", "generationId", "outputId", "imagePackage",
    "assetIndex", "assetKey", "storagePath", "rendererPromptVersion", "visualSessionBinding",
  ]);
  const binding = record(storedPayload.visualSessionBinding);
  requireExactObjectKeys(binding, ["sourceContractVersion", "sourceSha256", "sceneIndex"]);
  const assetIndex = Number(row.asset_index);
  if (
    row.job_kind !== "image_asset"
    || !Number.isSafeInteger(assetIndex)
    || storedPayload.contractVersion !== "ai-content-visual-session-render-job.v1"
    || storedPayload.jobKind !== "image_asset"
    || storedPayload.generationId !== String(row.generation_id)
    || storedPayload.outputId !== String(row.output_id)
    || storedPayload.assetIndex !== assetIndex
    || storedPayload.assetKey !== `${String(row.generation_id)}:${assetIndex}`
    || storedPayload.storagePath !== expectedAiContentAssetStoragePath({
      brandId: String(row.brand_id), generationId: String(row.generation_id),
      outputId: String(row.output_id), assetIndex,
    })
    || storedPayload.rendererPromptVersion !== "image-visual-session.v1"
    || !["card-manuscript-plan.v1", "reel-storyboard.v1", "reel-storyboard.v2"].includes(String(binding.sourceContractVersion))
    || binding.sceneIndex !== assetIndex
    || typeof binding.sourceSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(binding.sourceSha256)
  ) throw new Error("ai_content_render_snapshot_mismatch");

  const state = await client.query(
    `select output.plan_json,input.input_json,research.evidence_json,
            binding.selected_proposal_id,batch.origin,
            generation_job.payload_json as generation_job_payload
       from ai_content_generation_outputs output
       join ai_content_generations generation
         on generation.id=output.generation_id
        and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
       join ai_content_generation_input_snapshots input
         on input.generation_id=output.generation_id
        and input.workspace_id=output.workspace_id and input.brand_id=output.brand_id
       join ai_content_generation_prompt_bindings binding
         on binding.generation_id=output.generation_id
        and binding.workspace_id=output.workspace_id and binding.brand_id=output.brand_id
       join ai_content_proposals proposal
         on proposal.id=binding.selected_proposal_id
        and proposal.workspace_id=binding.workspace_id and proposal.brand_id=binding.brand_id
       join ai_content_proposal_batches batch
         on batch.id=proposal.batch_id
        and batch.workspace_id=proposal.workspace_id and batch.brand_id=proposal.brand_id
       join ai_content_generation_jobs generation_job
         on generation_job.generation_id=output.generation_id and generation_job.output_id=output.id
        and generation_job.workspace_id=output.workspace_id and generation_job.brand_id=output.brand_id
        and generation_job.job_type='generate' and generation_job.status='succeeded'
       left join ai_content_output_research_snapshots research
         on research.output_id=output.id and research.generation_id=output.generation_id
        and research.workspace_id=output.workspace_id and research.brand_id=output.brand_id
      where output.id=$1 and output.generation_id=$2
        and output.workspace_id=$3 and output.brand_id=$4
      for share of generation,output`,
    [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
  );
  if (state.rows.length !== 1 || state.rows[0]?.origin !== "manual") {
    throw new Error("ai_content_render_lineage_mismatch");
  }
  const contentGenerationInput = parseContentGenerationInputV3(state.rows[0].input_json);
  if (contentGenerationInput.generationId !== String(row.generation_id)
    || contentGenerationInput.selectedProposal.id !== String(state.rows[0].selected_proposal_id)) {
    throw new Error("ai_content_render_lineage_mismatch");
  }
  const contentPlan = parseContentPlanResultV2(
    state.rows[0].plan_json,
    contentGenerationInput,
    state.rows[0].evidence_json,
  );
  if (contentPlan.imagePackage === null
    || !isDeepStrictEqual(contentPlan.imagePackage, storedPayload.imagePackage)) {
    throw new Error("ai_content_render_snapshot_mismatch");
  }
  const generationPayload = record(state.rows[0].generation_job_payload);
  let visualSession: AiContentVisualSessionV1;
  if (binding.sourceContractVersion === "reel-storyboard.v1" || binding.sourceContractVersion === "reel-storyboard.v2") {
    const contract = binding.sourceContractVersion === "reel-storyboard.v2"
      ? parseReelStoryboardContractV2(generationPayload.reelStoryboardContract)
      : parseReelStoryboardContractV1(generationPayload.reelStoryboardContract);
    const storyboard = contract.contractVersion === "reel-storyboard.v2"
      ? parseReelStoryboardV2(contract.storyboard, contentGenerationInput)
      : parseReelStoryboardV1(contract.storyboard);
    const sourceHash = contract.contractVersion === "reel-storyboard.v2"
      ? reelStoryboardV2Sha256(storyboard as never)
      : reelStoryboardSha256(storyboard as never);
    if (contentPlan.imagePackage.outputFormat !== "reel"
      || sourceHash !== contract.storyboardSha256
      || contract.storyboardSha256 !== binding.sourceSha256) throw new Error("ai_content_render_snapshot_mismatch");
    visualSession = projectReelVisualRenderSession({ sourceSha256: contract.storyboardSha256, references: contentGenerationInput.references, storyboard });
  } else {
    const contract = parseCardManuscriptContractV1(generationPayload.cardManuscriptContract);
    const manuscript = parseCardManuscriptPlanV1(contract.plan, contentGenerationInput);
    if (contentPlan.imagePackage.outputFormat !== "card_news"
      || cardManuscriptPlanSha256(manuscript) !== contract.manuscriptSha256
      || contract.manuscriptSha256 !== binding.sourceSha256) throw new Error("ai_content_render_snapshot_mismatch");
    visualSession = projectCardVisualRenderSession({ sourceSha256: contract.manuscriptSha256, references: contentGenerationInput.references, plan: manuscript });
  }
  if (visualSession.scenes.length !== contentPlan.imagePackage.assets.length
    || !visualSession.scenes.some(({ index }) => index === assetIndex)) throw new Error("ai_content_render_snapshot_mismatch");

  return {
    ...storedPayload,
    contentGenerationInput,
    contentPlan,
    visualSession: parseAiContentVisualSessionV1(visualSession),
  };
}

function renderJob(row: Record<string, unknown>, payload: Record<string, unknown>): AiContentRenderJob {
  return {
    id: String(row.id), generationId: String(row.generation_id), outputId: String(row.output_id),
    workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
    jobKind: row.job_kind as AiContentRenderJob["jobKind"], assetIndex: row.asset_index === null ? null : Number(row.asset_index),
    leaseToken: String(row.lease_token), attemptCount: Number(row.attempt_count), payload,
  };
}

async function finalizerPayload(client: Queryable, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const state = await client.query(
    `select output.plan_json,input.input_json,research.evidence_json
       from ai_content_generation_outputs output
       join ai_content_generation_input_snapshots input
         on input.generation_id=output.generation_id and input.workspace_id=output.workspace_id and input.brand_id=output.brand_id
       left join ai_content_output_research_snapshots research
         on research.output_id=output.id and research.generation_id=output.generation_id
      where output.id=$1 and output.generation_id=$2 and output.workspace_id=$3 and output.brand_id=$4`,
    [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
  );
  if (!state.rows.length || !state.rows[0]?.plan_json || !state.rows[0]?.input_json) {
    throw new Error("ai_content_render_snapshot_missing");
  }
  const assets = await client.query(
    `select asset_index,result_json from ai_content_generation_render_jobs
      where output_id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4
        and job_kind='image_asset' and status='succeeded'
      order by asset_index`,
    [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
  );
  return {
    contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize",
    generationId: String(row.generation_id), outputId: String(row.output_id),
    plan: state.rows[0].plan_json, finalInput: state.rows[0].input_json,
    supplementalResearch: state.rows[0].evidence_json ?? null,
    assets: assets.rows.map((asset) => asset.result_json),
  };
}

async function lockedRenderJob(client: Queryable, jobId: string): Promise<Record<string, unknown>> {
  const result = await client.query(
    `select *,lease_expires_at<=clock_timestamp() as lease_expired
       from ai_content_generation_render_jobs where id=$1 for update`,
    [jobId],
  );
  if (!result.rows.length) throw new Error("ai_content_render_job_not_found");
  return result.rows[0] as Record<string, unknown>;
}

async function renderJobScope(client: Queryable, jobId: string): Promise<Record<string, unknown>> {
  const scope = await client.query(
    `select output_id,generation_id,workspace_id,brand_id
       from ai_content_generation_render_jobs where id=$1`,
    [jobId],
  );
  if (!scope.rows.length) throw new Error("ai_content_render_job_not_found");
  return scope.rows[0] as Record<string, unknown>;
}

function hasSameRenderScope(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return ["output_id", "generation_id", "workspace_id", "brand_id"]
    .every((key) => String(left[key]) === String(right[key]));
}

async function lockRenderGeneration(client: Queryable, scope: Record<string, unknown>): Promise<void> {
  const generation = await client.query(
    `select id from ai_content_generations
      where id=$1 and workspace_id=$2 and brand_id=$3 for update`,
    [scope.generation_id, scope.workspace_id, scope.brand_id],
  );
  if (!generation.rows.length) throw new Error("ai_content_render_snapshot_missing");
}

async function lockRenderOutput(client: Queryable, row: Record<string, unknown>): Promise<void> {
  const output = await client.query(
    `select id from ai_content_generation_outputs
      where id=$1 and generation_id=$2 and workspace_id=$3 and brand_id=$4 for update`,
    [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
  );
  if (!output.rows.length) throw new Error("ai_content_render_snapshot_missing");
}

async function lockTerminalRenderGraph(client: Queryable, jobId: string): Promise<Record<string, unknown>> {
  const scope = await renderJobScope(client, jobId);
  await lockRenderGeneration(client, scope);
  const row = await lockedRenderJob(client, jobId);
  if (!hasSameRenderScope(scope, row)) throw new Error("ai_content_render_snapshot_missing");
  await lockRenderOutput(client, row);
  return row;
}

async function failRenderOutputAndGeneration(
  client: Queryable,
  row: Record<string, unknown>,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await client.query(
    `update ai_content_generation_outputs set status='failed',failure_code=$2,failure_message=$3,updated_at=now() where id=$1`,
    [row.output_id, errorCode, errorMessage],
  );
  const counts = await client.query(
    `select count(*)::integer total,count(*) filter(where status='completed')::integer completed,
            count(*) filter(where status='failed')::integer failed
       from ai_content_generation_outputs where generation_id=$1`,
    [row.generation_id],
  );
  const total = Number(counts.rows[0]?.total ?? 0);
  const completed = Number(counts.rows[0]?.completed ?? 0);
  const failed = Number(counts.rows[0]?.failed ?? 0);
  const generationStatus = total > 0 && failed === total
    ? "failed"
    : total > 0 && completed + failed === total
      ? "partial_failed"
      : "generating";
  await client.query(
    `update ai_content_generations set status=$2,current_stage=case when $2='generating' then 'generation' else 'completed' end,
       terminal_at=case when $2<>'generating' then coalesce(terminal_at,now()) else terminal_at end,
       retryable_until=case when $2<>'generating' then coalesce(retryable_until,now()+interval '15 days') else retryable_until end,
       error_code=$3,error_message=$4,updated_at=now() where id=$1`,
    [row.generation_id, generationStatus, errorCode, errorMessage],
  );
  await reverseGenerationReservationIfTerminalFailure(client, String(row.generation_id));
}

async function appendRenderFailureAudit(
  client: Queryable,
  row: Record<string, unknown>,
  input: RenderFailure,
  willRetry: boolean,
): Promise<void> {
  const metadata = {
    contractVersion: "ai-content-render-attempt-failed.v1",
    generationId: String(row.generation_id),
    outputId: String(row.output_id),
    jobKind: String(row.job_kind),
    assetIndex: row.asset_index === null ? null : Number(row.asset_index),
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    diagnosticCode: input.diagnosticCode ?? null,
    requestedRetryable: input.retryable,
    willRetry,
  };
  try {
    await client.query(
      `insert into audit_events(
         workspace_id,brand_id,actor_type,actor_external_id,event_type,entity_type,entity_id,metadata
       ) values($1,$2,'worker',$3,'ai_content_render_attempt_failed','ai_content_generation_render_job',$4,$5::jsonb)`,
      [row.workspace_id, row.brand_id, input.workerId, input.jobId, JSON.stringify(metadata)],
    );
  } catch {
    // Error history is observational. It must never roll back an already committed render transition.
  }
}

function requireLease(row: Record<string, unknown>, input: { workerId: string; leaseToken: string }): void {
  if (
    row.status !== "processing" || row.worker_id !== input.workerId || String(row.lease_token) !== input.leaseToken
    || !row.lease_expires_at || row.lease_expired === true
  ) throw new Error("ai_content_render_job_lease_invalid");
}

function planImagePackage(value: unknown): ImageGenerationPackageV1 | null {
  const plan = record(value);
  return plan.imagePackage && typeof plan.imagePackage === "object" ? plan.imagePackage as ImageGenerationPackageV1 : null;
}

function normalizedVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function validateBlogFinalHtml(
  html: unknown,
  planValue: unknown,
  finalInputValue: unknown,
  supplementalResearchValue: unknown,
): void {
  if (typeof html !== "string" || /asset:\/\//.test(html)) throw new Error("ai_content_render_manifest_invalid");
  const $ = load(html);
  $("script,style,noscript").remove();
  const article = $("article");
  if (article.length !== 1 || article.find("h1").length !== 1) throw new Error("ai_content_render_manifest_invalid");
  const h1 = article.find("h1").first();
  const summary = h1.next();
  const summaryParagraphs = summary.children("p");
  if (!summary.length || summaryParagraphs.length !== 3 || summary.children().length !== 3) {
    throw new Error("ai_content_render_manifest_invalid");
  }
  const summaryLength = normalizedVisibleText(summaryParagraphs.toArray().map((element) => $(element).text()).join(" ")).length;
  const visibleLength = normalizedVisibleText(article.text()).length;
  if (summaryLength > 300 || visibleLength < 3_000 || visibleLength > 10_000) throw new Error("ai_content_render_manifest_invalid");
  for (const heading of article.find("h2,h3").toArray()) {
    if (!normalizedVisibleText($(heading).text()).endsWith("?") || !$(heading).next().is("p")) {
      throw new Error("ai_content_render_manifest_invalid");
    }
  }
  const forbiddenExperience = [/제가 직접 (?:써|사용해) ?보니/, /실제 고객의 경험을 재구성/, /가상의 경험담/, /합성된 경험/];
  if (forbiddenExperience.some((pattern) => pattern.test(article.text()))) throw new Error("ai_content_render_manifest_invalid");
  const plan = record(planValue);
  const content = record(plan.content);
  const usedEvidenceIds = new Set(Array.isArray(content.usedEvidenceIds) ? content.usedEvidenceIds.map(String) : []);
  const finalInput = record(finalInputValue);
  const baseEvidence = record(finalInput.researchEvidence);
  const supplementalEvidence = supplementalResearchValue === null || supplementalResearchValue === undefined
    ? null
    : parseResearchEvidenceSnapshotV1(supplementalResearchValue);
  const evidenceUrls = new Map<string, string>();
  for (const item of [
    ...(Array.isArray(baseEvidence.items) ? baseEvidence.items : []),
    ...(supplementalEvidence?.items ?? []),
  ]) {
    const evidence = record(item);
    const evidenceId = String(evidence.id);
    const frozenUrl = String(evidence.url);
    const existingUrl = evidenceUrls.get(evidenceId);
    if (existingUrl !== undefined && existingUrl !== frozenUrl) throw new Error("ai_content_render_manifest_invalid");
    evidenceUrls.set(evidenceId, frozenUrl);
  }
  const allLinks = article.find("a[data-evidence-id]").toArray();
  for (const link of allLinks) {
    const href = $(link).attr("href");
    const evidenceId = $(link).attr("data-evidence-id");
    let parsedHref: URL;
    try { parsedHref = new URL(String(href)); } catch { throw new Error("ai_content_render_manifest_invalid"); }
    if (
      !evidenceId
      || (parsedHref.protocol !== "http:" && parsedHref.protocol !== "https:")
      || href !== evidenceUrls.get(evidenceId)
    ) {
      throw new Error("ai_content_render_manifest_invalid");
    }
  }
  const referenceSection = article.find("#references,[data-references],.references").last();
  if (usedEvidenceIds.size) {
    if (!referenceSection.length) throw new Error("ai_content_render_manifest_invalid");
    const referenceIds = new Set(referenceSection.find("a[data-evidence-id]").toArray().map((link) => String($(link).attr("data-evidence-id"))));
    const bodyIds = new Set(allLinks.filter((link) => !referenceSection.find(link).length).map((link) => String($(link).attr("data-evidence-id"))));
    if (!isDeepStrictEqual([...referenceIds].sort(), [...usedEvidenceIds].sort()) || !isDeepStrictEqual([...bodyIds].sort(), [...usedEvidenceIds].sort())) {
      throw new Error("ai_content_render_manifest_invalid");
    }
  }
}

function validateManifestAgainstPlan(
  manifest: AiContentManifestV3,
  planValue: unknown,
  finalInputValue: unknown,
  supplementalResearchValue: unknown,
): void {
  const plan = record(planValue);
  const content = record(plan.content);
  const manifestContent = record(manifest.content);
  if (plan.contractVersion === "card-news-plan.v2" || plan.contractVersion === "reel-plan.v2") {
    for (const key of ["caption", "hashtags", "cta"] as const) {
      if (!isDeepStrictEqual(manifestContent[key], content[key])) throw new Error("ai_content_render_manifest_invalid");
    }
  } else if (plan.contractVersion === "blog-plan.v2") {
    if (
      manifest.title !== content.title
      || manifestContent.title !== content.title
      || manifestContent.metaTitle !== content.metaTitle
      || manifestContent.metaDescription !== content.metaDescription
    ) throw new Error("ai_content_render_manifest_invalid");
    validateBlogFinalHtml(manifestContent.html, plan, finalInputValue, supplementalResearchValue);
  } else {
    throw new Error("ai_content_render_manifest_invalid");
  }
}

function validateBlogImageBindings(manifest: AiContentManifestV3, expectedUrls: string[]): void {
  if (manifest.outputFormat !== "blog") return;
  if (new Set(expectedUrls).size !== expectedUrls.length) throw new Error("ai_content_render_manifest_invalid");
  const manifestUrls = manifest.assets
    .filter((asset) => asset.mimeType === "image/png")
    .map((asset) => asset.url);
  const content = record(manifest.content);
  if (typeof content.html !== "string") throw new Error("ai_content_render_manifest_invalid");
  const $ = load(content.html);
  if ($(BLOG_PASSIVE_HTML_FORBIDDEN_TAGS.join(",")).length) throw new Error("ai_content_render_manifest_invalid");
  for (const element of $("*").toArray()) {
    const tagName = String($(element).prop("tagName") ?? "").toLowerCase();
    const src = $(element).attr("src");
    const href = $(element).attr("href");
    const attributeNames = Object.keys((element as { attribs?: Record<string, string> }).attribs ?? {});
    if (
      (src !== undefined && tagName !== "img")
      || (href !== undefined && tagName !== "a")
      || attributeNames.some((attribute) => /^on/i.test(attribute))
      || [...BLOG_PASSIVE_HTML_FORBIDDEN_ATTRIBUTES].some((attribute) => $(element).attr(attribute) !== undefined)
      || [href, src].some((value) => typeof value === "string" && /^\s*javascript:/i.test(value))
    ) {
      throw new Error("ai_content_render_manifest_invalid");
    }
  }
  const htmlUrls = $("img").toArray().map((element) => $(element).attr("src"));
  if (
    htmlUrls.some((url) => typeof url !== "string")
    || !isDeepStrictEqual(manifestUrls, expectedUrls)
    || !isDeepStrictEqual(htmlUrls, expectedUrls)
  ) {
    throw new Error("ai_content_render_manifest_invalid");
  }
}

function orderedLeaseVector(value: VisualSessionLeaseInput["jobs"]): VisualSessionLeaseInput["jobs"] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) throw new Error("ai_content_visual_session_lease_invalid");
  const jobs = value.map((job) => ({
    jobId: String(job.jobId), assetIndex: Number(job.assetIndex), leaseToken: String(job.leaseToken),
  }));
  if (jobs.some((job, offset) => !job.jobId || !job.leaseToken || job.assetIndex !== offset + 1)
    || new Set(jobs.map(({ jobId }) => jobId)).size !== jobs.length
    || new Set(jobs.map(({ leaseToken }) => leaseToken)).size !== jobs.length) {
    throw new Error("ai_content_visual_session_lease_invalid");
  }
  return jobs;
}

export function aiContentVisualSessionCompletionSha256(input: Omit<VisualSessionCompletion, "bodySha256">): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

function assertDiagnosticForBinding(
  diagnostic: EditorialRenderDiagnosticAppend["diagnostic"],
  binding: Record<string, unknown>,
  assetIndex: number,
): void {
  if (diagnostic.contractVersion !== "ai-content-editorial-render-diagnostic.v1"
    || diagnostic.sourceContractVersion !== binding.sourceContractVersion
    || diagnostic.sourceSha256 !== binding.sourceSha256
    || diagnostic.sceneIndex !== assetIndex
    || diagnostic.compiledPromptVersion !== "image-visual-session.v1"
    || !/^[0-9a-f]{64}$/.test(diagnostic.compiledPromptSha256)
    || !["observed", "not_emitted_by_runner"].includes(diagnostic.actualToolArgumentsObservation)
    || (diagnostic.actualToolArgumentsObservation === "observed") !== (diagnostic.actualToolArgumentsSha256 !== null)
    || (diagnostic.actualToolArgumentsSha256 !== null && !/^[0-9a-f]{64}$/.test(diagnostic.actualToolArgumentsSha256))) {
    throw new Error("ai_content_editorial_render_diagnostic_invalid");
  }
}

async function lockVisualSessionRows(client: Queryable, outputId: string): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    `select *,lease_expires_at<=clock_timestamp() as lease_expired
       from ai_content_generation_render_jobs
      where output_id=$1 and job_kind='image_asset'
        and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'
      order by asset_index for update`,
    [outputId],
  );
  const rows = result.rows as Record<string, unknown>[];
  if (!rows.length || rows.some((row, offset) => Number(row.asset_index) !== offset + 1)) {
    throw new Error("ai_content_visual_session_lease_invalid");
  }
  const scope = rows[0]!;
  if (rows.some((row) => !hasSameRenderScope(scope, row))) throw new Error("ai_content_visual_session_lease_invalid");
  return rows;
}

function assertVisualLeaseRows(
  rows: Record<string, unknown>[],
  input: { workerId: string; jobs: VisualSessionLeaseInput["jobs"] },
  allowSucceeded = false,
): void {
  const jobs = orderedLeaseVector(input.jobs);
  if (rows.length !== jobs.length) throw new Error("ai_content_visual_session_lease_invalid");
  for (const [offset, row] of rows.entries()) {
    const job = jobs[offset]!;
    if (String(row.id) !== job.jobId || Number(row.asset_index) !== job.assetIndex
      || row.worker_id !== input.workerId || String(row.lease_token) !== job.leaseToken
      || (!allowSucceeded && (row.status !== "processing" || row.lease_expired === true))
      || (allowSucceeded && !["processing", "succeeded"].includes(String(row.status)))) {
      throw new Error("ai_content_visual_session_lease_invalid");
    }
  }
}

export function createAiContentRenderJobsRepository(
  pool: Pool,
  loadGeneration: (client: Queryable, generationId: string) => Promise<AiContentGenerationRecord>,
  afterPackageCompleted?: (input: {
    workspaceId: string;
    brandId: string;
    generationId: string;
    outputId: string;
  }) => Promise<void>,
): AiContentRenderJobsRepository {
  async function notifyPackageCompleted(row: Record<string, unknown>, outputFormat: string): Promise<void> {
    if (!afterPackageCompleted || (outputFormat !== "card_news" && outputFormat !== "reel")) return;
    await afterPackageCompleted({
      workspaceId: String(row.workspace_id),
      brandId: String(row.brand_id),
      generationId: String(row.generation_id),
      outputId: String(row.output_id),
    }).catch(() => undefined);
  }

  return {
    claim: (async (input: { workerId: string; leaseSeconds: number; capabilities?: string[] }) => {
      if (!input.workerId?.trim() || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 300) {
        throw new Error("ai_content_render_claim_invalid");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const expiredVisual = await client.query(
          `select distinct output_id
             from ai_content_generation_render_jobs
            where status='processing' and lease_expires_at<=clock_timestamp()
              and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'
            order by output_id`,
        );
        for (const candidate of expiredVisual.rows) {
          const outputId = String((candidate as Record<string, unknown>).output_id);
          const first = await client.query(
            `select id from ai_content_generation_render_jobs where output_id=$1 order by asset_index limit 1`, [outputId],
          );
          const scope = await renderJobScope(client, String(first.rows[0]?.id));
          await lockRenderGeneration(client, scope);
          await lockRenderOutput(client, scope);
          const rows = await lockVisualSessionRows(client, outputId);
          if (!rows.some((row) => row.status === "processing" && row.lease_expired === true)) continue;
          await client.query(
            `update ai_content_generation_render_jobs
                set status='failed',worker_id=null,lease_token=null,lease_expires_at=null,
                    error_code='ai_content_visual_session_lease_expired',
                    error_message='Visual session lease expired',completed_at=coalesce(completed_at,now()),updated_at=now()
              where output_id=$1 and job_kind='image_asset'
                and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'`,
            [outputId],
          );
          await failRenderOutputAndGeneration(client, rows[0]!, "ai_content_visual_session_lease_expired", "Visual session lease expired");
        }
        const exhausted = await client.query(
          `select id from ai_content_generation_render_jobs
            where status='processing' and lease_expires_at<=clock_timestamp() and attempt_count>=max_attempts
              and payload_json->>'contractVersion' is distinct from 'ai-content-visual-session-render-job.v1'
            order by generation_id,output_id,id`,
        );
        for (const expired of exhausted.rows) {
          const row = await lockTerminalRenderGraph(client, String(expired.id));
          if (
            row.status !== "processing"
            || row.lease_expired !== true
            || Number(row.attempt_count) < Number(row.max_attempts)
          ) continue;
          await client.query(
            `update ai_content_generation_render_jobs
                set status='failed',worker_id=null,lease_token=null,lease_expires_at=null,
                    error_code='ai_content_render_lease_expired',
                    error_message='Render worker lease expired after the final attempt',
                    completed_at=coalesce(completed_at,now()),updated_at=now()
              where id=$1`,
            [row.id],
          );
          await failRenderOutputAndGeneration(
            client,
            row,
            "ai_content_render_lease_expired",
            "Render worker lease expired after the final attempt",
          );
        }
        await client.query(
          `update ai_content_generation_render_jobs
              set status='queued',available_at=now(),worker_id=null,lease_token=null,lease_expires_at=null,
                  error_code='ai_content_render_lease_expired',updated_at=now()
            where status='processing' and lease_expires_at<=clock_timestamp() and attempt_count<max_attempts
              and payload_json->>'contractVersion' is distinct from 'ai-content-visual-session-render-job.v1'`,
        );
        if (input.capabilities?.includes("ai-content-visual-session.v1")) {
          const visualCandidate = await client.query(
            `select output_id
               from ai_content_generation_render_jobs
              where status='queued' and available_at<=clock_timestamp() and attempt_count<max_attempts
                and job_kind='image_asset'
                and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'
              group by output_id
              order by min(available_at),min(created_at),output_id limit 1`,
          );
          if (visualCandidate.rows.length) {
            const outputId = String((visualCandidate.rows[0] as Record<string, unknown>).output_id);
            const scope = await renderJobScope(client, String((await client.query(
              `select id from ai_content_generation_render_jobs where output_id=$1 order by asset_index limit 1`, [outputId],
            )).rows[0]?.id));
            await lockRenderGeneration(client, scope);
            await lockRenderOutput(client, scope);
            const rows = await lockVisualSessionRows(client, outputId);
            if (rows.every((row) => row.status === "queued" && Number(row.attempt_count) < Number(row.max_attempts))) {
              const claimed = await client.query(
                `update ai_content_generation_render_jobs
                    set status='processing',worker_id=$2,lease_token=gen_random_uuid(),
                        lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval,
                        attempt_count=attempt_count+1,error_code=null,error_message=null,updated_at=now()
                  where output_id=$1 and job_kind='image_asset'
                    and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'
                    and status='queued' returning *`,
                [outputId, input.workerId, input.leaseSeconds],
              );
              const claimedRows = (claimed.rows as Record<string, unknown>[]).sort((left, right) => Number(left.asset_index) - Number(right.asset_index));
              if (claimedRows.length !== rows.length) throw new Error("ai_content_visual_session_lease_invalid");
              const payload = await visualSessionImageAssetPayloadV1(client, claimedRows[0]!);
              const visualSession = parseAiContentVisualSessionV1(payload.visualSession);
              const jobs = claimedRows.map((row) => renderJob(row, { ...record(row.payload_json), contentGenerationInput: payload.contentGenerationInput, contentPlan: payload.contentPlan, visualSession }));
              await client.query("COMMIT");
              return { kind: "visual_session", outputId, outputFormat: visualSession.outputFormat, visualSession, jobs };
            }
          }
        }
        const candidate = await client.query(
          `select id from ai_content_generation_render_jobs
            where status='queued' and available_at<=clock_timestamp() and attempt_count<max_attempts
              and payload_json->>'contractVersion' is distinct from 'ai-content-visual-session-render-job.v1'
            order by available_at,created_at,id for update skip locked limit 1`,
        );
        if (!candidate.rows.length) {
          await client.query("COMMIT");
          return null;
        }
        const token = randomUUID();
        const claimed = await client.query(
          `update ai_content_generation_render_jobs
              set status='processing',worker_id=$2,lease_token=$3,
                  lease_expires_at=clock_timestamp()+($4::text||' seconds')::interval,
                  attempt_count=attempt_count+1,error_code=null,error_message=null,updated_at=now()
            where id=$1 and status='queued' returning *`,
          [candidate.rows[0].id, input.workerId, token, input.leaseSeconds],
        );
        if (!claimed.rows.length) {
          await client.query("COMMIT");
          return null;
        }
        const row = claimed.rows[0] as Record<string, unknown>;
        const storedPayload = record(row.payload_json);
        const payload = row.job_kind === "package_finalize"
          ? await finalizerPayload(client, row)
          : storedPayload.contractVersion === "ai-content-visual-session-render-job.v1"
            ? await visualSessionImageAssetPayloadV1(client, row)
            : storedPayload.contractVersion === "ai-content-render-job.v2"
              ? await manualImageAssetPayloadV2(client, row)
              : storedPayload;
        await client.query("COMMIT");
        return renderJob(row, payload);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    }) as AiContentRenderJobsRepository["claim"],

    async heartbeat(input) {
      const result = await pool.query(
        `update ai_content_generation_render_jobs
            set lease_expires_at=clock_timestamp()+($4::text||' seconds')::interval,updated_at=now()
          where id=$1 and status='processing' and worker_id=$2 and lease_token=$3
            and lease_expires_at>clock_timestamp() returning id`,
        [input.jobId, input.workerId, input.leaseToken, input.leaseSeconds],
      );
      return Boolean(result.rows.length);
    },

    async heartbeatVisualSession(input) {
      if (!Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 300) {
        throw new Error("ai_content_visual_session_lease_invalid");
      }
      const jobs = orderedLeaseVector(input.jobs);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const scope = await renderJobScope(client, jobs[0]!.jobId);
        if (String(scope.output_id) !== input.outputId) throw new Error("ai_content_visual_session_lease_invalid");
        await lockRenderGeneration(client, scope);
        await lockRenderOutput(client, scope);
        const rows = await lockVisualSessionRows(client, input.outputId);
        try { assertVisualLeaseRows(rows, { workerId: input.workerId, jobs }); } catch {
          await client.query("COMMIT");
          return false;
        }
        const updated = await client.query(
          `update ai_content_generation_render_jobs
              set lease_expires_at=clock_timestamp()+($3::text||' seconds')::interval,updated_at=now()
            where output_id=$1 and worker_id=$2 and status='processing'
              and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'
            returning id`,
          [input.outputId, input.workerId, input.leaseSeconds],
        );
        if (updated.rows.length !== rows.length) throw new Error("ai_content_visual_session_lease_invalid");
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async completeVisualSession(input) {
      const jobs = orderedLeaseVector(input.jobs);
      const unhashed = { outputId: input.outputId, workerId: input.workerId, jobs, assets: input.assets, diagnostics: input.diagnostics };
      if (!/^[0-9a-f]{64}$/.test(input.bodySha256) || aiContentVisualSessionCompletionSha256(unhashed) !== input.bodySha256
        || input.assets.length !== jobs.length || input.diagnostics.length !== jobs.length) {
        throw new Error("ai_content_visual_session_completion_invalid");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const scope = await renderJobScope(client, jobs[0]!.jobId);
        if (String(scope.output_id) !== input.outputId) throw new Error("ai_content_visual_session_lease_invalid");
        await lockRenderGeneration(client, scope);
        await lockRenderOutput(client, scope);
        const rows = await lockVisualSessionRows(client, input.outputId);
        assertVisualLeaseRows(rows, { workerId: input.workerId, jobs }, true);
        const allSucceeded = rows.every((row) => row.status === "succeeded");
        if (allSucceeded) {
          for (const [offset, row] of rows.entries()) {
            const stored = record(row.payload_json);
            if (stored.visualSessionCompletionSha256 !== input.bodySha256
              || !isDeepStrictEqual(row.result_json, input.assets[offset])) throw new Error("ai_content_render_completion_conflict");
          }
          await client.query("COMMIT");
          return;
        }
        if (rows.some((row) => row.status !== "processing")) throw new Error("ai_content_visual_session_lease_invalid");
        for (const [offset, row] of rows.entries()) {
          const imagePackage = record(row.payload_json).imagePackage as ImageGenerationPackageV1;
          const asset = parseRenderAssetResult(input.assets[offset], {
            brandId: String(row.brand_id), generationId: String(row.generation_id), outputId: String(row.output_id),
            assetIndex: Number(row.asset_index), outputFormat: imagePackage.outputFormat, aspectRatio: imagePackage.aspectRatio,
          });
          const binding = record(record(row.payload_json).visualSessionBinding);
          assertDiagnosticForBinding(input.diagnostics[offset]!, binding, Number(row.asset_index));
          await client.query(
            `update ai_content_generation_render_jobs
                set status='succeeded',result_json=$2::jsonb,
                    payload_json=jsonb_set(payload_json,'{visualSessionCompletionSha256}',to_jsonb($3::text),true),
                    lease_expires_at=null,error_code=null,error_message=null,
                    completed_at=coalesce(completed_at,now()),updated_at=now()
              where id=$1`,
            [row.id, JSON.stringify(asset), input.bodySha256],
          );
          const diagnostic = input.diagnostics[offset]!;
          const diagnosticJson = canonicalJson(diagnostic);
          const eventId = deterministicAuditEventId(["ai_content_editorial_render_diagnostic", String(row.id), input.workerId, diagnosticJson].join(":"));
          await client.query(
            `insert into audit_events(
               id,workspace_id,brand_id,actor_type,actor_external_id,event_type,entity_type,entity_id,metadata
             ) values($1,$2,$3,'worker',$4,'ai_content_editorial_render_diagnostic','ai_content_generation_render_job',$5,$6::jsonb)
             on conflict do nothing`,
            [eventId, row.workspace_id, row.brand_id, input.workerId, row.id, diagnosticJson],
          );
        }
        await insertFinalizer(client, {
          workspaceId: String(scope.workspace_id), brandId: String(scope.brand_id),
          generationId: String(scope.generation_id), outputId: input.outputId,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async failVisualSession(input) {
      const jobs = orderedLeaseVector(input.jobs);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const scope = await renderJobScope(client, jobs[0]!.jobId);
        if (String(scope.output_id) !== input.outputId) throw new Error("ai_content_visual_session_lease_invalid");
        await lockRenderGeneration(client, scope);
        await lockRenderOutput(client, scope);
        const rows = await lockVisualSessionRows(client, input.outputId);
        assertVisualLeaseRows(rows, { workerId: input.workerId, jobs });
        await client.query(
          `update ai_content_generation_render_jobs
              set status='failed',lease_expires_at=null,error_code=$2,error_message=$3,
                  completed_at=coalesce(completed_at,now()),updated_at=now()
            where output_id=$1 and job_kind='image_asset'
              and payload_json->>'contractVersion'='ai-content-visual-session-render-job.v1'`,
          [input.outputId, input.errorCode, input.errorMessage],
        );
        await failRenderOutputAndGeneration(client, rows[0]!, input.errorCode, input.errorMessage);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async completeAsset(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await lockedRenderJob(client, input.jobId);
        await lockRenderOutput(client, row);
        if (row.status === "succeeded") {
          if (row.worker_id !== input.workerId || String(row.lease_token) !== input.leaseToken) {
            throw new Error("ai_content_render_job_lease_invalid");
          }
          if (!isDeepStrictEqual(row.result_json, input.asset)) throw new Error("ai_content_render_completion_conflict");
          await client.query("COMMIT");
          return;
        }
        requireLease(row, input);
        if (row.job_kind !== "image_asset" || Number(row.asset_index) !== input.asset.index) throw new Error("ai_content_render_job_kind_invalid");
        const imagePackage = record(row.payload_json).imagePackage as ImageGenerationPackageV1 | undefined;
        if (!imagePackage) throw new Error("ai_content_render_snapshot_missing");
        const asset = parseRenderAssetResult(input.asset, {
          brandId: String(row.brand_id), generationId: String(row.generation_id), outputId: String(row.output_id),
          assetIndex: Number(row.asset_index), outputFormat: imagePackage.outputFormat,
          aspectRatio: imagePackage.aspectRatio,
        });
        await client.query(
          `update ai_content_generation_render_jobs set status='succeeded',result_json=$2::jsonb,
             lease_expires_at=null,error_code=null,error_message=null,completed_at=coalesce(completed_at,now()),updated_at=now()
           where id=$1`,
          [input.jobId, JSON.stringify(asset)],
        );
        const remaining = await client.query(
          `select count(*) filter(where status<>'succeeded')::integer as remaining
             from ai_content_generation_render_jobs where output_id=$1 and generation_id=$2
               and workspace_id=$3 and brand_id=$4 and job_kind='image_asset'`,
          [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
        );
        if (Number(remaining.rows[0]?.remaining ?? 0) === 0) {
          await insertFinalizer(client, {
            workspaceId: String(row.workspace_id), brandId: String(row.brand_id),
            generationId: String(row.generation_id), outputId: String(row.output_id),
          });
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async completePackage(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await lockTerminalRenderGraph(client, input.jobId);
        if (row.status === "succeeded") {
          if (row.worker_id !== input.workerId || String(row.lease_token) !== input.leaseToken) {
            throw new Error("ai_content_render_job_lease_invalid");
          }
        } else requireLease(row, input);
        if (row.job_kind !== "package_finalize") throw new Error("ai_content_render_job_kind_invalid");
        parseRenderManifestUrl(input.manifestUrl, {
          brandId: String(row.brand_id),
          generationId: String(row.generation_id),
          outputId: String(row.output_id),
        });
        const state = await client.query(
          `select output.plan_json,input.input_json,generation.output_format,generation.purpose,research.evidence_json
             from ai_content_generation_outputs output
             join ai_content_generations generation on generation.id=output.generation_id
               and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
             join ai_content_generation_input_snapshots input on input.generation_id=output.generation_id
               and input.workspace_id=output.workspace_id and input.brand_id=output.brand_id
             left join ai_content_output_research_snapshots research
               on research.output_id=output.id and research.generation_id=output.generation_id
              and research.workspace_id=output.workspace_id and research.brand_id=output.brand_id
            where output.id=$1 and output.generation_id=$2 and output.workspace_id=$3 and output.brand_id=$4 for update of output`,
          [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
        );
        if (!state.rows.length) throw new Error("ai_content_render_snapshot_missing");
        const finalInput = parseContentGenerationInputV3(state.rows[0].input_json);
        if (finalInput.generationId !== String(row.generation_id)) throw new Error("ai_content_generation_input_mismatch");
        const plan = parseContentPlanResultV2(state.rows[0].plan_json, finalInput, state.rows[0].evidence_json);
        const settings = finalInput.outputSettings;
        const imagePackage = planImagePackage(plan);
        const manifest = parseActiveAiContentManifestV3(
          input.manifest,
          imagePackage ? expectedAiContentAssetDimensions(imagePackage.aspectRatio) : undefined,
        );
        if (
          manifest.outputFormat !== settings.outputFormat
          || manifest.outputFormat !== state.rows[0].output_format
          || manifest.purpose !== settings.purpose
          || manifest.purpose !== state.rows[0].purpose
          || /asset:\/\//.test(JSON.stringify(manifest))
        ) throw new Error("ai_content_render_manifest_invalid");
        validateRenderManifestArtifactUrls(manifest, {
          brandId: String(row.brand_id),
          generationId: String(row.generation_id),
          outputId: String(row.output_id),
        });
        validateManifestAgainstPlan(manifest, plan, finalInput, state.rows[0].evidence_json);
        if (imagePackage) {
          const results = await client.query(
            `select asset_index,result_json from ai_content_generation_render_jobs where output_id=$1 and generation_id=$2
               and workspace_id=$3 and brand_id=$4 and job_kind='image_asset' and status='succeeded' order by asset_index`,
            [row.output_id, row.generation_id, row.workspace_id, row.brand_id],
          );
          if (results.rows.length !== imagePackage.assetCount) throw new Error("ai_content_render_manifest_invalid");
          const imageAssets = manifest.assets.filter((asset) => asset.mimeType === "image/png");
          if (
            imageAssets.length !== imagePackage.assetCount
            || imageAssets.some((asset, position) => {
              const result = results.rows[position];
              const rendered = record(result?.result_json);
              return Number(result?.asset_index) !== position + 1
                || asset.index !== position + 1
                || asset.url !== rendered.url
                || asset.mimeType !== rendered.mimeType
                || asset.width !== rendered.width
                || asset.height !== rendered.height;
            })
          ) {
            throw new Error("ai_content_render_manifest_invalid");
          }
          validateBlogImageBindings(
            manifest,
            results.rows.map((result) => String(record(result.result_json).url)),
          );
        } else {
          validateBlogImageBindings(manifest, []);
        }
        const resultJson = { manifest, manifestUrl: input.manifestUrl };
        if (row.status === "succeeded") {
          if (!isDeepStrictEqual(row.result_json, resultJson)) throw new Error("ai_content_render_completion_conflict");
          await completeGenerationOperationIfTerminal(client, String(row.generation_id));
          const generation = await loadGeneration(client, String(row.generation_id));
          await client.query("COMMIT");
          await notifyPackageCompleted(row, manifest.outputFormat);
          return generation;
        }
        await client.query(
          `update ai_content_generation_render_jobs set status='succeeded',result_json=$2::jsonb,lease_expires_at=null,
             error_code=null,error_message=null,completed_at=coalesce(completed_at,now()),updated_at=now() where id=$1`,
          [input.jobId, JSON.stringify(resultJson)],
        );
        await client.query(
          `update ai_content_generation_outputs set title=$2,status='completed',content_json=$3::jsonb,
             artifact_manifest_json=$4::jsonb,manifest_url=$5,failure_code=null,failure_message=null,
             completed_at=coalesce(completed_at,now()),updated_at=now() where id=$1`,
          [row.output_id, manifest.title, JSON.stringify(manifest.content), JSON.stringify(manifest), input.manifestUrl],
        );
        const counts = await client.query(
          `select count(*)::integer total,count(*) filter(where status='completed')::integer completed,
                  count(*) filter(where status='failed')::integer failed
             from ai_content_generation_outputs where generation_id=$1`,
          [row.generation_id],
        );
        const total = Number(counts.rows[0]?.total ?? 0);
        const completed = Number(counts.rows[0]?.completed ?? 0);
        const failed = Number(counts.rows[0]?.failed ?? 0);
        const status = total > 0 && completed === total ? "completed" : failed > 0 && completed + failed === total ? "partial_failed" : "generating";
        await client.query(
          `update ai_content_generations set status=$2,current_stage=case when $2='generating' then 'generation' else 'completed' end,
             completed_at=case when $2<>'generating' then coalesce(completed_at,now()) else null end,
             terminal_at=case when $2<>'generating' then coalesce(terminal_at,now()) else terminal_at end,
             retryable_until=case when $2<>'generating' then coalesce(retryable_until,now()+interval '15 days') else retryable_until end,
             error_code=null,error_message=null,updated_at=now() where id=$1`,
          [row.generation_id, status],
        );
        await completeGenerationOperationIfTerminal(client, String(row.generation_id));
        const generation = await loadGeneration(client, String(row.generation_id));
        await client.query("COMMIT");
        await notifyPackageCompleted(row, manifest.outputFormat);
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async appendEditorialDiagnostic(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const row = await lockedRenderJob(client, input.jobId);
        if (row.status !== "succeeded"
          || row.job_kind !== "image_asset"
          || row.worker_id !== input.workerId
          || String(row.lease_token) !== input.leaseToken) {
          throw new Error("ai_content_render_job_lease_invalid");
        }
        const storedPayload = record(row.payload_json);
        const binding = record(storedPayload.visualSessionBinding);
        const diagnostic = input.diagnostic;
        if (storedPayload.contractVersion !== "ai-content-visual-session-render-job.v1"
          || diagnostic.contractVersion !== "ai-content-editorial-render-diagnostic.v1"
          || diagnostic.sourceContractVersion !== binding.sourceContractVersion
          || diagnostic.compiledPromptVersion !== "image-visual-session.v1"
          || diagnostic.sourceSha256 !== binding.sourceSha256
          || diagnostic.sceneIndex !== Number(row.asset_index)
          || !/^[0-9a-f]{64}$/.test(diagnostic.compiledPromptSha256)
          || !["observed", "not_emitted_by_runner"].includes(diagnostic.actualToolArgumentsObservation)
          || (diagnostic.actualToolArgumentsObservation === "observed") !== (diagnostic.actualToolArgumentsSha256 !== null)
          || (diagnostic.actualToolArgumentsSha256 !== null && !/^[0-9a-f]{64}$/.test(diagnostic.actualToolArgumentsSha256))) {
          throw new Error("ai_content_editorial_render_diagnostic_invalid");
        }
        const diagnosticJson = canonicalJson(diagnostic);
        const eventId = deterministicAuditEventId([
          "ai_content_editorial_render_diagnostic", input.jobId, input.workerId, diagnosticJson,
        ].join(":"));
        await client.query(
          `insert into audit_events(
             id,workspace_id,brand_id,actor_type,actor_external_id,event_type,entity_type,entity_id,metadata
           ) values($1,$2,$3,'worker',$4,'ai_content_editorial_render_diagnostic','ai_content_generation_render_job',$5,$6::jsonb)
             on conflict do nothing`,
          [eventId, row.workspace_id, row.brand_id, input.workerId, input.jobId, diagnosticJson],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async fail(input) {
      const client = await pool.connect();
      try {
        if (input.diagnosticCode !== undefined && !/^(?:ai_content|codex)_[a-z0-9_]{1,108}$/.test(input.diagnosticCode)) {
          throw new Error("ai_content_render_diagnostic_invalid");
        }
        await client.query("BEGIN");
        const row = await lockTerminalRenderGraph(client, input.jobId);
        if (row.status === "failed" && row.error_code === input.errorCode) {
          if (row.worker_id !== input.workerId || String(row.lease_token) !== input.leaseToken) {
            throw new Error("ai_content_render_job_lease_invalid");
          }
          await reverseGenerationReservationIfTerminalFailure(client, String(row.generation_id));
          await client.query("COMMIT");
          return;
        }
        requireLease(row, input);
        const retry = input.retryable && Number(row.attempt_count) < Number(row.max_attempts);
        await client.query(
          `update ai_content_generation_render_jobs set status=$2,
             available_at=case when $2='queued' then now()+interval '60 seconds' else available_at end,
             worker_id=case when $2='failed' then worker_id else null end,
             lease_token=case when $2='failed' then lease_token else null end,
             lease_expires_at=null,error_code=$3,error_message=$4,
             completed_at=case when $2='failed' then now() else null end,updated_at=now() where id=$1`,
          [input.jobId, retry ? "queued" : "failed", input.errorCode, input.errorMessage],
        );
        if (!retry) {
          await failRenderOutputAndGeneration(client, row, input.errorCode, input.errorMessage);
        }
        await client.query("COMMIT");
        await appendRenderFailureAudit(client, row, input, retry);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },


    async saveOutputResearch(input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const job = await client.query(
          `select *,(lease_expires_at<=clock_timestamp()) as lease_expired from ai_content_generation_jobs
            where id=$1 and output_id=$2 for update`,
          [input.jobId, input.outputId],
        );
        const row = job.rows[0] as Record<string, unknown> | undefined;
        if (!row || row.job_type !== "generate" || row.output_format !== "blog") throw new Error("ai_content_research_job_invalid");
        requireLease(row, input);
        const evidence = parseResearchEvidenceSnapshotV1(input.evidence);
        if (evidence.decision !== "searched") throw new Error("ai_content_research_snapshot_invalid");
        const existing = await client.query(
          "select evidence_json from ai_content_output_research_snapshots where output_id=$1 for update",
          [input.outputId],
        );
        if (existing.rows.length) {
          if (!isDeepStrictEqual(existing.rows[0].evidence_json, evidence)) throw new Error("ai_content_research_snapshot_conflict");
        } else {
          await client.query(
            `insert into ai_content_output_research_snapshots(workspace_id,brand_id,generation_id,output_id,evidence_json)
             values($1,$2,$3,$4,$5::jsonb)`,
            [row.workspace_id, row.brand_id, row.generation_id, row.output_id, JSON.stringify(evidence)],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
  };
}
