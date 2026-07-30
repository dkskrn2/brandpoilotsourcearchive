import { describe, expect, it } from "vitest";
import { parseContentQualityBrief } from "./contentQualityBrief.js";

const validBrief = {
  version: "content-quality.v1",
  hook: "승인 지연이 콘텐츠 운영을 멈춥니다",
  readerPayoff: "승인 병목을 찾는 세 가지 기준을 알 수 있습니다",
  whyNow: "콘텐츠 발행량이 늘수록 승인 지연 비용도 커집니다",
  specificClaims: ["승인 담당자를 한 명으로 정한다", "24시간 안에 승인 여부를 결정한다"],
  evidence: [
    { claim: "담당자 단일화", support: "자사 서비스 페이지의 승인 흐름 설명", sourceUrl: "https://example.com/service" },
    { claim: "승인 기한 설정", support: "자사 FAQ의 운영 정책", sourceUrl: "https://example.com/faq" },
  ],
  sourceGaps: [],
};

describe("content quality brief", () => {
  it("accepts a structured brief with at least two concrete evidence items", () => {
    expect(parseContentQualityBrief(validBrief)).toEqual(validBrief);
  });

  it("rejects a brief with fewer than two evidence items", () => {
    expect(() => parseContentQualityBrief({
      ...validBrief,
      evidence: validBrief.evidence.slice(0, 1),
    })).toThrow("content_quality_evidence_insufficient");
  });

  it("rejects generic or empty evidence", () => {
    expect(() => parseContentQualityBrief({
      ...validBrief,
      evidence: [
        { claim: "좋은 콘텐츠", support: "좋습니다" },
        { claim: "유용한 콘텐츠", support: "유용합니다" },
      ],
    })).toThrow("content_quality_evidence_invalid");
  });

  it("normalizes one-based claim indexes emitted by a CLI worker", () => {
    expect(parseContentQualityBrief({
      ...validBrief,
      evidence: [
        { claimIndex: 1, support: "제품 페이지에서 첫 번째 주장을 확인했습니다" },
        { claimIndex: 2, support: "제품 페이지에서 두 번째 주장을 확인했습니다" },
      ],
    }).evidence).toEqual([
      { claim: validBrief.specificClaims[0], support: "제품 페이지에서 첫 번째 주장을 확인했습니다" },
      { claim: validBrief.specificClaims[1], support: "제품 페이지에서 두 번째 주장을 확인했습니다" },
    ]);
  });
});
