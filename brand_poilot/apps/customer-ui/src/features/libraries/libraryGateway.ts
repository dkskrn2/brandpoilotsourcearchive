import { put as putBlob } from "@vercel/blob/client";
import { ApiRequestError, apiClient } from "../../lib/apiClient";
import type { ReferenceItem } from "../../types";

export interface ProductServiceProfile {
  contractVersion: "product-service.v1";
  name: string;
  kind: "product" | "service";
  description: string;
  features: string[];
  benefits: string[];
  cautions: string[];
  audiences: Array<Record<string, unknown>>;
  appealsByTarget: Record<string, Array<Record<string, unknown>>>;
  evergreenPurchaseInfo: string;
  sourceUrls: string[];
}

export interface ProductServiceVersion {
  id: string;
  workspaceId: string;
  brandId: string;
  productServiceId: string;
  sourceAnalysisId: string | null;
  version: number;
  status: "draft" | "approved" | "superseded";
  profile: ProductServiceProfile;
  evidence: unknown[];
  approvedAt: string | null;
  updatedAt: string;
}

export interface ProductServiceItem {
  id: string;
  workspaceId: string;
  brandId: string;
  kind: "product" | "service";
  displayName: string;
  status: "active" | "archived";
  activeVersionId: string | null;
  activeVersion: ProductServiceVersion | null;
  draft: ProductServiceVersion | null;
}

export type ManualWikiItemType = "faq" | "policy" | "how_to" | "guide";
export type WikiBuildStatus =
  | "idle"
  | "draft"
  | "inactive"
  | "pending"
  | "building"
  | "active"
  | "stale"
  | "failed";

export interface WikiItem {
  id: string;
  workspaceId: string;
  brandId: string;
  itemType: ManualWikiItemType | "product" | "service";
  title: string;
  content: string;
  status: "draft" | "active" | "inactive" | "read_only";
  origin: "manual" | "import" | "product_service";
  provenance: Record<string, unknown>;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  sourceKind: "faq" | "product_service" | "service" | "policy" | "guide";
  sourceId: string;
  activeVersionId: string | null;
  lastBuiltAt: string | null;
  buildStatus: WikiBuildStatus;
}

export interface WikiIssue {
  id: string;
  workspaceId: string;
  brandId: string;
  issueType: string;
  severity: "info" | "warning" | "error";
  status: "open" | "pending_build" | "resolved" | "dismissed";
  question: string | null;
  detail: Record<string, unknown>;
  sourceKind: "faq" | "product_service" | "service" | "policy" | "guide" | "owned_snapshot" | null;
  sourceId: string | null;
  activeVersionId: string | null;
  lastBuiltAt: string | null;
  buildStatus: WikiBuildStatus;
  resolvedAt: string | null;
}

export interface AvatarImage {
  id: string;
  position: number;
  representative: boolean;
  storagePath: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export interface Avatar {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  description: string;
  isDefault: boolean;
  status: "active" | "archived";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  images: AvatarImage[];
}

export interface CreateAvatarInput {
  avatarId: string;
  name: string;
  description: string;
  imageSessionIds: string[];
  representativeSessionId: string;
}

export interface CreateWikiItemInput {
  contractVersion: "wiki-item.v1";
  itemType: ManualWikiItemType;
  title: string;
  content: string;
  provenance: Record<string, unknown>;
}

export interface UpdateWikiItemInput {
  title?: string;
  content?: string;
  status?: "draft" | "active" | "inactive";
}

export interface ResolveWikiIssueInput {
  sourceKind: "faq" | "policy" | "guide" | "product_service" | "owned_snapshot";
  sourceId: string;
}

export type LibraryErrorKind =
  | "unavailable"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "validation"
  | "retryable"
  | "unknown";

const unavailableCodes = new Set([
  "product_library_not_configured",
  "wiki_management_not_configured",
  "asset_library_not_configured",
  "asset_library_upload_storage_not_configured",
  "brand_center_not_configured",
]);

export function classifyLibraryError(
  error: unknown,
  target: "collection" | "item" = "item",
): LibraryErrorKind {
  if (error instanceof ApiRequestError) {
    if (error.errorCode && unavailableCodes.has(error.errorCode)) return "unavailable";
    if (error.status === 404 && target === "collection") return "unavailable";
    if (error.status === 404 || error.errorCode?.endsWith("_not_found")) return "not_found";
    if (error.status === 401 || error.status === 403 || error.errorCode?.includes("forbidden")) return "forbidden";
    if (error.status === 409 || error.errorCode?.includes("conflict")) return "conflict";
    if (error.status === 400 || error.status === 422 || error.errorCode?.includes("validation_failed")) return "validation";
    if (error.status >= 500) return "retryable";
  }
  if (error instanceof TypeError) return "retryable";
  return "unknown";
}

type Client = Pick<ReturnType<typeof apiClient>, "requestJson">;

async function fileBytes(file: File, signal?: AbortSignal, onProgress: (value: number) => void = () => undefined) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    signal?.addEventListener("abort", abort, { once: true });
    reader.onerror = () => reject(reader.error ?? new Error("avatar_file_read_failed"));
    reader.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 90));
    };
    reader.onload = () => {
      signal?.removeEventListener("abort", abort);
      resolve(reader.result as ArrayBuffer);
    };
    reader.readAsArrayBuffer(file);
  });
}

async function sha256(file: File, signal?: AbortSignal, onProgress: (value: number) => void = () => undefined) {
  onProgress(0);
  const digest = await crypto.subtle.digest("SHA-256", await fileBytes(file, signal, onProgress));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  onProgress(100);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export const REFERENCE_UPLOAD_POLICY = Object.freeze({
  "image/png": 5 * 1024 * 1024,
  "image/jpeg": 5 * 1024 * 1024,
  "image/webp": 5 * 1024 * 1024,
  "application/pdf": 10 * 1024 * 1024,
  "text/plain": 5 * 1024 * 1024,
  "text/markdown": 5 * 1024 * 1024,
  "text/csv": 5 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 10 * 1024 * 1024,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 10 * 1024 * 1024,
});

function validateReferenceFile(file: File) {
  const mimeType = file.type.toLowerCase();
  const maximum = REFERENCE_UPLOAD_POLICY[mimeType as keyof typeof REFERENCE_UPLOAD_POLICY];
  if (maximum === undefined) throw new Error("reference_upload_mime_invalid");
  if (file.size <= 0 || file.size > maximum) throw new Error("reference_upload_size_invalid");
  return mimeType;
}

export function createLibraryGateway(client: Client = apiClient(), blobPut: typeof putBlob = putBlob) {
  return {
    listProductServices(brandId: string) {
      return client.requestJson<ProductServiceItem[]>(`/brands/${brandId}/product-services`, { method: "GET" });
    },
    getProductService(brandId: string, itemId: string) {
      return client.requestJson<ProductServiceItem>(`/brands/${brandId}/product-services/${itemId}`, { method: "GET" });
    },
    createProductService(brandId: string, profile: ProductServiceProfile) {
      return client.requestJson<ProductServiceItem>(`/brands/${brandId}/product-services`, {
        method: "POST",
        body: JSON.stringify(profile),
      });
    },
    createProductServiceFromAnalysis(brandId: string, analysisId: string) {
      return client.requestJson<ProductServiceItem>(
        `/brands/${brandId}/product-services/from-analysis/${analysisId}`,
        { method: "POST" },
      );
    },
    updateProductServiceDraft(brandId: string, itemId: string, profile: ProductServiceProfile) {
      return client.requestJson<ProductServiceItem>(
        `/brands/${brandId}/product-services/${itemId}/draft`,
        { method: "PATCH", body: JSON.stringify(profile) },
      );
    },
    approveProductService(brandId: string, itemId: string) {
      return client.requestJson<ProductServiceItem>(
        `/brands/${brandId}/product-services/${itemId}/approve`,
        { method: "POST" },
      );
    },
    archiveProductService(brandId: string, itemId: string) {
      return client.requestJson<void>(
        `/brands/${brandId}/product-services/${itemId}/archive`,
        { method: "POST" },
      );
    },
    listWikiItems(brandId: string) {
      return client.requestJson<WikiItem[]>(`/brands/${brandId}/wiki/items`, { method: "GET" });
    },
    createWikiItem(brandId: string, input: CreateWikiItemInput) {
      return client.requestJson<WikiItem>(`/brands/${brandId}/wiki/items`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateWikiItem(brandId: string, itemId: string, input: UpdateWikiItemInput) {
      return client.requestJson<WikiItem>(`/brands/${brandId}/wiki/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    listWikiIssues(brandId: string) {
      return client.requestJson<WikiIssue[]>(`/brands/${brandId}/wiki/issues`, { method: "GET" });
    },
    resolveWikiIssue(brandId: string, issueId: string, input: ResolveWikiIssueInput) {
      return client.requestJson<WikiIssue>(`/brands/${brandId}/wiki/issues/${issueId}/resolve`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    listAvatars(brandId: string) {
      return client.requestJson<Avatar[]>(`/brands/${brandId}/avatars`, { method: "GET" });
    },
    createAvatar(brandId: string, input: CreateAvatarInput) {
      return client.requestJson<Avatar>(`/brands/${brandId}/avatars`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateAvatar(brandId: string, avatarId: string, input: Pick<CreateAvatarInput, "name" | "description">) {
      return client.requestJson<Avatar>(`/brands/${brandId}/avatars/${avatarId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    hashAvatarImage(file: File, signal?: AbortSignal, onProgress?: (value: number) => void) {
      return sha256(file, signal, onProgress);
    },
    async uploadAvatarImage(
      brandId: string,
      avatarId: string,
      file: File,
      options: ((value: number) => void) | {
        checksum?: string;
        signal?: AbortSignal;
        onProgress?: (value: number) => void;
        onSession?: (sessionId: string) => void;
      } = () => undefined,
    ) {
      const config = typeof options === "function" ? { onProgress: options } : options;
      const onProgress = config.onProgress ?? (() => undefined);
      const metadata = {
        fileName: file.name,
        mimeType: file.type.toLowerCase(),
        sizeBytes: file.size,
        checksum: config.checksum ?? await sha256(file, config.signal),
      };
      onProgress(10);
      const token = await client.requestJson<{
        pathname: string;
        clientToken: string;
        sessionId: string;
        nonce: string;
        expiresAt: string;
      }>(`/brands/${brandId}/avatars/${avatarId}/images/upload-token`, {
        method: "POST",
        body: JSON.stringify(metadata),
        ...(config.signal ? { signal: config.signal } : {}),
      });
      config.onSession?.(token.sessionId);
      const stored = await blobPut(token.pathname, file, {
        access: "public",
        token: token.clientToken,
        contentType: metadata.mimeType,
        abortSignal: config.signal,
        onUploadProgress: ({ percentage }) => onProgress(10 + Math.round(percentage * 0.6)),
      });
      onProgress(70);
      await client.requestJson(`/brands/${brandId}/avatars/${avatarId}/images/confirm`, {
        method: "POST",
        body: JSON.stringify({
          ...metadata,
          sessionId: token.sessionId,
          nonce: token.nonce,
          storagePath: token.pathname,
          storageUrl: stored.url,
          representative: false,
        }),
        ...(config.signal ? { signal: config.signal } : {}),
      });
      onProgress(100);
      return { sessionId: token.sessionId };
    },
    cancelAvatarUpload(brandId: string, avatarId: string, sessionId: string) {
      return client.requestJson<
        { status: "cleanup_pending"; immediateCleanup: "succeeded" | "retry_scheduled" | "already_pending" }
        | { status: "already_cancelled" }
      >(
        `/brands/${brandId}/avatars/${avatarId}/images/upload-sessions/${sessionId}`,
        { method: "DELETE" },
      );
    },
    hashReferenceFile(file: File, signal?: AbortSignal, onProgress?: (value: number) => void) {
      validateReferenceFile(file);
      return sha256(file, signal, onProgress);
    },
    async uploadReferenceFile(
      brandId: string,
      file: File,
      options: {
        checksum?: string;
        signal?: AbortSignal;
        onProgress?: (value: number) => void;
        onSession?: (sessionId: string) => void;
      } = {},
    ) {
      const mimeType = validateReferenceFile(file);
      const onProgress = options.onProgress ?? (() => undefined);
      const metadata = {
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        checksum: options.checksum ?? await sha256(file, options.signal),
      };
      onProgress(10);
      const token = await client.requestJson<{
        pathname: string;
        clientToken: string;
        sessionId: string;
        nonce: string;
        expiresAt: string;
      }>(`/brands/${brandId}/references/upload-token`, {
        method: "POST",
        body: JSON.stringify(metadata),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      options.onSession?.(token.sessionId);
      const stored = await blobPut(token.pathname, file, {
        access: "public",
        token: token.clientToken,
        contentType: metadata.mimeType,
        abortSignal: options.signal,
        onUploadProgress: ({ percentage }) => onProgress(10 + Math.round(percentage * 0.6)),
      });
      onProgress(70);
      const reference = await client.requestJson<ReferenceItem>(`/brands/${brandId}/references/confirm`, {
        method: "POST",
        body: JSON.stringify({
          ...metadata,
          sessionId: token.sessionId,
          nonce: token.nonce,
          storagePath: token.pathname,
          storageUrl: stored.url,
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      onProgress(100);
      return { sessionId: token.sessionId, reference };
    },
    cancelReferenceUpload(brandId: string, sessionId: string) {
      return client.requestJson<
        { status: "cleanup_pending"; immediateCleanup: "succeeded" | "retry_scheduled" | "already_pending" }
        | { status: "already_cancelled" }
      >(
        `/brands/${brandId}/references/upload-sessions/${sessionId}`,
        { method: "DELETE" },
      );
    },
    deleteAvatarImage(brandId: string, avatarId: string, imageId: string) {
      return client.requestJson<void>(`/brands/${brandId}/avatars/${avatarId}/images/${imageId}`, {
        method: "DELETE",
      });
    },
    setDefaultAvatar(brandId: string, avatarId: string) {
      return client.requestJson<Avatar>(`/brands/${brandId}/avatars/${avatarId}/default`, {
        method: "POST",
      });
    },
    archiveAvatar(brandId: string, avatarId: string) {
      return client.requestJson<void>(`/brands/${brandId}/avatars/${avatarId}/archive`, {
        method: "POST",
      });
    },
  };
}

export type LibraryGateway = ReturnType<typeof createLibraryGateway>;
export const libraryGateway = createLibraryGateway();
