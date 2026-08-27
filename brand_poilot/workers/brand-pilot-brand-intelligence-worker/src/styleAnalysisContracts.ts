import {
  parseDesignStyleAnalysisV1,
  type DesignStyleAnalysisV1,
} from "@brand-pilot/content-contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface StyleAnalysisJob {
  jobId: string;
  workspaceId: string;
  brandId: string;
  designStyleId: string;
  styleRevision: number;
  leaseToken: string;
  leaseExpiresAt: string;
  images: Array<{
    referenceItemId: string;
    storageUrl: string;
    storagePath: string;
    mimeType: "image/png" | "image/jpeg" | "image/webp";
    sizeBytes: number;
    checksum: string;
  }>;
}

export interface StyleAnalysisClient {
  claimStyleAnalysis(workerId: string, leaseSeconds: number): Promise<StyleAnalysisJob | null>;
  heartbeatStyleAnalysis(job: StyleAnalysisJob, workerId: string, leaseSeconds: number): Promise<void>;
  completeStyleAnalysis(job: StyleAnalysisJob, workerId: string, analysis: DesignStyleAnalysisV1, analysisSha256: string): Promise<void>;
  failStyleAnalysis(job: StyleAnalysisJob, workerId: string, errorCode: string, retryable: boolean): Promise<void>;
}

function invalid(): never { throw new Error("design_style_analysis_claim_invalid"); }

export function parseStyleAnalysisJob(value: unknown): StyleAnalysisJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const keys = ["jobId", "workspaceId", "brandId", "designStyleId", "styleRevision", "leaseToken", "leaseExpiresAt", "images"];
  if (Object.keys(row).some((key) => !keys.includes(key))) invalid();
  for (const key of ["jobId", "workspaceId", "brandId", "designStyleId", "leaseToken"] as const) {
    if (typeof row[key] !== "string" || !UUID.test(row[key] as string)) invalid();
  }
  if (!Number.isSafeInteger(row.styleRevision) || Number(row.styleRevision) < 1
    || typeof row.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(row.leaseExpiresAt))
    || !Array.isArray(row.images) || row.images.length < 1 || row.images.length > 5) invalid();
  const images = row.images.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const image = value as Record<string, unknown>;
    const imageKeys = ["referenceItemId", "storageUrl", "storagePath", "mimeType", "sizeBytes", "checksum"];
    if (Object.keys(image).some((key) => !imageKeys.includes(key))
      || typeof image.referenceItemId !== "string" || !UUID.test(image.referenceItemId)
      || typeof image.storageUrl !== "string" || !/^https:\/\//.test(image.storageUrl)
      || typeof image.storagePath !== "string" || !image.storagePath
      || typeof image.mimeType !== "string" || !IMAGE_MIME.has(image.mimeType.toLowerCase())
      || !Number.isSafeInteger(image.sizeBytes) || Number(image.sizeBytes) < 1 || Number(image.sizeBytes) > 5 * 1024 * 1024
      || typeof image.checksum !== "string" || !SHA256.test(image.checksum)) invalid();
    return {
      referenceItemId: image.referenceItemId.toLowerCase(), storageUrl: image.storageUrl,
      storagePath: image.storagePath, mimeType: image.mimeType.toLowerCase() as StyleAnalysisJob["images"][number]["mimeType"],
      sizeBytes: Number(image.sizeBytes), checksum: image.checksum,
    };
  });
  if (new Set(images.map(({ referenceItemId }) => referenceItemId)).size !== images.length) invalid();
  return {
    jobId: String(row.jobId).toLowerCase(), workspaceId: String(row.workspaceId).toLowerCase(),
    brandId: String(row.brandId).toLowerCase(), designStyleId: String(row.designStyleId).toLowerCase(),
    styleRevision: Number(row.styleRevision), leaseToken: String(row.leaseToken).toLowerCase(),
    leaseExpiresAt: String(row.leaseExpiresAt), images,
  };
}

export function parseStyleAnalysisResult(value: unknown): DesignStyleAnalysisV1 {
  return parseDesignStyleAnalysisV1(value);
}
