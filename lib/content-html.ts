import sanitizeHtml from "sanitize-html";
import { editorTextToSections } from "@/lib/content-format.js";

const colorValue = /^(?:#[0-9a-f]{3,8}|rgba?\([\d.,%\s]+\)|[a-z]+)$/i;
const sizeValue = /^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i;

const sanitizerOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike",
    "blockquote", "ul", "ol", "li", "a", "span", "div", "section", "hr", "img",
    "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td"
  ],
  allowedAttributes: {
    "*": ["style"],
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height"],
    table: ["border", "cellpadding", "cellspacing", "width", "summary"],
    col: ["span", "width"],
    th: ["colspan", "rowspan", "scope", "width", "height"],
    td: ["colspan", "rowspan", "width", "height"]
  },
  allowedStyles: {
    "*": {
      color: [colorValue],
      "background-color": [colorValue, /^transparent$/i],
      "font-family": [/^[\w\s,'"-]+$/],
      "font-size": [sizeValue],
      "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
      "font-style": [/^(?:normal|italic|oblique)$/i],
      "line-height": [sizeValue, /^\d+(?:\.\d+)?$/, /^normal$/i],
      "text-align": [/^(?:left|right|center|justify)$/i],
      "text-decoration": [/^(?:none|underline|line-through)$/i],
      "vertical-align": [/^(?:top|middle|bottom|baseline|sub|super)$/i],
      width: [sizeValue, /^auto$/i],
      height: [sizeValue, /^auto$/i]
    }
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard"
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function legacyTextToHtml(source: string) {
  return editorTextToSections(source).map((section: { title: string; paragraphs: string[]; points?: string[] }) => {
    const paragraphs = section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
    const points = section.points?.length ? `<ul>${section.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : "";
    return `<section><h2>${escapeHtml(section.title)}</h2>${paragraphs}${points}</section>`;
  }).join("");
}

export function isHtmlBody(source: string) {
  return /<\/?[a-z][\s\S]*>/i.test(source);
}

export function sanitizeArticleHtml(source: string) {
  return sanitizeHtml(source, sanitizerOptions).trim();
}

export function articleBodyToHtml(source: string) {
  return sanitizeArticleHtml(isHtmlBody(source) ? source : legacyTextToHtml(source));
}

export function articleTextContent(source: string) {
  return sanitizeHtml(articleBodyToHtml(source), { allowedTags: [], allowedAttributes: {} })
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const DEFAULT_ARTICLE_HTML = "<h2>첫 번째 소제목</h2><p>본문을 입력하세요.</p>";
