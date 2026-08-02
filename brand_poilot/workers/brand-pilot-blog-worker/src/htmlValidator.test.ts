import { describe, expect, it } from "vitest"; import { validateBlogPlanHtml, validateGeneratedBlogHtml } from "./htmlValidator.js";

const evidenceId = "10000000-0000-4000-8000-000000000005";
const body = "구체적인 판단 기준과 적용 방법을 독자가 이해하기 쉽게 설명합니다. ".repeat(75);
const validPlanHtml = (bodyLink = `<a href="https://example.com/source" data-evidence-id="${evidenceId}">근거</a>`, referencesLink = bodyLink) => `<article><h1>좋은 글은 어떻게 구성할까요?</h1><section data-summary="true"><p>핵심을 먼저 답합니다.</p><p>근거를 구조에 연결합니다.</p><p>실행 기준을 정리합니다.</p></section><section><h2>무엇을 먼저 확인해야 할까요?</h2><p>${body}${bodyLink}</p><h3>어떻게 적용하면 좋을까요?</h3><p>${body}</p></section><section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>본문에서 사용한 자료입니다.</p><ul><li>${referencesLink}</li></ul></section></article>`;
const options = { evidenceItems: [{ id: evidenceId, url: "https://example.com/source" }], usedEvidenceIds: [evidenceId], assetCount: 0 };
describe("blog HTML validation", () => {
  it("rejects active content", () => { expect(() => validateGeneratedBlogHtml('<article><h1>제목</h1><script>alert(1)</script></article>')).toThrow("blog_html_script_forbidden"); expect(() => validateGeneratedBlogHtml('<article><h1 onclick="x()">제목</h1></article>')).toThrow("blog_html_event_handler_forbidden"); });
  it("accepts one semantic article", () => { expect(validateGeneratedBlogHtml('<article><h1>제목</h1><section><h2>기준</h2><p>본문</p></section></article>').h1Count).toBe(1); });
  it("requires every declared inline image in the article with useful alt text", () => {
    const html = '<article><h1>제목</h1><section><h2>기준</h2><img src="./inline-01.png" alt="콘텐츠 검토 흐름 예시"></section></article>';
    expect(validateGeneratedBlogHtml(html, ["inline-01.png"]).imageSources).toEqual(["inline-01.png"]);
    expect(() => validateGeneratedBlogHtml(html, ["inline-01.png", "inline-02.png"])).toThrow("blog_html_inline_image_missing");
    expect(() => validateGeneratedBlogHtml(html.replace(' alt="콘텐츠 검토 흐름 예시"', ""), ["inline-01.png"])).toThrow("blog_html_image_alt_required");
    expect(() => validateGeneratedBlogHtml(html.replace("콘텐츠 검토 흐름 예시", "flow"), ["inline-01.png"])).toThrow("blog_html_image_alt_invalid");
    expect(() => validateGeneratedBlogHtml(html.replace("inline-01.png", "https://example.com/image.png"), ["inline-01.png"])).toThrow("blog_html_image_source_invalid");
  });

  it("accepts an article without inline images", () => {
    const html = '<article><h1>제목</h1><section><h2>기준</h2><p>본문</p></section></article>';
    expect(validateGeneratedBlogHtml(html, []).imageSources).toEqual([]);
  });

  it("enforces the v3 article, summary, length, question and direct-answer structure", () => {
    expect(validateBlogPlanHtml(validPlanHtml(), options).visibleTextLength).toBeGreaterThanOrEqual(3_000);
    expect(() => validateBlogPlanHtml(validPlanHtml().replace('<section data-summary="true">', "<div>"), options)).toThrow("blog_html_summary_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replace("<p>핵심을 먼저 답합니다.</p>", "<p>   </p>"), options)).toThrow("blog_html_summary_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replace("무엇을 먼저 확인해야 할까요?", "확인 기준"), options)).toThrow("blog_html_heading_question_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replace(`<p>${body}`, `<ul><li>${body}</li></ul><p>`), options)).toThrow("blog_html_direct_answer_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replace(body, "짧은 본문"), options)).toThrow("blog_html_length_invalid");
  });

  it("requires exactly one references section", () => {
    const duplicate = validPlanHtml().replace("</article>", '<section data-references="true"><h2>다른 자료가 있나요?</h2><p>중복 자료입니다.</p></section></article>');
    expect(() => validateBlogPlanHtml(duplicate, options)).toThrow("blog_html_references_invalid");
  });

  it("requires claim-near HTTPS evidence links and the same frozen set in references", () => {
    expect(() => validateBlogPlanHtml(validPlanHtml("", `<a href="https://example.com/source" data-evidence-id="${evidenceId}">근거</a>`), options)).toThrow("blog_html_evidence_set_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replaceAll("https://example.com/source", "https://attacker.example/source"), options)).toThrow("blog_html_evidence_url_invalid");
    expect(() => validateBlogPlanHtml(validPlanHtml().replaceAll("https://", "http://"), options)).toThrow("blog_html_evidence_url_invalid");
  });

  it("allows only exact continuous asset placeholders and forbids active styling or external image sources", () => {
    const imageHtml = validPlanHtml().replace("</p><h3>", '<img src="asset://01" alt="구조를 보여주는 설명 이미지"></p><h3>');
    expect(validateBlogPlanHtml(imageHtml, { ...options, assetCount: 1 }).imageSources).toEqual(["asset://01"]);
    expect(() => validateBlogPlanHtml(imageHtml.replace("asset://01", "asset://02"), { ...options, assetCount: 1 })).toThrow("blog_html_asset_placeholder_invalid");
    expect(() => validateBlogPlanHtml(imageHtml.replace("asset://01", "https://attacker.example/image.png"), { ...options, assetCount: 1 })).toThrow("blog_html_image_source_invalid");
    for (const unsafe of [' style="color:red"', '<style>p{color:red}</style>', ' srcset="https://attacker.example/x.png 2x"', '<source srcset="https://attacker.example/x.png">', '<svg><image href="https://attacker.example/x.png"/></svg>']) {
      expect(() => validateBlogPlanHtml(imageHtml.replace("<article>", `<article>${unsafe.startsWith("<") ? unsafe : `<div${unsafe}>x</div>`}`), { ...options, assetCount: 1 })).toThrow();
    }
  });

  it.each([
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://attacker.example/redirect">'],
    ["base", "<base>"],
  ])("rejects passive navigation tag %s", (_name, injection) => {
    expect(() => validateBlogPlanHtml(validPlanHtml().replace("<article>", `<article>${injection}`), options))
      .toThrow("blog_html_external_resource_forbidden");
  });

  it.each([
    ["ping", `<a href="https://example.com/source" data-evidence-id="${evidenceId}" ping="https://attacker.example/beacon">근거</a>`],
    ["formaction", '<button formaction="https://attacker.example/submit">전송</button>'],
    ["action", '<div action="https://attacker.example/submit">전송</div>'],
    ["srcdoc", '<div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">내용</div>'],
    ["manifest", '<div manifest="https://attacker.example/app.webmanifest">내용</div>'],
  ])("rejects passive navigation or beacon attribute %s", (_name, injection) => {
    const html = _name === "ping"
      ? validPlanHtml().replace(`<a href="https://example.com/source" data-evidence-id="${evidenceId}">근거</a>`, injection)
      : validPlanHtml().replace("<article>", `<article>${injection}`);
    expect(() => validateBlogPlanHtml(html, options)).toThrow("blog_html_external_resource_forbidden");
  });

  it("rejects every raw non-image, duplicate, or out-of-order asset token", () => {
    const imageHtml = validPlanHtml().replace("</p><h3>", '<img src="asset://01" alt="첫 번째 설명 이미지"><img src="asset://02" alt="두 번째 설명 이미지"></p><h3>');
    const imageOptions = { ...options, assetCount: 2 };
    expect(validateBlogPlanHtml(imageHtml, imageOptions).imageSources).toEqual(["asset://01", "asset://02"]);
    for (const invalid of [
      imageHtml.replace("</article>", "<p>asset://foo</p></article>"),
      imageHtml.replace('<img src="asset://02"', '<img src="asset://01" alt="중복"><img src="asset://02"'),
      imageHtml.replace('src="asset://01"', 'src="asset://XX"').replace('src="asset://02"', 'src="asset://01"').replace('src="asset://XX"', 'src="asset://02"'),
    ]) expect(() => validateBlogPlanHtml(invalid, imageOptions)).toThrow("blog_html_asset_placeholder_invalid");
  });

  it("rejects only explicit fabricated-experience markers and allows UX terminology", () => {
    expect(validateBlogPlanHtml(validPlanHtml().replace(body, `사용자 경험(UX)을 점검합니다. ${body}`), options)).toBeTruthy();
    for (const phrase of ["제가 직접 사용해 보니", "실제 고객의 경험을 재구성", "가상의 경험담", "합성된 경험"]) {
      expect(() => validateBlogPlanHtml(validPlanHtml().replace(body, `${phrase}. ${body}`), options)).toThrow("blog_html_fabricated_experience_forbidden");
    }
  });
});
