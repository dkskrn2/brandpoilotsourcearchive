import { describe, expect, it } from "vitest";
import * as contractModule from "./contracts.js";
import {
  CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH,
  isContentProposalCompositionJob,
  parseContentProposalJob,
  parseContentProposalSetV2,
  parseResearchSeal,
} from "./contracts.js";
import {
  baseInput,
  compositionJob,
  evidence,
  proposalSet,
  researchJob,
  researchJobWithBase,
} from "./testFixtures.js";

function resealComposition(job: ReturnType<typeof compositionJob>) {
  const { researchEvidence, ...withoutEvidence } = job.composedInput;
  const base = { ...withoutEvidence, contractVersion: "proposal-base-input.v2" };
  job.contract.requestSha256 = contractModule.proposalSha256(job.request);
  job.contract.baseInputSha256 = contractModule.proposalSha256(base);
  job.contract.enqueueContractSha256 = contractModule.proposalSha256({
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
  job.evidenceSetSha256 = contractModule.proposalSha256([researchEvidence]);
  job.composedInputSha256 = contractModule.proposalSha256(job.composedInput);
  job.finalInvocationAggregateSha256 = contractModule.proposalSha256({
    enqueueContractSha256: job.contract.enqueueContractSha256,
    modelId: job.contract.modelId,
    commandDescriptorSha256: job.contract.commandDescriptorSha256,
    proposalOutputSchemaSha256: job.contract.proposalOutputSchemaSha256,
    evidenceSetSha256: job.evidenceSetSha256,
    composedInputSha256: job.composedInputSha256,
  });
  return job;
}

function zeroEvidenceMarketingComposition(outputFormat: "card_news" | "reel" | "blog") {
  const job = compositionJob();
  job.request.purpose = "marketing";
  job.request.outputFormat = outputFormat;
  job.request.channelTargets = outputFormat === "blog" ? ["blog_export"] : ["instagram"];
  job.composedInput.outputSettings = {
    ...job.composedInput.outputSettings,
    purpose: "marketing",
    outputFormat,
    channelTargets: outputFormat === "blog" ? ["blog_export"] : ["instagram"],
    aspectRatio: outputFormat === "blog" ? null : outputFormat === "reel" ? "9:16" : "1:1",
  };
  job.composedInput.product = {
    id: "c0000000-0000-4000-8000-00000000000c",
    versionId: "d0000000-0000-4000-8000-00000000000d",
    kind: "service",
    name: "승인 제품",
    description: "승인된 설명",
    features: [], benefits: [], cautions: [], evergreenPurchaseInfo: "", images: [],
  };
  job.composedInput.researchEvidence = {
    contractVersion: "research-evidence.v1",
    decision: "not_needed",
    reason: "근거 없음",
    queries: [],
    capturedAt: "2026-08-01T04:00:00.000Z",
    items: [],
  };
  return resealComposition(job);
}

describe("Proposal V2 claim contract", () => {
  it("accepts the closed research claim with model attemptCount zero", () => {
    const input = researchJob();
    expect(parseContentProposalJob(input)).toEqual(input);
  });

  it("rejects a malformed acquisition sidecar before research", () => {
    const input = researchJob();
    expect(() => parseContentProposalJob({
      ...input,
      researchSourceAcquisition: { ...input.researchSourceAcquisition, status: "unknown" },
    })).toThrow("content_proposal_job_invalid");
  });

  it("accepts the closed composition claim and rejects V1 or mixed-arm fields", () => {
    const input = compositionJob();
    expect(isContentProposalCompositionJob(parseContentProposalJob(input))).toBe(true);
    expect(() => parseContentProposalJob({ ...input, inputSnapshot: input.composedInput })).toThrow(
      "content_proposal_job_invalid",
    );
    expect(() => parseContentProposalJob({
      ...researchJob(),
      request: { contractVersion: "content-proposal-request.v1" },
    })).toThrow("content_proposal_job_invalid");
  });

  it("requires Evidence for manual marketing card news and reels but preserves marketing blog behavior", () => {
    expect(() => parseContentProposalJob(zeroEvidenceMarketingComposition("card_news")))
      .toThrow("content_proposal_claim_contract_mismatch");
    expect(() => parseContentProposalJob(zeroEvidenceMarketingComposition("reel")))
      .toThrow("content_proposal_claim_contract_mismatch");
    expect(() => parseContentProposalJob(zeroEvidenceMarketingComposition("blog")))
      .not.toThrow();
  });

  it("requires composition attemptCount to be positive and equal modelAttemptNumber", () => {
    const zero = { ...compositionJob(), attemptCount: 0 };
    const mismatch = { ...compositionJob(), attemptCount: 2, modelAttemptNumber: 1 };
    for (const candidate of [zero, mismatch]) {
      expect(() => parseContentProposalJob(candidate)).toThrow("content_proposal_claim_contract_mismatch");
    }
  });

  it("rejects a v3 Proposal claim instead of accepting two prompt versions", () => {
    const input = compositionJob();
    input.contract.proposalPromptVersion = "proposal.writer.v3";
    expect(() => parseContentProposalJob(input)).toThrow("content_proposal_claim_contract_mismatch");
  });

  it("rejects request, base, command, enqueue, model, and aggregate hash drift", () => {
    const cases = [
      { ...researchJob(), contract: { ...researchJob().contract, requestSha256: "0".repeat(64) } },
      { ...researchJob(), contract: { ...researchJob().contract, baseInputSha256: "0".repeat(64) } },
      { ...researchJob(), contract: { ...researchJob().contract, commandDescriptorSha256: "0".repeat(64) } },
      { ...researchJob(), contract: { ...researchJob().contract, enqueueContractSha256: "0".repeat(64) } },
      { ...compositionJob(), modelSha256: "0".repeat(64) },
      { ...compositionJob(), finalInvocationAggregateSha256: "0".repeat(64) },
    ];
    for (const candidate of cases) {
      expect(() => parseContentProposalJob(candidate)).toThrow("content_proposal_claim_contract_mismatch");
    }
  });

  it("rejects purpose/product and format/channel/aspect drift before research or model work", () => {
    const productInput = structuredClone(baseInput);
    productInput.product = {
      id: "c0000000-0000-4000-8000-00000000000c",
      versionId: "d0000000-0000-4000-8000-00000000000d",
      kind: "service", name: "금지된 제품", description: "정보성 입력에는 제품이 없어야 함",
      features: [], benefits: [], cautions: [], evergreenPurchaseInfo: "", images: [],
    };
    const aspectInput = structuredClone(baseInput);
    aspectInput.outputSettings.aspectRatio = "4:5";
    for (const candidate of [researchJobWithBase(productInput), researchJobWithBase(aspectInput)]) {
      expect(() => parseContentProposalJob(candidate)).toThrow("content_proposal_claim_contract_mismatch");
    }
  });

  it("uses the canonical generated Proposal V2 output schema", () => {
    expect(CONTENT_PROPOSAL_OUTPUT_SCHEMA_PATH.replaceAll("\\", "/"))
      .toMatch(/brand-pilot-content-contracts\/generated\/content-proposal-v2\.schema\.json$/);
    expect((contractModule as Record<string, unknown>).CONTENT_PROPOSAL_OUTPUT_SCHEMA_SHA256)
      .toBe("54bf063cf32926874af6b098272df08d41a9e7d7f578ee6560debe44428cf5f3");
  });

  it("binds the research seal back to the claimed job, evidence, and aggregate chain", () => {
    const job = researchJob();
    const composed = compositionJob();
    const seal = {
      jobId: job.id, batchId: job.batchId, compositionId: composed.compositionId,
      composedInput: composed.composedInput, evidenceSetSha256: composed.evidenceSetSha256,
      composedInputSha256: composed.composedInputSha256,
      finalInvocationAggregateSha256: composed.finalInvocationAggregateSha256, status: "queued",
    };
    expect(parseResearchSeal(seal, job, evidence)).toEqual(seal);
    expect(() => parseResearchSeal({ ...seal, jobId: job.workspaceId }, job, evidence))
      .toThrow("content_proposal_research_seal_invalid");
  });
});

describe("Proposal V2 semantic result", () => {
  it("accepts three canonical, substantively distinct proposals bound to the frozen input", () => {
    expect(parseContentProposalSetV2(proposalSet, compositionJob())).toEqual(proposalSet);
  });

  it("rejects escaped evidence, output drift, duplicate concepts, and cosmetic differentiation", () => {
    const escaped = structuredClone(proposalSet);
    escaped.proposals[0].evidenceIds = ["f0000000-0000-4000-8000-00000000000f"];
    const outputDrift = structuredClone(proposalSet);
    outputDrift.proposals[0].outputFormat = "blog";
    const duplicate = structuredClone(proposalSet);
    duplicate.proposals[1] = structuredClone(duplicate.proposals[0]);
    duplicate.proposals[1].conceptKey = "b";
    duplicate.proposals[1].title = "표현만 변경";
    duplicate.proposals[1].differentiator = "표현만 변경";
    for (const candidate of [escaped, outputDrift, duplicate]) {
      expect(() => parseContentProposalSetV2(candidate, compositionJob())).toThrow();
    }
  });

  it.each(["card_news", "reel"] as const)(
  "allows %s concepts to cite different representative frozen evidence and references", (outputFormat) => {
    const job = compositionJob();
    const result = structuredClone(proposalSet);
    job.composedInput.outputSettings.outputFormat = outputFormat;
    job.request.outputFormat = outputFormat;
    const secondEvidenceId = "71000000-0000-4000-8000-000000000007";
    const firstReferenceId = "72000000-0000-4000-8000-000000000007";
    job.composedInput.researchEvidence.items.push({
      ...structuredClone(job.composedInput.researchEvidence.items[0]!),
      id: secondEvidenceId,
      title: "두 번째 검증 자료",
      url: "https://source.example/second",
      contentHash: "b".repeat(64),
    });
    job.composedInput.references.push({
      referenceItemId: firstReferenceId,
      snapshotId: "73000000-0000-4000-8000-000000000007",
      roles: ["content_reference"],
      title: "참고 자료",
      sourceUrl: "https://reference.example/article",
      capturedAt: "2026-08-01T04:00:00.000Z",
      contentHash: "c".repeat(64),
      text: "선택 관점을 보조하는 동결 참고 자료",
      image: null,
    });
    result.proposals[1].evidenceIds = [secondEvidenceId];
    result.proposals[2].referenceIds = [firstReferenceId];
    for (const proposal of result.proposals) proposal.outputFormat = outputFormat;

    expect(parseContentProposalSetV2(result, job)).toEqual(result);
  });

  it.each(["blog"] as const)(
    "keeps the existing identical representative evidence sets for %s proposals",
    (outputFormat) => {
      const job = compositionJob();
      const result = structuredClone(proposalSet);
      const secondEvidenceId = "71000000-0000-4000-8000-000000000007";
      job.composedInput.outputSettings.outputFormat = outputFormat;
      job.request.outputFormat = outputFormat;
      job.composedInput.researchEvidence.items.push({
        ...structuredClone(job.composedInput.researchEvidence.items[0]!),
        id: secondEvidenceId,
        title: "두 번째 검증 자료",
        url: "https://source.example/second",
        contentHash: "b".repeat(64),
      });
      for (const proposal of result.proposals) {
        proposal.outputFormat = outputFormat;
        if (outputFormat === "blog") proposal.assetCount = null;
      }
      result.proposals[1].evidenceIds = [secondEvidenceId];

      expect(() => parseContentProposalSetV2(result, job))
        .toThrow("content_proposal_result_not_distinct");
    },
  );
});
