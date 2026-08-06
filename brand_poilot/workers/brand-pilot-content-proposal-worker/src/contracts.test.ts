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

describe("Proposal V2 claim contract", () => {
  it("accepts the closed research claim with model attemptCount zero", () => {
    const input = researchJob();
    expect(parseContentProposalJob(input)).toEqual(input);
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

  it("requires composition attemptCount to be positive and equal modelAttemptNumber", () => {
    const zero = { ...compositionJob(), attemptCount: 0 };
    const mismatch = { ...compositionJob(), attemptCount: 2, modelAttemptNumber: 1 };
    for (const candidate of [zero, mismatch]) {
      expect(() => parseContentProposalJob(candidate)).toThrow("content_proposal_claim_contract_mismatch");
    }
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
});
