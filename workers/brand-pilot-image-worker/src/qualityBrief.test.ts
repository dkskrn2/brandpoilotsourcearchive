import { describe, expect, it } from "vitest";
import { requireQualityBrief } from "./qualityBrief.js";

describe("image worker quality brief", () => {
  it("requires two concrete evidence items before rendering is accepted", () => {
    expect(() => requireQualityBrief({
      version: "content-quality.v1",
      hook: "게시가 늦는 이유",
      readerPayoff: "승인 병목을 찾습니다",
      whyNow: "발행량 증가",
      specificClaims: ["담당자 지정", "기한 설정"],
      evidence: [{ claim: "담당자", support: "서비스 페이지의 담당자 운영 설명입니다" }],
      sourceGaps: [],
    })).toThrow("content_quality_evidence_insufficient");
  });
});
