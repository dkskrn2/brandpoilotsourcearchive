export interface ProductImageImportJob {
  id: string;
  workspaceId: string;
  brandId: string;
  productServiceId: string;
  versionId: string;
  requestedByUserId: string | null;
  sourceUrls: string[];
  attemptCount: number;
  remainingSlots: number;
  leaseToken: string;
}

export interface ProductImageImportUploadedAsset {
  storageUrl: string;
  storagePath: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sizeBytes: number;
  checksum: string;
  sourceUrl: string;
}

export interface ProductImageImportClient {
  claim(workerId: string, leaseSeconds: number): Promise<ProductImageImportJob | null>;
  heartbeat(job: ProductImageImportJob, workerId: string, leaseSeconds: number): Promise<boolean>;
  complete(job: ProductImageImportJob, workerId: string, input: {
    images: ProductImageImportUploadedAsset[]; selectionAudit: Record<string, unknown>;
  }): Promise<{ retainedStoragePaths: string[] }>;
  fail(job: ProductImageImportJob, workerId: string, errorCode: string): Promise<void>;
}

function job(value: unknown): ProductImageImportJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("product_image_import_job_invalid");
  const source = value as Record<string, unknown>;
  const required = ["id", "workspaceId", "brandId", "productServiceId", "versionId", "requestedByUserId", "sourceUrls", "attemptCount", "remainingSlots", "leaseToken"];
  const requiredStrings = ["id", "workspaceId", "brandId", "productServiceId", "versionId", "leaseToken"];
  if (Object.keys(source).length !== required.length || Object.keys(source).some((key) => !required.includes(key))
    || requiredStrings.some((key) => typeof source[key] !== "string" || !String(source[key]).trim())
    || (source.requestedByUserId !== null && typeof source.requestedByUserId !== "string")
    || !Array.isArray(source.sourceUrls) || source.sourceUrls.length < 1 || source.sourceUrls.length > 5
    || source.sourceUrls.some((url) => typeof url !== "string" || !url.startsWith("https://"))
    || !Number.isSafeInteger(source.attemptCount) || Number(source.attemptCount) < 1
    || !Number.isSafeInteger(source.remainingSlots) || Number(source.remainingSlots) < 0 || Number(source.remainingSlots) > 5) {
    throw new Error("product_image_import_job_invalid");
  }
  return source as unknown as ProductImageImportJob;
}

export function createProductImageImportClient({ apiUrl, token, fetchImpl = fetch }: {
  apiUrl: string; token: string; fetchImpl?: typeof fetch;
}): ProductImageImportClient {
  const baseUrl = apiUrl.replace(/\/+$/, "");
  async function request(path: string, body: Record<string, unknown>) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`product_image_import_api_failed:${response.status}`);
    return response;
  }
  return {
    async claim(workerId, leaseSeconds) {
      const response = await request("/worker/product-image-import-jobs/claim", { workerId, leaseSeconds });
      const envelope = await response.json() as { job?: unknown };
      return envelope.job === null ? null : job(envelope.job);
    },
    async heartbeat(claim, workerId, leaseSeconds) {
      const response = await fetchImpl(`${baseUrl}/worker/product-image-import-jobs/${encodeURIComponent(claim.id)}/heartbeat`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ workerId, leaseToken: claim.leaseToken, leaseSeconds }),
      });
      if (response.status === 409) return false;
      if (!response.ok) throw new Error(`product_image_import_api_failed:${response.status}`);
      return true;
    },
    async complete(claim, workerId, input) {
      const response = await request(`/worker/product-image-import-jobs/${encodeURIComponent(claim.id)}/complete`, {
        workerId, leaseToken: claim.leaseToken, ...input,
      });
      const envelope = await response.json() as Record<string, unknown>;
      if (!Array.isArray(envelope.retainedStoragePaths)
        || envelope.retainedStoragePaths.some((item) => typeof item !== "string")) {
        throw new Error("product_image_import_completion_invalid");
      }
      return { retainedStoragePaths: envelope.retainedStoragePaths as string[] };
    },
    async fail(claim, workerId, errorCode) {
      await request(`/worker/product-image-import-jobs/${encodeURIComponent(claim.id)}/fail`, {
        workerId, leaseToken: claim.leaseToken, errorCode,
      });
    },
  };
}
