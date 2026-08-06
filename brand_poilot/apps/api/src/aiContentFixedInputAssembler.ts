import {
  CONTENT_GENERATION_INPUT_VERSION,
  CONTENT_PLANNER_MODEL_ID,
  assertEvidenceOwnership,
  assertPlannerPromptBinding,
  assertPurposeProductInvariant,
  assertSelectedProposalInvariant,
  parseContentGenerationInputV3,
  parseContentPipelineAuthorityContext,
  parseContentProposalRequestV2,
  parseProposalBaseInputSnapshotV2,
  parseProposalInputSnapshotV2,
  promptBindingFor,
  type ApprovedBrandCoreSnapshotV2,
  type ApprovedBrandRulesSnapshotV1,
  type ApprovedProductSnapshotV2,
  type BrandRulesContentV1,
  type ContentGenerationInputV3,
  type ContentPromptBinding,
  type ContentProposalRequestV2,
  type ContentProposalV2,
  type ContentPurpose,
  type ContentStudioOutputFormat,
  type FinalAttachmentSnapshotV1,
  type FrozenReferenceSnapshotV2,
  type FrozenStyleImageSnapshotV1,
  type ProposalBaseInputSnapshotV2,
  type ProposalInputSnapshotV2,
  type ResearchEvidenceItemSnapshotV1,
  type VerifiedGeneratedContentCatalog,
} from "@brand-pilot/content-contracts";
import { parseBrandRules } from "./brandCoreContracts.js";
import { canonicalProposalJson, proposalSha256 } from "./aiContentProposalV2Service.js";

type Scope = { workspaceId: string; brandId: string };
type ScopedStatus = Scope & { status: string; deletedAt: string | null };

export interface FixedInputAssembly {
  input: ContentGenerationInputV3;
  canonicalJson: string;
  contentHash: string;
  binding: ContentPromptBinding;
  provenance: {
    selectedProposalId: string;
    proposalJobId: string;
    proposalContractId: string;
    successfulModelAttemptId: string;
    finalInvocationOrdinal: 1 | 2;
  };
}

export interface AiContentFixedInputSource {
  catalog: VerifiedGeneratedContentCatalog;
  catalogSha256: string;
  startedAt: string;
  scope: Scope & { actorUserId: string };
  draft: Scope & {
    generationId: string;
    status: "draft";
    deletedAt: null;
    origin: "proposal-v2";
    proposalBatchId: string;
    proposalId: string;
    outputFormat: ContentStudioOutputFormat;
    purpose: ContentPurpose;
    userImageInstruction: string | null;
    brandStyleImageIds: string[];
    avatarStyleImageId: string | null;
    attachmentIds: string[];
  };
  batch: Scope & {
    id: string;
    status: "ready";
    deletedAt: null;
    baseInput: ProposalBaseInputSnapshotV2;
  };
  selection: Scope & {
    id: string;
    batchId: string;
    generationId: string;
    status: "selected";
    deletedAt: null;
    proposal: ContentProposalV2;
    successfulModelAttemptId: string;
    successfulProposalJobId: string;
    finalInvocationOrdinal: 1 | 2;
  };
  proposalJob: Scope & {
    id: string;
    contractId: string;
    batchId: string;
    status: "completed";
    request: ContentProposalRequestV2;
    requestContractVersion: string;
    baseInputContractVersion: string;
    researchContractVersion: string;
    proposalContractVersion: string;
    proposalPromptVersion: string;
    proposalOutputSchemaSha256: string;
    proposalModelId: string;
    commandDescriptorSha256: string;
    requestSha256: string;
    baseInputSha256: string;
    contractSourceSha256: string;
    catalogSha256: string;
    enqueueContractSha256: string;
  };
  composition: Scope & {
    id: string;
    jobId: string;
    contractId: string;
    batchId: string;
    composedInput: ProposalInputSnapshotV2;
    researchEvidenceSetSha256: string;
    composedInputSha256: string;
    finalInvocationAggregateSha256: string;
  };
  successfulAttempt: Scope & {
    id: string;
    jobId: string;
    contractId: string;
    compositionId: string;
    aggregateContractSha256: string;
    modelId: string;
    modelSha256: string;
    commandDescriptorSha256: string;
    proposalOutputSchemaSha256: string;
    composedInputSha256: string;
  };
  successEvent: Scope & {
    modelAttemptId: string;
    jobId: string;
    eventType: "attempt_succeeded";
    invocationOrdinal: 1 | 2;
    aggregateContractSha256: string;
    modelSha256: string;
    commandDescriptorSha256: string;
    proposalOutputSchemaSha256: string;
    composedInputSha256: string;
    outputSha256: string;
    parserSha256: string;
    parserValid: true;
  };
  approvedBrandCore: ScopedStatus & { snapshot: ApprovedBrandCoreSnapshotV2 };
  approvedBrandRules: ScopedStatus & {
    versionId: string;
    version: number;
    content: BrandRulesContentV1;
    contentSha256: string;
  };
  approvedProduct: (ScopedStatus & { snapshot: ApprovedProductSnapshotV2 }) | null;
  evidence: Array<ScopedStatus & {
    proposalBatchId: string;
    snapshot: ResearchEvidenceItemSnapshotV1;
  }>;
  references: Array<ScopedStatus & {
    proposalBatchId: string;
    snapshot: FrozenReferenceSnapshotV2;
  }>;
  brandStyleImages: Array<ScopedStatus & {
    ruleSetVersionId: string;
    snapshot: FrozenStyleImageSnapshotV1;
  }>;
  attachments: Array<ScopedStatus & {
    generationId: string;
    snapshot: FinalAttachmentSnapshotV1;
  }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function fail(code: string): never {
  throw new Error(code);
}

function same(left: unknown, right: unknown): boolean {
  return canonicalProposalJson(left) === canonicalProposalJson(right);
}

function exactObject(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("fixed_input_source_invalid");
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (!same(actual, expected)) fail("fixed_input_source_invalid");
}

function assertScope(scope: Scope, value: Scope, code = "fixed_input_scope_mismatch"): void {
  if (value.workspaceId !== scope.workspaceId || value.brandId !== scope.brandId) fail(code);
}

function assertAvailable(value: ScopedStatus, status: string, code: string): void {
  if (value.status !== status || value.deletedAt !== null) fail(code);
}

function assertExactIds(actual: readonly string[], expected: readonly string[], code: string): void {
  if (new Set(actual).size !== actual.length || !same(actual, expected)) fail(code);
}

function validateSourceShape(source: AiContentFixedInputSource): void {
  exactObject(source, [
    "catalog", "catalogSha256", "startedAt", "scope", "draft", "batch", "selection", "proposalJob",
    "composition", "successfulAttempt", "successEvent", "approvedBrandCore", "approvedBrandRules", "approvedProduct", "evidence",
    "references", "brandStyleImages", "attachments",
  ]);
  exactObject(source.scope, ["workspaceId", "brandId", "actorUserId"]);
  exactObject(source.draft, [
    "workspaceId", "brandId", "generationId", "status", "deletedAt", "origin",
    "proposalBatchId", "proposalId", "outputFormat", "purpose", "userImageInstruction",
    "brandStyleImageIds", "avatarStyleImageId", "attachmentIds",
  ]);
  exactObject(source.batch, ["id", "workspaceId", "brandId", "status", "deletedAt", "baseInput"]);
  exactObject(source.selection, [
    "id", "batchId", "workspaceId", "brandId", "generationId", "status", "deletedAt", "proposal",
    "successfulModelAttemptId", "successfulProposalJobId", "finalInvocationOrdinal",
  ]);
  exactObject(source.proposalJob, [
    "id", "contractId", "batchId", "workspaceId", "brandId", "status", "request",
    "requestContractVersion", "baseInputContractVersion", "researchContractVersion",
    "proposalContractVersion", "proposalPromptVersion", "proposalOutputSchemaSha256", "proposalModelId",
    "commandDescriptorSha256", "requestSha256", "baseInputSha256", "contractSourceSha256",
    "catalogSha256", "enqueueContractSha256",
  ]);
  exactObject(source.composition, [
    "id", "jobId", "contractId", "batchId", "workspaceId", "brandId", "composedInput",
    "researchEvidenceSetSha256", "composedInputSha256", "finalInvocationAggregateSha256",
  ]);
  exactObject(source.successfulAttempt, [
    "id", "jobId", "contractId", "compositionId", "workspaceId", "brandId", "aggregateContractSha256",
    "modelId", "modelSha256", "commandDescriptorSha256", "proposalOutputSchemaSha256", "composedInputSha256",
  ]);
  exactObject(source.successEvent, [
    "modelAttemptId", "jobId", "workspaceId", "brandId", "eventType", "invocationOrdinal",
    "aggregateContractSha256", "modelSha256", "commandDescriptorSha256", "proposalOutputSchemaSha256",
    "composedInputSha256", "outputSha256", "parserSha256", "parserValid",
  ]);
  exactObject(source.approvedBrandCore, ["workspaceId", "brandId", "status", "deletedAt", "snapshot"]);
  exactObject(source.approvedBrandRules, [
    "workspaceId", "brandId", "versionId", "version", "status", "deletedAt", "content", "contentSha256",
  ]);
  if (source.approvedProduct !== null) {
    exactObject(source.approvedProduct, ["workspaceId", "brandId", "status", "deletedAt", "snapshot"]);
  }
  for (const row of source.evidence) {
    exactObject(row, ["workspaceId", "brandId", "proposalBatchId", "status", "deletedAt", "snapshot"]);
  }
  for (const row of source.references) {
    exactObject(row, ["workspaceId", "brandId", "proposalBatchId", "status", "deletedAt", "snapshot"]);
  }
  for (const row of source.brandStyleImages) {
    exactObject(row, ["workspaceId", "brandId", "ruleSetVersionId", "status", "deletedAt", "snapshot"]);
  }
  for (const row of source.attachments) {
    exactObject(row, [
      "workspaceId", "brandId", "generationId", "status", "deletedAt", "snapshot",
    ]);
  }
  if (!UUID.test(source.scope.workspaceId) || !UUID.test(source.scope.brandId)
    || !UUID.test(source.scope.actorUserId) || !SHA256.test(source.catalogSha256)
    || Number.isNaN(Date.parse(source.startedAt))) {
    fail("fixed_input_source_invalid");
  }
  const uuidValues = [
    source.draft.generationId, source.draft.proposalBatchId, source.draft.proposalId,
    source.batch.id, source.selection.id, source.selection.batchId, source.selection.generationId,
    source.selection.successfulModelAttemptId, source.selection.successfulProposalJobId,
    source.proposalJob.id, source.proposalJob.contractId, source.proposalJob.batchId,
    source.composition.id, source.composition.jobId, source.composition.contractId, source.composition.batchId,
    source.successfulAttempt.id, source.successfulAttempt.jobId, source.successfulAttempt.contractId,
    source.successfulAttempt.compositionId, source.successEvent.modelAttemptId, source.successEvent.jobId,
    source.approvedBrandRules.versionId,
  ];
  const hashes = [
    source.proposalJob.proposalOutputSchemaSha256, source.proposalJob.commandDescriptorSha256,
    source.proposalJob.requestSha256, source.proposalJob.baseInputSha256,
    source.proposalJob.contractSourceSha256, source.proposalJob.catalogSha256,
    source.proposalJob.enqueueContractSha256, source.composition.researchEvidenceSetSha256,
    source.composition.composedInputSha256, source.composition.finalInvocationAggregateSha256,
    source.successfulAttempt.aggregateContractSha256, source.successfulAttempt.modelSha256,
    source.successfulAttempt.commandDescriptorSha256, source.successfulAttempt.proposalOutputSchemaSha256,
    source.successfulAttempt.composedInputSha256, source.successEvent.aggregateContractSha256,
    source.successEvent.modelSha256, source.successEvent.commandDescriptorSha256,
    source.successEvent.proposalOutputSchemaSha256, source.successEvent.composedInputSha256,
    source.successEvent.outputSha256, source.successEvent.parserSha256, source.approvedBrandRules.contentSha256,
  ];
  if (uuidValues.some((value) => !UUID.test(value)) || hashes.some((value) => !SHA256.test(value))) {
    fail("fixed_input_source_invalid");
  }
}

function assertProposalContract(source: AiContentFixedInputSource): {
  request: ContentProposalRequestV2;
  baseInput: ProposalBaseInputSnapshotV2;
  composedInput: ProposalInputSnapshotV2;
} {
  const { catalog, proposalJob, composition, batch } = source;
  assertScope(source.scope, proposalJob);
  assertScope(source.scope, composition);
  if (proposalJob.status !== "completed" || proposalJob.batchId !== batch.id
    || composition.jobId !== proposalJob.id || composition.batchId !== batch.id
    || composition.contractId !== proposalJob.contractId) {
    fail("fixed_input_proposal_job_mismatch");
  }
  const request = parseContentProposalRequestV2(proposalJob.request);
  const baseInput = parseProposalBaseInputSnapshotV2(batch.baseInput);
  const composedInput = parseProposalInputSnapshotV2(composition.composedInput);
  const expectedCommandDescriptorSha256 = proposalSha256({
    runner: "codex-exec",
    model: CONTENT_PLANNER_MODEL_ID,
    promptVersion: catalog.proposalContracts.promptVersion,
    outputSchemaSha256: catalog.proposalContracts.outputSchemaSha256,
    requestContractVersion: catalog.proposalContracts.requestVersion,
    baseInputContractVersion: catalog.proposalContracts.baseInputVersion,
    researchContractVersion: catalog.researchEvidence.version,
    proposalContractVersion: catalog.proposalContracts.outputVersion,
  });
  const expectedEnqueueContractSha256 = proposalSha256({
    jobId: proposalJob.id,
    batchId: proposalJob.batchId,
    workspaceId: proposalJob.workspaceId,
    brandId: proposalJob.brandId,
    requestSha256: proposalJob.requestSha256,
    baseInputSha256: proposalJob.baseInputSha256,
    commandDescriptorSha256: proposalJob.commandDescriptorSha256,
    contractSourceSha256: proposalJob.contractSourceSha256,
    catalogSha256: proposalJob.catalogSha256,
  });
  if (proposalJob.requestContractVersion !== catalog.proposalContracts.requestVersion
    || proposalJob.baseInputContractVersion !== catalog.proposalContracts.baseInputVersion
    || composedInput.contractVersion !== catalog.proposalContracts.composedInputVersion
    || proposalJob.researchContractVersion !== catalog.researchEvidence.version
    || proposalJob.proposalContractVersion !== catalog.proposalContracts.outputVersion
    || proposalJob.proposalPromptVersion !== catalog.proposalContracts.promptVersion
    || proposalJob.proposalOutputSchemaSha256 !== catalog.proposalContracts.outputSchemaSha256
    || proposalJob.proposalModelId !== CONTENT_PLANNER_MODEL_ID
    || proposalJob.contractSourceSha256 !== catalog.contractSourceHash
    || proposalJob.catalogSha256 !== source.catalogSha256
    || proposalJob.commandDescriptorSha256 !== expectedCommandDescriptorSha256
    || proposalJob.enqueueContractSha256 !== expectedEnqueueContractSha256
    || proposalJob.requestSha256 !== proposalSha256(request)
    || proposalJob.baseInputSha256 !== proposalSha256(baseInput)
    || composition.composedInputSha256 !== proposalSha256(composedInput)) {
    fail("fixed_input_proposal_contract_mismatch");
  }
  const { contractVersion: _baseVersion, ...baseFields } = baseInput;
  const { contractVersion: _composedVersion, researchEvidence: _evidence, ...composedFields } = composedInput;
  if (!same(baseFields, composedFields)) fail("fixed_input_composition_mismatch");
  if (request.outputFormat !== baseInput.outputSettings.outputFormat
    || request.purpose !== baseInput.outputSettings.purpose
    || !same(request.channelTargets, baseInput.outputSettings.channelTargets)) {
    fail("fixed_input_request_mismatch");
  }
  const expectedEvidenceSetSha256 = proposalSha256([composedInput.researchEvidence]);
  const expectedAggregateSha256 = proposalSha256({
    enqueueContractSha256: proposalJob.enqueueContractSha256,
    modelId: proposalJob.proposalModelId,
    commandDescriptorSha256: proposalJob.commandDescriptorSha256,
    proposalOutputSchemaSha256: proposalJob.proposalOutputSchemaSha256,
    evidenceSetSha256: composition.researchEvidenceSetSha256,
    composedInputSha256: composition.composedInputSha256,
  });
  if (composition.researchEvidenceSetSha256 !== expectedEvidenceSetSha256
    || composition.finalInvocationAggregateSha256 !== expectedAggregateSha256) {
    fail("fixed_input_composition_hash_mismatch");
  }
  return { request, baseInput, composedInput };
}

function assertSuccessfulLineage(source: AiContentFixedInputSource): void {
  const { selection, proposalJob, composition, successfulAttempt: attempt, successEvent: event } = source;
  assertScope(source.scope, attempt);
  assertScope(source.scope, event);
  if (selection.successfulModelAttemptId !== attempt.id
    || selection.successfulProposalJobId !== proposalJob.id
    || selection.finalInvocationOrdinal !== event.invocationOrdinal
    || attempt.jobId !== proposalJob.id
    || attempt.contractId !== proposalJob.contractId
    || attempt.compositionId !== composition.id
    || event.modelAttemptId !== attempt.id
    || event.jobId !== proposalJob.id
    || event.eventType !== "attempt_succeeded"
    || event.parserValid !== true
    || attempt.aggregateContractSha256 !== composition.finalInvocationAggregateSha256
    || attempt.modelId !== CONTENT_PLANNER_MODEL_ID
    || attempt.modelSha256 !== proposalSha256({ modelId: CONTENT_PLANNER_MODEL_ID })
    || attempt.commandDescriptorSha256 !== proposalJob.commandDescriptorSha256
    || attempt.proposalOutputSchemaSha256 !== proposalJob.proposalOutputSchemaSha256
    || attempt.composedInputSha256 !== composition.composedInputSha256
    || event.aggregateContractSha256 !== attempt.aggregateContractSha256
    || event.modelSha256 !== attempt.modelSha256
    || event.commandDescriptorSha256 !== attempt.commandDescriptorSha256
    || event.proposalOutputSchemaSha256 !== attempt.proposalOutputSchemaSha256
    || event.composedInputSha256 !== attempt.composedInputSha256) {
    fail("fixed_input_success_lineage_mismatch");
  }
}

export function assembleAiContentFixedInput(source: AiContentFixedInputSource): FixedInputAssembly {
  validateSourceShape(source);
  const { scope, draft, batch, selection } = source;
  assertScope(scope, draft);
  assertScope(scope, batch);
  assertScope(scope, selection);
  if (draft.status !== "draft" || draft.deletedAt !== null || draft.origin !== "proposal-v2") {
    fail("fixed_input_draft_unavailable");
  }
  if (batch.status !== "ready" || batch.deletedAt !== null) fail("fixed_input_batch_unavailable");
  if (selection.status !== "selected" || selection.deletedAt !== null) fail("fixed_input_selection_unavailable");
  if (draft.proposalBatchId !== batch.id || draft.proposalId !== selection.id
    || selection.batchId !== batch.id || selection.generationId !== draft.generationId) {
    fail("fixed_input_selection_mismatch");
  }

  const { baseInput, composedInput } = assertProposalContract(source);
  assertSuccessfulLineage(source);
  const selectedProposal = selection.proposal;
  if (draft.outputFormat !== baseInput.outputSettings.outputFormat
    || draft.purpose !== baseInput.outputSettings.purpose
    || selectedProposal.outputFormat !== draft.outputFormat
    || selectedProposal.purposeDetails.kind !== draft.purpose) {
    fail("fixed_input_format_or_purpose_mismatch");
  }

  assertScope(scope, source.approvedBrandCore);
  assertAvailable(source.approvedBrandCore, "approved", "fixed_input_brand_core_unavailable");
  if (!same(source.approvedBrandCore.snapshot, baseInput.brandCore)) fail("fixed_input_brand_core_mismatch");

  assertScope(scope, source.approvedBrandRules);
  assertAvailable(source.approvedBrandRules, "approved", "fixed_input_brand_rules_unavailable");
  const canonicalRules = parseBrandRules(source.approvedBrandRules.content);
  if (!same(canonicalRules, source.approvedBrandRules.content)
    || source.approvedBrandRules.contentSha256 !== proposalSha256(canonicalRules)) {
    fail("fixed_input_brand_rules_hash_mismatch");
  }
  const brandRules: ApprovedBrandRulesSnapshotV1 = {
    versionId: source.approvedBrandRules.versionId,
    version: source.approvedBrandRules.version,
    content: canonicalRules,
    contentSha256: source.approvedBrandRules.contentSha256,
  };

  if (baseInput.product === null) {
    if (source.approvedProduct !== null) fail("fixed_input_product_mismatch");
  } else {
    if (source.approvedProduct === null) fail("fixed_input_product_unavailable");
    assertScope(scope, source.approvedProduct);
    assertAvailable(source.approvedProduct, "approved", "fixed_input_product_unavailable");
    if (!same(source.approvedProduct.snapshot, baseInput.product)) fail("fixed_input_product_mismatch");
  }

  for (const row of source.evidence) {
    assertScope(scope, row);
    assertAvailable(row, "frozen", "fixed_input_evidence_unavailable");
    if (row.proposalBatchId !== batch.id) fail("fixed_input_evidence_batch_mismatch");
  }
  if (!same(source.evidence.map(({ snapshot }) => snapshot), composedInput.researchEvidence.items)) {
    fail("fixed_input_evidence_mismatch");
  }
  for (const row of source.references) {
    assertScope(scope, row);
    assertAvailable(row, "approved", "fixed_input_reference_unavailable");
    if (row.proposalBatchId !== batch.id) fail("fixed_input_reference_batch_mismatch");
  }
  if (!same(source.references.map(({ snapshot }) => snapshot), baseInput.references)) {
    fail("fixed_input_reference_mismatch");
  }

  for (const row of source.brandStyleImages) {
    assertScope(scope, row);
    assertAvailable(row, "approved", "fixed_input_style_image_unavailable");
    if (row.ruleSetVersionId !== brandRules.versionId) fail("fixed_input_style_image_rules_mismatch");
  }
  assertExactIds(
    source.brandStyleImages.map(({ snapshot }) => snapshot.referenceItemId),
    draft.brandStyleImageIds,
    "fixed_input_style_image_mismatch",
  );
  if (draft.avatarStyleImageId !== null
    && !draft.brandStyleImageIds.includes(draft.avatarStyleImageId)) {
    fail("fixed_input_avatar_style_mismatch");
  }
  for (const row of source.attachments) {
    assertScope(scope, row);
    assertAvailable(row, "finalized", "fixed_input_attachment_unavailable");
    if (row.generationId !== draft.generationId) {
      fail("fixed_input_attachment_unavailable");
    }
  }
  assertExactIds(
    source.attachments.map(({ snapshot }) => snapshot.id),
    draft.attachmentIds,
    "fixed_input_attachment_mismatch",
  );

  const input = parseContentGenerationInputV3({
    contractVersion: CONTENT_GENERATION_INPUT_VERSION,
    generationId: draft.generationId,
    brandCore: baseInput.brandCore,
    brandRules,
    subject: baseInput.subject,
    contentInstruction: baseInput.contentInstruction,
    product: baseInput.product,
    researchEvidence: composedInput.researchEvidence,
    references: {
      selected: source.references.map(({ snapshot }) => snapshot),
      brandStyleImages: source.brandStyleImages.map(({ snapshot }) => snapshot),
      avatarStyleImageId: draft.avatarStyleImageId,
      attachments: source.attachments.map(({ snapshot }) => snapshot),
    },
    selectedProposal: { id: selection.id, ...selectedProposal },
    userImageInstruction: draft.userImageInstruction,
    outputSettings: baseInput.outputSettings,
    capturedAt: source.startedAt,
  });
  const authority = parseContentPipelineAuthorityContext({
    scope: { workspaceId: scope.workspaceId, brandId: scope.brandId },
    selection: {
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      proposalBatchId: batch.id,
      proposalId: selection.id,
      outputFormat: draft.outputFormat,
      purpose: draft.purpose,
    },
    evidence: source.evidence.map(({ snapshot }) => ({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      proposalBatchId: batch.id,
      evidenceId: snapshot.id,
    })),
    references: source.references.map(({ snapshot }) => ({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      proposalBatchId: batch.id,
      referenceItemId: snapshot.referenceItemId,
      snapshotId: snapshot.snapshotId,
    })),
  });
  assertPurposeProductInvariant(input);
  assertEvidenceOwnership(input, authority);
  assertSelectedProposalInvariant(input, authority);
  const binding = promptBindingFor(draft.outputFormat, draft.purpose, source.catalog);
  assertPlannerPromptBinding(input, binding);
  const canonicalJson = canonicalProposalJson(input);
  return {
    input,
    canonicalJson,
    contentHash: proposalSha256(input),
    binding,
    provenance: {
      selectedProposalId: selection.id,
      proposalJobId: source.proposalJob.id,
      proposalContractId: source.proposalJob.contractId,
      successfulModelAttemptId: source.successfulAttempt.id,
      finalInvocationOrdinal: source.successEvent.invocationOrdinal,
    },
  };
}
