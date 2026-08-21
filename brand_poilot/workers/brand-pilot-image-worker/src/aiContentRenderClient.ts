import { createHash } from "node:crypto";
import type { ContentGenerationInputV3, ImageGenerationPackageV1 } from "@brand-pilot/content-contracts";
import { parseAiContentVisualSessionV1, type AiContentVisualSessionV1 } from "@brand-pilot/content-contracts/visual-render-session";
import {
  parseAiContentManualImageAssetPayloadV2,
  type AiContentManualImageAssetPayloadV2,
} from "./aiContentManualRenderContract.js";
import type { AiContentEditorialRenderDiagnostic } from "./aiContentAssetRenderer.js";

export interface AiContentRenderedAsset {
  index: number;
  url: string;
  storagePath: string;
  mimeType: "image/png";
  width: number;
  height: number;
  checksum: string;
}

interface AiContentRenderJobBase {
  id: string;
  generationId: string;
  outputId: string;
  workspaceId: string;
  brandId: string;
  leaseToken: string;
  attemptCount: number;
}

export interface AiContentImageAssetJobV2 extends AiContentRenderJobBase {
  jobKind: "image_asset";
  assetIndex: number;
  payload: AiContentManualImageAssetPayloadV2;
}

export interface AiContentVisualSessionImageAssetJob extends AiContentRenderJobBase {
  jobKind: "image_asset";
  assetIndex: number;
  payload: {
    contractVersion: "ai-content-visual-session-render-job.v1";
    jobKind: "image_asset";
    generationId: string;
    outputId: string;
    imagePackage: ImageGenerationPackageV1;
    assetIndex: number;
    assetKey: string;
    storagePath: string;
    rendererPromptVersion: "image-visual-session.v1";
    visualSessionBinding: { sourceContractVersion: "card-manuscript-plan.v1" | "reel-storyboard.v1" | "reel-storyboard.v2"; sourceSha256: string; sceneIndex: number };
    contentGenerationInput: ContentGenerationInputV3;
    contentPlan: Record<string, unknown>;
    visualSession: AiContentVisualSessionV1;
  };
}

export type AiContentImageAssetJob = AiContentImageAssetJobV2;

export interface AiContentVisualSessionLease {
  kind: "visual_session";
  outputId: string;
  outputFormat: "card_news" | "reel";
  visualSession: AiContentVisualSessionV1;
  jobs: AiContentVisualSessionImageAssetJob[];
}

export interface AiContentPackageFinalizeJob extends AiContentRenderJobBase {
  jobKind: "package_finalize";
  assetIndex: null;
  payload: {
    contractVersion: "ai-content-render-job.v1";
    jobKind: "package_finalize";
    generationId: string;
    outputId: string;
    plan: Record<string, unknown>;
    finalInput: Record<string, unknown>;
    supplementalResearch: Record<string, unknown> | null;
    assets: AiContentRenderedAsset[];
  };
}

export type AiContentRenderJob = AiContentImageAssetJob | AiContentPackageFinalizeJob;
export type AiContentRenderClaim = AiContentRenderJob | AiContentVisualSessionLease;
export type AiContentRenderLease = Pick<AiContentRenderJob, "id" | "leaseToken">;

export interface AiContentRenderClient {
  claim(workerId: string, leaseSeconds: number): Promise<AiContentRenderClaim | null>;
  heartbeat(job: AiContentRenderLease, workerId: string, leaseSeconds: number): Promise<boolean>;
  heartbeatBatch(batch: AiContentVisualSessionLease, workerId: string, leaseSeconds: number): Promise<boolean>;
  completeBatch(batch: AiContentVisualSessionLease, workerId: string, input: { assets: AiContentRenderedAsset[]; diagnostics: AiContentEditorialRenderDiagnostic[] }): Promise<void>;
  failBatch(batch: AiContentVisualSessionLease, workerId: string, input: { errorCode: string; errorMessage: string }): Promise<void>;
  completeAsset(job: AiContentRenderLease, workerId: string, asset: AiContentRenderedAsset): Promise<void>;
  appendRenderDiagnostic?(job: AiContentRenderLease, workerId: string, diagnostic: AiContentEditorialRenderDiagnostic): Promise<void>;
  completePackage(job: AiContentRenderLease, workerId: string, input: { manifest: object; manifestUrl: string }): Promise<void>;
  fail(job: AiContentRenderLease, workerId: string, input: { errorCode: string; errorMessage: string; diagnosticCode?: string; retryable: boolean }): Promise<void>;
}

function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]))
      : item;
  return JSON.stringify(normalize(value));
}

export function aiContentVisualSessionCompletionSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function record(value: unknown, code = "ai_content_render_job_invalid"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("ai_content_render_job_invalid");
  return value.trim();
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = record(value);
  if (Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) {
    throw new Error("ai_content_render_job_invalid");
  }
  return source;
}

function renderedAsset(value: unknown): AiContentRenderedAsset {
  const source = exact(value, ["index", "url", "storagePath", "mimeType", "width", "height", "checksum"]);
  if (
    !Number.isSafeInteger(source.index) || Number(source.index) < 1
    || source.mimeType !== "image/png"
    || !Number.isSafeInteger(source.width) || Number(source.width) < 1
    || !Number.isSafeInteger(source.height) || Number(source.height) < 1
    || typeof source.checksum !== "string" || !/^[0-9a-f]{64}$/.test(source.checksum)
  ) throw new Error("ai_content_render_job_invalid");
  const url = text(source.url);
  try { if (new URL(url).protocol !== "https:") throw new Error(); } catch { throw new Error("ai_content_render_job_invalid"); }
  return { index: Number(source.index), url, storagePath: text(source.storagePath), mimeType: "image/png", width: Number(source.width), height: Number(source.height), checksum: source.checksum };
}

function parseJob(value: unknown): AiContentRenderJob {
  const source = exact(value, ["id", "generationId", "outputId", "brandId", "workspaceId", "jobKind", "assetIndex", "leaseToken", "attemptCount", "payload"]);
  const common = {
    id: text(source.id), generationId: text(source.generationId), outputId: text(source.outputId),
    workspaceId: text(source.workspaceId), brandId: text(source.brandId), leaseToken: text(source.leaseToken),
    attemptCount: Number(source.attemptCount),
  };
  if (!Number.isSafeInteger(common.attemptCount) || common.attemptCount < 1) throw new Error("ai_content_render_job_invalid");
  if (source.jobKind === "image_asset") {
    const rawPayload = record(source.payload);
    if (rawPayload.contractVersion === "ai-content-render-job.v2") {
      const assetIndex = Number(source.assetIndex);
      if (!Number.isSafeInteger(assetIndex) || assetIndex < 1 || source.assetIndex !== assetIndex) {
        throw new Error("ai_content_render_job_invalid");
      }
      const payload = parseAiContentManualImageAssetPayloadV2(rawPayload, { ...common, id: common.id, assetIndex });
      return { ...common, jobKind: "image_asset", assetIndex, payload };
    }
    throw new Error("ai_content_render_job_invalid");
  }
  if (source.jobKind === "package_finalize" && source.assetIndex === null) {
    const payload = exact(source.payload, ["contractVersion", "jobKind", "generationId", "outputId", "plan", "finalInput", "supplementalResearch", "assets"]);
    if (payload.contractVersion !== "ai-content-render-job.v1" || payload.jobKind !== "package_finalize" || payload.generationId !== common.generationId || payload.outputId !== common.outputId || !Array.isArray(payload.assets)) {
      throw new Error("ai_content_render_job_invalid");
    }
    return { ...common, jobKind: "package_finalize", assetIndex: null, payload: { contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize", generationId: common.generationId, outputId: common.outputId, plan: record(payload.plan), finalInput: record(payload.finalInput), supplementalResearch: payload.supplementalResearch === null ? null : record(payload.supplementalResearch), assets: payload.assets.map(renderedAsset) } };
  }
  throw new Error("ai_content_render_job_invalid");
}

function parseVisualJob(value: unknown, session: AiContentVisualSessionV1, outputId: string): AiContentVisualSessionImageAssetJob {
  const source = exact(value, ["id", "generationId", "outputId", "brandId", "workspaceId", "jobKind", "assetIndex", "leaseToken", "attemptCount", "payload"]);
  const assetIndex = Number(source.assetIndex);
  if (source.jobKind !== "image_asset" || source.outputId !== outputId || !Number.isSafeInteger(assetIndex) || assetIndex < 1) throw new Error("ai_content_visual_session_invalid");
  const payload = exact(source.payload, ["contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey", "storagePath", "rendererPromptVersion", "visualSessionBinding", "contentGenerationInput", "contentPlan", "visualSession"]);
  const binding = exact(payload.visualSessionBinding, ["sourceContractVersion", "sourceSha256", "sceneIndex"]);
  const parsedSession = parseAiContentVisualSessionV1(payload.visualSession);
  if (payload.contractVersion !== "ai-content-visual-session-render-job.v1" || payload.rendererPromptVersion !== "image-visual-session.v1"
    || payload.outputId !== outputId || payload.assetIndex !== assetIndex || binding.sceneIndex !== assetIndex
    || binding.sourceContractVersion !== session.source.contractVersion || binding.sourceSha256 !== session.source.sha256
    || canonicalJson(parsedSession) !== canonicalJson(session)) throw new Error("ai_content_visual_session_invalid");
  const base = { id: text(source.id), generationId: text(source.generationId), outputId, workspaceId: text(source.workspaceId), brandId: text(source.brandId), leaseToken: text(source.leaseToken), attemptCount: Number(source.attemptCount) };
  if (!Number.isSafeInteger(base.attemptCount) || base.attemptCount < 1) throw new Error("ai_content_visual_session_invalid");
  return { ...base, jobKind: "image_asset", assetIndex, payload: {
    contractVersion: "ai-content-visual-session-render-job.v1", jobKind: "image_asset", generationId: text(payload.generationId), outputId,
    imagePackage: record(payload.imagePackage) as ImageGenerationPackageV1, assetIndex, assetKey: text(payload.assetKey), storagePath: text(payload.storagePath), rendererPromptVersion: "image-visual-session.v1",
    visualSessionBinding: { sourceContractVersion: binding.sourceContractVersion as "card-manuscript-plan.v1" | "reel-storyboard.v1" | "reel-storyboard.v2", sourceSha256: text(binding.sourceSha256), sceneIndex: assetIndex },
    contentGenerationInput: record(payload.contentGenerationInput) as ContentGenerationInputV3, contentPlan: record(payload.contentPlan), visualSession: parsedSession,
  } };
}

function parseClaim(value: unknown): AiContentRenderClaim {
  const source = record(value);
  if (source.kind !== "visual_session") return parseJob(value);
  const exactSource = exact(value, ["kind", "outputId", "outputFormat", "visualSession", "jobs"]);
  const outputId = text(exactSource.outputId);
  const visualSession = parseAiContentVisualSessionV1(exactSource.visualSession);
  if (exactSource.outputFormat !== visualSession.outputFormat || !Array.isArray(exactSource.jobs)) throw new Error("ai_content_visual_session_invalid");
  const jobs = exactSource.jobs.map((job) => parseVisualJob(job, visualSession, outputId));
  if (jobs.length !== visualSession.scenes.length || jobs.some(({ assetIndex }, offset) => assetIndex !== offset + 1)) throw new Error("ai_content_visual_session_invalid");
  return { kind: "visual_session", outputId, outputFormat: visualSession.outputFormat, visualSession, jobs };
}

function leaseVector(batch: AiContentVisualSessionLease) {
  return batch.jobs.map(({ id, assetIndex, leaseToken }) => ({ jobId: id, assetIndex, leaseToken }));
}

async function apiFailure(response: Response): Promise<Error> {
  let code = "";
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && /^[a-z0-9_]{1,120}$/.test(body.error)) {
      code = `:${body.error}`;
    }
  } catch {
    // The status remains sufficient when the API did not return its stable JSON error contract.
  }
  return new Error(`ai_content_render_api_failed:${response.status}${code}`);
}

export function createAiContentRenderClient({ apiUrl, token, fetchImpl = fetch }: { apiUrl: string; token: string; fetchImpl?: typeof fetch }): AiContentRenderClient {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>): Promise<Response> {
    const response = await fetchImpl(`${baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok && response.status !== 204) throw await apiFailure(response);
    return response;
  }
  return {
    async claim(workerId, leaseSeconds) {
      const response = await request("/worker/ai-content-render-jobs/claim", { workerId, leaseSeconds, capabilities: ["ai-content-visual-session.v1"] });
      if (response.status === 204) return null;
      const envelope = exact(await response.json(), ["job"]);
      return envelope.job === null ? null : parseClaim(envelope.job);
    },
    async heartbeat(job, workerId, leaseSeconds) {
      const response = await fetchImpl(`${baseUrl}/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ workerId, leaseToken: job.leaseToken, leaseSeconds }) });
      if (response.status === 409) return false;
      if (!response.ok) throw await apiFailure(response);
      return true;
    },
    async heartbeatBatch(batch, workerId, leaseSeconds) {
      const response = await fetchImpl(`${baseUrl}/worker/ai-content-render-jobs/visual-session/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ outputId: batch.outputId, workerId, leaseSeconds, jobs: leaseVector(batch) }) });
      if (response.status === 409) return false;
      if (!response.ok) throw await apiFailure(response);
      return true;
    },
    async completeBatch(batch, workerId, input) {
      const body = { outputId: batch.outputId, workerId, jobs: leaseVector(batch), assets: input.assets, diagnostics: input.diagnostics };
      const exactBody = { ...body, bodySha256: aiContentVisualSessionCompletionSha256(body) };
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try { await request("/worker/ai-content-render-jobs/visual-session/complete", exactBody); return; }
        catch (error) { lastError = error; if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, [250, 750, 1500][attempt])); }
      }
      throw lastError;
    },
    async failBatch(batch, workerId, input) {
      await request("/worker/ai-content-render-jobs/visual-session/fail", { outputId: batch.outputId, workerId, jobs: leaseVector(batch), ...input });
    },
    async completeAsset(job, workerId, asset) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/complete`, { workerId, leaseToken: job.leaseToken, jobKind: "image_asset", asset });
    },
    async appendRenderDiagnostic(job, workerId, diagnostic) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/diagnostic`, {
        workerId, leaseToken: job.leaseToken, diagnostic,
      });
    },
    async completePackage(job, workerId, input) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/complete`, { workerId, leaseToken: job.leaseToken, jobKind: "package_finalize", manifest: input.manifest, manifestUrl: input.manifestUrl });
    },
    async fail(job, workerId, input) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/fail`, { workerId, leaseToken: job.leaseToken, ...input });
    },
  };
}
