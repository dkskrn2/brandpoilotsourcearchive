import { describe, expect, it } from "vitest";
import { parseAiContentManifest } from "./aiContentManifest.js";

function slide(index: number) {
  return {
    role: "slide",
    url: `https://blob.example/slide-${index}.png`,
    fileName: `slide-${index}.png`,
    mimeType: "image/png",
    width: 1080,
    height: 1080,
    index,
  };
}

function cardManifest(count = 1) {
  return {
    version: "ai-content.v1",
    type: "card_news",
    title: "여름 운영 체크리스트",
    assets: Array.from({ length: count }, (_, index) => slide(index + 1)),
    content: {
      caption: "실무에서 먼저 확인할 항목입니다.",
      hashtags: ["브랜드운영", "콘텐츠마케팅"],
      cta: "필요할 때 다시 확인해 보세요.",
    },
  };
}

const validBlog = {
  version: "ai-content.v1",
  type: "blog",
  title: "브랜드 콘텐츠 운영 기준",
  assets: [
    {
      role: "cover",
      url: "https://blob.example/cover.png",
      fileName: "cover.png",
      mimeType: "image/png",
      width: 1200,
      height: 630,
      index: 1,
    },
    {
      role: "html",
      url: "https://blob.example/article.html",
      fileName: "article.html",
      mimeType: "text/html",
      index: 2,
    },
  ],
  content: {
    title: "브랜드 콘텐츠 운영 기준",
    summary: "운영 전에 확인할 기준을 설명합니다.",
    html: "<article><h1>브랜드 콘텐츠 운영 기준</h1><section><h2>먼저 볼 것</h2><p>본문</p></section></article>",
    metaTitle: "브랜드 콘텐츠 운영 기준",
    metaDescription: "콘텐츠 운영 전에 확인할 기준을 정리했습니다.",
    coverAlt: "콘텐츠 운영 체크리스트",
  },
};

const validMarketing = {
  version: "ai-content.v1",
  type: "marketing",
  title: "운영 부담을 줄이는 콘텐츠",
  assets: [
    {
      role: "creative",
      url: "https://blob.example/creative.png",
      fileName: "creative.png",
      mimeType: "image/png",
      width: 1080,
      height: 1350,
      index: 1,
    },
  ],
  content: {
    headline: "매일 쓰지 않아도 콘텐츠는 이어집니다",
    body: "브랜드 자료를 바탕으로 검토 가능한 초안을 만듭니다.",
    cta: "운영 방식 확인하기",
    concept: "콘텐츠 운영 부담 → 반복 생성 → 검토 후 활용",
  },
};

describe("parseAiContentManifest", () => {
  it("accepts card news with one or five slides", () => {
    expect(parseAiContentManifest("card_news", cardManifest(1)).assets).toHaveLength(1);
    expect(parseAiContentManifest("card_news", cardManifest(5)).assets).toHaveLength(5);
  });

  it("rejects six card-news slides", () => {
    expect(() => parseAiContentManifest("card_news", cardManifest(6)))
      .toThrow("ai_content_card_news_slide_count_invalid");
  });

  it("accepts a card-news slide matching the selected ratio", () => {
    const value = cardManifest();
    value.assets[0].height = 1350;
    expect(parseAiContentManifest("card_news", value, { width: 4, height: 5 }).assets[0])
      .toMatchObject({ width: 1080, height: 1350 });
  });

  it("rejects a card-news slide that differs from the selected ratio", () => {
    const value = cardManifest();
    expect(() => parseAiContentManifest("card_news", value, { width: 4, height: 5 }))
      .toThrow("ai_content_card_news_dimensions_invalid");
  });

  it("rejects insecure URLs, duplicate indexes, unsafe filenames, and too many hashtags", () => {
    const insecure = cardManifest();
    insecure.assets[0].url = "http://blob.example/slide.png";
    expect(() => parseAiContentManifest("card_news", insecure)).toThrow("ai_content_asset_url_invalid");

    const duplicate = cardManifest(2);
    duplicate.assets[1].index = 1;
    expect(() => parseAiContentManifest("card_news", duplicate)).toThrow("ai_content_asset_index_invalid");

    const unsafe = cardManifest();
    unsafe.assets[0].fileName = "../slide.png";
    expect(() => parseAiContentManifest("card_news", unsafe)).toThrow("ai_content_asset_file_name_invalid");

    const hashtags = cardManifest();
    hashtags.content.hashtags = ["a", "b", "c", "d", "e", "f"];
    expect(() => parseAiContentManifest("card_news", hashtags)).toThrow("ai_content_card_news_hashtags_invalid");
  });

  it("accepts a valid blog and rejects a missing HTML asset", () => {
    expect(parseAiContentManifest("blog", validBlog).type).toBe("blog");
    expect(() => parseAiContentManifest("blog", { ...validBlog, assets: validBlog.assets.slice(0, 1) }))
      .toThrow("ai_content_blog_html_asset_required");
  });

  it("accepts blog body images when the HTML uses their public URLs", () => {
    const inlineAsset = {
      role: "inline",
      url: "https://blob.example/inline-01.png",
      fileName: "inline-01.png",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      index: 2,
    };
    const htmlAsset = { ...validBlog.assets[1], index: 3 };
    const value = {
      ...validBlog,
      assets: [validBlog.assets[0], inlineAsset, htmlAsset],
      content: { ...validBlog.content, html: `<article><h1>브랜드 콘텐츠 운영 기준</h1><img src="${inlineAsset.url}" alt="운영 흐름"></article>` },
    };
    expect(parseAiContentManifest("blog", value).assets).toHaveLength(3);

    const missingReference = { ...value, content: { ...value.content, html: "<article><h1>제목</h1></article>" } };
    expect(() => parseAiContentManifest("blog", missingReference)).toThrow("ai_content_blog_inline_asset_not_referenced");

    const invalidAlt = { ...value, content: { ...value.content, html: value.content.html.replace("운영 흐름", "flow") } };
    expect(() => parseAiContentManifest("blog", invalidAlt)).toThrow("ai_content_blog_inline_asset_alt_invalid");
  });

  it("accepts five sequential blog inline images and rejects a sixth", () => {
    const inlineAssets = Array.from({ length: 5 }, (_, index) => ({
      role: "inline",
      url: `https://blob.example/inline-${String(index + 1).padStart(2, "0")}.png`,
      fileName: `inline-${String(index + 1).padStart(2, "0")}.png`,
      mimeType: "image/png",
      width: 1200,
      height: 800,
      index: index + 2,
    }));
    const htmlAsset = { ...validBlog.assets[1], index: 7 };
    const html = `<article><h1>브랜드 콘텐츠 운영 기준</h1>${inlineAssets.map((asset, index) => `<img src="${asset.url}" alt="${index + 1}단계 운영 흐름 설명">`).join("")}</article>`;
    const value = { ...validBlog, assets: [validBlog.assets[0], ...inlineAssets, htmlAsset], content: { ...validBlog.content, html } };
    expect(parseAiContentManifest("blog", value).assets).toHaveLength(7);

    const sixth = { ...inlineAssets[0], url: "https://blob.example/inline-06.png", fileName: "inline-06.png", index: 7 };
    const sixValue = {
      ...value,
      assets: [validBlog.assets[0], ...inlineAssets, sixth, { ...htmlAsset, index: 8 }],
      content: { ...validBlog.content, html: html.replace("</article>", `<img src="${sixth.url}" alt="6단계 운영 흐름 설명"></article>`) },
    };
    expect(() => parseAiContentManifest("blog", sixValue)).toThrow("ai_content_blog_inline_asset_count_invalid");
  });

  it("requires an exact 1200x630 blog cover and sequential inline filenames", () => {
    const invalidCover = {
      ...validBlog,
      assets: [{ ...validBlog.assets[0], width: 1200, height: 628 }, validBlog.assets[1]],
    };
    expect(() => parseAiContentManifest("blog", invalidCover)).toThrow("ai_content_blog_cover_dimensions_invalid");

    const inlineAsset = {
      role: "inline",
      url: "https://blob.example/inline-02.png",
      fileName: "inline-02.png",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      index: 2,
    };
    const invalidSequence = {
      ...validBlog,
      assets: [validBlog.assets[0], inlineAsset, { ...validBlog.assets[1], index: 3 }],
      content: { ...validBlog.content, html: `<article><h1>제목</h1><img src="${inlineAsset.url}" alt="운영 흐름 설명"></article>` },
    };
    expect(() => parseAiContentManifest("blog", invalidSequence)).toThrow("ai_content_blog_inline_asset_sequence_invalid");
  });

  it("rejects unsafe blog HTML and multiple h1 elements", () => {
    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><script>alert(1)</script></article>" },
    })).toThrow("ai_content_blog_html_script_forbidden");

    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><h1>y</h1></article>" },
    })).toThrow("ai_content_blog_html_h1_count_invalid");

    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><a href=\"javascript&#x3a;alert(1)\">x</a></article>" },
    })).toThrow("ai_content_blog_html_javascript_url_forbidden");

    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><img on&#x6c;oad=\"alert(1)\"></article>" },
    })).toThrow("ai_content_blog_html_event_handler_forbidden");

    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><form action=\"/send\"></form></article>" },
    })).toThrow("ai_content_blog_html_form_forbidden");

    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      content: { ...validBlog.content, html: "<article><h1>x</h1><iframe src=\"https://example.com\"></iframe></article>" },
    })).toThrow("ai_content_blog_html_iframe_forbidden");
  });

  it("rejects URL-encoded traversal in asset filenames", () => {
    const unsafe = cardManifest();
    unsafe.assets[0].fileName = "%2e%2e%2fslide.png";
    expect(() => parseAiContentManifest("card_news", unsafe))
      .toThrow("ai_content_asset_file_name_invalid");
  });

  it("accepts marketing dimensions and rejects a mismatch", () => {
    expect(parseAiContentManifest("marketing", validMarketing).type).toBe("marketing");
    expect(parseAiContentManifest("marketing", validMarketing, { width: 1080, height: 1350 }).type).toBe("marketing");
    expect(() => parseAiContentManifest("marketing", validMarketing, { width: 1080, height: 1920 }))
      .toThrow("ai_content_marketing_dimensions_mismatch");
  });

  it("rejects a manifest type mismatch", () => {
    expect(() => parseAiContentManifest("blog", cardManifest()))
      .toThrow("ai_content_manifest_type_mismatch");
  });
});
