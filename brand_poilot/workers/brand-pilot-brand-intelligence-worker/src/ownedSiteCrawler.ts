import {
  crawlSourceUrl,
  discoverContentUrls,
  type CrawledSnapshot,
} from "./sourceCrawler.js";
import { getDomain } from "tldts";
import { createOwnedPageRenderer, renderOwnedPage } from "./chromiumRenderer.js";

export const OWNED_PAGE_ATTEMPT_LIMIT = 20;
export const OWNED_OFFERING_PAGE_LIMIT = 5;
export const OWNED_CANDIDATE_LIMIT = 200;

export type OwnedPageClassification =
  | "homepage" | "about" | "offering" | "pricing"
  | "case" | "faq" | "contact" | "other";

export interface OwnedCrawledPage {
  sourceUrl: string;
  title: string | null;
  text: string;
  contentHash: string;
  classification: OwnedPageClassification;
}

interface Candidate {
  url: string;
  depth: number;
  linkText: string | null;
  score: number;
  classification: OwnedPageClassification;
}

const EXCLUDED_PATH = /(?:^|\/)(?:privacy|privacy-policy|terms|terms-of-service|legal|cookies?|login|signin|signup|register|account|search|tags?|authors?|cart|checkout)(?:\/|$)/i;
const OFFERING_SIGNAL = /(?:^|\/)(?:products?|items?|goods|services?|solutions?|shop|store)(?:\/|$)/i;
const PRICING_SIGNAL = /(?:^|\/)(?:pricing|plans?|fees?)(?:\/|$)/i;
const CASE_SIGNAL = /(?:^|\/)(?:customers?|clients?|cases?|case-stud(?:y|ies)|portfolio|reviews?|testimonials?)(?:\/|$)/i;
const ABOUT_SIGNAL = /(?:^|\/)(?:about|company|brand|story|mission|why)(?:\/|$)/i;
const FAQ_SIGNAL = /(?:^|\/)(?:faq|faqs|help|support)(?:\/|$)/i;
const CONTACT_SIGNAL = /(?:^|\/)(?:contact|contact-us|locations?)(?:\/|$)/i;
const OFFERING_TEXT_SIGNAL = /\b(?:product|service|solution|shop|pricing|plan)s?\b|상품|제품|서비스|솔루션|가격|요금/i;
const CASE_TEXT_SIGNAL = /\b(?:customer|client|case study|portfolio|review|testimonial)s?\b|고객|사례|포트폴리오|후기/i;
const ABOUT_TEXT_SIGNAL = /\b(?:about|company|brand|story|mission)\b|회사|브랜드|소개|미션/i;
const QUOTAS: Record<OwnedPageClassification, number> = {
  homepage: 1,
  about: 3,
  offering: 5,
  pricing: 2,
  case: 3,
  faq: 2,
  contact: 2,
  other: 2,
};

async function discoverMetadataUrls(seedUrl: string, signal?: AbortSignal): Promise<string[]> {
  const seed = new URL(seedUrl);
  const sitemapUrls = new Set<string>([new URL("/sitemap.xml", seed).toString()]);
  try {
    const robots = await crawlSourceUrl(new URL("/robots.txt", seed).toString(), {
      signal,
      timeoutMs: 5_000,
      maxResponseBytes: 256 * 1024,
    });
    for (const match of robots.rawText.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      if (sitemapUrls.size < 5) sitemapUrls.add(match[1]!);
    }
  } catch {
    // robots.txt is optional.
  }
  const discovered: string[] = [];
  for (const sitemapUrl of [...sitemapUrls].slice(0, 5)) {
    try {
      const sitemap = await crawlSourceUrl(sitemapUrl, {
        signal,
        timeoutMs: 5_000,
        maxResponseBytes: 2 * 1024 * 1024,
      });
      for (const match of sitemap.rawText.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
        discovered.push(match[1]!.replaceAll("&amp;", "&"));
        if (discovered.length >= OWNED_CANDIDATE_LIMIT) return discovered;
      }
    } catch {
      // A missing or blocked sitemap does not fail the site crawl.
    }
  }
  return discovered;
}

function discoverJsonLdUrls(pageUrl: string, html: string): string[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]!);
      const visit = (item: unknown) => {
        if (!item || typeof item !== "object") return;
        if (Array.isArray(item)) return item.forEach(visit);
        for (const [key, nested] of Object.entries(item as Record<string, unknown>)) {
          if (["url", "@id"].includes(key) && typeof nested === "string") {
            try { urls.push(new URL(nested, pageUrl).toString()); } catch { /* Ignore. */ }
          } else visit(nested);
        }
      };
      visit(value);
    } catch {
      // Invalid embedded JSON-LD is ignored.
    }
  }
  return urls;
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_")
        || ["fbclid", "gclid", "igshid"].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function classify(candidateUrl: string, linkText: string | null): OwnedPageClassification {
  const pathname = new URL(candidateUrl).pathname;
  const textSignal = linkText ?? "";
  if (pathname === "/" || pathname === "") return "homepage";
  if (PRICING_SIGNAL.test(pathname)) return "pricing";
  if (FAQ_SIGNAL.test(pathname)) return "faq";
  if (CONTACT_SIGNAL.test(pathname)) return "contact";
  if (OFFERING_SIGNAL.test(pathname) || OFFERING_TEXT_SIGNAL.test(textSignal)) return "offering";
  if (ABOUT_SIGNAL.test(pathname) || ABOUT_TEXT_SIGNAL.test(textSignal)) return "about";
  if (CASE_SIGNAL.test(pathname) || CASE_TEXT_SIGNAL.test(textSignal)) return "case";
  return "other";
}

function classifySnapshot(
  candidateUrl: string,
  title: string | null,
  text: string,
  fallback: OwnedPageClassification,
): OwnedPageClassification {
  const observed = `${title ?? ""} ${text.slice(0, 2_000)}`;
  if (new URL(candidateUrl).pathname === "/") return "homepage";
  if (PRICING_SIGNAL.test(new URL(candidateUrl).pathname)) return "pricing";
  if (FAQ_SIGNAL.test(new URL(candidateUrl).pathname)) return "faq";
  if (CONTACT_SIGNAL.test(new URL(candidateUrl).pathname)) return "contact";
  if (OFFERING_SIGNAL.test(new URL(candidateUrl).pathname)
    || OFFERING_TEXT_SIGNAL.test(observed)) return "offering";
  if (ABOUT_SIGNAL.test(new URL(candidateUrl).pathname)
    || ABOUT_TEXT_SIGNAL.test(observed)) return "about";
  if (CASE_SIGNAL.test(new URL(candidateUrl).pathname)
    || CASE_TEXT_SIGNAL.test(observed)) return "case";
  return fallback;
}

function score(candidateUrl: string, linkText: string | null, depth: number): number {
  const classification = classify(candidateUrl, linkText);
  const base = classification === "homepage"
    ? 120
    : classification === "about"
      ? 100
    : classification === "offering"
      ? 90
      : classification === "pricing"
        ? 85
      : classification === "case"
        ? 75
        : classification === "faq" || classification === "contact"
          ? 60
        : 30;
  const pathDepth = new URL(candidateUrl).pathname.split("/").filter(Boolean).length;
  return base - depth * 8 - pathDepth * 2;
}

function isEligible(candidateUrl: string, seed: URL): boolean {
  try {
    const parsed = new URL(candidateUrl);
    const seedDomain = getDomain(seed.hostname) ?? seed.hostname;
    const candidateDomain = getDomain(parsed.hostname) ?? parsed.hostname;
    return candidateDomain === seedDomain
      && !EXCLUDED_PATH.test(parsed.pathname)
      && !/\.(?:pdf|csv|xlsx?|docx?|zip|png|jpe?g|gif|svg|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isCrawlValid(snapshot: CrawledSnapshot): boolean {
  return snapshot.httpStatus >= 200
    && snapshot.httpStatus < 300
    && snapshot.text.replace(/\s+/g, " ").trim().length >= 120;
}

function discoverOwnedNavigationUrls(pageUrl: string, html: string) {
  const discovered: Array<{ url: string; linkText: string | null }> = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const candidate = new URL(match[1]!, pageUrl);
      candidate.hash = "";
      discovered.push({
        url: candidate.toString(),
        linkText: match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null,
      });
    } catch {
      // Ignore malformed and non-HTTP navigation values.
    }
  }
  return discovered;
}

export function requiredOwnedPageSuccesses(eligibleSelected: number): number {
  return Math.min(10, Math.ceil(Math.max(0, eligibleSelected) / 2));
}

export async function crawlImportantOwnedPages(
  seedUrl: string,
  {
    crawlPage: crawlPageInput,
    renderPage = renderOwnedPage,
    signal,
    onProgress,
  }: {
    crawlPage?: (url: string, signal?: AbortSignal) => Promise<CrawledSnapshot>;
    renderPage?: (url: string, signal?: AbortSignal) => Promise<CrawledSnapshot>;
    signal?: AbortSignal;
    onProgress?: (progress: {
      attemptedCount: number;
      successfulCount: number;
      requiredCount: number;
    }) => Promise<void>;
  } = {},
): Promise<{
  pages: OwnedCrawledPage[];
  attemptedCount: number;
  successfulCount: number;
  requiredCount: number;
  candidateCount: number;
}> {
  const crawlPage = crawlPageInput
    ?? ((url: string, activeSignal?: AbortSignal) => (
      crawlSourceUrl(url, { signal: activeSignal, timeoutMs: 10_000 })
    ));
  const renderer = crawlPageInput ? null : createOwnedPageRenderer();
  const activeRenderPage = renderPage === renderOwnedPage && renderer
    ? renderer.render
    : renderPage;
  const normalizedSeed = normalizedUrl(seedUrl);
  if (!normalizedSeed) throw new Error("brand_analysis_owned_url_invalid");
  const seed = new URL(normalizedSeed);
  const candidates = new Map<string, Candidate>();
  const discoveredCandidates = new Set<string>();
  const attempted = new Set<string>();
  const canonicalUrls = new Set<string>();
  const contentHashes = new Set<string>();
  const pages: OwnedCrawledPage[] = [];
  let successfulCount = 0;
  let retainedOfferings = 0;
  let chromiumFallbacks = 0;
  let retainedCharacters = 0;
  const attemptedByClass: Record<OwnedPageClassification, number> = {
    homepage: 0, about: 0, offering: 0, pricing: 0,
    case: 0, faq: 0, contact: 0, other: 0,
  };

  const addCandidate = (url: string, depth: number, linkText: string | null) => {
    const normalized = normalizedUrl(url);
    if (!normalized || discoveredCandidates.size >= OWNED_CANDIDATE_LIMIT
      || attempted.has(normalized) || !isEligible(normalized, seed)) return;
    const classification = depth === 0 ? "homepage" : classify(normalized, linkText);
    const next: Candidate = {
      url: normalized,
      depth,
      linkText,
      classification,
      score: depth === 0 ? 1_000 : score(normalized, linkText, depth),
    };
    const previous = candidates.get(normalized);
    if (!previous || next.score > previous.score) {
      candidates.set(normalized, next);
      discoveredCandidates.add(normalized);
    }
  };
  addCandidate(normalizedSeed, 0, null);
  if (!crawlPageInput) {
    for (const url of await discoverMetadataUrls(normalizedSeed, signal)) {
      addCandidate(url, 1, null);
    }
  }

  try {
    while (attempted.size < OWNED_PAGE_ATTEMPT_LIMIT && candidates.size) {
      if (signal?.aborted) throw signal.reason ?? new Error("brand_analysis_cancelled");
      const next = [...candidates.values()]
      .filter((candidate) => attemptedByClass[candidate.classification] < QUOTAS[candidate.classification])
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))[0];
      if (!next) break;
      candidates.delete(next.url);
      attempted.add(next.url);
      attemptedByClass[next.classification] += 1;
      await onProgress?.({
        attemptedCount: attempted.size,
        successfulCount,
        requiredCount: requiredOwnedPageSuccesses(attempted.size),
      });

    let snapshot: CrawledSnapshot;
    try {
      snapshot = await crawlPage(next.url, signal);
      if (!isCrawlValid(snapshot) && chromiumFallbacks < 3) {
        chromiumFallbacks += 1;
        snapshot = await activeRenderPage(next.url, signal);
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      continue;
    }

    const canonical = normalizedUrl(snapshot.canonicalUrl ?? next.url) ?? next.url;
    if (!isCrawlValid(snapshot)) continue;
    if (!isEligible(canonical, seed)) continue;
    if (canonicalUrls.has(canonical)) {
      continue;
    }
    canonicalUrls.add(canonical);
    if (contentHashes.has(snapshot.contentHash)) {
      continue;
    }
    contentHashes.add(snapshot.contentHash);
    const observedClassification = classifySnapshot(
      canonical,
      snapshot.title,
      snapshot.text,
      next.classification,
    );
    if (observedClassification === "offering" && retainedOfferings >= OWNED_OFFERING_PAGE_LIMIT) {
      continue;
    }
    if (observedClassification === "offering") retainedOfferings += 1;
    const normalizedText = snapshot.text.replace(/\s+/g, " ").trim().slice(0, 15_000);
    if (!normalizedText || retainedCharacters + normalizedText.length > 300_000) continue;
    retainedCharacters += normalizedText.length;
    successfulCount += 1;
    await onProgress?.({
      attemptedCount: attempted.size,
      successfulCount,
      requiredCount: requiredOwnedPageSuccesses(attempted.size),
    });

    pages.push({
      sourceUrl: canonical,
      title: snapshot.title,
      text: normalizedText,
      contentHash: snapshot.contentHash,
      classification: observedClassification,
    });
    if (next.depth < 2) {
      const discoveredLinks = [
        ...discoverContentUrls(next.url, snapshot.rawText),
        ...discoverOwnedNavigationUrls(next.url, snapshot.rawText).map((item) => ({
          ...item,
          discoveryMethod: "anchor" as const,
        })),
      ];
      for (const jsonLdUrl of discoverJsonLdUrls(next.url, snapshot.rawText)) {
        discoveredLinks.push({
          url: jsonLdUrl,
          linkText: null,
          discoveryMethod: "anchor" as const,
        });
      }
      for (const discovered of discoveredLinks) {
        addCandidate(discovered.url, next.depth + 1, discovered.linkText);
      }
    }
    }
  } finally {
    await renderer?.close();
  }

  const requiredCount = requiredOwnedPageSuccesses(attempted.size);
  if (successfulCount < requiredCount) {
    throw new Error("brand_analysis_owned_page_success_threshold_not_met");
  }
  return {
    pages,
    attemptedCount: attempted.size,
    successfulCount,
    requiredCount,
    candidateCount: discoveredCandidates.size,
  };
}
