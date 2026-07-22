import { describe, expect, it } from "vitest";
import {
  parseBrandIntelligenceInput,
  parseBrandIntelligenceResult,
  parseCreateBrandAnalysisInput,
  parseEditBrandAnalysisInput,
  parseBrandAnalysisWorkerClaimInput,
  parseBrandAnalysisWorkerLeaseInput,
} from "./brandIntelligenceContracts.js";

function validResult() {
  return {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: "그로스라인은 브랜드 콘텐츠 운영을 지원하는 회사입니다.",
    businessDescription: "자사 자료를 바탕으로 콘텐츠 제작과 게시 운영을 연결합니다.",
    primaryCategory: { code: "marketing", name: "마케팅" },
    subcategories: [{ code: "content-automation", name: "콘텐츠 자동화" }],
    primaryTarget: "콘텐츠 운영 인력이 부족한 중소 브랜드 담당자",
    differentiators: "자사 근거를 재사용하고 승인 이후 게시하는 운영 흐름",
    coreAppeal: "반복적인 콘텐츠 운영 업무를 줄일 수 있습니다.",
    competitors: [{
      name: "경쟁 서비스",
      description: "콘텐츠 제작과 예약 게시를 제공하는 대안입니다.",
      sourceUrls: ["https://competitor.example.com/service"],
    }],
    evidence: [{
      field: "businessDescription",
      claim: "콘텐츠 제작과 게시 운영을 연결합니다.",
      sourceId: "owned-url",
      sourceUrl: "https://example.com/service",
    }],
    sourceGaps: ["공개된 가격 정보가 없습니다."],
  };
}

function validWorkerInput() {
  return {
    contractVersion: "brand-intelligence.v1",
    brand: { id: "brand-1", name: "그로스라인" },
    documents: [{
      sourceId: "owned-url",
      sourceType: "owned_url",
      title: "서비스 소개",
      sourceUrl: "https://example.com/service",
      textBlocks: [{ heading: "서비스", text: "콘텐츠 운영을 지원합니다." }],
      tables: [],
      contentHash: "a".repeat(64),
    }],
    researchPolicy: {
      publicWebSearch: true,
      purposes: ["competitors", "market_context"],
      requireSourceUrl: true,
    },
  };
}

describe("brand intelligence customer inputs", () => {
  it("accepts one owned URL and at most five uploads", () => {
    expect(parseCreateBrandAnalysisInput({
      ownedUrl: " https://example.com/about ",
      uploadIds: ["upload-1", "upload-2"],
      idempotencyKey: " analysis-1 ",
    })).toEqual({
      ownedUrl: "https://example.com/about",
      uploadIds: ["upload-1", "upload-2"],
      idempotencyKey: "analysis-1",
    });

    expect(() => parseCreateBrandAnalysisInput({
      ownedUrl: null,
      uploadIds: Array.from({ length: 6 }, (_, index) => `upload-${index}`),
      idempotencyKey: "analysis-2",
    })).toThrow("brand_analysis_upload_limit_exceeded");
  });

  it("requires a URL or document and rejects unknown fields", () => {
    expect(() => parseCreateBrandAnalysisInput({
      ownedUrl: null,
      uploadIds: [],
      idempotencyKey: "analysis-1",
    })).toThrow("brand_analysis_source_required");
    expect(() => parseCreateBrandAnalysisInput({
      ownedUrl: "http://example.com",
      uploadIds: [],
      idempotencyKey: "analysis-1",
    })).toThrow("brand_analysis_owned_url_invalid");
    expect(() => parseCreateBrandAnalysisInput({
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "analysis-1",
      extra: true,
    })).toThrow("brand_analysis_create_input_invalid");
  });

  it("parses editable review data and worker leases", () => {
    expect(parseEditBrandAnalysisInput({ editedResult: validResult() }).editedResult.primaryTarget)
      .toContain("중소 브랜드");
    expect(parseBrandAnalysisWorkerClaimInput({ workerId: " worker-1 " }))
      .toEqual({ workerId: "worker-1", leaseSeconds: 300 });
    expect(parseBrandAnalysisWorkerLeaseInput({
      workerId: "worker-1",
      leaseToken: "lease-1",
      leaseSeconds: 120,
    })).toEqual({ workerId: "worker-1", leaseToken: "lease-1", leaseSeconds: 120 });
  });
});

describe("brand-intelligence.v1 worker input", () => {
  it("normalizes the evidence contract", () => {
    const parsed = parseBrandIntelligenceInput(validWorkerInput());
    expect(parsed.contractVersion).toBe("brand-intelligence.v1");
    expect(parsed.documents[0]?.textBlocks[0]).toEqual({
      heading: "서비스",
      text: "콘텐츠 운영을 지원합니다.",
    });
  });

  it("rejects altered research policy and unknown nested keys", () => {
    const policy = validWorkerInput();
    policy.researchPolicy.publicWebSearch = false;
    expect(() => parseBrandIntelligenceInput(policy))
      .toThrow("brand_intelligence_research_policy_invalid");

    const unknown = validWorkerInput();
    unknown.documents[0] = { ...unknown.documents[0], invented: true } as typeof unknown.documents[0];
    expect(() => parseBrandIntelligenceInput(unknown))
      .toThrow("brand_intelligence_document_invalid");
  });
});

describe("brand-intelligence-result.v1 worker output", () => {
  it("returns editable fields, categories, evidence and sourced competitors", () => {
    expect(parseBrandIntelligenceResult(validResult())).toMatchObject({
      contractVersion: "brand-intelligence-result.v1",
      primaryCategory: { code: "marketing", name: "마케팅" },
      primaryTarget: "콘텐츠 운영 인력이 부족한 중소 브랜드 담당자",
    });
  });

  it("rejects competitors without public sources and unknown fields", () => {
    const unsourced = validResult();
    unsourced.competitors[0]!.sourceUrls = [];
    expect(() => parseBrandIntelligenceResult(unsourced))
      .toThrow("brand_intelligence_competitor_invalid");
    expect(() => parseBrandIntelligenceResult({ ...validResult(), invented: true }))
      .toThrow("brand_intelligence_result_invalid");
  });

  it("bounds narrative fields and evidence collections", () => {
    expect(() => parseBrandIntelligenceResult({
      ...validResult(),
      primaryTarget: "x".repeat(4_001),
    })).toThrow("brand_intelligence_primary_target_invalid");
    expect(() => parseBrandIntelligenceResult({
      ...validResult(),
      sourceGaps: Array.from({ length: 51 }, () => "gap"),
    })).toThrow("brand_intelligence_source_gaps_invalid");
  });
});
