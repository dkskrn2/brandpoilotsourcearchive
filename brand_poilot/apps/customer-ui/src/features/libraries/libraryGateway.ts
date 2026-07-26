import { ApiRequestError, apiClient } from "../../lib/apiClient";

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

export function createLibraryGateway(client: Client = apiClient()) {
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
  };
}

export type LibraryGateway = ReturnType<typeof createLibraryGateway>;
export const libraryGateway = createLibraryGateway();
