import { parseWikiSourceKind, type WikiSourceKind } from "./wiki.js";
import { parseFaqUtterances } from "./faqUtterancePolicy.js";

export type ManualWikiItemType = "faq" | "policy" | "how_to" | "guide";
export type WikiItemStatusChange = "draft" | "active" | "inactive";

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
  status?: WikiItemStatusChange;
  manualAliases?: string[];
  expectedUpdatedAt?: string;
}

export type ResolvableWikiSourceKind =
  | "faq"
  | "policy"
  | "guide"
  | "product_service"
  | "owned_snapshot";

export interface ResolveWikiIssueInput {
  sourceKind: ResolvableWikiSourceKind;
  sourceId: string;
}

export type WikiManagementBuildStatus =
  | "idle"
  | "draft"
  | "inactive"
  | "pending"
  | "building"
  | "active"
  | "stale"
  | "failed";

export interface WikiManagementItem {
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
  sourceKind: Exclude<WikiSourceKind, "owned_snapshot" | "product">;
  sourceId: string;
  activeVersionId: string | null;
  lastBuiltAt: string | null;
  buildStatus: WikiManagementBuildStatus;
  sourceAliases: string[];
  manualAliases: string[];
  effectiveAliases: string[];
  updatedAt: string;
}

export interface WikiManagementIssue {
  id: string;
  workspaceId: string;
  brandId: string;
  issueType: string;
  severity: "info" | "warning" | "error";
  status: "open" | "pending_build" | "resolved" | "dismissed";
  question: string | null;
  detail: Record<string, unknown>;
  sourceKind: Exclude<WikiSourceKind, "product"> | null;
  sourceId: string | null;
  activeVersionId: string | null;
  lastBuiltAt: string | null;
  buildStatus: WikiManagementBuildStatus;
  resolvedAt: string | null;
}

export interface WikiManagementSummary {
  state: "empty" | "draft" | "building" | "active" | "stale" | "failed";
  activeVersionId: string | null;
  lastBuiltAt: string | null;
  buildStatus: WikiManagementBuildStatus;
  itemCount: number;
  issueCount: number;
}

interface BrandScope {
  workspaceId: string;
  brandId: string;
}

export interface WikiManagementRepository {
  listWikiItems(scope: BrandScope): Promise<WikiManagementItem[]>;
  createWikiItem(
    scope: BrandScope & { actorUserId: string },
    input: CreateWikiItemInput,
  ): Promise<WikiManagementItem>;
  updateWikiItem(
    scope: BrandScope & { actorUserId: string; itemId: string },
    input: UpdateWikiItemInput,
  ): Promise<WikiManagementItem>;
  listWikiIssues(scope: BrandScope): Promise<WikiManagementIssue[]>;
  resolveWikiIssue(
    scope: BrandScope & { actorUserId: string; issueId: string },
    input: ResolveWikiIssueInput,
  ): Promise<WikiManagementIssue>;
  summarizeWiki(scope: BrandScope): Promise<WikiManagementSummary>;
}

const itemTypes = new Set<ManualWikiItemType>(["faq", "policy", "how_to", "guide"]);
const statuses = new Set<WikiItemStatusChange>(["draft", "active", "inactive"]);
const resolvableSourceKinds = new Set<WikiSourceKind>([
  "faq",
  "policy",
  "guide",
  "product_service",
  "owned_snapshot",
]);
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, prefix = "wiki_item_validation_failed") {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 10_000) {
    throw new Error(`${prefix}:${field}`);
  }
  return value.trim();
}

export function parseCreateWikiItem(value: unknown): CreateWikiItemInput {
  const input = record(value, "wiki_item_validation_failed:root");
  if (input.contractVersion !== "wiki-item.v1") {
    throw new Error("wiki_item_validation_failed:contractVersion");
  }
  if (typeof input.itemType !== "string" || !itemTypes.has(input.itemType as ManualWikiItemType)) {
    throw new Error("wiki_item_validation_failed:itemType");
  }
  const provenance = input.provenance === undefined
    ? {}
    : record(input.provenance, "wiki_item_validation_failed:provenance");
  return {
    contractVersion: "wiki-item.v1",
    itemType: input.itemType as ManualWikiItemType,
    title: requiredText(input.title, "title"),
    content: requiredText(input.content, "content"),
    provenance,
  };
}

export function parseUpdateWikiItem(value: unknown): UpdateWikiItemInput {
  const input = record(value, "wiki_item_validation_failed:root");
  const output: UpdateWikiItemInput = {};
  if (input.title !== undefined) output.title = requiredText(input.title, "title");
  if (input.content !== undefined) output.content = requiredText(input.content, "content");
  if (input.status !== undefined) {
    if (typeof input.status !== "string" || !statuses.has(input.status as WikiItemStatusChange)) {
      throw new Error("wiki_item_validation_failed:status");
    }
    output.status = input.status as WikiItemStatusChange;
  }
  if (input.manualAliases !== undefined) {
    output.manualAliases = parseFaqUtterances(input.manualAliases);
    if (typeof input.expectedUpdatedAt !== "string") {
      throw new Error("wiki_item_validation_failed:expectedUpdatedAt");
    }
    const timestamp = new Date(input.expectedUpdatedAt);
    if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== input.expectedUpdatedAt) {
      throw new Error("wiki_item_validation_failed:expectedUpdatedAt");
    }
    output.expectedUpdatedAt = input.expectedUpdatedAt;
  }
  if (!Object.keys(output).length) throw new Error("wiki_item_validation_failed:root");
  return output;
}

export function parseResolveWikiIssue(value: unknown): ResolveWikiIssueInput {
  const input = record(value, "wiki_issue_validation_failed:root");
  let sourceKind: WikiSourceKind;
  try {
    sourceKind = parseWikiSourceKind(input.sourceKind);
  } catch {
    throw new Error("wiki_issue_validation_failed:sourceKind");
  }
  if (!resolvableSourceKinds.has(sourceKind)) {
    throw new Error("wiki_issue_validation_failed:sourceKind");
  }
  if (typeof input.sourceId !== "string" || !uuidPattern.test(input.sourceId)) {
    throw new Error("wiki_issue_validation_failed:sourceId");
  }
  return { sourceKind: sourceKind as ResolvableWikiSourceKind, sourceId: input.sourceId };
}
