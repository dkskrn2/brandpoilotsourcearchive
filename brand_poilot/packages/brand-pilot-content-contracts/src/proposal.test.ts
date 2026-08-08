import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  RESEARCH_EVIDENCE_VERSION,
} from "./catalog.js";
import {
  ContentProposalRequestV2Schema,
  ContentProposalSetV2Schema,
  ProposalBaseInputSnapshotV2Schema,
  ProposalInputSnapshotV2Schema,
  parseContentProposalRequestV2,
  parseContentProposalSetV2,
  parseProposalBaseInputSnapshotV2,
  parseProposalInputSnapshotV2,
  parseResearchEvidenceSnapshotV1,
} from "./proposal.js";

const UUIDS = {
  brandVersion: "00000000-0000-4000-8000-000000000010",
  product: "00000000-0000-4000-8000-000000000020",
  productVersion: "00000000-0000-4000-8000-000000000021",
  evidence: "00000000-0000-4000-8000-000000000030",
} as const;

const brandCore = {
  versionId: UUIDS.brandVersion,
  companyOverview: "브랜드 개요",
  businessDescription: "사업 설명",
  primaryCategory: "테크",
  detailedCategory: "생산성",
  primaryTarget: "실무자",
  differentiator: "검증된 자동화",
  coreAppeal: "빠른 실행",
};

const product = {
  id: UUIDS.product,
  versionId: UUIDS.productVersion,
  kind: "product",
  name: "검증 상품",
  description: "상품 설명",
  features: ["기능"],
  benefits: ["효과"],
  cautions: [],
  evergreenPurchaseInfo: "",
  images: [],
};

const researchEvidence = {
  contractVersion: RESEARCH_EVIDENCE_VERSION,
  decision: "searched",
  reason: "최신 근거가 필요함",
  queries: ["검증 검색어"],
  capturedAt: "2026-08-05T00:00:00.000Z",
  items: [{
    id: UUIDS.evidence,
    title: "검증 근거",
    url: "https://example.com/evidence",
    publisher: null,
    publishedAt: null,
    capturedAt: "2026-08-05T00:00:00.000Z",
    claimSummary: "검증된 주장",
    contentHash: "b".repeat(64),
  }],
};

function baseInput() {
  return {
    contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput,
    brandCore,
    subject: { kind: "topic_text", title: "검증 주제" },
    contentInstruction: null,
    product: null,
    references: [],
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
      purpose: "informational",
    },
    capturedAt: "2026-08-05T00:00:00.000Z",
  } as const;
}

function proposal(index: number) {
  return {
    conceptKey: `concept-${index}`,
    title: `제안 ${index}`,
    informationalType: "how_to",
    oneLineIntent: "실행 방법을 설명한다",
    differentiator: `차별점 ${index}`,
    differentiationAxes: ["narrative"],
    target: "실무자",
    customerContext: "업무 자동화가 필요한 상황",
    keyMessage: "검증된 순서로 실행한다",
    hook: `훅 ${index}`,
    selectionReason: "근거와 형식이 일치한다",
    evidenceIds: [UUIDS.evidence],
    referenceIds: [],
    outputFormat: "card_news",
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "slide", headline: "핵심", purpose: "설명" }],
    purposeDetails: {
      kind: "informational",
      question: "어떻게 실행하는가?",
      value: "실행 순서를 얻는다",
      whyNow: "지금 검증이 필요하다",
      learningPoints: ["첫 단계"],
    },
  } as const;
}

describe("proposal V2 schemas", () => {
  it("sources purpose-detail discriminators from the catalog", () => {
    const source = readFileSync(new URL("./proposal.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Type\.Literal\("(?:informational|marketing)"\)/);
  });

  it("derives parser helper results from checked schemas and reuses the UUID schema", () => {
    for (const fileName of ["proposal.ts", "generation.ts", "plans.ts"]) {
      const source = readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
      expect(source, fileName).toContain("function parse<S extends TSchema>");
      expect(source, fileName).toContain("): Static<S> {");
      expect(source, fileName).not.toContain("function parse<T>");
    }

    const proposalSource = readFileSync(new URL("./proposal.ts", import.meta.url), "utf8");
    expect(proposalSource).toContain("UuidSchema");
    expect(proposalSource).not.toContain('pattern: "^[0-9a-fA-F]{8}');
  });

  it("parses the exact persisted request and lowercase fingerprint", () => {
    const request = {
      contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.request,
      purpose: "informational",
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      requestFingerprint: "a".repeat(64),
    };

    expect(parseContentProposalRequestV2(request)).toEqual(request);
    expect(ContentProposalRequestV2Schema.properties.contractVersion.const)
      .toBe(CONTENT_PROPOSAL_CONTRACT_VERSIONS.request);
    expect(() => parseContentProposalRequestV2({ ...request, requestFingerprint: "A".repeat(64) }))
      .toThrow("content_proposal_request_v2_invalid");
    expect(() => parseContentProposalRequestV2({ ...request, extra: true }))
      .toThrow("content_proposal_request_v2_invalid");
  });

  it("keeps base and composed inputs exact and independently versioned", () => {
    const base = baseInput();
    const { contractVersion: _baseVersion, ...shared } = base;
    const composed = {
      contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput,
      ...shared,
      researchEvidence,
    };

    expect(parseProposalBaseInputSnapshotV2(base).product).toBeNull();
    expect(parseProposalInputSnapshotV2(composed).researchEvidence).toEqual(researchEvidence);
    expect(ProposalBaseInputSnapshotV2Schema.properties.contractVersion.const)
      .toBe(CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput);
    expect(ProposalInputSnapshotV2Schema.properties.contractVersion.const)
      .toBe(CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput);
    expect(() => parseProposalBaseInputSnapshotV2(composed))
      .toThrow("proposal_base_input_v2_invalid");
    expect(() => parseProposalInputSnapshotV2(base))
      .toThrow("proposal_input_v2_invalid");
  });

  it("permits the approved product snapshot's empty evergreen purchase info", () => {
    const marketing = {
      ...baseInput(),
      product,
      outputSettings: { ...baseInput().outputSettings, purpose: "marketing" },
    };

    expect(parseProposalBaseInputSnapshotV2(marketing).product?.evergreenPurchaseInfo).toBe("");
  });

  it("parses research evidence only at its catalog version", () => {
    expect(parseResearchEvidenceSnapshotV1(researchEvidence)).toEqual(researchEvidence);
  });

  it("requires exactly three structurally valid proposals at the output version", () => {
    const output = {
      contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.output,
      proposals: [proposal(1), proposal(2), proposal(3)],
    };

    expect(parseContentProposalSetV2(output).proposals).toHaveLength(3);
    expect(ContentProposalSetV2Schema.properties.contractVersion.const)
      .toBe(CONTENT_PROPOSAL_CONTRACT_VERSIONS.output);
    expect(ContentProposalSetV2Schema.properties.proposals.minItems).toBe(3);
    expect(ContentProposalSetV2Schema.properties.proposals.maxItems).toBe(3);
    expect(() => parseContentProposalSetV2({ ...output, proposals: output.proposals.slice(0, 2) }))
      .toThrow("content_proposal_set_v2_invalid");
    expect(() => parseContentProposalSetV2({ ...output, contractVersion: "content-proposal.v1" }))
      .toThrow("content_proposal_set_v2_invalid");
  });

  it.each([
    {
      name: "request",
      parser: parseContentProposalRequestV2,
      valid: {
        contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.request,
        purpose: "informational",
        outputFormat: "card_news",
        channelTargets: ["instagram"],
        requestFingerprint: "a".repeat(64),
      },
      legacyVersion: "content-proposal-request.v1",
      errorCode: "content_proposal_request_v2_invalid",
    },
    {
      name: "base",
      parser: parseProposalBaseInputSnapshotV2,
      valid: baseInput(),
      legacyVersion: "proposal-base-input.v1",
      errorCode: "proposal_base_input_v2_invalid",
    },
    {
      name: "composed",
      parser: parseProposalInputSnapshotV2,
      valid: (() => {
        const { contractVersion: _version, ...shared } = baseInput();
        return {
          contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput,
          ...shared,
          researchEvidence,
        };
      })(),
      legacyVersion: "proposal-input.v1",
      errorCode: "proposal_input_v2_invalid",
    },
    {
      name: "output",
      parser: parseContentProposalSetV2,
      valid: {
        contractVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.output,
        proposals: [proposal(1), proposal(2), proposal(3)],
      },
      legacyVersion: "content-proposal.v1",
      errorCode: "content_proposal_set_v2_invalid",
    },
    {
      name: "research",
      parser: parseResearchEvidenceSnapshotV1,
      valid: researchEvidence,
      legacyVersion: "research-evidence.v0",
      errorCode: "research_evidence_v1_invalid",
    },
  ])("rejects omitted, unknown, and legacy $name contract versions", ({
    parser,
    valid,
    legacyVersion,
    errorCode,
  }) => {
    const { contractVersion: _version, ...withoutVersion } = valid;
    expect(() => parser(withoutVersion)).toThrow(errorCode);
    expect(() => parser({ ...valid, contractVersion: "unknown.contract.v999" })).toThrow(errorCode);
    expect(() => parser({ ...valid, contractVersion: legacyVersion })).toThrow(errorCode);
  });
});
