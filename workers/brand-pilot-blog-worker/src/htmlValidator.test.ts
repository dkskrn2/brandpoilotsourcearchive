import { describe, expect, it } from "vitest"; import { validateGeneratedBlogHtml } from "./htmlValidator.js";
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
});
