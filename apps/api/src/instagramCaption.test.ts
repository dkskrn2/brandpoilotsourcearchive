import { describe, expect, it } from "vitest";
import { formatInstagramCaption } from "./instagramCaption";

describe("formatInstagramCaption", () => {
  it("separates readable paragraphs from exactly five hashtags in the published caption", () => {
    expect(formatInstagramCaption(
      "서비스가 좋아도 처음 전달되는 메시지가 흐리면 고객은 다음 행동을 결정하기 어렵습니다.\n\n처음부터 고객이 이해할 구조와 기준을 함께 설계해야 운영이 흔들리지 않습니다.",
      ["#브랜딩", "#브랜드전략", "#콘텐츠마케팅", "#고객경험", "#사업성장"]
    )).toBe(
      "서비스가 좋아도 처음 전달되는 메시지가 흐리면 고객은 다음 행동을 결정하기 어렵습니다.\n\n처음부터 고객이 이해할 구조와 기준을 함께 설계해야 운영이 흔들리지 않습니다.\n\n#브랜딩 #브랜드전략 #콘텐츠마케팅 #고객경험 #사업성장"
    );
  });

  it("rejects generic CTA copy and fewer than five hashtags", () => {
    expect(() => formatInstagramCaption(
      "서비스를 더 잘 전달하는 기준을 정리했습니다.\n\n자세히 확인하기",
      ["#브랜딩", "#콘텐츠마케팅", "#사업성장"]
    )).toThrow("instagram_caption_prohibited_cta");
  });
});
