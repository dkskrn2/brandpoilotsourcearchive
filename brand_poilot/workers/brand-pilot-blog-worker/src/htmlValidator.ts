import * as cheerio from "cheerio";

export interface BlogPlanHtmlOptions {
  evidenceItems: Array<{ id: string; url: string }>;
  usedEvidenceIds: string[];
  assetCount: number;
}

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const PASSIVE_HTML_FORBIDDEN_TAGS = [
  "script", "style", "form", "iframe", "link", "source", "svg", "image", "noscript", "object", "embed", "video", "audio", "meta", "base",
] as const;
const PASSIVE_HTML_FORBIDDEN_ATTRIBUTES = new Set([
  "style", "srcset", "xlink:href", "poster", "background", "data", "ping", "formaction", "action", "srcdoc", "manifest",
]);

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function validatePassiveSemanticHtml($: cheerio.CheerioAPI): void {
  if ($("script").length) throw new Error("blog_html_script_forbidden");
  if ($("style").length) throw new Error("blog_html_style_forbidden");
  if ($("form").length) throw new Error("blog_html_form_forbidden");
  if ($("iframe").length) throw new Error("blog_html_iframe_forbidden");
  if ($(PASSIVE_HTML_FORBIDDEN_TAGS.join(",")).length) throw new Error("blog_html_external_resource_forbidden");
  $("*").each((_index, element) => {
    if (!("attribs" in element)) return;
    const tagName = String($(element).prop("tagName") ?? "").toLowerCase();
    for (const [name, value] of Object.entries(element.attribs as Record<string, string>)) {
      if (/^on/i.test(name)) throw new Error("blog_html_event_handler_forbidden");
      const lowerName = name.toLowerCase();
      if (PASSIVE_HTML_FORBIDDEN_ATTRIBUTES.has(lowerName)) {
        throw new Error("blog_html_external_resource_forbidden");
      }
      if (lowerName === "src" && tagName !== "img") throw new Error("blog_html_external_resource_forbidden");
      if (lowerName === "href" && tagName !== "a") throw new Error("blog_html_external_resource_forbidden");
      if ((lowerName === "href" || lowerName === "src") && /^\s*javascript:/i.test(value)) throw new Error("blog_html_javascript_url_forbidden");
    }
  });
}

function normalizeImageSource(source: string): string {
  return source.trim().replace(/^\.\//, "");
}

export function ensureEmptyBlogReferencesSection(html: string, hasUsedEvidence: boolean): string {
  if (hasUsedEvidence) return html;
  const $ = cheerio.load(html, null, false);
  const article = $("article");
  if (article.length !== 1 || $('section[data-references="true"]').length !== 0) return html;
  article.append(
    '<section data-references="true"><h2>어떤 자료를 참고했나요?</h2>'
      + '<p>제공된 고정 근거 없이 승인된 브랜드와 제품 스냅샷만 사용했습니다.</p></section>',
  );
  return $.html();
}

export function validateGeneratedBlogHtml(html: string, inlineFileNames?: string[]) {
  const $ = cheerio.load(html, null, false);
  validatePassiveSemanticHtml($);
  if ($("article").length !== 1) throw new Error("blog_html_article_required");
  const h1Count = $("article h1").length;
  if (h1Count !== 1) throw new Error("blog_html_h1_count_invalid");
  const imageSources: string[] = [];
  if (inlineFileNames) {
    const allowedSources = new Set(inlineFileNames);
    $("article img").each((_index, element) => {
      const alt = $(element).attr("alt")?.trim();
      if (!alt) throw new Error("blog_html_image_alt_required");
      if (alt.length < 4 || !/[가-힣]/.test(alt)) throw new Error("blog_html_image_alt_invalid");
      const source = normalizeImageSource($(element).attr("src") ?? "");
      if (!allowedSources.has(source)) throw new Error("blog_html_image_source_invalid");
      imageSources.push(source);
    });
    for (const fileName of inlineFileNames) {
      if (!imageSources.includes(fileName)) throw new Error("blog_html_inline_image_missing");
    }
  }

  return { html: $.html(), h1Count, imageSources };
}

export function validateBlogPlanHtml(html: string, options: BlogPlanHtmlOptions) {
  if (typeof html !== "string" || !html.trim()) throw new Error("blog_html_invalid");
  if (!Number.isSafeInteger(options.assetCount) || options.assetCount < 0 || options.assetCount > 5) {
    throw new Error("blog_html_asset_count_invalid");
  }
  const $ = cheerio.load(html, null, false);
  validatePassiveSemanticHtml($);
  const article = $("article");
  if (article.length !== 1) throw new Error("blog_html_article_required");
  const h1 = article.find("h1");
  if (h1.length !== 1) throw new Error("blog_html_h1_count_invalid");
  const summary = h1.first().next();
  if (!summary.is('section[data-summary="true"]')) throw new Error("blog_html_summary_invalid");
  const summaryChildren = summary.children();
  if (summaryChildren.length !== 3 || summaryChildren.filter("p").length !== 3) throw new Error("blog_html_summary_invalid");
  const summaryTexts = summaryChildren.toArray().map((element) => normalizeText($(element).text()));
  if (summaryTexts.some((text) => !text)) throw new Error("blog_html_summary_invalid");
  const summaryLength = normalizeText(summaryTexts.join(" ")).length;
  if (summaryLength > 300) throw new Error("blog_html_summary_length_invalid");
  const visibleTextLength = normalizeText(article.text()).length;
  if (visibleTextLength < 3_000 || visibleTextLength > 10_000) throw new Error("blog_html_length_invalid");
  for (const heading of article.find("h2,h3").toArray()) {
    if (!normalizeText($(heading).text()).endsWith("?")) throw new Error("blog_html_heading_question_invalid");
    if (!$(heading).next().is("p")) throw new Error("blog_html_direct_answer_invalid");
  }

  const articleText = article.text();
  const forbiddenExperience = [
    /제가 직접 (?:써|사용해) ?보니/,
    /실제 고객의 경험을 재구성/,
    /가상의 경험담/,
    /합성된 경험/,
  ];
  if (forbiddenExperience.some((pattern) => pattern.test(articleText))) {
    throw new Error("blog_html_fabricated_experience_forbidden");
  }

  const imageSources = article.find("img").toArray().map((element) => {
    const source = $(element).attr("src")?.trim() ?? "";
    if (!$(element).attr("alt")?.trim()) throw new Error("blog_html_image_alt_required");
    if (!/^asset:\/\/\d{2}$/.test(source)) throw new Error("blog_html_image_source_invalid");
    return source;
  });
  const placeholderOccurrences = html.match(/asset:\/\/[^\s"'<>]*/g) ?? [];
  if (!sameArray(placeholderOccurrences, imageSources)) throw new Error("blog_html_asset_placeholder_invalid");
  const expectedSources = Array.from({ length: options.assetCount }, (_, index) => `asset://${String(index + 1).padStart(2, "0")}`);
  if (!sameArray(imageSources, expectedSources)) throw new Error("blog_html_asset_placeholder_invalid");

  const evidenceUrls = new Map<string, string>();
  for (const item of options.evidenceItems) {
    let parsed: URL;
    try { parsed = new URL(item.url); } catch { throw new Error("blog_html_evidence_url_invalid"); }
    if (parsed.protocol !== "https:") throw new Error("blog_html_evidence_url_invalid");
    const previous = evidenceUrls.get(item.id);
    if (previous !== undefined && previous !== item.url) throw new Error("blog_html_evidence_url_invalid");
    evidenceUrls.set(item.id, item.url);
  }
  const referenceSections = $('section[data-references="true"]');
  if (referenceSections.length !== 1 || article.find('section[data-references="true"]').length !== 1) throw new Error("blog_html_references_invalid");
  const referenceSection = referenceSections.first();
  const allEvidenceLinks = article.find("a[data-evidence-id]").toArray();
  for (const link of allEvidenceLinks) {
    const id = $(link).attr("data-evidence-id") ?? "";
    const href = $(link).attr("href") ?? "";
    if (!id || evidenceUrls.get(id) !== href) throw new Error("blog_html_evidence_url_invalid");
    try { if (new URL(href).protocol !== "https:") throw new Error(); } catch { throw new Error("blog_html_evidence_url_invalid"); }
  }
  if (article.find("a").length !== allEvidenceLinks.length) throw new Error("blog_html_evidence_url_invalid");
  const expectedIds = new Set(options.usedEvidenceIds);
  if (expectedIds.size !== options.usedEvidenceIds.length || [...expectedIds].some((id) => !evidenceUrls.has(id))) {
    throw new Error("blog_html_evidence_set_invalid");
  }
  const referenceIds = new Set(referenceSection.find("a[data-evidence-id]").toArray().map((link) => String($(link).attr("data-evidence-id"))));
  const bodyIds = new Set(allEvidenceLinks.filter((link) => !referenceSection.find(link).length).map((link) => String($(link).attr("data-evidence-id"))));
  if (!sameSet(expectedIds, referenceIds) || !sameSet(expectedIds, bodyIds)) throw new Error("blog_html_evidence_set_invalid");
  return { html: $.html(), visibleTextLength, summaryLength, imageSources };
}
