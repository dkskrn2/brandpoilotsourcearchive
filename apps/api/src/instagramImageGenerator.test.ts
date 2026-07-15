import { describe, expect, it } from "vitest";
import { buildInstagramCardImagePrompt } from "./instagramImageGenerator";

describe("instagramImageGenerator", () => {
  it("builds one job prompt that lets Codex choose one to five separate cards", () => {
    const prompt = buildInstagramCardImagePrompt({
      brandProfile: {
        categoryContext: "여행·관광 / 여행 상담",
        serviceDescription: "제주 일정과 숙소 동선을 상담합니다.",
        primaryCustomer: "제주 가족 여행자",
        tone: "친절하지만 과장 없는 전문가 톤"
      },
      masterDraft: {
        title: "제주 가족여행 숙소 선택법",
        contentTheme: "이동 동선 중심 숙소 선택",
        coreMessage: "후기보다 가족의 이동 동선을 먼저 확인하세요.",
        targetAudience: "아이와 제주를 여행하는 가족",
        customerProblem: "후기가 많아도 우리 가족에게 맞는 위치인지 판단하기 어렵습니다.",
        keyPoints: ["주요 방문지 사이 이동 시간을 확인합니다.", "숙소 이동 횟수를 줄입니다."],
        supportingEvidence: ["자사 상담 자료에서 이동 동선 질문이 반복됐습니다."]
      },
      instagram: {
        title: "숙소 후기보다 먼저 볼 것",
        caption: "가족여행은 숙소 평점보다 이동 동선이 중요합니다.",
        hashtags: ["#제주여행", "#가족여행"]
      }
    });

    expect(prompt).toContain("최소 1장, 최대 5장");
    expect(prompt).toContain("각 카드는 하나의 독립된 PNG 파일");
    expect(prompt).toContain("공감, 공유, 저장");
    expect(prompt).toContain("여행·관광 / 여행 상담");
    expect(prompt).toContain("친절하지만 과장 없는 전문가 톤");
    expect(prompt).toContain("이동 동선 중심 숙소 선택");
    expect(prompt).toContain("숙소 후기보다 먼저 볼 것");
    expect(prompt).not.toContain("현재 카드 한 장만 생성");
    expect(prompt).not.toContain("Jeju Pilot");
  });
});
