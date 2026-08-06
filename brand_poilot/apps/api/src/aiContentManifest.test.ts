import { describe, expect, it } from "vitest";
import { parseActiveAiContentManifestV3, parseAiContentManifest } from "./aiContentManifest.js";

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

function v2Image(role: "slide" | "inline" | "creative" | "scene", index: number, overrides: Record<string, unknown> = {}) {
  return {
    role,
    index,
    url: `https://blob.example/${role}-${index}.png`,
    fileName: `${role}-${index}.png`,
    mimeType: "image/png",
    width: role === "scene" ? 1080 : 1200,
    height: role === "scene" ? 1920 : 800,
    ...overrides,
  };
}

function v2Manifest(
  type: "card_news" | "blog" | "marketing",
  outputFormat: "card_news" | "blog" | "reel" | "marketing_content",
  assets: unknown[],
) {
  return {
    version: "ai-content.v2",
    type,
    purpose: "marketing",
    outputFormat,
    title: "V2 콘텐츠 제목",
    assets,
    content: { planner: { arbitrary: true } },
  };
}

function v2Video(durationSeconds: number, overrides: Record<string, unknown> = {}) {
  return {
    role: "video",
    index: 1,
    url: "https://blob.example/reel.mp4",
    fileName: "reel.mp4",
    mimeType: "video/mp4",
    width: 1080,
    height: 1920,
    durationSeconds,
    videoCodec: "h264",
    fps: 30,
    audioCodec: null,
    ...overrides,
  };
}

describe("parseAiContentManifest", () => {
  it("keeps V1 card, blog, and marketing parsing unchanged, including version-first blog cover enforcement", () => {
    expect(parseAiContentManifest("card_news", cardManifest())).toMatchObject({ version: "ai-content.v1", type: "card_news" });
    expect(parseAiContentManifest("blog", validBlog)).toMatchObject({ version: "ai-content.v1", type: "blog" });
    expect(parseAiContentManifest("marketing", validMarketing)).toMatchObject({ version: "ai-content.v1", type: "marketing" });
    expect(() => parseAiContentManifest("blog", {
      ...validBlog,
      outputFormat: "blog",
      assets: [{ ...validBlog.assets[1], index: 1 }],
    }))
      .toThrow("ai_content_blog_cover_asset_required");
  });

  it("accepts a strict V2 card-news manifest", () => {
    const parsed = parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { width: 1080, height: 1080 }),
      v2Image("slide", 2, { width: 1080, height: 1080 }),
    ]));
    expect(parsed).toMatchObject({ version: "ai-content.v2", outputFormat: "card_news" });
  });

  it("enforces the requested V2 card-news slide ratio without requiring its exact dimensions", () => {
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { width: 1080, height: 1080 }),
    ]), { width: 4, height: 5 })).toThrow("ai_content_card_news_dimensions_invalid");

    expect(parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { width: 1080, height: 1350 }),
    ]), { width: 4, height: 5 })).toMatchObject({ assets: [{ width: 1080, height: 1350 }] });
  });

  it("accepts V2 blogs with zero or sequential inline images without a cover", () => {
    const html = {
      role: "html",
      index: 1,
      url: "https://blob.example/article.html",
      fileName: "article.html",
      mimeType: "text/html",
    };
    expect(parseAiContentManifest("blog", v2Manifest("blog", "blog", [html]))).toMatchObject({ version: "ai-content.v2" });
    expect(parseAiContentManifest("blog", v2Manifest("blog", "blog", [
      html,
      v2Image("inline", 1),
      v2Image("inline", 2),
    ]))).toMatchObject({ assets: [{ role: "html" }, { role: "inline" }, { role: "inline" }] });
  });

  it("accepts strict V2 marketing-content and reel manifests", () => {
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "marketing_content", [
      v2Image("creative", 1),
    ]))).toMatchObject({ version: "ai-content.v2", outputFormat: "marketing_content" });
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      v2Image("scene", 1),
      v2Image("scene", 2),
      v2Video(8),
    ]))).toMatchObject({ version: "ai-content.v2", outputFormat: "reel" });
  });

  it("requires requested V2 marketing-content creative dimensions to match exactly", () => {
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "marketing_content", [
      v2Image("creative", 1, { width: 1200, height: 800 }),
    ]), { width: 1080, height: 1350 })).toThrow("ai_content_marketing_dimensions_mismatch");

    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "marketing_content", [
      v2Image("creative", 1, { width: 1080, height: 1350 }),
    ]), { width: 1080, height: 1350 })).toMatchObject({ assets: [{ width: 1080, height: 1350 }] });
  });

  it("rejects V2 unknown top-level and asset keys", () => {
    expect(() => parseAiContentManifest("card_news", {
      ...v2Manifest("card_news", "card_news", [v2Image("slide", 1)]),
      unexpected: true,
    })).toThrow("ai_content_manifest_invalid");
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { unexpected: true }),
    ]))).toThrow("ai_content_asset_invalid");
  });

  it("applies HTTPS URL and safe-filename rules to V2 assets", () => {
    const valid = v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { width: 1080, height: 1080, fileName: "safe-slide_01.png" }),
    ]);
    expect(parseAiContentManifest("card_news", valid)).toMatchObject({
      assets: [{ url: "https://blob.example/slide-1.png", fileName: "safe-slide_01.png" }],
    });

    const unsafeAssets = [
      { url: "http://blob.example/slide-1.png" },
      { fileName: "../slide.png" },
      { fileName: "nested/slide.png" },
      { fileName: "nested\\slide.png" },
      { fileName: "%2e%2e%2fslide.png" },
      { fileName: "slide\u0000.png" },
    ];
    for (const overrides of unsafeAssets) {
      expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
        v2Image("slide", 1, { width: 1080, height: 1080, ...overrides }),
      ]))).toThrow(overrides.url ? "ai_content_asset_url_invalid" : "ai_content_asset_file_name_invalid");
    }
  });

  it("enforces V2 card-news and marketing-content one-to-five asset limits", () => {
    const cards = (count: number) => Array.from({ length: count }, (_, index) => v2Image("slide", index + 1));
    const creatives = (count: number) => Array.from({ length: count }, (_, index) => v2Image("creative", index + 1));
    const cases = [
      { type: "card_news" as const, outputFormat: "card_news" as const, assets: cards, error: "ai_content_card_news_slide_count_invalid" },
      { type: "marketing" as const, outputFormat: "marketing_content" as const, assets: creatives, error: "ai_content_marketing_asset_invalid" },
    ];

    for (const testCase of cases) {
      expect(parseAiContentManifest(testCase.type, v2Manifest(testCase.type, testCase.outputFormat, testCase.assets(1))).assets).toHaveLength(1);
      expect(parseAiContentManifest(testCase.type, v2Manifest(testCase.type, testCase.outputFormat, testCase.assets(5))).assets).toHaveLength(5);
      expect(() => parseAiContentManifest(testCase.type, v2Manifest(testCase.type, testCase.outputFormat, testCase.assets(6))))
        .toThrow(testCase.error);
    }
  });

  it("allows five V2 blog inline images and rejects a sixth", () => {
    const html = { role: "html", index: 1, url: "https://blob.example/article.html", fileName: "article.html", mimeType: "text/html" };
    const inlines = (count: number) => Array.from({ length: count }, (_, index) => v2Image("inline", index + 1));
    expect(parseAiContentManifest("blog", v2Manifest("blog", "blog", [html, ...inlines(5)])).assets).toHaveLength(6);
    expect(() => parseAiContentManifest("blog", v2Manifest("blog", "blog", [html, ...inlines(6)])))
      .toThrow("ai_content_blog_inline_asset_count_invalid");
  });

  it("uses the first V2 reel scene as the cover while enforcing one-to-five scenes and one video", () => {
    const reelAssets = (sceneCount: number) => [
      ...Array.from({ length: sceneCount }, (_, index) => v2Image("scene", index + 1)),
      v2Video(sceneCount * 4),
    ];
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "reel", reelAssets(1))).assets)
      .toMatchObject([{ role: "scene", index: 1 }, { role: "video", index: 1 }]);
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "reel", reelAssets(5))).assets).toHaveLength(6);
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", reelAssets(6))))
      .toThrow("ai_content_reel_asset_invalid");
  });

  it("rejects duplicate, missing, and out-of-order V2 card, creative, and scene indexes", () => {
    const cases = [
      {
        type: "card_news" as const,
        outputFormat: "card_news" as const,
        assets: (indexes: number[]) => indexes.map((index) => v2Image("slide", index)),
        missing: [1, 3],
      },
      {
        type: "marketing" as const,
        outputFormat: "marketing_content" as const,
        assets: (indexes: number[]) => indexes.map((index) => v2Image("creative", index)),
        missing: [1, 3],
      },
      {
        type: "marketing" as const,
        outputFormat: "reel" as const,
        assets: (indexes: number[]) => [...indexes.map((index) => v2Image("scene", index)), v2Video(indexes.length * 4)],
        missing: [2],
      },
    ];

    for (const testCase of cases) {
      for (const indexes of [[1, 1], testCase.missing, [2, 1]]) {
        expect(() => parseAiContentManifest(testCase.type, v2Manifest(testCase.type, testCase.outputFormat, testCase.assets(indexes))))
          .toThrow("ai_content_asset_index_invalid");
      }
    }
  });

  it("requires V2 blog HTML index 1 and independently ordered inline indexes", () => {
    const html = { role: "html", index: 1, url: "https://blob.example/article.html", fileName: "article.html", mimeType: "text/html" };
    const manifest = (htmlIndex: number, inlineIndexes: number[]) => v2Manifest("blog", "blog", [
      { ...html, index: htmlIndex },
      ...inlineIndexes.map((index) => v2Image("inline", index)),
    ]);
    expect(() => parseAiContentManifest("blog", manifest(2, [1]))).toThrow("ai_content_asset_index_invalid");
    for (const inlineIndexes of [[1, 1], [1, 3], [2, 1]]) {
      expect(() => parseAiContentManifest("blog", manifest(1, inlineIndexes))).toThrow("ai_content_asset_index_invalid");
    }
  });

  it("rejects V2 type and output-format mapping mismatches", () => {
    expect(() => parseAiContentManifest("card_news", { ...cardManifest(), version: "ai-content.v3" }))
      .toThrow("ai_content_manifest_version_invalid");
    expect(() => parseAiContentManifest("blog", v2Manifest("card_news", "card_news", [v2Image("slide", 1)])))
      .toThrow("ai_content_manifest_type_mismatch");
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "blog", [v2Image("creative", 1)])))
      .toThrow("ai_content_manifest_output_format_invalid");
  });

  it("rejects V2 invalid counts, per-role indexes, roles, MIME types, and image dimensions", () => {
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [])))
      .toThrow("ai_content_card_news_slide_count_invalid");
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1), v2Image("slide", 3),
    ]))).toThrow("ai_content_asset_index_invalid");
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [v2Image("creative", 1)])))
      .toThrow("ai_content_card_news_slide_role_invalid");
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      {
        role: "slide",
        index: 1,
        url: "https://blob.example/slide.html",
        fileName: "slide.html",
        mimeType: "text/html",
      },
    ]))).toThrow("ai_content_card_news_mime_type_invalid");
    expect(() => parseAiContentManifest("card_news", v2Manifest("card_news", "card_news", [
      v2Image("slide", 1, { height: undefined }),
    ]))).toThrow("ai_content_asset_dimensions_invalid");
  });

  it("rejects V2 reels with missing or extra video assets and invalid video metadata", () => {
    const scenes = [v2Image("scene", 1), v2Image("scene", 2)];
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", scenes)))
      .toThrow("ai_content_reel_video_asset_required");
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8), v2Video(8, { fileName: "reel-2.mp4" }),
    ]))).toThrow("ai_content_reel_video_asset_required");
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8, { audioCodec: "aac" }),
    ]))).toThrow("ai_content_asset_video_metadata_invalid");
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8, { width: 1079 }),
    ]))).toThrow("ai_content_reel_video_metadata_invalid");
    for (const overrides of [{ videoCodec: "vp9" }, { fps: 29 }]) {
      expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
        ...scenes, v2Video(8, overrides),
      ]))).toThrow("ai_content_asset_video_metadata_invalid");
    }
  });

  it("accepts the V2 reel duration tolerance boundary and rejects values beyond it", () => {
    const tolerance = 1 / 30;
    const scenes = [v2Image("scene", 1), v2Image("scene", 2)];
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8 + tolerance),
    ]))).toMatchObject({ version: "ai-content.v2" });
    expect(parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8 - tolerance),
    ]))).toMatchObject({ version: "ai-content.v2" });
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8 + tolerance + 0.001),
    ]))).toThrow("ai_content_reel_duration_invalid");
    expect(() => parseAiContentManifest("marketing", v2Manifest("marketing", "reel", [
      ...scenes, v2Video(8 - tolerance - 0.001),
    ]))).toThrow("ai_content_reel_duration_invalid");
  });

  it("preserves optional content family, strategy, and output format metadata", () => {
    const parsed = parseAiContentManifest("card_news", {
      ...cardManifest(1),
      family: "informational",
      strategy: "how_to",
      outputFormat: "card_news",
    });
    expect(parsed).toMatchObject({
      family: "informational",
      strategy: "how_to",
      outputFormat: "card_news",
    });
  });

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

  it("accepts a text-only marketing artifact only for channel_text output", () => {
    const channelText = {
      ...validMarketing,
      family: "marketing",
      strategy: "cta",
      outputFormat: "channel_text",
      assets: [{
        role: "text",
        url: "https://blob.example/channel-text.txt",
        fileName: "channel-text.txt",
        mimeType: "text/plain",
        index: 1,
      }],
    };

    expect(parseAiContentManifest("marketing", channelText))
      .toMatchObject({ outputFormat: "channel_text", assets: [{ role: "text", mimeType: "text/plain" }] });
    expect(() => parseAiContentManifest("marketing", {
      ...channelText,
      outputFormat: "single_image",
    })).toThrow("ai_content_marketing_asset_invalid");
  });

  it("rejects a manifest type mismatch", () => {
    expect(() => parseAiContentManifest("blog", cardManifest()))
      .toThrow("ai_content_manifest_type_mismatch");
  });
});

describe("parseActiveAiContentManifestV3", () => {
  const reelManifest = {
    version: "ai-content.v3",
    outputFormat: "reel",
    purpose: "marketing",
    title: "Tea reel",
    assets: [
      { role: "scene", index: 1, url: "https://blob.example/scene-01.png", fileName: "scene-01.png", mimeType: "image/png", width: 1080, height: 1920 },
      { role: "video", index: 1, url: "https://blob.example/reel.mp4", fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 4, videoCodec: "h264", fps: 30, audioCodec: null },
    ],
    content: { caption: "Caption", hashtags: ["#tea"], cta: "Learn" },
  };

  it("accepts the canonical V3 reel without a legacy type field", () => {
    expect(parseActiveAiContentManifestV3(reelManifest)).toEqual(reelManifest);
  });

  it("rejects retired versions, type fields, and mismatched content shapes", () => {
    expect(() => parseActiveAiContentManifestV3({ ...reelManifest, version: "ai-content.v2" }))
      .toThrow("ai_content_manifest_v3_invalid");
    expect(() => parseActiveAiContentManifestV3({ ...reelManifest, type: "marketing" }))
      .toThrow("ai_content_manifest_v3_invalid");
    expect(() => parseActiveAiContentManifestV3({ ...reelManifest, outputFormat: "blog" }))
      .toThrow("ai_content_manifest_content_invalid");
  });
});
