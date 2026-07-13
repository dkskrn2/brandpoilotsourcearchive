import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ExtractedSnapshot {
  title: string | null;
  canonicalUrl: string | null;
  metaDescription: string | null;
  text: string;
  contentHash: string;
}

export interface CrawledSnapshot extends ExtractedSnapshot {
  httpStatus: number;
  rawText: string;
}

export interface DiscoveredContentUrl {
  url: string;
  discoveryMethod: "seed_self" | "canonical" | "og_url" | "anchor";
  linkText: string | null;
}

export interface ResolvedAddress {
  address: string;
}

export type HostnameResolver = (hostname: string) => Promise<ResolvedAddress[]>;

function isUnsafeIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) ||
    first >= 224;
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return isUnsafeIpAddress(normalized.slice("::ffff:".length));
  return /^(fc|fd|fe[89ab])/.test(normalized);
}

function isUnsafeIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isUnsafeIpv4(address);
  if (family === 6) return isUnsafeIpv6(address);
  return true;
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local");
}

async function defaultResolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

export async function assertSafeCrawlUrl(
  value: string,
  { resolveHostname = defaultResolveHostname }: { resolveHostname?: HostnameResolver } = {}
) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("crawl_url_invalid");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new Error("crawl_url_invalid");
  }
  if (isUnsafeHostname(parsed.hostname)) throw new Error("crawl_url_unsafe_host");
  if (isIP(parsed.hostname)) {
    if (isUnsafeIpAddress(parsed.hostname)) throw new Error("crawl_url_unsafe_address");
    return parsed;
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHostname(parsed.hostname);
  } catch {
    throw new Error("crawl_url_resolution_failed");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isUnsafeIpAddress(address))) {
    throw new Error("crawl_url_unsafe_address");
  }
  return parsed;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function normalizeWhitespace(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function stripNoiseBlocks(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ")
    .replace(/<button\b[\s\S]*?<\/button>/gi, " ");
}

function htmlToText(html: string) {
  return normalizeWhitespace(stripNoiseBlocks(html).replace(/<[^>]+>/g, " "));
}

function readableBodyText(html: string) {
  const candidates = [
    ...Array.from(html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi), (match) => match[1]),
    ...Array.from(html.matchAll(/<[^>]+\brole\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/gi), (match) => match[1])
  ]
    .map(htmlToText)
    .filter((text) => text.length > 0)
    .sort((left, right) => right.length - left.length);

  return candidates[0] ?? htmlToText(html);
}

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] ?? "";
}

function extractMetaDescription(html: string) {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const tag = match[1];
    const name = attr(tag, "name").toLowerCase();
    const property = attr(tag, "property").toLowerCase();
    if (name === "description" || property === "og:description") {
      return normalizeWhitespace(attr(tag, "content"));
    }
  }
  return null;
}

function extractCanonicalUrl(html: string, baseUrl?: string) {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const tag = match[1];
    const rel = attr(tag, "rel").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) {
      return normalizeDiscoveredUrl(attr(tag, "href"), baseUrl);
    }
  }
  return null;
}

function extractOgUrl(html: string, baseUrl?: string) {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const tag = match[1];
    const property = attr(tag, "property").toLowerCase();
    if (property === "og:url") {
      return normalizeDiscoveredUrl(attr(tag, "content"), baseUrl);
    }
  }
  return null;
}

function normalizeDiscoveredUrl(value: string, baseUrl?: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        ["fbclid", "gclid", "yclid", "mc_cid", "mc_eid", "igshid"].includes(normalizedKey)
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isSameHostname(url: string, seedUrl: string) {
  try {
    return new URL(url).hostname === new URL(seedUrl).hostname;
  } catch {
    return false;
  }
}

function isLikelyHtmlUrl(url: string) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(avif|bmp|css|csv|docx?|gif|ico|jpe?g|js|json|pdf|png|pptx?|rss|svg|webp|xlsx?|xml|zip)$/i.test(pathname);
  } catch {
    return false;
  }
}

function hasArticleSignal(html: string) {
  return (
    /<article\b/i.test(html) ||
    /<meta\b[^>]*property\s*=\s*["']og:type["'][^>]*content\s*=\s*["']article["'][^>]*>/i.test(html) ||
    /<meta\b[^>]*content\s*=\s*["']article["'][^>]*property\s*=\s*["']og:type["'][^>]*>/i.test(html) ||
    /\barticle:published_time\b/i.test(html) ||
    /schema\.org\/Article/i.test(html) ||
    /"@type"\s*:\s*"Article"/i.test(html)
  );
}

function hasListingPath(url: string) {
  try {
    const segments = new URL(url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    return segments.some((segment) => [
      "archive",
      "archives",
      "author",
      "authors",
      "category",
      "categories",
      "featured",
      "page",
      "search",
      "tag",
      "tags",
      "topic",
      "topics"
    ].includes(segment));
  } catch {
    return true;
  }
}

const genericIndexSegments = new Set([
  "article",
  "articles",
  "blog",
  "blogs",
  "insight",
  "insights",
  "news",
  "resource",
  "resources",
  "report",
  "reports"
]);

const utilitySegments = new Set([
  "about",
  "about-us",
  "account",
  "cart",
  "career",
  "careers",
  "checkout",
  "company",
  "contact",
  "contact-us",
  "cookie-policy",
  "cookies",
  "jobs",
  "legal",
  "login",
  "my-account",
  "people",
  "privacy",
  "privacy-policy",
  "register",
  "sign-in",
  "signin",
  "sign-up",
  "signup",
  "slack",
  "subscribe",
  "subscription",
  "support",
  "team",
  "telegram",
  "terms",
  "terms-of-service"
]);

function hasNonContentPath(url: string) {
  try {
    const segments = new URL(url).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean);
    if (segments.length === 0) return true;
    if (segments.some((segment) => utilitySegments.has(segment))) return true;
    if (segments.length === 1 && genericIndexSegments.has(segments[0])) return true;
    return false;
  } catch {
    return true;
  }
}

function countContentAnchors(html: string) {
  return Array.from(stripNoiseBlocks(html).matchAll(/<a\b[^>]*>/gi)).length;
}

export function isLikelyContentPage(url: string, html: string, snapshot: Pick<ExtractedSnapshot, "text">) {
  const textLength = snapshot.text.trim().length;
  if (textLength === 0) return false;
  if (hasNonContentPath(url)) return false;
  if (hasListingPath(url)) return false;
  if (hasArticleSignal(html)) return textLength >= 120;
  if (countContentAnchors(html) >= 3 && textLength < 600) return false;
  return textLength >= 30;
}

export function discoverContentUrls(seedUrl: string, html: string): DiscoveredContentUrl[] {
  const seedSelf = normalizeDiscoveredUrl(seedUrl);
  if (!seedSelf) return [];
  const discovered = new Map<string, DiscoveredContentUrl>();
  const add = (candidateUrl: string | null, discoveryMethod: DiscoveredContentUrl["discoveryMethod"], linkText: string | null) => {
    if (!candidateUrl || !isSameHostname(candidateUrl, seedSelf) || !isLikelyHtmlUrl(candidateUrl)) return;
    if (!discovered.has(candidateUrl)) {
      discovered.set(candidateUrl, { url: candidateUrl, discoveryMethod, linkText });
    }
  };

  add(seedSelf, "seed_self", null);
  add(extractCanonicalUrl(html, seedSelf), "canonical", null);
  add(extractOgUrl(html, seedSelf), "og_url", null);

  const discoverableHtml = stripNoiseBlocks(html);
  for (const match of discoverableHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const candidateUrl = normalizeDiscoveredUrl(attr(match[1], "href"), seedSelf);
    const linkText = htmlToText(match[2]) || null;
    add(candidateUrl, "anchor", linkText);
  }

  return [...discovered.values()];
}

export function extractPageSnapshot(html: string, pageUrl?: string): ExtractedSnapshot {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = readableBodyText(html);
  return {
    title: title ? normalizeWhitespace(title) : null,
    canonicalUrl: extractCanonicalUrl(html, pageUrl),
    metaDescription: extractMetaDescription(html),
    text,
    contentHash: crypto.createHash("sha256").update(text).digest("hex")
  };
}

export async function crawlSourceUrl(
  url: string,
  {
    fetcher = fetch,
    timeoutMs = 15000,
    resolveHostname = defaultResolveHostname
  }: { fetcher?: typeof fetch; timeoutMs?: number; resolveHostname?: HostnameResolver } = {}
): Promise<CrawledSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let target = await assertSafeCrawlUrl(url, { resolveHostname });
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      response = await fetcher(target.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "BrandPilotMVP/0.1 (+https://github.com/2pow1/Brand_Pilot)",
          Accept: "text/html,application/xhtml+xml"
        }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("crawl_redirect_location_required");
      target = await assertSafeCrawlUrl(new URL(location, target).toString(), { resolveHostname });
      if (redirectCount === 3) throw new Error("crawl_redirect_limit_exceeded");
    }
    if (!response) throw new Error("crawl_response_missing");
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const rawText = await response.text();
    return { ...extractPageSnapshot(rawText, target.toString()), httpStatus: response.status, rawText };
  } finally {
    clearTimeout(timeout);
  }
}
