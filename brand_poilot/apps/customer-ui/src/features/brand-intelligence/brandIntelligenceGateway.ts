import { put as putBlob } from "@vercel/blob/client";
import { apiClient } from "../../lib/apiClient";
import type {
  BrandAnalysis,
  BrandIntelligenceGateway,
  BrandOnboardingContext,
} from "./types";

async function fileBytes(file: File) {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("brand_analysis_file_read_failed"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await fileBytes(file));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

const mimeTypesByExtension: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function resolveBrandAnalysisFileMimeType(file: Pick<File, "name" | "type">) {
  if (file.type.trim()) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return mimeTypesByExtension[extension] ?? "application/octet-stream";
}

export function createBrandIntelligenceGateway(
  client = apiClient(),
  blobPut: typeof putBlob = putBlob,
): BrandIntelligenceGateway {
  return {
    async getCurrent(brandId) {
      const payload = await client.requestJson<{ intelligence: BrandAnalysis | null }>(
        `/brands/${brandId}/brand-intelligence`,
        { method: "GET" },
      );
      return payload.intelligence;
    },
    async getWorkflow(brandId) {
      const payload = await client.requestJson<{ workflow: BrandAnalysis | null }>(
        `/brands/${brandId}/brand-intelligence/workflow`,
        { method: "GET" },
      );
      return payload.workflow;
    },
    getOnboarding(brandId) {
      return client.requestJson<BrandOnboardingContext>(
        `/brands/${brandId}/brand-intelligence/onboarding`,
        { method: "GET" },
      );
    },
    getAnalysis(brandId, analysisId, signal) {
      return client.requestJson(`/brands/${brandId}/brand-analyses/${analysisId}`, {
        method: "GET",
        signal,
      });
    },
    async requestAnalysis(brandId, input) {
      const files = input.files ?? [];
      const uploads = await Promise.all(files.map(async (file) => ({
        fileName: file.name,
        mimeType: resolveBrandAnalysisFileMimeType(file),
        byteSize: file.size,
        checksum: await sha256(file),
      })));
      const created = await client.requestJson<BrandAnalysis>(
        `/brands/${brandId}/brand-analyses`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(input.companyName ? { companyName: input.companyName } : {}),
            ownedUrl: input.ownedUrl,
            uploadIds: input.uploadIds ?? [],
            uploads,
            idempotencyKey: input.idempotencyKey,
          }),
        },
      );
      if (!files.length) return created;
      try {
        for (const [index, file] of files.entries()) {
          const uploadId = created.input.uploadIds[index];
          const metadata = uploads[index];
          if (!uploadId || !metadata) throw new Error("brand_analysis_upload_intent_missing");
          const token = await client.requestJson<{ pathname: string; clientToken: string }>(
            `/brands/${brandId}/brand-analyses/${created.id}/uploads/${uploadId}/token`,
            { method: "POST", body: JSON.stringify(metadata) },
          );
          const stored = await blobPut(token.pathname, file, {
            access: "public",
            token: token.clientToken,
            contentType: metadata.mimeType,
          });
          await client.requestJson(
            `/brands/${brandId}/brand-analyses/${created.id}/uploads/${uploadId}/confirm`,
            {
              method: "POST",
              body: JSON.stringify({
                ...metadata,
                storagePath: token.pathname,
                storageUrl: stored.url,
              }),
            },
          );
        }
        return await client.requestJson<BrandAnalysis>(
          `/brands/${brandId}/brand-analyses/${created.id}/start`,
          { method: "POST" },
        );
      } catch (error) {
        await client.requestJson(
          `/brands/${brandId}/brand-analyses/${created.id}/cancel`,
          { method: "POST" },
        ).catch(() => undefined);
        throw error;
      }
    },
    async uploadFile(brandId, uploadSessionId, file) {
      const checksum = await sha256(file);
      const metadata = {
        uploadSessionId,
        fileName: file.name,
        mimeType: resolveBrandAnalysisFileMimeType(file),
        byteSize: file.size,
        checksum,
      };
      const token = await client.requestJson<{ pathname: string; clientToken: string }>(
        `/brands/${brandId}/brand-intelligence/uploads/token`,
        { method: "POST", body: JSON.stringify(metadata) },
      );
      const stored = await blobPut(token.pathname, file, {
        access: "public",
        token: token.clientToken,
        contentType: metadata.mimeType,
      });
      const confirmed = await client.requestJson<{ id: string }>(
        `/brands/${brandId}/brand-intelligence/uploads/confirm`,
        {
          method: "POST",
          body: JSON.stringify({ ...metadata, storagePath: token.pathname, storageUrl: stored.url }),
        },
      );
      return confirmed.id;
    },
    updateDraft(brandId, analysisId, editedResult) {
      return client.requestJson(`/brands/${brandId}/brand-analyses/${analysisId}/draft`, {
        method: "PATCH",
        body: JSON.stringify({ editedResult }),
      });
    },
    cancel(brandId, analysisId) {
      return client.requestJson(`/brands/${brandId}/brand-analyses/${analysisId}/cancel`, {
        method: "POST",
      });
    },
    retry(brandId, analysisId) {
      return client.requestJson(`/brands/${brandId}/brand-analyses/${analysisId}/retry`, {
        method: "POST",
      });
    },
    confirm(brandId, analysisId, companyName, editedResult) {
      if (!companyName) {
        return client.requestJson(`/brands/${brandId}/brand-intelligence/analyses/${analysisId}/confirm`, {
          method: "POST",
        });
      }
      return client.requestJson(`/brands/${brandId}/brand-analyses/${analysisId}/confirm`, {
        method: "POST",
        body: JSON.stringify({ companyName, ...(editedResult ? { editedResult } : {}) }),
      });
    },
  };
}

export const brandIntelligenceGateway: BrandIntelligenceGateway = {
  getCurrent: (...args) => createBrandIntelligenceGateway().getCurrent(...args),
  getWorkflow: (...args) => createBrandIntelligenceGateway().getWorkflow(...args),
  getOnboarding: (...args) => createBrandIntelligenceGateway().getOnboarding!(...args),
  getAnalysis: (...args) => createBrandIntelligenceGateway().getAnalysis(...args),
  requestAnalysis: (...args) => createBrandIntelligenceGateway().requestAnalysis(...args),
  uploadFile: (...args) => createBrandIntelligenceGateway().uploadFile(...args),
  updateDraft: (...args) => createBrandIntelligenceGateway().updateDraft(...args),
  cancel: (...args) => createBrandIntelligenceGateway().cancel!(...args),
  retry: (...args) => createBrandIntelligenceGateway().retry!(...args),
  confirm: (...args) => createBrandIntelligenceGateway().confirm(...args),
};
