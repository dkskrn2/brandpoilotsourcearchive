import { describe, expect, it } from "vitest";
import { normalizeKnowledgeSource } from "./knowledgeNormalizer.js";

describe("knowledge source normalizer", () => {
  it("normalizes whitespace while preserving heading, list, and table order", () => {
    const repeated = "배송 일정은 결제 완료 시점과 배송 지역에 따라 달라지며, 주문 상세 화면에서 최신 상태를 확인할 수 있습니다.";
    const source = [
      "홈 | 제품 | 고객센터\r",
      "\r",
      "#   배송 안내\r",
      "\r",
      `  ${repeated}  \r`,
      "\r",
      "-   서울 지역은 영업일 기준 2일 이내 배송됩니다.\r",
      "- 제주 지역은 기상 상황에 따라 2일이 추가될 수 있습니다.\r",
      "\r",
      "| 구분 | 예상 기간 |\r",
      "| 일반 | 2일 |\r",
      "\r",
      `${repeated}\r`,
      "\r",
      "쿠키 설정 개인정보 처리방침\r",
      "© 2026 Brand. All rights reserved.\r",
      "홈 | 제품 | 고객센터\r",
    ].join("\n");

    const normalized = normalizeKnowledgeSource(source);

    expect(normalized).not.toBeNull();
    expect(normalized).not.toContain("\r");
    expect(normalized).not.toContain("홈 | 제품 | 고객센터");
    expect(normalized).not.toContain("쿠키 설정");
    expect(normalized).not.toContain("All rights reserved");
    expect(normalized?.match(new RegExp(repeated, "g"))).toHaveLength(1);
    expect(normalized).toContain("# 배송 안내");
    expect(normalized).toContain("- 서울 지역은 영업일 기준 2일 이내 배송됩니다.");
    expect(normalized).toContain("| 구분 | 예상 기간 |");
    expect(normalized!.indexOf("# 배송 안내")).toBeLessThan(normalized!.indexOf("- 서울 지역"));
    expect(normalized!.indexOf("- 서울 지역")).toBeLessThan(normalized!.indexOf("| 구분 | 예상 기간 |"));
  });

  it("rejects normalized content shorter than 120 characters", () => {
    expect(normalizeKnowledgeSource("# 안내\n\n짧은 안내입니다.\n\n쿠키 설정")).toBeNull();
  });
});
