import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { load } from "cheerio";
import { Agent } from "undici";
import {
  assertSafeCrawlUrl,
  type HostnameResolver,
  type ResolvedAddress,
} from "./sourceCrawler.js";

const HTML_LIMIT = 5 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.azure.internal",
  "instance-data.ec2.internal",
]);

export type SubjectImageRole = "product" | "service" | "logo" | "detail" | "unknown";

export interface SubjectImageArchiveInput {
  sourceUrl: string;
  index: number;
  data: Uint8Array;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string;
  role: SubjectImageRole;
  signal: AbortSignal;
}

export interface ExtractedSubjectImage {
  sourceUrl: string;
  storageUrl: string;
  storagePath: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  altText: string;
  role: SubjectImageRole;
}

export interface ExtractedSubjectPage {
  canonicalUrl: string;
  title: string;
  description: string;
  facts: Array<{ key: string; value: string; sourceUrl: string }>;
  structuredData: Record<string, unknown>;
  images: ExtractedSubjectImage[];
}

type ResolverResult = Array<string | ResolvedAddress>;
type Resolver = (hostname: string) => Promise<ResolverResult>;

export interface ExtractSubjectPageInput {
  url: string;
  fetchImpl?: typeof fetch;
  fetcher?: typeof fetch;
  resolveHost?: Resolver;
  resolveHostname?: Resolver;
  archiveImage: (image: SubjectImageArchiveInput) => Promise<{
    storageUrl: string;
    storagePath: string;
    width?: number | null;
    height?: number | null;
  }>;
  timeoutMs?: number;
}

interface ImageCandidate {
  sourceUrl: string;
  width: number | null;
  height: number | null;
  altText: string;
  role: SubjectImageRole;
}

export function pinnedLookup(addresses: Array<ResolvedAddress & { family?: number }>): LookupFunction {
  const normalized = addresses.map(({ address, family }) => ({
    address,
    family: family ?? isIP(address),
  }));

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, normalized);
      return;
    }
    const requestedFamily = typeof options.family === "number" ? options.family : 0;
    const selected = normalized.find(({ family }) => requestedFamily === 0 || family === requestedFamily) ?? normalized[0];
    callback(null, selected.address, selected.family);
  };
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function normalizeResolver(resolver?: Resolver): HostnameResolver {
  if (!resolver) return defaultResolver;
  return async (hostname) => (await resolver(hostname)).map((entry) => typeof entry === "string"
    ? { address: entry, family: isIP(entry) || undefined }
    : entry);
}

async function safeFetch(
  initialUrl: string,
  fetchImpl: typeof fetch,
  resolveHostname: HostnameResolver,
  timeoutMs: number,
  accept: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => clearTimeout(timeout);
  let dispatcher: Agent | null = null;
  try {
    let targetUrl = initialUrl;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      try {
        if (METADATA_HOSTNAMES.has(new URL(targetUrl).hostname.toLowerCase().replace(/\.$/, ""))) {
          throw new Error("crawl_url_unsafe_host");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "crawl_url_unsafe_host") throw error;
      }
      let validatedAddresses: ResolvedAddress[] = [];
      const target = await assertSafeCrawlUrl(targetUrl, {
        resolveHostname: async (hostname) => {
          validatedAddresses = await resolveHostname(hostname);
          return validatedAddresses;
        },
      });
      const addresses = isIP(target.hostname)
        ? [{ address: target.hostname, family: isIP(target.hostname) }]
        : validatedAddresses;
      if (addresses.length === 0) throw new Error("crawl_url_unsafe_address");

      dispatcher = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
      const response = await fetchImpl(target.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "BrandPilotMVP/0.1 (+https://github.com/2pow1/Brand_Pilot)",
          Accept: accept,
        },
        dispatcher,
      } as RequestInit);

      if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: target.toString(), dispatcher, cleanup };
      const location = response.headers.get("location");
      if (!location) {
        await cancelResponseBody(response);
        throw new Error("crawl_redirect_location_required");
      }
      await cancelResponseBody(response);
      await dispatcher?.close();
      dispatcher = null;
      if (redirectCount === MAX_REDIRECTS) throw new Error("crawl_redirect_limit_exceeded");
      targetUrl = new URL(location, target).toString();
    }
    throw new Error("crawl_response_missing");
  } catch (error) {
    await dispatcher?.close().catch(() => undefined);
    cleanup();
    throw error;
  }
}

async function cancelResponseBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function readBounded(response: Response, limit: number, errorCode: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await cancelResponseBody(response);
    throw new Error(errorCode);
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function archiveWithTimeout(
  archiveImage: ExtractSubjectPageInput["archiveImage"],
  image: Omit<SubjectImageArchiveInput, "signal">,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("subject_image_archive_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([archiveImage({ ...image, signal: controller.signal }), timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

function text(value: string | undefined | null) {
  return decodeHtml(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? "").trim();
}

function absoluteHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function metaContent(html: string, names: string[]) {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const tag = match[1];
    const name = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (names.includes(name)) return text(attr(tag, "content"));
  }
  return "";
}

function canonicalUrl(html: string, finalUrl: string) {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const tag = match[1];
    if (attr(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")) {
      return absoluteHttpUrl(attr(tag, "href"), finalUrl) ?? finalUrl;
    }
  }
  return finalUrl;
}

function visibleText(html: string) {
  const $ = load(html);
  $("script, style, svg, noscript, head, nav, footer, header, aside, form").remove();
  return decodeHtml($("body").text()).replace(/\s+/g, " ").trim().slice(0, 20_000);
}

function isProductOrService(value: unknown) {
  const types = Array.isArray(value) ? value : [value];
  return types.some((type) => type === "Product" || type === "Service");
}

function findStructuredData(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStructuredData(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (isProductOrService(object["@type"])) return object;
  return findStructuredData(object["@graph"]);
}

function extractStructuredData(html: string) {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attr(match[1], "type").toLowerCase() !== "application/ld+json") continue;
    try {
      const found = findStructuredData(JSON.parse(match[2]));
      if (found) return found;
    } catch {
      // Invalid JSON-LD is ignored while the rest of the page remains usable.
    }
  }
  return {};
}

function numberAttr(tag: string, name: string) {
  const value = Number(attr(tag, name));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function classifyRole(hint: string, structuredData: Record<string, unknown>): SubjectImageRole {
  const normalized = hint.toLowerCase();
  if (normalized.includes("logo")) return "logo";
  if (normalized.includes("detail") || normalized.includes("zoom") || normalized.includes("gallery")) return "detail";
  const type = structuredData["@type"];
  if ((Array.isArray(type) ? type : [type]).includes("Product")) return "product";
  if ((Array.isArray(type) ? type : [type]).includes("Service")) return "service";
  return "unknown";
}

function imageCandidates(html: string, baseUrl: string, structuredData: Record<string, unknown>) {
  const candidates = new Map<string, ImageCandidate>();
  const add = (value: string, details: Omit<ImageCandidate, "sourceUrl">) => {
    if (!value.trim()) return;
    const sourceUrl = absoluteHttpUrl(value, baseUrl);
    if (!sourceUrl) return;
    const existing = candidates.get(sourceUrl);
    if (existing) {
      candidates.set(sourceUrl, {
        ...existing,
        width: details.width ?? existing.width,
        height: details.height ?? existing.height,
        altText: details.altText || existing.altText,
        role: details.role === "unknown" ? existing.role : details.role,
      });
    } else if (candidates.size < 20) {
      candidates.set(sourceUrl, { sourceUrl, ...details });
    }
  };

  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const tag = match[1];
    if (["og:image", "og:image:url", "twitter:image"].includes((attr(tag, "property") || attr(tag, "name")).toLowerCase())) {
      add(attr(tag, "content"), { width: null, height: null, altText: "", role: classifyRole("hero", structuredData) });
    }
  }
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const tag = match[1];
    const altText = text(attr(tag, "alt"));
    const details = {
      width: numberAttr(tag, "width"),
      height: numberAttr(tag, "height"),
      altText,
      role: classifyRole(`${attr(tag, "class")} ${attr(tag, "id")} ${altText} ${attr(tag, "src")}`, structuredData),
    };
    add(attr(tag, "src") || attr(tag, "data-src"), details);
    for (const source of attr(tag, "srcset").split(",")) add(source.trim().split(/\s+/)[0], details);
  }
  const structuredImages = structuredData.image;
  const values = Array.isArray(structuredImages) ? structuredImages : [structuredImages];
  for (const value of values) {
    const source = typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>).url : null;
    if (typeof source === "string") add(source, { width: null, height: null, altText: "", role: classifyRole("structured", structuredData) });
  }
  return [...candidates.values()].slice(0, 6);
}

function extractedFacts(title: string, description: string, body: string, structuredData: Record<string, unknown>, sourceUrl: string) {
  const facts: Array<{ key: string; value: string; sourceUrl: string }> = [];
  const add = (key: string, value: string) => { if (value) facts.push({ key, value, sourceUrl }); };
  add("title", title);
  add("description", description);
  add("visible_text", body);
  for (const [key, value] of Object.entries(structuredData)) {
    if (!key.startsWith("@") && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      add(key, String(value));
    }
  }
  return facts;
}

export async function extractSubjectPage(input: ExtractSubjectPageInput): Promise<ExtractedSubjectPage> {
  const fetchImpl = input.fetchImpl ?? input.fetcher ?? fetch;
  const resolveHostname = normalizeResolver(input.resolveHost ?? input.resolveHostname);
  const timeoutMs = input.timeoutMs ?? 15_000;
  const archiveTimeoutMs = Math.min(Math.max(timeoutMs, 1), 30_000);
  const pageFetch = await safeFetch(input.url, fetchImpl, resolveHostname, timeoutMs, "text/html,application/xhtml+xml");
  try {
    if (!pageFetch.response.ok) throw new Error(`subject_page_fetch_failed:${pageFetch.response.status}`);
    const pageMime = (pageFetch.response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (pageMime !== "text/html" && pageMime !== "application/xhtml+xml") throw new Error("subject_page_mime_unsupported");
    const html = new TextDecoder().decode(await readBounded(pageFetch.response, HTML_LIMIT, "subject_page_too_large"));
    const title = text(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || metaContent(html, ["og:title"]);
    const description = metaContent(html, ["description", "og:description"]);
    const structuredData = extractStructuredData(html);
    const images: ExtractedSubjectImage[] = [];

    for (const candidate of imageCandidates(html, pageFetch.finalUrl, structuredData)) {
      try {
        const fetched = await safeFetch(candidate.sourceUrl, fetchImpl, resolveHostname, timeoutMs, "image/jpeg,image/png,image/webp,image/gif");
        try {
          if (!fetched.response.ok) throw new Error(`subject_image_fetch_failed:${fetched.response.status}`);
          const mimeType = (fetched.response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
          if (!IMAGE_MIME_TYPES.has(mimeType)) throw new Error("subject_image_mime_unsupported");
          const data = await readBounded(fetched.response, IMAGE_LIMIT, "subject_image_too_large");
          const index = images.length;
          const archived = await archiveWithTimeout(input.archiveImage, { ...candidate, index, data, mimeType }, archiveTimeoutMs);
          images.push({
            sourceUrl: candidate.sourceUrl,
            storageUrl: archived.storageUrl,
            storagePath: archived.storagePath,
            width: archived.width ?? candidate.width,
            height: archived.height ?? candidate.height,
            mimeType,
            altText: candidate.altText,
            role: candidate.role,
          });
        } finally {
          await cancelResponseBody(fetched.response);
          await fetched.dispatcher?.close().catch(() => undefined);
          fetched.cleanup();
        }
      } catch {
        // A bad image must not make otherwise valid subject extraction fail.
      }
    }

    const body = visibleText(html);
    return {
      canonicalUrl: canonicalUrl(html, pageFetch.finalUrl),
      title,
      description,
      facts: extractedFacts(title, description, body, structuredData, pageFetch.finalUrl),
      structuredData,
      images,
    };
  } finally {
    await cancelResponseBody(pageFetch.response);
    await pageFetch.dispatcher?.close().catch(() => undefined);
    pageFetch.cleanup();
  }
}
