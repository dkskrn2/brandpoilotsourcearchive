import { createHash } from "node:crypto";
import {
  parseResearchSourceAcquisitionV1,
  type ResearchSourceAcquisitionV1,
} from "@brand-pilot/content-contracts/research-source-acquisition";
import type { ContentReferenceRoleV2, ContentSeedV2 } from "./aiContentContracts.js";
import { crawlSourceUrl, isLikelyContentPage } from "./sourceCrawler.js";

export type ResolvedAiContentSubjectV2 =
  | { kind: "topic_text"; title: string; researchSourceAcquisition: ResearchSourceAcquisitionV1 }
  | {
    kind: "topic_url";
    requestedUrl: string;
    canonicalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    capturedAt: string;
    researchSourceAcquisition: ResearchSourceAcquisitionV1;
  }
  | { kind: "reference"; referenceIds: string[]; researchSourceAcquisition: ResearchSourceAcquisitionV1 };

const referenceRoles = new Set<ContentReferenceRoleV2>([
  "planning",
  "copy_pattern",
  "visual_composition",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidSeed(): never {
  throw new Error("ai_content_seed_invalid");
}

function resolutionFailed(): never {
  throw new Error("ai_content_seed_resolution_failed");
}

function exactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalidSeed();
}

function normalizedHttpUrl(value: unknown, fail: () => never): string {
  if (typeof value !== "string") return fail();
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_000) return fail();
  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return fail();
    url.hash = "";
    return url.toString();
  } catch {
    return fail();
  }
}

function normalizedSnapshotText(value: unknown): string | null {
  if (typeof value !== "string") return resolutionFailed();
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > 50_000) return resolutionFailed();
  return normalized || null;
}

function normalizedSnapshotTitle(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return resolutionFailed();
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length > 500) return resolutionFailed();
  return normalized;
}

function publisherBlocked(error: unknown): boolean {
  return error instanceof Error && /^HTTP (?:402|403|429)$/.test(error.message);
}

function indeterminateCrawlerFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message === "crawl_url_unsafe_address" || /^HTTP \d{3}$/.test(error.message)) return false;
  return true;
}

function acquisition(input: Omit<ResearchSourceAcquisitionV1, "contractVersion">): ResearchSourceAcquisitionV1 {
  return parseResearchSourceAcquisitionV1({
    contractVersion: "research-source-acquisition.v1",
    ...input,
  });
}

function urlTopicHint(value: string): string {
  const url = new URL(value);
  const encodedSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  let segment = encodedSegment;
  try {
    segment = decodeURIComponent(encodedSegment);
  } catch { /* Keep the encoded public path as the bounded fallback hint. */ }
  const title = segment
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+\d{5,}$/, "")
    .trim();
  return (title || url.hostname.replace(/^www\./i, "")).slice(0, 500);
}

function boundedMetadataHint(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function contentMarkup(rawText: string): string {
  return rawText
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ");
}

function normalizedMarkupText(markup: string): string {
  return contentMarkup(markup).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function hasAmbiguousArticleOnlyBody(rawText: string, selectedText: string): boolean {
  const markup = contentMarkup(rawText);
  const articleCount = Array.from(markup.matchAll(/<article\b/gi)).length;
  if (articleCount <= 1) return false;
  const trustedMainTexts = Array.from(
    markup.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi),
    (match) => {
      const mainMarkup = match[1] ?? "";
      const descendantArticleCount = Array.from(mainMarkup.matchAll(/<article\b/gi)).length;
      return descendantArticleCount <= 1 ? normalizedMarkupText(mainMarkup) : "";
    },
  ).filter(Boolean);
  return !trustedMainTexts.includes(selectedText);
}

function incompletePageFallbackText(input: {
  canonicalUrl: string;
  title: string | null;
  metaDescription: unknown;
}): string {
  const url = input.canonicalUrl.slice(0, 1_000);
  const slug = urlTopicHint(input.canonicalUrl);
  const title = input.title ?? "확인 필요";
  const metaDescription = boundedMetadataHint(input.metaDescription, 1_000) ?? "확인 필요";
  return [
    "원문 전체 본문을 안정적으로 수집하지 못했습니다. 아래 메타데이터는 주제 단서일 뿐이며 온라인 검색으로 원문 내용을 검증해야 합니다.",
    `원문 URL: ${url}`,
    `수집 제목: ${title}`,
    `URL 주제: ${slug}`,
    `메타 설명: ${metaDescription}`,
  ].join("\n").slice(0, 4_000);
}

function canonicalReferenceIds(seed: Extract<ContentSeedV2, { kind: "reference" }>): string[] {
  exactKeys(seed, ["kind", "items"]);
  if (!Array.isArray(seed.items) || seed.items.length < 1 || seed.items.length > 5) invalidSeed();
  const referenceIds = seed.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalidSeed();
    exactKeys(item, ["referenceId", "roles"]);
    if (typeof item.referenceId !== "string" || !uuidPattern.test(item.referenceId.trim())) return invalidSeed();
    if (!Array.isArray(item.roles) || item.roles.length < 1 || item.roles.length > 3) return invalidSeed();
    if (item.roles.some((role) => typeof role !== "string" || !referenceRoles.has(role as ContentReferenceRoleV2))) {
      return invalidSeed();
    }
    if (new Set(item.roles).size !== item.roles.length) return invalidSeed();
    return item.referenceId.trim().toLowerCase();
  });
  if (new Set(referenceIds).size !== referenceIds.length) invalidSeed();
  return referenceIds;
}

export async function resolveAiContentSeed(
  seed: ContentSeedV2,
  deps: { crawlUrl: typeof crawlSourceUrl; now: () => Date },
): Promise<ResolvedAiContentSubjectV2> {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) invalidSeed();

  if (seed.kind === "topic_text") {
    exactKeys(seed, ["kind", "title"]);
    if (typeof seed.title !== "string") invalidSeed();
    const title = seed.title.trim();
    if (!title || title.length > 500) invalidSeed();
    return {
      kind: "topic_text",
      title,
      researchSourceAcquisition: acquisition({
        status: "not_applicable",
        requestedUrl: null,
        canonicalUrl: null,
        contentHash: null,
        capturedAt: deps.now().toISOString(),
      }),
    };
  }

  if (seed.kind === "reference") {
    return {
      kind: "reference",
      referenceIds: canonicalReferenceIds(seed),
      researchSourceAcquisition: acquisition({
        status: "not_applicable",
        requestedUrl: null,
        canonicalUrl: null,
        contentHash: null,
        capturedAt: deps.now().toISOString(),
      }),
    };
  }

  if (seed.kind !== "topic_url") return invalidSeed();
  exactKeys(seed, ["kind", "url"]);
  const requestedUrl = normalizedHttpUrl(seed.url, invalidSeed);

  let snapshot: Awaited<ReturnType<typeof crawlSourceUrl>>;
  try {
    snapshot = await deps.crawlUrl(requestedUrl);
  } catch (error) {
    if (!publisherBlocked(error) && !indeterminateCrawlerFailure(error)) return resolutionFailed();
    const title = urlTopicHint(requestedUrl);
    const text = `원문 URL을 수집하지 못했습니다. 온라인 검색으로 확인할 주제: ${title}`;
    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
    const capturedAt = deps.now().toISOString();
    return {
      kind: "topic_url",
      requestedUrl,
      canonicalUrl: requestedUrl,
      title,
      text,
      contentHash,
      capturedAt,
      researchSourceAcquisition: acquisition({
        status: publisherBlocked(error) ? "access_failed" : "indeterminate",
        requestedUrl,
        canonicalUrl: requestedUrl,
        contentHash,
        capturedAt,
      }),
    };
  }

  try {
    const canonicalUrl = normalizedHttpUrl(snapshot?.finalUrl, resolutionFailed);
    let title = normalizedSnapshotTitle(snapshot?.title);
    let text = normalizedSnapshotText(snapshot?.text);
    let acquisitionStatus: ResearchSourceAcquisitionV1["status"] = "complete_body";
    if (typeof snapshot?.rawText !== "string") return resolutionFailed();
    if (text === null) {
      if (title === null && boundedMetadataHint(snapshot.metaDescription, 1_000) === null) return resolutionFailed();
      title ??= urlTopicHint(canonicalUrl);
      text = incompletePageFallbackText({
        canonicalUrl,
        title,
        metaDescription: snapshot.metaDescription,
      });
      acquisitionStatus = "metadata_only";
    } else if (
      !isLikelyContentPage(canonicalUrl, snapshot.rawText, { text }) ||
      hasAmbiguousArticleOnlyBody(snapshot.rawText, text)
    ) {
      title ??= urlTopicHint(canonicalUrl);
      text = incompletePageFallbackText({
        canonicalUrl,
        title,
        metaDescription: snapshot.metaDescription,
      });
      acquisitionStatus = "partial_body";
    }
    const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
    const capturedAt = deps.now().toISOString();
    return {
      kind: "topic_url",
      requestedUrl,
      canonicalUrl,
      title,
      text,
      contentHash,
      capturedAt,
      researchSourceAcquisition: acquisition({
        status: acquisitionStatus,
        requestedUrl,
        canonicalUrl,
        contentHash,
        capturedAt,
      }),
    };
  } catch {
    return resolutionFailed();
  }
}
