import {
  parseBrandIntelligenceResultV2,
  toBrandIntelligenceCommonView,
  type BrandIntelligenceCommonView,
  type BrandIntelligenceResult,
  type BrandIntelligenceResultV2,
  type BrandIntelligenceValidationRegistry,
  type BrandOfferingV2,
} from "./brandIntelligenceV2Contracts.js";

export {
  toBrandIntelligenceCommonView,
  type BrandIntelligenceCommonView,
  type BrandIntelligenceResult,
  type BrandIntelligenceResultV2,
  type BrandIntelligenceValidationRegistry,
  type BrandOfferingV2,
};

export type BrandAnalysisStatus =
  | "queued"
  | "extracting"
  | "analyzing"
  | "accepting_uploads"
  | "waiting_for_resource"
  | "running"
  | "finalizing"
  | "review_ready"
  | "confirmed"
  | "failed"
  | "cancel_requested"
  | "purging"
  | "cancelled";

export type BrandEvidenceSourceType = "owned_url" | "text" | "markdown" | "pdf" | "csv" | "xlsx";

export interface BrandEvidenceDocument {
  sourceId: string;
  sourceType: BrandEvidenceSourceType;
  title: string;
  sourceUrl: string | null;
  textBlocks: Array<{ heading: string | null; text: string }>;
  tables: Array<{ sheet: string | null; headers: string[]; rows: string[][] }>;
  contentHash: string;
}

export interface BrandIntelligenceResultV1 {
  contractVersion: "brand-intelligence-result.v1";
  companyOverview: string;
  businessDescription: string;
  primaryCategory: { code: string | null; name: string };
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string;
  differentiators: string;
  coreAppeal: string;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  evidence: Array<{ field: string; claim: string; sourceId: string; sourceUrl: string | null }>;
  sourceGaps: string[];
}

export interface BrandIntelligenceInputV1 {
  contractVersion: "brand-intelligence.v1";
  brand: { id: string; name: string };
  documents: BrandEvidenceDocument[];
  researchPolicy: {
    publicWebSearch: true;
    purposes: ["competitors", "market_context"];
    requireSourceUrl: true;
  };
}

export interface CreateBrandAnalysisInput {
  companyName?: string;
  ownedUrl: string | null;
  uploadIds: string[];
  uploads?: Array<{
    fileName: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
  }>;
  idempotencyKey: string;
}

export interface EditBrandAnalysisInput { editedResult: BrandIntelligenceResult }
export interface BrandAnalysisWorkerClaimInput {
  workerId: string;
  leaseSeconds: number;
  supportedPipelineVersions: number[];
}
export interface BrandAnalysisWorkerLeaseInput {
  workerId: string;
  leaseSeconds: number;
  leaseToken: string;
}

const LIMITS = {
  narrative: 4_000,
  short: 300,
  list: 50,
  documents: 25,
  textBlocks: 200,
  tables: 30,
  rows: 500,
  cells: 100,
  cell: 2_000,
} as const;

function fail(code: string): never { throw new Error(code); }

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function strictObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  const source = object(value, code);
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, max: number = LIMITS.narrative, allowEmpty = false): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) fail(code);
  return normalized;
}

function nullableText(value: unknown, code: string, max: number = LIMITS.short): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, code, max);
}

function list<T>(value: unknown, code: string, parser: (item: unknown) => T, max: number = LIMITS.list): T[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value.map(parser);
}

function httpsUrl(value: unknown, code: string): string {
  const normalized = text(value, code, 2_048);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
  } catch { fail(code); }
  return normalized;
}

function nullableHttpsUrl(value: unknown, code: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return httpsUrl(value, code);
}

function leaseSeconds(value: unknown): number {
  const parsed = value === undefined ? 300 : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 30 || Number(parsed) > 900) {
    fail("brand_analysis_lease_seconds_invalid");
  }
  return Number(parsed);
}

export function parseCreateBrandAnalysisInput(value: unknown): CreateBrandAnalysisInput {
  const source = strictObject(
    value,
    ["companyName", "ownedUrl", "uploadIds", "uploads", "idempotencyKey"],
    "brand_analysis_create_input_invalid",
  );
  let companyName: string | undefined;
  if (Object.hasOwn(source, "companyName")) {
    if (typeof source.companyName !== "string" || !source.companyName.trim()) {
      fail("brand_analysis_company_name_required");
    }
    companyName = source.companyName.normalize("NFKC").trim();
    if (Array.from(companyName).length > 100
      || /[\u0000-\u001f\u007f]/.test(companyName)) {
      fail("brand_analysis_company_name_invalid");
    }
  }
  const ownedUrl = nullableHttpsUrl(source.ownedUrl, "brand_analysis_owned_url_invalid");
  const uploadIds = list(
    source.uploadIds ?? [],
    "brand_analysis_upload_limit_exceeded",
    (item) => text(item, "brand_analysis_upload_id_invalid", 200),
    5,
  );
  const uploads = list(
    source.uploads ?? [],
    "brand_analysis_upload_limit_exceeded",
    (item) => {
      const upload = strictObject(
        item,
        ["fileName", "mimeType", "byteSize", "checksum"],
        "brand_analysis_upload_invalid",
      );
      const byteSize = Number(upload.byteSize);
      if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > 10 * 1024 * 1024) {
        fail("brand_analysis_file_too_large");
      }
      const checksum = text(upload.checksum, "brand_analysis_checksum_invalid", 64);
      if (!/^[a-f0-9]{64}$/i.test(checksum)) fail("brand_analysis_checksum_invalid");
      return {
        fileName: text(upload.fileName, "brand_analysis_file_name_invalid", 160),
        mimeType: text(upload.mimeType, "brand_analysis_file_type_invalid", 200),
        byteSize,
        checksum: checksum.toLowerCase(),
      };
    },
    5,
  );
  if (uploadIds.length && uploads.length) fail("brand_analysis_upload_input_invalid");
  if (uploads.reduce((total, upload) => total + upload.byteSize, 0) > 25 * 1024 * 1024) {
    fail("brand_analysis_upload_total_too_large");
  }
  if (!ownedUrl && uploadIds.length === 0 && uploads.length === 0) {
    fail("brand_analysis_source_required");
  }
  return {
    ...(companyName ? { companyName } : {}),
    ownedUrl,
    uploadIds,
    ...(uploads.length ? { uploads } : {}),
    idempotencyKey: text(source.idempotencyKey, "brand_analysis_idempotency_key_invalid", 200),
  };
}

function category(value: unknown, code: string): { code: string | null; name: string } {
  const source = strictObject(value, ["code", "name"], code);
  return {
    code: nullableText(source.code, code, 200),
    name: text(source.name, code, 300),
  };
}

function parseResult(value: unknown): BrandIntelligenceResultV1 {
  const source = strictObject(value, [
    "contractVersion", "companyOverview", "businessDescription", "primaryCategory",
    "subcategories", "primaryTarget", "differentiators", "coreAppeal", "competitors",
    "evidence", "sourceGaps",
  ], "brand_intelligence_result_invalid");
  if (source.contractVersion !== "brand-intelligence-result.v1") {
    fail("brand_intelligence_result_version_invalid");
  }
  const competitors = list(source.competitors, "brand_intelligence_competitors_invalid", (item) => {
    const entry = strictObject(item, ["name", "description", "sourceUrls"], "brand_intelligence_competitor_invalid");
    const sourceUrls = list(
      entry.sourceUrls,
      "brand_intelligence_competitor_invalid",
      (url) => httpsUrl(url, "brand_intelligence_competitor_invalid"),
      10,
    );
    if (sourceUrls.length === 0) fail("brand_intelligence_competitor_invalid");
    return {
      name: text(entry.name, "brand_intelligence_competitor_invalid", 300),
      description: text(entry.description, "brand_intelligence_competitor_invalid"),
      sourceUrls,
    };
  }, 20);
  const evidence = list(source.evidence, "brand_intelligence_evidence_invalid", (item) => {
    const entry = strictObject(item, ["field", "claim", "sourceId", "sourceUrl"], "brand_intelligence_evidence_invalid");
    return {
      field: text(entry.field, "brand_intelligence_evidence_invalid", 100),
      claim: text(entry.claim, "brand_intelligence_evidence_invalid"),
      sourceId: text(entry.sourceId, "brand_intelligence_evidence_invalid", 200),
      sourceUrl: nullableHttpsUrl(entry.sourceUrl, "brand_intelligence_evidence_invalid"),
    };
  }, 100);
  return {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: text(source.companyOverview, "brand_intelligence_company_overview_invalid"),
    businessDescription: text(source.businessDescription, "brand_intelligence_business_description_invalid"),
    primaryCategory: category(source.primaryCategory, "brand_intelligence_primary_category_invalid"),
    subcategories: list(
      source.subcategories,
      "brand_intelligence_subcategories_invalid",
      (item) => category(item, "brand_intelligence_subcategory_invalid"),
      20,
    ),
    primaryTarget: text(source.primaryTarget, "brand_intelligence_primary_target_invalid"),
    differentiators: text(source.differentiators, "brand_intelligence_differentiators_invalid"),
    coreAppeal: text(source.coreAppeal, "brand_intelligence_core_appeal_invalid"),
    competitors,
    evidence,
    sourceGaps: list(
      source.sourceGaps,
      "brand_intelligence_source_gaps_invalid",
      (item) => text(item, "brand_intelligence_source_gaps_invalid"),
      LIMITS.list,
    ),
  };
}

export function parseBrandIntelligenceResult(
  value: unknown,
  registry?: BrandIntelligenceValidationRegistry,
): BrandIntelligenceResult {
  if (value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).contractVersion === "brand-intelligence-result.v2") {
    return parseBrandIntelligenceResultV2(value, registry);
  }
  return parseResult(value);
}

export function parseEditBrandAnalysisInput(value: unknown): EditBrandAnalysisInput {
  const source = strictObject(value, ["editedResult"], "brand_analysis_edit_input_invalid");
  return { editedResult: parseBrandIntelligenceResult(source.editedResult) };
}

function sourceType(value: unknown): BrandEvidenceSourceType {
  if (value !== "owned_url" && value !== "text" && value !== "markdown"
    && value !== "pdf" && value !== "csv" && value !== "xlsx") {
    fail("brand_intelligence_document_source_type_invalid");
  }
  return value;
}

function document(value: unknown): BrandEvidenceDocument {
  const source = strictObject(
    value,
    ["sourceId", "sourceType", "title", "sourceUrl", "textBlocks", "tables", "contentHash"],
    "brand_intelligence_document_invalid",
  );
  const textBlocks = list(source.textBlocks, "brand_intelligence_text_blocks_invalid", (item) => {
    const block = strictObject(item, ["heading", "text"], "brand_intelligence_text_block_invalid");
    return {
      heading: nullableText(block.heading, "brand_intelligence_text_block_invalid", 500),
      text: text(block.text, "brand_intelligence_text_block_invalid", 20_000),
    };
  }, LIMITS.textBlocks);
  const tables = list(source.tables, "brand_intelligence_tables_invalid", (item) => {
    const table = strictObject(item, ["sheet", "headers", "rows"], "brand_intelligence_table_invalid");
    const headers = list(table.headers, "brand_intelligence_table_invalid", (cell) => (
      text(cell, "brand_intelligence_table_invalid", LIMITS.cell, true)
    ), LIMITS.cells);
    const rows = list(table.rows, "brand_intelligence_table_invalid", (row) => (
      list(row, "brand_intelligence_table_invalid", (cell) => (
        text(cell, "brand_intelligence_table_invalid", LIMITS.cell, true)
      ), LIMITS.cells)
    ), LIMITS.rows);
    return {
      sheet: nullableText(table.sheet, "brand_intelligence_table_invalid", 300),
      headers,
      rows,
    };
  }, LIMITS.tables);
  const contentHash = text(source.contentHash, "brand_intelligence_content_hash_invalid", 64);
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) fail("brand_intelligence_content_hash_invalid");
  return {
    sourceId: text(source.sourceId, "brand_intelligence_document_invalid", 200),
    sourceType: sourceType(source.sourceType),
    title: text(source.title, "brand_intelligence_document_invalid", 500),
    sourceUrl: nullableHttpsUrl(source.sourceUrl, "brand_intelligence_document_url_invalid"),
    textBlocks,
    tables,
    contentHash: contentHash.toLowerCase(),
  };
}

export function parseBrandEvidenceDocuments(value: unknown): BrandEvidenceDocument[] {
  return list(
    value,
    "brand_intelligence_documents_invalid",
    document,
    LIMITS.documents,
  );
}

export function parseBrandIntelligenceInput(value: unknown): BrandIntelligenceInputV1 {
  const source = strictObject(
    value,
    ["contractVersion", "brand", "documents", "researchPolicy"],
    "brand_intelligence_input_invalid",
  );
  if (source.contractVersion !== "brand-intelligence.v1") fail("brand_intelligence_contract_version_invalid");
  const brand = strictObject(source.brand, ["id", "name"], "brand_intelligence_brand_invalid");
  const policy = strictObject(
    source.researchPolicy,
    ["publicWebSearch", "purposes", "requireSourceUrl"],
    "brand_intelligence_research_policy_invalid",
  );
  if (policy.publicWebSearch !== true || policy.requireSourceUrl !== true
    || !Array.isArray(policy.purposes)
    || policy.purposes.join("|") !== "competitors|market_context") {
    fail("brand_intelligence_research_policy_invalid");
  }
  const documents = list(
    source.documents,
    "brand_intelligence_documents_invalid",
    document,
    LIMITS.documents,
  );
  if (documents.length === 0) fail("brand_intelligence_documents_invalid");
  return {
    contractVersion: "brand-intelligence.v1",
    brand: {
      id: text(brand.id, "brand_intelligence_brand_invalid", 200),
      name: text(brand.name, "brand_intelligence_brand_invalid", 300),
    },
    documents,
    researchPolicy: {
      publicWebSearch: true,
      purposes: ["competitors", "market_context"],
      requireSourceUrl: true,
    },
  };
}

export function parseBrandAnalysisWorkerClaimInput(value: unknown): BrandAnalysisWorkerClaimInput {
  const source = strictObject(
    value,
    ["workerId", "leaseSeconds", "supportedPipelineVersions"],
    "brand_analysis_worker_claim_invalid",
  );
  const rawVersions = source.supportedPipelineVersions ?? [1];
  if (!Array.isArray(rawVersions) || rawVersions.length < 1 || rawVersions.length > 2) {
    fail("brand_analysis_pipeline_versions_invalid");
  }
  const supportedPipelineVersions = [...new Set(rawVersions.map((version) => {
    if (!Number.isSafeInteger(version) || Number(version) < 1 || Number(version) > 2) {
      fail("brand_analysis_pipeline_versions_invalid");
    }
    return Number(version);
  }))];
  return {
    workerId: text(source.workerId, "brand_analysis_worker_id_invalid", 200),
    leaseSeconds: leaseSeconds(source.leaseSeconds),
    supportedPipelineVersions,
  };
}

export function parseBrandAnalysisWorkerLeaseInput(value: unknown): BrandAnalysisWorkerLeaseInput {
  const source = strictObject(
    value,
    ["workerId", "leaseToken", "leaseSeconds"],
    "brand_analysis_worker_lease_invalid",
  );
  return {
    workerId: text(source.workerId, "brand_analysis_worker_id_invalid", 200),
    leaseToken: text(source.leaseToken, "brand_analysis_lease_token_invalid", 200),
    leaseSeconds: leaseSeconds(source.leaseSeconds),
  };
}
