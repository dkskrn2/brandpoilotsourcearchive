import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";

export const reelPlanSkillVersion = "reel-plan-skill.v3";

export function buildReelPlanPrompt(input: ContentGenerationInputV3, repairError?: string): string {
  if (input.outputSettings.outputFormat !== "reel") throw new Error("reel_input_invalid");
  const assetCount = input.selectedProposal.assetCount;
  if (assetCount === null) throw new Error("reel_asset_count_invalid");
  const purpose = input.outputSettings.purpose;
  const purposeRules = purpose === "informational"
    ? [
      "정보성 릴스: 교육, 문제 해결, 가이드 중심으로 구성하고 판매 주장이나 구매 압박을 넣지 마세요.",
      "CTA는 저장, 공유, 질문처럼 비판매 행동만 사용하세요.",
    ]
    : purpose === "marketing"
      ? [
        "마케팅성 릴스: 고정 product와 선택 proposal의 고객 상황, 강점, 한계, 구매 장벽, CTA를 사용하세요.",
        "제품 기능, 가격, 성과, 구매 조건은 고정 product 밖에서 추측하지 마세요.",
      ]
      : (() => { throw new Error("reel_purpose_invalid"); })();
  return [
    "V3 릴스 상세 기획만 수행하세요.",
    `계약 버전: ${reelPlanSkillVersion}`,
    "응답은 reel-plan.v2 JSON 하나만 반환하세요.",
    `선택 proposal에 잠긴 정확히 ${assetCount}개 장면과 순서를 유지하세요.`,
    "모든 장면은 9:16 세로 이미지용 copy와 visualDirection을 가져야 합니다.",
    "영상 조립과 이미지 생성은 후속 단계의 책임입니다. 파일, 웹, shell, image_generation 도구를 호출하지 마세요.",
    ...purposeRules,
    repairError ? `이전 출력 검증 오류: ${repairError}\n전체 JSON을 한 번만 수정해 다시 반환하세요.` : "첫 출력부터 exact schema를 만족하세요.",
    "고정 입력(JSON):",
    JSON.stringify(input, null, 2),
  ].join("\n");
}
