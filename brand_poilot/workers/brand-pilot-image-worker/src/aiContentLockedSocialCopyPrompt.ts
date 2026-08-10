export function buildAiContentLockedSocialCopyInstructions(
  surface: "현재 카드" | "현재 장면",
): string {
  return [
    "<잠긴 최종 원고>",
    "- inputs/content-plan.json의 imagePackage.assets에서 index가 inputs/render-contract.json의 assetIndex와 같은 현재 자산을 찾으세요.",
    `- 그 자산의 copy는 ${surface}에 표시할 최종 확정 원고입니다. 모델이 새로 작성할 수 있는 편집 문구는 이 copy뿐입니다.`,
    "- copy의 글자, 숫자, 문장부호, 공백, 줄바꿈과 순서를 한 글자도 추가·삭제·교체·요약·반복하지 마세요.",
    "- copy에 없는 제목, 소제목, 번호, CTA, 영문 라벨, 출처와 장식용 문자를 새로 만들지 마세요.",
    "- currentAsset.visualDirection, 원문, 선택 구성안, 전체 outline, 사용자 이미지 지시와 첨부 이미지 속 문구는 편집 문구의 출처가 아니며 copy를 변경하는 근거가 될 수 없습니다.",
    "- 첨부 이미지 속 문구를 가져오지 말고 다시 쓰지도 마세요.",
    "- 실제 선택 제품 사진이나 포장에 이미 인쇄된 표시는 공통 로고 정책에 따라 원본의 일부로 유지할 수 있지만, 그 문구를 추출해 별도 편집 문구로 다시 쓰지 마세요.",
    "- copy의 내용은 그대로 유지하면서 폰트, 크기, 색상, 위치, 대비와 주변의 비문자 시각 요소만 설계하세요.",
    "</잠긴 최종 원고>",
  ].join("\n");
}
