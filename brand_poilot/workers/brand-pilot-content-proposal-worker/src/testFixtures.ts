import {
  proposalSha256,
  type ContentProposalCompositionJob,
  type ContentProposalJobContract,
  type ContentProposalResearchJob,
  type ContentProposalSetV2,
  type ProposalBaseInputSnapshotV2,
  type ProposalInputSnapshotV2,
  type ResearchEvidenceSnapshotV1,
} from "./contracts.js";

export const ids = {
  job: "10000000-0000-4000-8000-000000000001",
  workspace: "20000000-0000-4000-8000-000000000002",
  brand: "30000000-0000-4000-8000-000000000003",
  batch: "40000000-0000-4000-8000-000000000004",
  lease: "50000000-0000-4000-8000-000000000005",
  researchAttempt: "60000000-0000-4000-8000-000000000006",
  evidence: "70000000-0000-4000-8000-000000000007",
  modelAttempt: "80000000-0000-4000-8000-000000000008",
  composition: "90000000-0000-4000-8000-000000000009",
  contract: "a0000000-0000-4000-8000-00000000000a",
};

export const evidence: ResearchEvidenceSnapshotV1 = {
  contractVersion: "research-evidence.v1",
  decision: "searched",
  reason: "최신 근거 필요",
  queries: ["브랜드 운영 최신 동향"],
  capturedAt: "2026-08-01T04:00:00.000Z",
  items: [{
    id: ids.evidence,
    title: "검증 자료",
    url: "https://source.example/article",
    publisher: "Source",
    publishedAt: null,
    capturedAt: "2026-08-01T04:00:00.000Z",
    claimSummary: "실무 적용 근거",
    contentHash: "a".repeat(64),
  }],
};

export const researchSourceAcquisition = {
  contractVersion: "research-source-acquisition.v1" as const,
  status: "not_applicable" as const,
  requestedUrl: null,
  canonicalUrl: null,
  contentHash: null,
  capturedAt: "2026-08-01T03:00:00.000Z",
};

export const baseInput: ProposalBaseInputSnapshotV2 = {
  contractVersion: "proposal-base-input.v2",
  brandCore: {
    versionId: ids.batch,
    companyOverview: "브랜드 개요",
    businessDescription: "사업 설명",
    primaryCategory: "교육",
    detailedCategory: "온라인 교육",
    primaryTarget: "창업자",
    differentiator: "실전형",
    coreAppeal: "바로 적용",
  },
  subject: { kind: "topic_text", title: "브랜드 운영" },
  contentInstruction: "실무 중심",
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    aspectRatio: "1:1",
    outputCount: 1,
    purpose: "informational",
  },
  capturedAt: "2026-08-01T03:00:00.000Z",
};

export const composedInput: ProposalInputSnapshotV2 = {
  ...baseInput,
  contractVersion: "proposal-input.v2",
  researchEvidence: evidence,
};

export const request = {
  contractVersion: "content-proposal-request.v2" as const,
  purpose: "informational" as const,
  outputFormat: "card_news" as const,
  channelTargets: ["instagram"] as ["instagram"],
  requestFingerprint: "b".repeat(64),
};

function contract(): ContentProposalJobContract {
  const partial = {
    id: ids.contract,
    requestContractVersion: "content-proposal-request.v2",
    baseInputContractVersion: "proposal-base-input.v2",
    researchContractVersion: "research-evidence.v1",
    proposalContractVersion: "content-proposal.v2",
    proposalPromptVersion: "proposal.writer.v4",
    proposalOutputSchemaSha256: "54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3",
    modelId: "gpt-5.6-terra",
    requestSha256: proposalSha256(request),
    baseInputSha256: proposalSha256(baseInput),
    contractSourceSha256: "e607bbb891af3723dc4620a0319382e83ee29006ed547aae620086b9809f248d",
    catalogSha256: "6d983b25c51debb7588650165494f6cceffd1b2a921301e8cb79afb38543c9a9",
  };
  const commandDescriptorSha256 = proposalSha256({
    runner: "codex-exec",
    model: partial.modelId,
    promptVersion: partial.proposalPromptVersion,
    outputSchemaSha256: partial.proposalOutputSchemaSha256,
    requestContractVersion: partial.requestContractVersion,
    baseInputContractVersion: partial.baseInputContractVersion,
    researchContractVersion: partial.researchContractVersion,
    proposalContractVersion: partial.proposalContractVersion,
  });
  return {
    ...partial,
    commandDescriptorSha256,
    enqueueContractSha256: proposalSha256({
      jobId: ids.job,
      batchId: ids.batch,
      workspaceId: ids.workspace,
      brandId: ids.brand,
      requestSha256: partial.requestSha256,
      baseInputSha256: partial.baseInputSha256,
      commandDescriptorSha256,
      contractSourceSha256: partial.contractSourceSha256,
      catalogSha256: partial.catalogSha256,
    }),
  };
}

const common = {
  id: ids.job,
  workspaceId: ids.workspace,
  brandId: ids.brand,
  batchId: ids.batch,
  status: "processing" as const,
  maxAttempts: 3,
  workerId: "proposal-worker-1",
  leaseToken: ids.lease,
  leaseExpiresAt: new Date(Date.now() + 180_000).toISOString(),
  availableAt: "2026-08-01T04:00:00.000Z",
  executionTier: "fast" as const,
  request,
  contract: contract(),
};

export function researchJob(): ContentProposalResearchJob {
  return {
    ...structuredClone(common),
    stage: "research_required",
    attemptCount: 0,
    researchAttemptId: ids.researchAttempt,
    researchAttemptNumber: 1,
    baseInput: structuredClone(baseInput),
    researchSourceAcquisition: structuredClone(researchSourceAcquisition),
  };
}

export function researchJobWithBase(input: ProposalBaseInputSnapshotV2): ContentProposalResearchJob {
  const job = researchJob();
  job.baseInput = structuredClone(input);
  job.contract.baseInputSha256 = proposalSha256(job.baseInput);
  job.contract.enqueueContractSha256 = proposalSha256({
    jobId: job.id,
    batchId: job.batchId,
    workspaceId: job.workspaceId,
    brandId: job.brandId,
    requestSha256: job.contract.requestSha256,
    baseInputSha256: job.contract.baseInputSha256,
    commandDescriptorSha256: job.contract.commandDescriptorSha256,
    contractSourceSha256: job.contract.contractSourceSha256,
    catalogSha256: job.contract.catalogSha256,
  });
  return job;
}

export function compositionJob(): ContentProposalCompositionJob {
  const evidenceSetSha256 = proposalSha256([evidence]);
  const composedInputSha256 = proposalSha256(composedInput);
  const modelSha256 = proposalSha256({ modelId: common.contract.modelId });
  return {
    ...structuredClone(common),
    stage: "composition_ready",
    attemptCount: 1,
    modelAttemptId: ids.modelAttempt,
    modelAttemptNumber: 1,
    compositionId: ids.composition,
    composedInput: structuredClone(composedInput),
    evidenceSetSha256,
    composedInputSha256,
    finalInvocationAggregateSha256: proposalSha256({
      enqueueContractSha256: common.contract.enqueueContractSha256,
      modelId: common.contract.modelId,
      commandDescriptorSha256: common.contract.commandDescriptorSha256,
      proposalOutputSchemaSha256: common.contract.proposalOutputSchemaSha256,
      evidenceSetSha256,
      composedInputSha256,
    }),
    modelSha256,
  };
}

function proposal(key: string) {
  return {
    conceptKey: key,
    title: `구성안 ${key}`,
    informationalType: "how_to" as const,
    oneLineIntent: `의도 ${key}`,
    differentiator: `차별점 ${key}`,
    differentiationAxes: ["narrative" as const],
    target: `창업자 ${key}`,
    customerContext: `운영 시작 ${key}`,
    keyMessage: `메시지 ${key}`,
    hook: `훅 ${key}`,
    selectionReason: `이유 ${key}`,
    evidenceIds: [ids.evidence],
    referenceIds: [],
    outputFormat: "card_news" as const,
    channelTargets: ["instagram" as const],
    assetCount: 1,
    outline: [{ index: 1, role: "hook", headline: `제목 ${key}`, purpose: `목적 ${key}` }],
    purposeDetails: {
      kind: "informational" as const,
      question: `질문 ${key}`,
      value: `가치 ${key}`,
      whyNow: `시점 ${key}`,
      learningPoints: [`학습 ${key}`],
    },
  };
}

export const proposalSet: ContentProposalSetV2 = {
  contractVersion: "content-proposal.v2",
  proposals: [proposal("a"), proposal("b"), proposal("c")],
};
