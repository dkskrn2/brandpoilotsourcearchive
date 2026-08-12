import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CONTENT_PLANNER_MODEL_ID,
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  CONTENT_PROPOSAL_PROMPT_VERSION,
  RESEARCH_EVIDENCE_VERSION,
  parseContentProposalRequestV2,
  parseContentProposalSetV2 as parseCanonicalContentProposalSetV2,
  parseProposalBaseInputSnapshotV2,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
  type ContentProposalRequestV2,
  type ContentProposalSetV2,
  type ContentProposalV2,
  type ProposalBaseInputSnapshotV2,
  type ProposalInputSnapshotV2,
  type ResearchEvidenceSnapshotV1,
} from "@brand-pilot/content-contracts";

export type {
  ContentProposalRequestV2,
  ContentProposalSetV2,
  ContentProposalV2,
  ProposalBaseInputSnapshotV2,
  ProposalInputSnapshotV2,
  ResearchEvidenceSnapshotV1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_CATALOG_SHA256 = "41ac04e76adf0fd9746ea7535b36f6c1ea314ec4890253a2cd56a9f215f7cdbe";

export const CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH = fileURLToPath(import.meta.resolve(
  "@brand-pilot/content-contracts/generated/content-proposal-v2.schema.json",
));
const outputSchemaBytes = readFileSync(CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH);
export const CONTENT_PROPOSAL_OUTPUT_SCHEMA_SHA256 = createHash("sha256")
  .update(outputSchemaBytes)
  .digest("hex");
const catalogPath = fileURLToPath(import.meta.resolve(
  "@brand-pilot/content-contracts/generated/content-catalog.json",
));
const catalogBytes = readFileSync(catalogPath);
const catalogSha256 = createHash("sha256").update(catalogBytes).digest("hex");
if (catalogSha256 !== EXPECTED_CATALOG_SHA256) {
  throw new Error("content_contract_catalog_hash_mismatch");
}
const catalog = JSON.parse(catalogBytes.toString("utf8")) as {
  contractSourceHash: string;
  proposalContracts: {
    requestVersion: string;
    baseInputVersion: string;
    outputVersion: string;
    promptVersion: string;
    outputSchemaSha256: string;
  };
  researchEvidence: { version: string };
};
if (CONTENT_PROPOSAL_OUTPUT_SCHEMA_SHA256 !== catalog.proposalContracts.outputSchemaSha256) {
  throw new Error("content_proposal_output_schema_hash_mismatch");
}

export class ContentProposalContractError extends Error {
  readonly retryable = false;

  constructor(code: string) {
    super(code);
    this.name = "ContentProposalContractError";
  }
}

function fail(code = "content_proposal_job_invalid"): never {
  throw new ContentProposalContractError(code);
}

function record(value: unknown, code = "content_proposal_job_invalid"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exact(
  value: unknown,
  keys: readonly string[],
  code = "content_proposal_job_invalid",
): Record<string, unknown> {
  const source = record(value, code);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return source;
}

function string(value: unknown, code = "content_proposal_job_invalid"): string {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function uuid(value: unknown): string {
  const normalized = string(value).toLowerCase();
  if (!UUID.test(normalized)) fail();
  return normalized;
}

function sha(value: unknown): string {
  const normalized = string(value).toLowerCase();
  if (!SHA256.test(normalized)) fail();
  return normalized;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail();
  return Number(value);
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail();
  return Number(value);
}

function timestamp(value: unknown): string {
  const input = string(value);
  const date = new Date(input);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)
    || Number.isNaN(date.getTime()) || date.toISOString() !== input.replace(/Z$/, input.includes(".") ? "Z" : ".000Z")) {
    fail();
  }
  return input;
}

export function canonicalProposalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function proposalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalProposalJson(value)).digest("hex");
}

export type ContentProposalJobContract = {
  id: string;
  requestContractVersion: string;
  baseInputContractVersion: string;
  researchContractVersion: string;
  proposalContractVersion: string;
  proposalPromptVersion: string;
  proposalOutputSchemaSha256: string;
  modelId: string;
  commandDescriptorSha256: string;
  requestSha256: string;
  baseInputSha256: string;
  contractSourceSha256: string;
  catalogSha256: string;
  enqueueContractSha256: string;
};

type ContentProposalJobCommon = {
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
  request: ContentProposalRequestV2;
  contract: ContentProposalJobContract;
};

export type ContentProposalResearchJob = ContentProposalJobCommon & {
  stage: "research_required";
  researchAttemptId: string;
  researchAttemptNumber: number;
  baseInput: ProposalBaseInputSnapshotV2;
};

export type ContentProposalCompositionJob = ContentProposalJobCommon & {
  stage: "composition_ready";
  modelAttemptId: string;
  modelAttemptNumber: number;
  compositionId: string;
  composedInput: ProposalInputSnapshotV2;
  evidenceSetSha256: string;
  composedInputSha256: string;
  finalInvocationAggregateSha256: string;
  modelSha256: string;
};

export type ContentProposalJob = ContentProposalResearchJob | ContentProposalCompositionJob;

const commonKeys = [
  "id", "workspaceId", "brandId", "batchId", "status", "stage", "attemptCount", "maxAttempts",
  "workerId", "leaseToken", "leaseExpiresAt", "availableAt", "request", "contract",
] as const;
const contractKeys = [
  "id", "requestContractVersion", "baseInputContractVersion", "researchContractVersion",
  "proposalContractVersion", "proposalPromptVersion", "proposalOutputSchemaSha256", "modelId",
  "commandDescriptorSha256", "requestSha256", "baseInputSha256", "contractSourceSha256",
  "catalogSha256", "enqueueContractSha256",
] as const;

function parseContract(value: unknown): ContentProposalJobContract {
  const source = exact(value, contractKeys);
  const contract: ContentProposalJobContract = {
    id: uuid(source.id),
    requestContractVersion: string(source.requestContractVersion),
    baseInputContractVersion: string(source.baseInputContractVersion),
    researchContractVersion: string(source.researchContractVersion),
    proposalContractVersion: string(source.proposalContractVersion),
    proposalPromptVersion: string(source.proposalPromptVersion),
    proposalOutputSchemaSha256: sha(source.proposalOutputSchemaSha256),
    modelId: string(source.modelId),
    commandDescriptorSha256: sha(source.commandDescriptorSha256),
    requestSha256: sha(source.requestSha256),
    baseInputSha256: sha(source.baseInputSha256),
    contractSourceSha256: sha(source.contractSourceSha256),
    catalogSha256: sha(source.catalogSha256),
    enqueueContractSha256: sha(source.enqueueContractSha256),
  };
  if (contract.requestContractVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.request
    || contract.baseInputContractVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput
    || contract.researchContractVersion !== RESEARCH_EVIDENCE_VERSION
    || contract.proposalContractVersion !== CONTENT_PROPOSAL_CONTRACT_VERSIONS.output
    || contract.proposalPromptVersion !== CONTENT_PROPOSAL_PROMPT_VERSION
    || contract.proposalOutputSchemaSha256 !== catalog.proposalContracts.outputSchemaSha256
    || contract.modelId !== CONTENT_PLANNER_MODEL_ID
    || contract.contractSourceSha256 !== catalog.contractSourceHash
    || contract.catalogSha256 !== EXPECTED_CATALOG_SHA256) fail("content_proposal_claim_contract_mismatch");
  const expectedCommand = proposalSha256({
    runner: "codex-exec",
    model: CONTENT_PLANNER_MODEL_ID,
    promptVersion: contract.proposalPromptVersion,
    outputSchemaSha256: contract.proposalOutputSchemaSha256,
    requestContractVersion: contract.requestContractVersion,
    baseInputContractVersion: contract.baseInputContractVersion,
    researchContractVersion: contract.researchContractVersion,
    proposalContractVersion: contract.proposalContractVersion,
  });
  if (contract.commandDescriptorSha256 !== expectedCommand) fail("content_proposal_claim_contract_mismatch");
  return contract;
}

function parseCommon(source: Record<string, unknown>): ContentProposalJobCommon {
  let request: ContentProposalRequestV2;
  try { request = parseContentProposalRequestV2(source.request); }
  catch { fail(); }
  const contract = parseContract(source.contract);
  const common: ContentProposalJobCommon = {
    id: uuid(source.id), workspaceId: uuid(source.workspaceId), brandId: uuid(source.brandId),
    batchId: uuid(source.batchId), status: source.status === "processing" ? source.status : fail(),
    attemptCount: nonNegativeInteger(source.attemptCount), maxAttempts: positiveInteger(source.maxAttempts),
    workerId: string(source.workerId), leaseToken: uuid(source.leaseToken),
    leaseExpiresAt: timestamp(source.leaseExpiresAt), availableAt: timestamp(source.availableAt),
    request, contract,
  };
  if (common.attemptCount > common.maxAttempts
    || proposalSha256(request) !== contract.requestSha256
    || contract.enqueueContractSha256 !== proposalSha256({
      jobId: common.id,
      batchId: common.batchId,
      workspaceId: common.workspaceId,
      brandId: common.brandId,
      requestSha256: contract.requestSha256,
      baseInputSha256: contract.baseInputSha256,
      commandDescriptorSha256: contract.commandDescriptorSha256,
      contractSourceSha256: contract.contractSourceSha256,
      catalogSha256: contract.catalogSha256,
    })) fail("content_proposal_claim_contract_mismatch");
  return common;
}

function baseFromComposed(composed: ProposalInputSnapshotV2): ProposalBaseInputSnapshotV2 {
  const { contractVersion: _version, researchEvidence: _evidence, ...fields } = composed;
  try { return parseProposalBaseInputSnapshotV2({ ...fields, contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput }); }
  catch { fail(); }
}

function assertInputBinding(
  request: ContentProposalRequestV2,
  input: ProposalBaseInputSnapshotV2 | ProposalInputSnapshotV2,
): void {
  const settings = input.outputSettings;
  const formatBindingValid = settings.outputFormat === "blog"
    ? settings.channelTargets[0] === "blog_export" && settings.aspectRatio === null
    : settings.channelTargets[0] === "instagram"
      && settings.aspectRatio === (settings.outputFormat === "reel" ? "9:16" : "1:1");
  if (request.purpose !== settings.purpose
    || request.outputFormat !== input.outputSettings.outputFormat
    || request.channelTargets.length !== 1
    || settings.channelTargets.length !== 1
    || request.channelTargets[0] !== settings.channelTargets[0]
    || !formatBindingValid
    || (request.purpose === "informational" ? input.product !== null : input.product === null)
    || ("researchEvidence" in input && request.purpose === "informational"
      && (input.researchEvidence.decision !== "searched" || input.researchEvidence.items.length === 0))) {
    fail("content_proposal_claim_contract_mismatch");
  }
}

export function parseContentProposalJob(value: unknown): ContentProposalJob {
  const initial = record(value);
  if (initial.stage === "research_required") {
    const source = exact(initial, [...commonKeys, "researchAttemptId", "researchAttemptNumber", "baseInput"]);
    const common = parseCommon(source);
    let baseInput: ProposalBaseInputSnapshotV2;
    try { baseInput = parseProposalBaseInputSnapshotV2(source.baseInput); }
    catch { fail(); }
    assertInputBinding(common.request, baseInput);
    if (proposalSha256(baseInput) !== common.contract.baseInputSha256) fail("content_proposal_claim_contract_mismatch");
    return {
      ...common, stage: "research_required", researchAttemptId: uuid(source.researchAttemptId),
      researchAttemptNumber: positiveInteger(source.researchAttemptNumber), baseInput,
    };
  }
  if (initial.stage === "composition_ready") {
    const source = exact(initial, [
      ...commonKeys, "modelAttemptId", "modelAttemptNumber", "compositionId", "composedInput",
      "evidenceSetSha256", "composedInputSha256", "finalInvocationAggregateSha256", "modelSha256",
    ]);
    const common = parseCommon(source);
    const modelAttemptNumber = positiveInteger(source.modelAttemptNumber);
    if (common.attemptCount < 1 || common.attemptCount !== modelAttemptNumber) {
      fail("content_proposal_claim_contract_mismatch");
    }
    let composedInput: ProposalInputSnapshotV2;
    try { composedInput = parseProposalInputSnapshotV2(source.composedInput); }
    catch { fail(); }
    assertInputBinding(common.request, composedInput);
    const baseInput = baseFromComposed(composedInput);
    const evidenceSetSha256 = sha(source.evidenceSetSha256);
    const composedInputSha256 = sha(source.composedInputSha256);
    const finalInvocationAggregateSha256 = sha(source.finalInvocationAggregateSha256);
    const modelSha256 = sha(source.modelSha256);
    if (proposalSha256(baseInput) !== common.contract.baseInputSha256
      || modelSha256 !== proposalSha256({ modelId: common.contract.modelId })
      || finalInvocationAggregateSha256 !== proposalSha256({
        enqueueContractSha256: common.contract.enqueueContractSha256,
        modelId: common.contract.modelId,
        commandDescriptorSha256: common.contract.commandDescriptorSha256,
        proposalOutputSchemaSha256: common.contract.proposalOutputSchemaSha256,
        evidenceSetSha256,
        composedInputSha256,
      })) fail("content_proposal_claim_contract_mismatch");
    return {
      ...common, stage: "composition_ready", modelAttemptId: uuid(source.modelAttemptId),
      modelAttemptNumber, compositionId: uuid(source.compositionId),
      composedInput, evidenceSetSha256, composedInputSha256, finalInvocationAggregateSha256, modelSha256,
    };
  }
  fail();
}

export function isContentProposalResearchJob(job: ContentProposalJob): job is ContentProposalResearchJob {
  return job.stage === "research_required";
}

export function isContentProposalCompositionJob(job: ContentProposalJob): job is ContentProposalCompositionJob {
  return job.stage === "composition_ready";
}

function sortedSet(values: readonly string[]): string {
  return JSON.stringify([...values].sort());
}

function semanticFingerprint(proposal: ContentProposalV2): string {
  return canonicalProposalJson({
    informationalType: proposal.informationalType,
    target: proposal.target,
    customerContext: proposal.customerContext,
    keyMessage: proposal.keyMessage,
    hook: proposal.hook,
    assetCount: proposal.assetCount,
    outline: proposal.outline,
    purposeDetails: proposal.purposeDetails,
  });
}

function axisValue(proposal: ContentProposalV2, axis: ContentProposalV2["differentiationAxes"][number]): string | null {
  switch (axis) {
    case "target": return proposal.target;
    case "situation": return proposal.customerContext;
    case "question": return proposal.purposeDetails.kind === "informational" ? proposal.purposeDetails.question : proposal.hook;
    case "appeal": return proposal.purposeDetails.kind === "marketing" ? proposal.purposeDetails.appeal : proposal.keyMessage;
    case "narrative": return canonicalProposalJson({ intent: proposal.oneLineIntent, hook: proposal.hook, outline: proposal.outline });
    case "informational_type": return proposal.informationalType;
  }
}

export function parseContentProposalSetV2(
  value: unknown,
  job: ContentProposalCompositionJob,
): ContentProposalSetV2 {
  let set: ContentProposalSetV2;
  try { set = parseCanonicalContentProposalSetV2(value); }
  catch { fail("content_proposal_result_invalid"); }
  const input = job.composedInput;
  const settings = input.outputSettings;
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const referenceIds = new Set(input.references.map((item) => item.referenceItemId));
  for (const proposal of set.proposals) {
    if (proposal.outputFormat !== settings.outputFormat
      || proposal.channelTargets.length !== 1 || proposal.channelTargets[0] !== settings.channelTargets[0]
      || proposal.purposeDetails.kind !== settings.purpose
      || proposal.evidenceIds.some((id) => !evidenceIds.has(id))
      || proposal.referenceIds.some((id) => !referenceIds.has(id))
      || (settings.outputFormat === "blog" ? proposal.assetCount !== null : proposal.assetCount !== proposal.outline.length)
      || proposal.outline.some((item, index) => item.index !== index + 1)
      || (settings.purpose === "informational" && (input.product !== null || proposal.informationalType === null))
      || (settings.purpose === "marketing" && (input.product === null || proposal.informationalType !== null
        || proposal.purposeDetails.kind !== "marketing" || proposal.purposeDetails.productId !== input.product.id))) {
      fail("content_proposal_result_invalid");
    }
  }
  const requiresSharedRepresentativeSources = settings.outputFormat === "blog";
  if (new Set(set.proposals.map((proposal) => proposal.conceptKey)).size !== 3
    || new Set(set.proposals.map(semanticFingerprint)).size !== 3
    || (requiresSharedRepresentativeSources
      && new Set(set.proposals.map((proposal) => sortedSet(proposal.evidenceIds))).size !== 1)
    || (requiresSharedRepresentativeSources
      && new Set(set.proposals.map((proposal) => sortedSet(proposal.referenceIds))).size !== 1)) {
    fail("content_proposal_result_not_distinct");
  }
  for (let leftIndex = 0; leftIndex < set.proposals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < set.proposals.length; rightIndex += 1) {
      const left = set.proposals[leftIndex]!;
      const right = set.proposals[rightIndex]!;
      const axes = new Set([...left.differentiationAxes, ...right.differentiationAxes]);
      if (![...axes].some((axis) => axisValue(left, axis) !== axisValue(right, axis))) {
        fail("content_proposal_result_not_distinct");
      }
    }
  }
  return set;
}

export type ContentProposalResearchSeal = {
  jobId: string;
  batchId: string;
  compositionId: string;
  composedInput: ProposalInputSnapshotV2;
  evidenceSetSha256: string;
  composedInputSha256: string;
  finalInvocationAggregateSha256: string;
  status: "queued";
};

export type InvocationOrdinal = 1 | 2;
export type InvocationTerminalInput =
  | {
      eventType: "invocation_completed";
      transcriptSha256: string;
      outputSha256: string;
      parserSha256: string;
      parserValid: false;
    }
  | {
      eventType: "invocation_failed" | "invocation_indeterminate";
      transcriptSha256: string | null;
      outputSha256: null;
      parserSha256: null;
      parserValid: null;
    };

export type ContentProposalCompletionInput = {
  transcriptSha256: string;
  outputSha256: string;
  parserSha256: string;
  proposalSet: ContentProposalSetV2;
};

export type ContentProposalCompletion = {
  jobId: string;
  batchId: string;
  status: "completed";
  invocationEventSha256: string;
  attemptEventSha256: string;
};

export interface ContentProposalWorkerClient {
  heartbeatWorker(workerId: string): Promise<void>;
  claim(workerId: string, leaseSeconds: number): Promise<ContentProposalJob | null>;
  heartbeat(job: ContentProposalJob, leaseSeconds: number): Promise<void>;
  completeResearch(job: ContentProposalResearchJob, evidence: ResearchEvidenceSnapshotV1): Promise<ContentProposalResearchSeal>;
  startInvocation(job: ContentProposalCompositionJob, ordinal: InvocationOrdinal): Promise<{ eventSha256: string }>;
  recordInvocationTerminal(
    job: ContentProposalCompositionJob,
    ordinal: InvocationOrdinal,
    input: InvocationTerminalInput,
  ): Promise<{
    eventSha256: string;
    status: "queued" | "processing" | "failed" | "manual_review_required";
  }>;
  complete(
    job: ContentProposalCompositionJob,
    ordinal: InvocationOrdinal,
    input: ContentProposalCompletionInput,
  ): Promise<ContentProposalCompletion>;
  fail(job: ContentProposalJob, input: {
    stage: ContentProposalJob["stage"];
    attemptId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  }): Promise<void>;
}

export function parseResearchSeal(
  value: unknown,
  job: ContentProposalResearchJob,
  evidence: ResearchEvidenceSnapshotV1,
): ContentProposalResearchSeal {
  const source = exact(value, [
    "jobId", "batchId", "compositionId", "composedInput", "evidenceSetSha256",
    "composedInputSha256", "finalInvocationAggregateSha256", "status",
  ], "content_proposal_research_seal_invalid");
  let composedInput: ProposalInputSnapshotV2;
  try { composedInput = parseProposalInputSnapshotV2(source.composedInput); }
  catch { fail("content_proposal_research_seal_invalid"); }
  if (source.status !== "queued") fail("content_proposal_research_seal_invalid");
  const seal = {
    jobId: uuid(source.jobId), batchId: uuid(source.batchId), compositionId: uuid(source.compositionId),
    composedInput, evidenceSetSha256: sha(source.evidenceSetSha256),
    composedInputSha256: sha(source.composedInputSha256),
    finalInvocationAggregateSha256: sha(source.finalInvocationAggregateSha256), status: "queued",
  } as const;
  if (seal.jobId !== job.id || seal.batchId !== job.batchId
    || proposalSha256(baseFromComposed(seal.composedInput)) !== job.contract.baseInputSha256
    || canonicalProposalJson(seal.composedInput.researchEvidence) !== canonicalProposalJson(evidence)
    || seal.finalInvocationAggregateSha256 !== proposalSha256({
      enqueueContractSha256: job.contract.enqueueContractSha256,
      modelId: job.contract.modelId,
      commandDescriptorSha256: job.contract.commandDescriptorSha256,
      proposalOutputSchemaSha256: job.contract.proposalOutputSchemaSha256,
      evidenceSetSha256: seal.evidenceSetSha256,
      composedInputSha256: seal.composedInputSha256,
    })) fail("content_proposal_research_seal_invalid");
  return seal;
}

export function parseResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  try { return parseResearchEvidenceSnapshotV1(value); }
  catch { fail("content_proposal_research_invalid"); }
}
