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

  it("rejects generic CTA copy", () => {
    expect(() => formatInstagramCaption(
      "서비스를 더 잘 전달하는 기준을 정리했습니다.\n\n자세히 확인하기",
      ["#브랜딩", "#콘텐츠마케팅", "#사업성장"]
    )).toThrow("instagram_caption_prohibited_cta");
  });

  it("publishes a valid single-paragraph AI caption instead of rejecting the carousel", () => {
    expect(formatInstagramCaption(
      "브랜드 자료를 일관된 발행 흐름으로 연결합니다.",
      ["#Growthline", "#마케팅통합솔루션", "#브랜드콘텐츠", "#콘텐츠운영", "#브랜드전략"]
    )).toBe(
      "브랜드 자료를 일관된 발행 흐름으로 연결합니다.\n\n#Growthline #마케팅통합솔루션 #브랜드콘텐츠 #콘텐츠운영 #브랜드전략"
    );
  });

  it("publishes a generated caption with four valid hashtags", () => {
    expect(formatInstagramCaption(
      "콘텐츠 운영 기준을 정리해 브랜드 신뢰를 높입니다.",
      ["#콘텐츠운영", "#브랜드신뢰", "#콘텐츠마케팅", "#AI콘텐츠"]
    )).toBe(
      "콘텐츠 운영 기준을 정리해 브랜드 신뢰를 높입니다.\n\n#콘텐츠운영 #브랜드신뢰 #콘텐츠마케팅 #AI콘텐츠"
    );
  });

  it("limits generated hashtags to the first five instead of failing the publish", () => {
    expect(formatInstagramCaption(
      "Neon Rebels의 라이프스타일 큐레이션 전략을 정리했습니다.",
      [
        "#NeonRebels",
        "#Maisonette",
        "#트윈마켓",
        "#라이프스타일큐레이션",
        "#카테고리확장",
        "#브랜드전략",
        "#고객경험"
      ]
    )).toBe(
      "Neon Rebels의 라이프스타일 큐레이션 전략을 정리했습니다.\n\n#NeonRebels #Maisonette #트윈마켓 #라이프스타일큐레이션 #카테고리확장"
    );
  });

  it("normalizes mixed prefixed and bare generated hashtags before limiting them", () => {
    expect(formatInstagramCaption(
      "소규모 기업의 소셜 미디어 운영 기준을 정리했습니다.",
      [
        "#소규모기업",
        "소셜미디어마케팅",
        "콘텐츠전략",
        "콘텐츠캘린더",
        "숏폼콘텐츠",
        "SNS운영"
      ]
    )).toBe(
      "소규모 기업의 소셜 미디어 운영 기준을 정리했습니다.\n\n#소규모기업 #소셜미디어마케팅 #콘텐츠전략 #콘텐츠캘린더 #숏폼콘텐츠"
    );
  });

  it("deduplicates equivalent generated hashtags after normalization", () => {
    expect(formatInstagramCaption(
      "중복 태그를 제거합니다.",
      ["#AI콘텐츠", "AI콘텐츠", "#ai콘텐츠", "브랜드전략"]
    )).toBe(
      "중복 태그를 제거합니다.\n\n#AI콘텐츠 #브랜드전략"
    );
  });

  it.each([
    ["empty", [""]],
    ["whitespace", ["콘텐츠 전략"]],
    ["embedded hash", ["콘텐츠#전략"]],
    ["non-string", [42]],
  ])("rejects an invalid %s hashtag", (_label, hashtags) => {
    expect(() => formatInstagramCaption("유효한 캡션입니다.", hashtags))
      .toThrow("instagram_caption_hashtags_invalid");
  });
});
