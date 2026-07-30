import * as cheerio from "cheerio";

function normalizeImageSource(source: string): string {
  return source.trim().replace(/^\.\//, "");
}

export function validateGeneratedBlogHtml(html: string, inlineFileNames?: string[]) {
  const $ = cheerio.load(html, null, false);
  if ($("script").length) throw new Error("blog_html_script_forbidden");
  if ($("form").length) throw new Error("blog_html_form_forbidden");
  if ($("iframe").length) throw new Error("blog_html_iframe_forbidden");
  if ($("article").length !== 1) throw new Error("blog_html_article_required");
  const h1Count = $("article h1").length;
  if (h1Count !== 1) throw new Error("blog_html_h1_count_invalid");
  $("*").each((_index, element) => {
    if (!("attribs" in element)) return;
    for (const [name, value] of Object.entries(element.attribs as Record<string, string>)) {
      if (/^on/i.test(name)) throw new Error("blog_html_event_handler_forbidden");
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) throw new Error("blog_html_javascript_url_forbidden");
    }
  });

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
