import { parseImageGenerationPackageV1, type ImageGenerationPackageV1 } from "@brand-pilot/content-contracts";
import {
  parseAiContentManualImageAssetPayloadV2,
  parseAiContentManualImageAssetPayloadV3,
  type AiContentManualImageAssetPayloadV2,
  type AiContentManualImageAssetPayloadV3,
} from "./aiContentManualRenderContract.js";

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

export interface AiContentImageAssetJobV1 extends AiContentRenderJobBase {
  jobKind: "image_asset";
  assetIndex: number;
  payload: {
    contractVersion: "ai-content-render-job.v1";
    jobKind: "image_asset";
    generationId: string;
    outputId: string;
    imagePackage: ImageGenerationPackageV1;
    assetIndex: number;
    assetKey: string;
    storagePath: string;
  };
}

export interface AiContentImageAssetJobV2 extends AiContentRenderJobBase {
  jobKind: "image_asset";
  assetIndex: number;
  payload: AiContentManualImageAssetPayloadV2;
}

export interface AiContentImageAssetJobV3 extends AiContentRenderJobBase {
  jobKind: "image_asset";
  assetIndex: number;
  payload: AiContentManualImageAssetPayloadV3;
}

export type AiContentImageAssetJob = AiContentImageAssetJobV1 | AiContentImageAssetJobV2 | AiContentImageAssetJobV3;

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
export type AiContentRenderLease = Pick<AiContentRenderJob, "id" | "leaseToken">;

export interface AiContentRenderClient {
  claim(workerId: string, leaseSeconds: number): Promise<AiContentRenderJob | null>;
  heartbeat(job: AiContentRenderLease, workerId: string, leaseSeconds: number): Promise<boolean>;
  completeAsset(job: AiContentRenderLease, workerId: string, asset: AiContentRenderedAsset): Promise<void>;
  completePackage(job: AiContentRenderLease, workerId: string, input: { manifest: object; manifestUrl: string }): Promise<void>;
  fail(job: AiContentRenderLease, workerId: string, input: { errorCode: string; errorMessage: string; diagnosticCode?: string; retryable: boolean }): Promise<void>;
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
    if (rawPayload.contractVersion === "ai-content-render-job.v3") {
      const assetIndex = Number(source.assetIndex);
      if (!Number.isSafeInteger(assetIndex) || assetIndex < 1 || source.assetIndex !== assetIndex) {
        throw new Error("ai_content_render_job_invalid");
      }
      const payload = parseAiContentManualImageAssetPayloadV3(rawPayload, { ...common, id: common.id, assetIndex });
      return { ...common, jobKind: "image_asset", assetIndex, payload };
    }
    if (rawPayload.contractVersion === "ai-content-render-job.v2") {
      const assetIndex = Number(source.assetIndex);
      if (!Number.isSafeInteger(assetIndex) || assetIndex < 1 || source.assetIndex !== assetIndex) {
        throw new Error("ai_content_render_job_invalid");
      }
      const payload = parseAiContentManualImageAssetPayloadV2(rawPayload, { ...common, id: common.id, assetIndex });
      return { ...common, jobKind: "image_asset", assetIndex, payload };
    }
    const payload = exact(source.payload, ["contractVersion", "jobKind", "generationId", "outputId", "imagePackage", "assetIndex", "assetKey", "storagePath"]);
    const assetIndex = Number(source.assetIndex);
    const imagePackage = parseImageGenerationPackageV1(payload.imagePackage);
    const expectedPath = `ai-content/${common.brandId}/${common.generationId}/${common.outputId}/assets/${String(assetIndex).padStart(2, "0")}.png`;
    if (
      payload.contractVersion !== "ai-content-render-job.v1" || payload.jobKind !== "image_asset"
      || !Number.isSafeInteger(assetIndex) || assetIndex < 1 || assetIndex > imagePackage.assetCount
      || Number(payload.assetIndex) !== assetIndex || source.assetIndex !== assetIndex
      || payload.generationId !== common.generationId || payload.outputId !== common.outputId
      || imagePackage.generationId !== common.generationId
      || payload.assetKey !== `${common.generationId}:${assetIndex}` || payload.storagePath !== expectedPath
    ) throw new Error("ai_content_render_job_invalid");
    return { ...common, jobKind: "image_asset", assetIndex, payload: { contractVersion: "ai-content-render-job.v1", jobKind: "image_asset", generationId: common.generationId, outputId: common.outputId, imagePackage, assetIndex, assetKey: String(payload.assetKey), storagePath: String(payload.storagePath) } };
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
      const response = await request("/worker/ai-content-render-jobs/claim", { workerId, leaseSeconds });
      if (response.status === 204) return null;
      const envelope = exact(await response.json(), ["job"]);
      return envelope.job === null ? null : parseJob(envelope.job);
    },
    async heartbeat(job, workerId, leaseSeconds) {
      const response = await fetchImpl(`${baseUrl}/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/heartbeat`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ workerId, leaseToken: job.leaseToken, leaseSeconds }) });
      if (response.status === 409) return false;
      if (!response.ok) throw await apiFailure(response);
      return true;
    },
    async completeAsset(job, workerId, asset) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/complete`, { workerId, leaseToken: job.leaseToken, jobKind: "image_asset", asset });
    },
    async completePackage(job, workerId, input) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/complete`, { workerId, leaseToken: job.leaseToken, jobKind: "package_finalize", manifest: input.manifest, manifestUrl: input.manifestUrl });
    },
    async fail(job, workerId, input) {
      await request(`/worker/ai-content-render-jobs/${encodeURIComponent(job.id)}/fail`, { workerId, leaseToken: job.leaseToken, ...input });
    },
  };
}
