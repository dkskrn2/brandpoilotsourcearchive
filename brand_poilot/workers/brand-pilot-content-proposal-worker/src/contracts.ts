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

export interface ContentProposalJob {
  id: string;
  workspaceId: string;
  brandId: string;
  batchId: string;
  status: "processing";
  request: ContentProposalRequestV1;
  sourceSnapshots: FrozenSourceSnapshot[];
  attemptCount: number;
  maxAttempts: number;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  availableAt: string;
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
  complete(job: ContentProposalJob, proposals: ContentProposalV1[]): Promise<void>;
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
const families = ["informational", "marketing"] as const;
const formats = ["card_news", "blog", "single_image", "channel_text"] as const;
const channels = ["instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export"] as const;
const strategies = [
  "problem_solution", "how_to", "comparison", "faq", "insight",
  "benefit", "social_proof", "brand_story", "cta",
] as const;

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

export function parseContentProposalJob(value: unknown): ContentProposalJob {
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

function parseProposal(value: unknown, job: ContentProposalJob): ContentProposalV1 {
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

export function parseContentProposalResult(value: unknown, job: ContentProposalJob): ContentProposalV1[] {
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
