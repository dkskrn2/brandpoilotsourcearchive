import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedProductSnapshotV2,
  ContentChannelTargetV2,
  ContentOutputFormatV2,
  ContentProposalV2,
  ContentPurposeV2,
  FrozenReferenceSnapshotV2,
  ResearchEvidenceSnapshotV1,
} from "@brand-pilot/worker-runtime";

export type {
  ContentProposalV2,
  ResearchEvidenceSnapshotV1,
};

type ProposalSubjectV2 =
  | { kind: "topic_text"; title: string }
  | {
    kind: "topic_url";
    requestedUrl: string;
    canonicalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    capturedAt: string;
  }
  | { kind: "reference"; referenceIds: string[] };

export type ContentFamily = "informational" | "marketing";
export type OutputFormat = "card_news" | "blog" | "single_image" | "channel_text";
export type ContentChannelTarget =
  | "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok" | "blog_export";
export type MessageStrategy =
  | "problem_solution" | "how_to" | "comparison" | "faq" | "insight"
  | "benefit" | "social_proof" | "brand_story" | "cta";

export interface ContentProposalRequestV1 {
  contractVersion: "content-proposal-request.v1";
  contentFamily: ContentFamily;
  subjectInput: Record<string, unknown>;
  channelTargets: ContentChannelTarget[];
  outputFormats: OutputFormat[];
  sourceSnapshotIds: string[];
  performanceSnapshotIds: string[];
  performanceEvidence: Array<{
    snapshotId: string;
    channelOutputId: string;
    snapshotDate: string;
    metrics: Record<string, unknown>;
    collectedAt: string;
  }>;
}

export interface FrozenSourceSnapshot {
  sourceId: string;
  url: string;
  crawledAt: string;
  contentHash: string;
  summary: string;
}

interface ContentProposalJobBase {
  id: string;
  workspaceId: string;
  brandId: string;
  batchId: string;
  status: "processing";
  attemptCount: number;
  maxAttempts: number;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  availableAt: string;
}

export interface ContentProposalJobV1 extends ContentProposalJobBase {
  request: ContentProposalRequestV1;
  sourceSnapshots: FrozenSourceSnapshot[];
}

export interface ContentProposalRequestV2 {
  contractVersion: "content-proposal-request.v2";
  purpose: ContentPurposeV2;
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelTargetV2];
  requestFingerprint: string;
}

export interface ProposalBaseInputSnapshotV2 {
  contractVersion: "proposal-base-input.v2";
  brandCore: ApprovedBrandCoreSnapshotV2;
  subject: ProposalSubjectV2;
  contentInstruction: string | null;
  product: ApprovedProductSnapshotV2 | null;
  references: FrozenReferenceSnapshotV2[];
  outputSettings: {
    outputFormat: ContentOutputFormatV2;
    channelTargets: [ContentChannelTargetV2];
    aspectRatio: "1:1" | "4:5" | "16:9" | "9:16" | null;
    outputCount: 1;
    purpose: ContentPurposeV2;
  };
  capturedAt: string;
}

export interface ProposalInputSnapshotV2 extends Omit<ProposalBaseInputSnapshotV2, "contractVersion"> {
  contractVersion: "proposal-input.v2";
  researchEvidence: ResearchEvidenceSnapshotV1;
}

export interface ContentProposalJobV2 extends ContentProposalJobBase {
  request: ContentProposalRequestV2;
  sourceSnapshots: [];
  inputSnapshot: ProposalBaseInputSnapshotV2 | ProposalInputSnapshotV2;
  researchEvidence?: ResearchEvidenceSnapshotV1;
}

export type ContentProposalJob = ContentProposalJobV1 | ContentProposalJobV2;

export interface ContentProposalSetV2 {
  contractVersion: "content-proposal.v2";
  proposals: [ContentProposalV2, ContentProposalV2, ContentProposalV2];
}

export interface ContentProposalV1 {
  contractVersion: "content-proposal.v1";
  title: string;
  reasonToCreateNow: string;
  contentFamily: ContentFamily;
  topic: string;
  target: Record<string, unknown>;
  messageStrategy: MessageStrategy;
  hook: string;
  keyMessage: string;
  evidence: Array<{ sourceSnapshotId: string; summary: string }>;
  outline: Array<{ heading: string; purpose: string }>;
  outputFormat: OutputFormat;
  channelTargets: ContentChannelTarget[];
  recommendedReferenceQuery: {
    strategies: MessageStrategy[];
    formats: OutputFormat[];
    tags: string[];
  };
}

export interface ContentProposalWorkerClient {
  heartbeatWorker(workerId: string): Promise<void>;
  claim(workerId: string, leaseSeconds: number): Promise<ContentProposalJob | null>;
  heartbeat(job: ContentProposalJob, leaseSeconds: number): Promise<void>;
  completeResearch(
    job: ContentProposalJobV2,
    evidence: ResearchEvidenceSnapshotV1,
  ): Promise<ProposalInputSnapshotV2>;
  complete(
    job: ContentProposalJob,
    proposals: ContentProposalV1[] | ContentProposalSetV2,
  ): Promise<void>;
  fail(job: ContentProposalJob, input: {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  }): Promise<void>;
}

export class ContentProposalContractError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "ContentProposalContractError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256 = /^[0-9a-f]{64}$/i;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const families = ["informational", "marketing"] as const;
const formats = ["card_news", "blog", "single_image", "channel_text"] as const;
const channels = ["instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export"] as const;
const strategies = [
  "problem_solution", "how_to", "comparison", "faq", "insight",
  "benefit", "social_proof", "brand_story", "cta",
] as const;
const v2Formats = ["card_news", "blog", "reel", "marketing_content"] as const;
const v2Axes = ["target", "situation", "question", "appeal", "narrative", "informational_type"] as const;
const informationalTypes = [
  "problem_solution", "how_to", "checklist", "comparison", "trend_insight", "q_and_a", "myth_fact",
] as const;
const v2Ratios = ["1:1", "4:5", "16:9", "9:16"] as const;
const referenceRoles = ["planning", "copy_pattern", "visual_composition"] as const;

function fail(code: string): never {
  throw new ContentProposalContractError(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  const source = record(value, code);
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, max = 2_000): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
}

function textAllowEmpty(value: unknown, code: string, max = 2_000): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (normalized.length > max) fail(code);
  return normalized;
}

function uuid(value: unknown, code: string): string {
  const normalized = text(value, code, 36);
  if (!UUID.test(normalized)) fail(code);
  return normalized.toLowerCase();
}

function timestamp(value: unknown, code: string): string {
  const normalized = text(value, code, 50);
  if (Number.isNaN(Date.parse(normalized))) fail(code);
  return normalized;
}

function utcTimestamp(value: unknown, code: string): string {
  const normalized = text(value, code, 40);
  const match = UTC_TIMESTAMP.exec(normalized);
  if (!match) fail(code);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0").slice(0, 3));
  const parsed = new Date(normalized);
  if (year === 0
    || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
    || parsed.getUTCSeconds() !== second
    || parsed.getUTCMilliseconds() !== millisecond) fail(code);
  return normalized;
}

function sha256(value: unknown, code: string): string {
  const normalized = text(value, code, 64);
  if (!SHA_256.test(normalized)) fail(code);
  return normalized.toLowerCase();
}

function integer(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(code);
  return Number(value);
}

function uniqueStrings<T extends string>(
  value: unknown,
  allowed: readonly T[] | null,
  code: string,
  maximum = 50,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) fail(code);
  const parsed = value.map((item) => text(item, code, 500) as T);
  if (new Set(parsed).size !== parsed.length || (allowed && parsed.some((item) => !allowed.includes(item)))) {
    fail(code);
  }
  return parsed;
}

function boundedStrings(
  value: unknown,
  code: string,
  minimum: number,
  maximum: number,
  itemMaximum = 2_000,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(code);
  return value.map((item) => text(item, code, itemMaximum));
}

function unique<T>(values: readonly T[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

function nullableText(value: unknown, code: string, max = 2_000): string | null {
  if (value === null) return null;
  return text(value, code, max);
}

function parseBrandCore(value: unknown): ApprovedBrandCoreSnapshotV2 {
  const code = "content_proposal_job_invalid";
  const source = exact(value, [
    "versionId", "companyOverview", "businessDescription", "primaryCategory",
    "detailedCategory", "primaryTarget", "differentiator", "coreAppeal",
  ], code);
  return {
    versionId: uuid(source.versionId, code),
    companyOverview: text(source.companyOverview, code, 10_000),
    businessDescription: text(source.businessDescription, code, 10_000),
    primaryCategory: text(source.primaryCategory, code, 500),
    detailedCategory: text(source.detailedCategory, code, 500),
    primaryTarget: text(source.primaryTarget, code, 2_000),
    differentiator: text(source.differentiator, code, 4_000),
    coreAppeal: text(source.coreAppeal, code, 4_000),
  };
}

function httpUrl(value: unknown, code: string): string {
  const normalized = text(value, code, 2_000);
  try {
    if (!["http:", "https:"].includes(new URL(normalized).protocol)) fail(code);
  } catch { fail(code); }
  return normalized;
}

function parseSubject(value: unknown): ProposalSubjectV2 {
  const code = "content_proposal_job_invalid";
  const source = record(value, code);
  if (source.kind === "topic_text") {
    const exactSource = exact(source, ["kind", "title"], code);
    return { kind: "topic_text", title: text(exactSource.title, code, 500) };
  }
  if (source.kind === "topic_url") {
    const exactSource = exact(source, [
      "kind", "requestedUrl", "canonicalUrl", "title", "text", "contentHash", "capturedAt",
    ], code);
    return {
      kind: "topic_url",
      requestedUrl: httpUrl(exactSource.requestedUrl, code),
      canonicalUrl: httpUrl(exactSource.canonicalUrl, code),
      title: nullableText(exactSource.title, code, 500),
      text: text(exactSource.text, code, 50_000),
      contentHash: sha256(exactSource.contentHash, code),
      capturedAt: utcTimestamp(exactSource.capturedAt, code),
    };
  }
  const exactSource = exact(source, ["kind", "referenceIds"], code);
  if (exactSource.kind !== "reference") fail(code);
  const referenceIds = boundedStrings(exactSource.referenceIds, code, 1, 5, 100)
    .map((id) => uuid(id, code));
  unique(referenceIds, code);
  return { kind: "reference", referenceIds };
}

function parseProduct(value: unknown): ApprovedProductSnapshotV2 | null {
  if (value === null) return null;
  const code = "content_proposal_job_invalid";
  const source = exact(value, [
    "id", "versionId", "kind", "name", "description", "features", "benefits", "cautions",
    "evergreenPurchaseInfo", "images",
  ], code);
  if (source.kind !== "product" && source.kind !== "service") fail(code);
  if (!Array.isArray(source.images) || source.images.length > 20) fail(code);
  const images = source.images.map((value) => {
    const image = exact(value, [
      "assetId", "role", "storageUrl", "storagePath", "mimeType", "checksum",
    ], code);
    if (image.role !== "hero" && image.role !== "detail") fail(code);
    const role: "hero" | "detail" = image.role;
    const mimeType = text(image.mimeType, code, 100);
    if (!mimeType.startsWith("image/")) fail(code);
    return {
      assetId: uuid(image.assetId, code), role,
      storageUrl: httpUrl(image.storageUrl, code), storagePath: text(image.storagePath, code, 2_000),
      mimeType, checksum: sha256(image.checksum, code),
    };
  });
  unique(images.map((image) => image.assetId), code);
  return {
    id: uuid(source.id, code),
    versionId: uuid(source.versionId, code),
    kind: source.kind,
    name: text(source.name, code, 500),
    description: text(source.description, code, 10_000),
    features: boundedStrings(source.features, code, 0, 50),
    benefits: boundedStrings(source.benefits, code, 0, 50),
    cautions: boundedStrings(source.cautions, code, 0, 50),
    evergreenPurchaseInfo: textAllowEmpty(source.evergreenPurchaseInfo, code, 4_000),
    images,
  };
}

function parseReferences(value: unknown): FrozenReferenceSnapshotV2[] {
  const code = "content_proposal_job_invalid";
  if (!Array.isArray(value) || value.length > 5) fail(code);
  const parsed = value.map((item) => {
    const source = exact(item, [
      "referenceItemId", "snapshotId", "roles", "title", "sourceUrl", "capturedAt",
      "contentHash", "text", "image",
    ], code);
    const roles = uniqueStrings(source.roles, referenceRoles, code, 3);
    if (roles.length === 0) fail(code);
    let image: FrozenReferenceSnapshotV2["image"] = null;
    if (source.image !== null) {
      const rawImage = exact(source.image, ["storageUrl", "storagePath", "mimeType", "checksum"], code);
      if (!["image/png", "image/jpeg", "image/webp"].includes(String(rawImage.mimeType))) fail(code);
      image = {
        storageUrl: httpUrl(rawImage.storageUrl, code), storagePath: text(rawImage.storagePath, code, 2_000),
        mimeType: rawImage.mimeType as "image/png" | "image/jpeg" | "image/webp",
        checksum: sha256(rawImage.checksum, code),
      };
    }
    return {
      referenceItemId: uuid(source.referenceItemId, code), snapshotId: uuid(source.snapshotId, code), roles,
      title: text(source.title, code, 500), sourceUrl: httpUrl(source.sourceUrl, code),
      capturedAt: utcTimestamp(source.capturedAt, code), contentHash: sha256(source.contentHash, code),
      text: text(source.text, code, 50_000), image,
    };
  });
  unique(parsed.map((item) => item.referenceItemId), code);
  return parsed;
}

function parseResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  const code = "content_proposal_job_invalid";
  const source = exact(value, ["contractVersion", "decision", "reason", "queries", "capturedAt", "items"], code);
  if (source.contractVersion !== "research-evidence.v1"
    || (source.decision !== "searched" && source.decision !== "not_needed")
    || !Array.isArray(source.items) || source.items.length > 8) fail(code);
  const queries = boundedStrings(source.queries, code, 0, 8, 500);
  const items = source.items.map((value) => {
    const item = exact(value, [
      "id", "title", "url", "publisher", "publishedAt", "capturedAt", "claimSummary", "contentHash",
    ], code);
    return {
      id: uuid(item.id, code), title: text(item.title, code, 500), url: httpUrl(item.url, code),
      publisher: nullableText(item.publisher, code, 500),
      publishedAt: item.publishedAt === null ? null : utcTimestamp(item.publishedAt, code),
      capturedAt: utcTimestamp(item.capturedAt, code), claimSummary: text(item.claimSummary, code, 4_000),
      contentHash: sha256(item.contentHash, code),
    };
  });
  unique(items.map((item) => item.id), code);
  if (source.decision === "not_needed" && (queries.length !== 0 || items.length !== 0)) fail(code);
  return {
    contractVersion: "research-evidence.v1", decision: source.decision,
    reason: text(source.reason, code, 4_000), queries, capturedAt: utcTimestamp(source.capturedAt, code), items,
  };
}

function parseV2InputSnapshot(value: unknown): ProposalBaseInputSnapshotV2 | ProposalInputSnapshotV2 {
  const code = "content_proposal_job_invalid";
  const source = record(value, code);
  const composed = source.contractVersion === "proposal-input.v2";
  if (!composed && source.contractVersion !== "proposal-base-input.v2") fail(code);
  const exactSource = exact(source, [
    "contractVersion", "brandCore", "subject", "contentInstruction", "product", "references",
    ...(composed ? ["researchEvidence"] : []), "outputSettings", "capturedAt",
  ], code);
  const settings = exact(exactSource.outputSettings, [
    "outputFormat", "channelTargets", "aspectRatio", "outputCount", "purpose",
  ], code);
  if (!v2Formats.includes(settings.outputFormat as ContentOutputFormatV2)
    || !families.includes(settings.purpose as ContentPurposeV2)
    || !Array.isArray(settings.channelTargets) || settings.channelTargets.length !== 1
    || !channels.includes(settings.channelTargets[0] as ContentChannelTarget)
    || settings.outputCount !== 1
    || (settings.aspectRatio !== null && !v2Ratios.includes(settings.aspectRatio as never))) fail(code);
  const outputFormat = settings.outputFormat as ContentOutputFormatV2;
  const channelTarget = settings.channelTargets[0] as ContentChannelTargetV2;
  if ((outputFormat === "blog") !== (channelTarget === "blog_export")
    || (outputFormat === "blog" && settings.aspectRatio !== null)
    || (outputFormat === "reel" && settings.aspectRatio !== "9:16")
    || (outputFormat !== "blog" && settings.aspectRatio === null)) fail(code);
  const product = parseProduct(exactSource.product);
  if ((settings.purpose === "informational" && product !== null)
    || (settings.purpose === "marketing" && product === null)) fail(code);
  const references = parseReferences(exactSource.references);
  const subject = parseSubject(exactSource.subject);
  if (subject.kind === "reference") {
    const frozen = new Set(references.map((reference) => reference.referenceItemId));
    if (subject.referenceIds.some((id) => !frozen.has(id))) fail(code);
  }
  const researchEvidence = composed ? parseResearchEvidence(exactSource.researchEvidence) : undefined;
  if (settings.purpose === "informational" && researchEvidence
    && (researchEvidence.decision !== "searched" || researchEvidence.items.length === 0)) fail(code);
  const base = {
    brandCore: parseBrandCore(exactSource.brandCore), subject,
    contentInstruction: nullableText(exactSource.contentInstruction, code, 4_000), product, references,
    outputSettings: {
      outputFormat,
      channelTargets: [channelTarget] as [ContentChannelTargetV2],
      aspectRatio: settings.aspectRatio as ProposalBaseInputSnapshotV2["outputSettings"]["aspectRatio"],
      outputCount: 1 as const, purpose: settings.purpose as ContentPurposeV2,
    }, capturedAt: utcTimestamp(exactSource.capturedAt, code),
  };
  return composed
    ? { contractVersion: "proposal-input.v2", ...base, researchEvidence: researchEvidence! }
    : { contractVersion: "proposal-base-input.v2", ...base };
}

export function parseProposalInputSnapshotV2(value: unknown): ProposalInputSnapshotV2 {
  const snapshot = parseV2InputSnapshot(value);
  if (snapshot.contractVersion !== "proposal-input.v2") fail("content_proposal_job_invalid");
  return snapshot;
}

function parseV2Request(value: unknown): ContentProposalRequestV2 {
  const code = "content_proposal_job_invalid";
  const source = exact(value, [
    "contractVersion", "purpose", "outputFormat", "channelTargets", "requestFingerprint",
  ], code);
  if (source.contractVersion !== "content-proposal-request.v2"
    || !families.includes(source.purpose as ContentPurposeV2)
    || !v2Formats.includes(source.outputFormat as ContentOutputFormatV2)
    || !Array.isArray(source.channelTargets) || source.channelTargets.length !== 1
    || !channels.includes(source.channelTargets[0] as ContentChannelTarget)) fail(code);
  return {
    contractVersion: "content-proposal-request.v2", purpose: source.purpose as ContentPurposeV2,
    outputFormat: source.outputFormat as ContentOutputFormatV2,
    channelTargets: [source.channelTargets[0] as ContentChannelTargetV2],
    requestFingerprint: text(source.requestFingerprint, code, 500),
  };
}

function parseRequest(value: unknown): ContentProposalRequestV1 {
  const source = exact(value, [
    "contractVersion", "contentFamily", "subjectInput", "channelTargets", "outputFormats",
    "sourceSnapshotIds", "performanceSnapshotIds", "performanceEvidence",
  ], "content_proposal_job_invalid");
  if (source.contractVersion !== "content-proposal-request.v1"
    || !families.includes(source.contentFamily as ContentFamily)) {
    fail("content_proposal_job_invalid");
  }
  const sourceSnapshotIds = uniqueStrings(source.sourceSnapshotIds, null, "content_proposal_job_invalid");
  const performanceSnapshotIds = uniqueStrings(
    source.performanceSnapshotIds,
    null,
    "content_proposal_job_invalid",
  );
  if (!Array.isArray(source.performanceEvidence)
    || source.performanceEvidence.length !== performanceSnapshotIds.length) {
    fail("content_proposal_job_snapshot_mismatch");
  }
  const performanceEvidence = source.performanceEvidence.map((item) => {
    const evidence = exact(item, [
      "snapshotId", "channelOutputId", "snapshotDate", "metrics", "collectedAt",
    ], "content_proposal_job_invalid");
    return {
      snapshotId: text(evidence.snapshotId, "content_proposal_job_invalid"),
      channelOutputId: text(evidence.channelOutputId, "content_proposal_job_invalid"),
      snapshotDate: text(evidence.snapshotDate, "content_proposal_job_invalid", 50),
      metrics: record(evidence.metrics, "content_proposal_job_invalid"),
      collectedAt: timestamp(evidence.collectedAt, "content_proposal_job_invalid"),
    };
  });
  if (new Set(performanceEvidence.map(({ snapshotId }) => snapshotId)).size !== performanceEvidence.length
    || performanceEvidence.some(({ snapshotId }) => !performanceSnapshotIds.includes(snapshotId))) {
    fail("content_proposal_job_snapshot_mismatch");
  }
  return {
    contractVersion: "content-proposal-request.v1",
    contentFamily: source.contentFamily as ContentFamily,
    subjectInput: record(source.subjectInput, "content_proposal_job_invalid"),
    channelTargets: uniqueStrings(source.channelTargets, channels, "content_proposal_job_invalid"),
    outputFormats: uniqueStrings(source.outputFormats, formats, "content_proposal_job_invalid"),
    sourceSnapshotIds,
    performanceSnapshotIds,
    performanceEvidence,
  };
}

function parseContentProposalJobV1(value: unknown): ContentProposalJobV1 {
  const source = exact(value, [
    "id", "workspaceId", "brandId", "batchId", "status", "request", "sourceSnapshots",
    "attemptCount", "maxAttempts", "workerId", "leaseToken", "leaseExpiresAt", "availableAt",
  ], "content_proposal_job_invalid");
  if (source.status !== "processing") fail("content_proposal_job_invalid");
  const request = parseRequest(source.request);
  if (!Array.isArray(source.sourceSnapshots)) fail("content_proposal_job_invalid");
  const sourceSnapshots = source.sourceSnapshots.map((item) => {
    const snapshot = exact(
      item,
      ["sourceId", "url", "crawledAt", "contentHash", "summary"],
      "content_proposal_job_invalid",
    );
    return {
      sourceId: text(snapshot.sourceId, "content_proposal_job_invalid"),
      url: text(snapshot.url, "content_proposal_job_invalid"),
      crawledAt: timestamp(snapshot.crawledAt, "content_proposal_job_invalid"),
      contentHash: text(snapshot.contentHash, "content_proposal_job_invalid"),
      summary: typeof snapshot.summary === "string"
        ? snapshot.summary.slice(0, 20_000)
        : fail("content_proposal_job_invalid"),
    };
  });
  const frozenIds = sourceSnapshots.map(({ sourceId }) => sourceId);
  if (new Set(frozenIds).size !== frozenIds.length
    || request.sourceSnapshotIds.length !== frozenIds.length
    || request.sourceSnapshotIds.some((id) => !frozenIds.includes(id))) {
    fail("content_proposal_job_snapshot_mismatch");
  }
  const attemptCount = integer(source.attemptCount, "content_proposal_job_invalid");
  const maxAttempts = integer(source.maxAttempts, "content_proposal_job_invalid");
  if (attemptCount < 1 || maxAttempts < attemptCount) fail("content_proposal_job_invalid");
  return {
    id: uuid(source.id, "content_proposal_job_invalid"),
    workspaceId: uuid(source.workspaceId, "content_proposal_job_invalid"),
    brandId: uuid(source.brandId, "content_proposal_job_invalid"),
    batchId: uuid(source.batchId, "content_proposal_job_invalid"),
    status: "processing",
    request,
    sourceSnapshots,
    attemptCount,
    maxAttempts,
    workerId: text(source.workerId, "content_proposal_job_invalid", 200),
    leaseToken: uuid(source.leaseToken, "content_proposal_job_invalid"),
    leaseExpiresAt: timestamp(source.leaseExpiresAt, "content_proposal_job_invalid"),
    availableAt: timestamp(source.availableAt, "content_proposal_job_invalid"),
  };
}

function parseContentProposalJobV2(value: unknown): ContentProposalJobV2 {
  const sourceRecord = record(value, "content_proposal_job_invalid");
  const composed = record(sourceRecord.inputSnapshot, "content_proposal_job_invalid").contractVersion
    === "proposal-input.v2";
  const source = exact(value, [
    "id", "workspaceId", "brandId", "batchId", "status", "request", "sourceSnapshots",
    "inputSnapshot", ...(composed ? ["researchEvidence"] : []),
    "attemptCount", "maxAttempts", "workerId", "leaseToken", "leaseExpiresAt", "availableAt",
  ], "content_proposal_job_invalid");
  if (source.status !== "processing" || !Array.isArray(source.sourceSnapshots)
    || source.sourceSnapshots.length !== 0) fail("content_proposal_job_invalid");
  const request = parseV2Request(source.request);
  const inputSnapshot = parseV2InputSnapshot(source.inputSnapshot);
  if (inputSnapshot.outputSettings.purpose !== request.purpose
    || inputSnapshot.outputSettings.outputFormat !== request.outputFormat
    || inputSnapshot.outputSettings.channelTargets[0] !== request.channelTargets[0]) {
    fail("content_proposal_job_snapshot_mismatch");
  }
  let researchEvidence: ResearchEvidenceSnapshotV1 | undefined;
  if (inputSnapshot.contractVersion === "proposal-input.v2") {
    researchEvidence = parseResearchEvidence(source.researchEvidence);
    if (JSON.stringify(researchEvidence) !== JSON.stringify(inputSnapshot.researchEvidence)) {
      fail("content_proposal_job_snapshot_mismatch");
    }
    if (request.purpose === "informational"
      && (researchEvidence.decision !== "searched" || researchEvidence.items.length === 0)) {
      fail("content_proposal_job_snapshot_mismatch");
    }
  }
  const attemptCount = integer(source.attemptCount, "content_proposal_job_invalid");
  const maxAttempts = integer(source.maxAttempts, "content_proposal_job_invalid");
  if (attemptCount < 1 || maxAttempts < attemptCount) fail("content_proposal_job_invalid");
  return {
    id: uuid(source.id, "content_proposal_job_invalid"),
    workspaceId: uuid(source.workspaceId, "content_proposal_job_invalid"),
    brandId: uuid(source.brandId, "content_proposal_job_invalid"),
    batchId: uuid(source.batchId, "content_proposal_job_invalid"),
    status: "processing", request, sourceSnapshots: [], inputSnapshot,
    ...(researchEvidence ? { researchEvidence } : {}),
    attemptCount, maxAttempts,
    workerId: text(source.workerId, "content_proposal_job_invalid", 200),
    leaseToken: uuid(source.leaseToken, "content_proposal_job_invalid"),
    leaseExpiresAt: utcTimestamp(source.leaseExpiresAt, "content_proposal_job_invalid"),
    availableAt: utcTimestamp(source.availableAt, "content_proposal_job_invalid"),
  };
}

export function parseContentProposalJob(value: unknown): ContentProposalJob {
  const source = record(value, "content_proposal_job_invalid");
  const request = record(source.request, "content_proposal_job_invalid");
  if (request.contractVersion === "content-proposal-request.v1") return parseContentProposalJobV1(value);
  if (request.contractVersion === "content-proposal-request.v2") return parseContentProposalJobV2(value);
  fail("content_proposal_job_invalid");
}

function parseProposal(value: unknown, job: ContentProposalJobV1): ContentProposalV1 {
  const source = exact(value, [
    "contractVersion", "title", "reasonToCreateNow", "contentFamily", "topic", "target",
    "messageStrategy", "hook", "keyMessage", "evidence", "outline", "outputFormat",
    "channelTargets", "recommendedReferenceQuery",
  ], "content_proposal_result_invalid");
  if (source.contractVersion !== "content-proposal.v1"
    || source.contentFamily !== job.request.contentFamily
    || !strategies.includes(source.messageStrategy as MessageStrategy)
    || !job.request.outputFormats.includes(source.outputFormat as OutputFormat)) {
    fail("content_proposal_result_invalid");
  }
  if (!Array.isArray(source.evidence) || !Array.isArray(source.outline) || source.outline.length === 0) {
    fail("content_proposal_result_invalid");
  }
  const evidence = source.evidence.map((item) => {
    const entry = exact(item, ["sourceSnapshotId", "summary"], "content_proposal_result_invalid");
    const sourceSnapshotId = text(entry.sourceSnapshotId, "content_proposal_result_invalid");
    if (!job.request.sourceSnapshotIds.includes(sourceSnapshotId)) fail("content_proposal_result_invalid");
    return {
      sourceSnapshotId,
      summary: text(entry.summary, "content_proposal_result_invalid"),
    };
  });
  const outline = source.outline.map((item) => {
    const entry = exact(item, ["heading", "purpose"], "content_proposal_result_invalid");
    return {
      heading: text(entry.heading, "content_proposal_result_invalid", 500),
      purpose: text(entry.purpose, "content_proposal_result_invalid"),
    };
  });
  const referenceQuery = exact(
    source.recommendedReferenceQuery,
    ["strategies", "formats", "tags"],
    "content_proposal_result_invalid",
  );
  const channelTargets = uniqueStrings(
    source.channelTargets,
    channels,
    "content_proposal_result_invalid",
  );
  if (channelTargets.length === 0
    || channelTargets.some((channel) => !job.request.channelTargets.includes(channel))) {
    fail("content_proposal_result_invalid");
  }
  return {
    contractVersion: "content-proposal.v1",
    title: text(source.title, "content_proposal_result_invalid", 500),
    reasonToCreateNow: text(source.reasonToCreateNow, "content_proposal_result_invalid"),
    contentFamily: job.request.contentFamily,
    topic: text(source.topic, "content_proposal_result_invalid", 500),
    target: record(source.target, "content_proposal_result_invalid"),
    messageStrategy: source.messageStrategy as MessageStrategy,
    hook: text(source.hook, "content_proposal_result_invalid"),
    keyMessage: text(source.keyMessage, "content_proposal_result_invalid"),
    evidence,
    outline,
    outputFormat: source.outputFormat as OutputFormat,
    channelTargets,
    recommendedReferenceQuery: {
      strategies: uniqueStrings(referenceQuery.strategies, strategies, "content_proposal_result_invalid"),
      formats: uniqueStrings(referenceQuery.formats, formats, "content_proposal_result_invalid"),
      tags: uniqueStrings(referenceQuery.tags, null, "content_proposal_result_invalid"),
    },
  };
}

export function parseContentProposalResult(value: unknown, job: ContentProposalJobV1): ContentProposalV1[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
    fail("content_proposal_result_invalid");
  }
  const proposals = value.map((item) => parseProposal(item, job));
  const fingerprints = proposals.map(({ title, topic, messageStrategy, hook, keyMessage, outputFormat }) => (
    JSON.stringify([title, topic, messageStrategy, hook, keyMessage, outputFormat])
  ));
  if (new Set(fingerprints).size !== proposals.length) fail("content_proposal_result_not_distinct");
  return proposals;
}

export function isContentProposalJobV2(job: ContentProposalJob): job is ContentProposalJobV2 {
  return job.request.contractVersion === "content-proposal-request.v2";
}

function parseV2Proposal(value: unknown, job: ContentProposalJobV2): ContentProposalV2 {
  if (job.inputSnapshot.contractVersion !== "proposal-input.v2") fail("content_proposal_result_invalid");
  const code = "content_proposal_result_invalid";
  const source = exact(value, [
    "conceptKey", "title", "informationalType", "oneLineIntent", "differentiator",
    "differentiationAxes", "target", "customerContext", "keyMessage", "hook",
    "selectionReason", "evidenceIds", "referenceIds", "outputFormat", "channelTargets",
    "assetCount", "outline", "purposeDetails",
  ], code);
  if (source.outputFormat !== job.inputSnapshot.outputSettings.outputFormat
    || !Array.isArray(source.channelTargets) || source.channelTargets.length !== 1
    || source.channelTargets[0] !== job.inputSnapshot.outputSettings.channelTargets[0]
    || !Array.isArray(source.outline) || source.outline.length === 0) fail(code);
  const evidenceIds = uniqueStrings(source.evidenceIds, null, code, 8).map((id) => uuid(id, code));
  const allowedEvidenceIds = new Set(job.inputSnapshot.researchEvidence.items.map((item) => item.id));
  if (evidenceIds.some((id) => !allowedEvidenceIds.has(id))) fail(code);
  const referenceIds = uniqueStrings(source.referenceIds, null, code, 5).map((id) => uuid(id, code));
  const allowedReferenceIds = new Set(job.inputSnapshot.references.map((item) => item.referenceItemId));
  if (referenceIds.some((id) => !allowedReferenceIds.has(id))) fail(code);
  const axes = uniqueStrings(source.differentiationAxes, v2Axes, code, v2Axes.length);
  if (axes.length === 0) fail(code);
  const outline = source.outline.map((value, offset) => {
    const item = exact(value, ["index", "role", "headline", "purpose"], code);
    if (item.index !== offset + 1) fail(code);
    return {
      index: offset + 1, role: text(item.role, code, 200), headline: text(item.headline, code, 500),
      purpose: text(item.purpose, code, 2_000),
    };
  });
  let assetCount: number | null;
  if (source.outputFormat === "blog") {
    if (source.assetCount !== null) fail(code);
    assetCount = null;
  } else {
    if (!Number.isSafeInteger(source.assetCount) || Number(source.assetCount) < 1
      || Number(source.assetCount) > 5 || Number(source.assetCount) !== outline.length) fail(code);
    assetCount = Number(source.assetCount);
  }
  const details = record(source.purposeDetails, code);
  let purposeDetails: ContentProposalV2["purposeDetails"];
  let informationalType: ContentProposalV2["informationalType"];
  if (job.inputSnapshot.outputSettings.purpose === "informational") {
    const parsed = exact(details, ["kind", "question", "value", "whyNow", "learningPoints"], code);
    if (parsed.kind !== "informational"
      || !informationalTypes.includes(source.informationalType as never)) fail(code);
    const learningPoints = uniqueStrings(parsed.learningPoints, null, code, 20);
    if (learningPoints.length === 0) fail(code);
    informationalType = source.informationalType as ContentProposalV2["informationalType"];
    purposeDetails = {
      kind: "informational", question: text(parsed.question, code), value: text(parsed.value, code),
      whyNow: text(parsed.whyNow, code), learningPoints,
    };
  } else {
    const parsed = exact(details, [
      "kind", "campaignObjective", "situationAndNeed", "productId", "targetSegment",
      "strengths", "limitations", "appeal", "buyingBarriers", "cta",
    ], code);
    if (parsed.kind !== "marketing" || source.informationalType !== null
      || !job.inputSnapshot.product || uuid(parsed.productId, code) !== job.inputSnapshot.product.id) fail(code);
    const strengths = uniqueStrings(parsed.strengths, null, code, 20);
    const limitations = uniqueStrings(parsed.limitations, null, code, 20);
    const buyingBarriers = uniqueStrings(parsed.buyingBarriers, null, code, 20);
    if (strengths.length === 0 || limitations.length === 0 || buyingBarriers.length === 0) fail(code);
    informationalType = null;
    purposeDetails = {
      kind: "marketing", campaignObjective: text(parsed.campaignObjective, code),
      situationAndNeed: text(parsed.situationAndNeed, code), productId: job.inputSnapshot.product.id,
      targetSegment: text(parsed.targetSegment, code), strengths, limitations,
      appeal: text(parsed.appeal, code), buyingBarriers, cta: text(parsed.cta, code),
    };
  }
  return {
    conceptKey: text(source.conceptKey, code, 200), title: text(source.title, code, 500), informationalType,
    oneLineIntent: text(source.oneLineIntent, code), differentiator: text(source.differentiator, code),
    differentiationAxes: axes, target: text(source.target, code),
    customerContext: text(source.customerContext, code), keyMessage: text(source.keyMessage, code),
    hook: text(source.hook, code), selectionReason: text(source.selectionReason, code), evidenceIds,
    referenceIds, outputFormat: source.outputFormat as ContentOutputFormatV2,
    channelTargets: [source.channelTargets[0] as ContentChannelTargetV2], assetCount, outline, purposeDetails,
  };
}

function sortedSet(value: readonly string[]): string {
  return JSON.stringify([...value].sort());
}

function substantiveFingerprint(proposal: ContentProposalV2): string {
  return JSON.stringify({
    informationalType: proposal.informationalType,
    target: proposal.target,
    customerContext: proposal.customerContext,
    keyMessage: proposal.keyMessage,
    hook: proposal.hook,
    evidenceIds: [...proposal.evidenceIds].sort(),
    referenceIds: [...proposal.referenceIds].sort(),
    assetCount: proposal.assetCount,
    outline: proposal.outline,
    purposeDetails: proposal.purposeDetails,
  });
}

function proposalDifferentiationValue(
  proposal: ContentProposalV2,
  axis: ContentProposalV2["differentiationAxes"][number],
): string | null {
  switch (axis) {
    case "target":
      return proposal.target;
    case "situation":
      return proposal.customerContext;
    case "question":
      return proposal.purposeDetails.kind === "informational"
        ? proposal.purposeDetails.question
        : proposal.hook;
    case "appeal":
      return proposal.purposeDetails.kind === "marketing"
        ? proposal.purposeDetails.appeal
        : proposal.keyMessage;
    case "narrative":
      return JSON.stringify({
        oneLineIntent: proposal.oneLineIntent,
        hook: proposal.hook,
        outline: proposal.outline,
      });
    case "informational_type":
      return proposal.informationalType;
  }
}

function validateSubstantiveDifferentiation(proposals: ContentProposalV2[]): void {
  for (let leftIndex = 0; leftIndex < proposals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < proposals.length; rightIndex += 1) {
      const left = proposals[leftIndex];
      const right = proposals[rightIndex];
      if (!left || !right) fail("content_proposal_result_not_distinct");
      const declaredAxes = new Set([...left.differentiationAxes, ...right.differentiationAxes]);
      const differs = [...declaredAxes].some((axis) => (
        proposalDifferentiationValue(left, axis) !== proposalDifferentiationValue(right, axis)
      ));
      if (!differs) fail("content_proposal_result_not_distinct");
    }
  }
}

export function parseContentProposalSetV2(
  value: unknown,
  job: ContentProposalJobV2,
): ContentProposalSetV2 {
  const source = exact(value, ["contractVersion", "proposals"], "content_proposal_result_invalid");
  if (source.contractVersion !== "content-proposal.v2"
    || !Array.isArray(source.proposals) || source.proposals.length !== 3) {
    fail("content_proposal_result_invalid");
  }
  const proposals = source.proposals.map((proposal) => parseV2Proposal(proposal, job));
  if (new Set(proposals.map((proposal) => proposal.conceptKey)).size !== 3
    || new Set(proposals.map(substantiveFingerprint)).size !== 3) {
    fail("content_proposal_result_not_distinct");
  }
  validateSubstantiveDifferentiation(proposals);
  const evidenceSets = new Set(proposals.map((proposal) => sortedSet(proposal.evidenceIds)));
  const referenceSets = new Set(proposals.map((proposal) => sortedSet(proposal.referenceIds)));
  if (evidenceSets.size !== 1 || referenceSets.size !== 1) fail("content_proposal_result_invalid");
  return {
    contractVersion: "content-proposal.v2",
    proposals: proposals as [ContentProposalV2, ContentProposalV2, ContentProposalV2],
  };
}
