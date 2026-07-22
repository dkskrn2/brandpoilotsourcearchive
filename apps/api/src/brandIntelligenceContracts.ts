export type BrandAnalysisStatus =
  | "queued"
  | "extracting"
  | "analyzing"
  | "review_ready"
  | "confirmed"
  | "failed";

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
  ownedUrl: string | null;
  uploadIds: string[];
  idempotencyKey: string;
}

export interface EditBrandAnalysisInput { editedResult: BrandIntelligenceResultV1 }
export interface BrandAnalysisWorkerClaimInput { workerId: string; leaseSeconds: number }
export interface BrandAnalysisWorkerLeaseInput extends BrandAnalysisWorkerClaimInput { leaseToken: string }

const LIMITS = {
  narrative: 4_000,
  short: 300,
  list: 50,
  documents: 6,
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
    ["ownedUrl", "uploadIds", "idempotencyKey"],
    "brand_analysis_create_input_invalid",
  );
  const ownedUrl = nullableHttpsUrl(source.ownedUrl, "brand_analysis_owned_url_invalid");
  const uploadIds = list(
    source.uploadIds ?? [],
    "brand_analysis_upload_limit_exceeded",
    (item) => text(item, "brand_analysis_upload_id_invalid", 200),
    5,
  );
  if (!ownedUrl && uploadIds.length === 0) fail("brand_analysis_source_required");
  return {
    ownedUrl,
    uploadIds,
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

export function parseBrandIntelligenceResult(value: unknown): BrandIntelligenceResultV1 {
  return parseResult(value);
}

export function parseEditBrandAnalysisInput(value: unknown): EditBrandAnalysisInput {
  const source = strictObject(value, ["editedResult"], "brand_analysis_edit_input_invalid");
  return { editedResult: parseResult(source.editedResult) };
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
  const source = strictObject(value, ["workerId", "leaseSeconds"], "brand_analysis_worker_claim_invalid");
  return {
    workerId: text(source.workerId, "brand_analysis_worker_id_invalid", 200),
    leaseSeconds: leaseSeconds(source.leaseSeconds),
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
