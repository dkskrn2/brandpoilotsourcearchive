import { randomUUID } from "node:crypto";
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
import type { AiContentGenerationRecord } from "./aiContentRepository.js";
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

type Queryable = Pick<PoolClient, "query">;

export type AiContentImageAssetTransport = "v1" | "manual-v2";

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
  retryable: boolean;
}

export interface AiContentRenderJobsRepository {
  claim(input: { workerId: string; leaseSeconds: number }): Promise<AiContentRenderJob | null>;
  heartbeat(input: RenderLeaseInput): Promise<boolean>;
  completeAsset(input: RenderAssetCompletion): Promise<void>;
  completePackage(input: RenderPackageCompletion): Promise<AiContentGenerationRecord>;
  fail(input: RenderFailure): Promise<void>;
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

export async function resolveManualRenderTransport(client: Queryable, input: {
  generationId: string;
  workspaceId: string;
  brandId: string;
  selectedProposalId: string;
}): Promise<AiContentImageAssetTransport> {
  const lineage = await client.query(
    `select binding.selected_proposal_id,batch.origin
       from ai_content_generation_prompt_bindings binding
       join ai_content_proposals proposal
         on proposal.id=binding.selected_proposal_id
        and proposal.workspace_id=binding.workspace_id and proposal.brand_id=binding.brand_id
       join ai_content_proposal_batches batch
         on batch.id=proposal.batch_id
        and batch.workspace_id=proposal.workspace_id and batch.brand_id=proposal.brand_id
      where binding.generation_id=$1 and binding.workspace_id=$2 and binding.brand_id=$3
        and binding.selected_proposal_id=$4
      for share of binding,proposal,batch`,
    [input.generationId, input.workspaceId, input.brandId, input.selectedProposalId],
  );
  if (
    lineage.rows.length !== 1
    || String(lineage.rows[0]?.selected_proposal_id) !== input.selectedProposalId
    || lineage.rows[0]?.origin !== "manual"
  ) return "v1";
  return "manual-v2";
}

export async function enqueueAiContentRenderJobs(client: Queryable, input: {
  workspaceId: string;
  brandId: string;
  generationId: string;
  outputId: string;
  plan: ContentPlanResultV2;
  finalInput: ContentGenerationInputV3;
  imageAssetTransport?: AiContentImageAssetTransport;
}): Promise<void> {
  const imagePackage = input.plan.imagePackage;
  if (imagePackage) {
    for (const asset of imagePackage.assets) {
      const payload = {
        contractVersion: input.imageAssetTransport === "manual-v2"
          ? "ai-content-render-job.v2"
          : "ai-content-render-job.v1",
        jobKind: "image_asset",
        generationId: input.generationId,
        outputId: input.outputId,
        imagePackage,
        assetIndex: asset.index,
        assetKey: `${input.generationId}:${asset.index}`,
        storagePath: expectedAiContentAssetStoragePath({ ...input, assetIndex: asset.index }),
        ...(input.imageAssetTransport === "manual-v2"
          ? { rendererPromptVersion: "image-final-pixels.v2" }
          : {}),
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
      for share of generation,output,binding,proposal,batch`,
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

export function createAiContentRenderJobsRepository(
  pool: Pool,
  loadGeneration: (client: Queryable, generationId: string) => Promise<AiContentGenerationRecord>,
): AiContentRenderJobsRepository {
  return {
    async claim(input) {
      if (!input.workerId?.trim() || !Number.isSafeInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 300) {
        throw new Error("ai_content_render_claim_invalid");
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const exhausted = await client.query(
          `select id from ai_content_generation_render_jobs
            where status='processing' and lease_expires_at<=clock_timestamp() and attempt_count>=max_attempts
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
            where status='processing' and lease_expires_at<=clock_timestamp() and attempt_count<max_attempts`,
        );
        const candidate = await client.query(
          `select id from ai_content_generation_render_jobs
            where status='queued' and available_at<=clock_timestamp() and attempt_count<max_attempts
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
          : storedPayload.contractVersion === "ai-content-render-job.v2"
            ? await manualImageAssetPayloadV2(client, row)
            : storedPayload;
        await client.query("COMMIT");
        return renderJob(row, payload);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

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
        return generation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },

    async fail(input) {
      const client = await pool.connect();
      try {
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
