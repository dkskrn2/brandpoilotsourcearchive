import {
  crawlSourceUrl,
  discoverContentUrls,
  type CrawledSnapshot,
} from "./sourceCrawler.js";

export const OWNED_PAGE_ATTEMPT_LIMIT = 20;
export const OWNED_OFFERING_PAGE_LIMIT = 5;
export const OWNED_CANDIDATE_LIMIT = 200;

export type OwnedPageClassification = "core" | "offering" | "proof" | "other";

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

const EXCLUDED_PATH = /(?:^|\/)(?:privacy|privacy-policy|terms|terms-of-service|legal|cookies?|login|signin|signup|cart|checkout)(?:\/|$)/i;
const OFFERING_SIGNAL = /(?:^|\/)(?:products?|items?|goods|services?|solutions?|shop|store|pricing|plans?)(?:\/|$)/i;
const PROOF_SIGNAL = /(?:^|\/)(?:customers?|clients?|cases?|case-stud(?:y|ies)|portfolio|reviews?|testimonials?)(?:\/|$)/i;
const CORE_SIGNAL = /(?:^|\/)(?:about|company|brand|story|mission|why)(?:\/|$)/i;
const OFFERING_TEXT_SIGNAL = /\b(?:product|service|solution|shop|pricing|plan)s?\b|상품|제품|서비스|솔루션|가격|요금/i;
const PROOF_TEXT_SIGNAL = /\b(?:customer|client|case study|portfolio|review|testimonial)s?\b|고객|사례|포트폴리오|후기/i;
const CORE_TEXT_SIGNAL = /\b(?:about|company|brand|story|mission)\b|회사|브랜드|소개|미션/i;

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
  if (OFFERING_SIGNAL.test(pathname) || OFFERING_TEXT_SIGNAL.test(textSignal)) return "offering";
  if (CORE_SIGNAL.test(pathname) || CORE_TEXT_SIGNAL.test(textSignal)) return "core";
  if (PROOF_SIGNAL.test(pathname) || PROOF_TEXT_SIGNAL.test(textSignal)) return "proof";
  return "other";
}

function classifySnapshot(
  candidateUrl: string,
  title: string | null,
  text: string,
  fallback: OwnedPageClassification,
): OwnedPageClassification {
  const observed = `${title ?? ""} ${text.slice(0, 2_000)}`;
  if (OFFERING_SIGNAL.test(new URL(candidateUrl).pathname)
    || OFFERING_TEXT_SIGNAL.test(observed)) return "offering";
  if (CORE_SIGNAL.test(new URL(candidateUrl).pathname)
    || CORE_TEXT_SIGNAL.test(observed)) return "core";
  if (PROOF_SIGNAL.test(new URL(candidateUrl).pathname)
    || PROOF_TEXT_SIGNAL.test(observed)) return "proof";
  return fallback;
}

function score(candidateUrl: string, linkText: string | null, depth: number): number {
  const classification = classify(candidateUrl, linkText);
  const base = classification === "core"
    ? 100
    : classification === "offering"
      ? 90
      : classification === "proof"
        ? 75
        : 30;
  const pathDepth = new URL(candidateUrl).pathname.split("/").filter(Boolean).length;
  return base - depth * 8 - pathDepth * 2;
}

function isEligible(candidateUrl: string, seed: URL): boolean {
  try {
    const parsed = new URL(candidateUrl);
    return parsed.hostname === seed.hostname
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
    signal,
  }: {
    crawlPage?: (url: string, signal?: AbortSignal) => Promise<CrawledSnapshot>;
    signal?: AbortSignal;
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
      crawlSourceUrl(url, { signal: activeSignal })
    ));
  const normalizedSeed = normalizedUrl(seedUrl);
  if (!normalizedSeed) throw new Error("brand_analysis_owned_url_invalid");
  const seed = new URL(normalizedSeed);
  const candidates = new Map<string, Candidate>();
  const attempted = new Set<string>();
  const canonicalUrls = new Set<string>();
  const contentHashes = new Set<string>();
  const pages: OwnedCrawledPage[] = [];
  let eligibleSelected = 0;
  let offeringAttempts = 0;
  let successfulCount = 0;
  let retainedOfferings = 0;

  const addCandidate = (url: string, depth: number, linkText: string | null) => {
    const normalized = normalizedUrl(url);
    if (!normalized || candidates.size >= OWNED_CANDIDATE_LIMIT
      || attempted.has(normalized) || !isEligible(normalized, seed)) return;
    const classification = depth === 0 ? "core" : classify(normalized, linkText);
    const next: Candidate = {
      url: normalized,
      depth,
      linkText,
      classification,
      score: depth === 0 ? 1_000 : score(normalized, linkText, depth),
    };
    const previous = candidates.get(normalized);
    if (!previous || next.score > previous.score) candidates.set(normalized, next);
  };
  addCandidate(normalizedSeed, 0, null);

  while (attempted.size < OWNED_PAGE_ATTEMPT_LIMIT && candidates.size) {
    if (signal?.aborted) throw signal.reason ?? new Error("brand_analysis_cancelled");
    const next = [...candidates.values()]
      .filter((candidate) => (
        candidate.classification !== "offering"
        || offeringAttempts < OWNED_OFFERING_PAGE_LIMIT
      ))
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))[0];
    if (!next) break;
    candidates.delete(next.url);
    attempted.add(next.url);
    if (next.classification === "offering") offeringAttempts += 1;
    eligibleSelected += 1;

    let snapshot: CrawledSnapshot;
    try {
      snapshot = await crawlPage(next.url, signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      continue;
    }

    const canonical = normalizedUrl(snapshot.canonicalUrl ?? next.url) ?? next.url;
    if (canonicalUrls.has(canonical)) {
      eligibleSelected -= 1;
      continue;
    }
    canonicalUrls.add(canonical);
    if (!isCrawlValid(snapshot)) continue;
    if (contentHashes.has(snapshot.contentHash)) {
      eligibleSelected -= 1;
      continue;
    }
    contentHashes.add(snapshot.contentHash);
    successfulCount += 1;
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

    pages.push({
      sourceUrl: canonical,
      title: snapshot.title,
      text: snapshot.text,
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
      for (const discovered of discoveredLinks) {
        addCandidate(discovered.url, next.depth + 1, discovered.linkText);
      }
    }
  }

  const requiredCount = requiredOwnedPageSuccesses(eligibleSelected);
  if (successfulCount < requiredCount) {
    throw new Error("brand_analysis_owned_page_success_threshold_not_met");
  }
  return {
    pages,
    attemptedCount: attempted.size,
    successfulCount,
    requiredCount,
    candidateCount: attempted.size + candidates.size,
  };
}
