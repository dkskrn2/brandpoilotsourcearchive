import { createHash } from "node:crypto";
import type { ContentReferenceRoleV2, ContentSeedV2 } from "./aiContentContracts.js";
import { crawlSourceUrl } from "./sourceCrawler.js";

export type ResolvedAiContentSubjectV2 =
  | { kind: "topic_text"; title: string }
  | {
    kind: "topic_url";
    requestedUrl: string;
    canonicalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    capturedAt: string;
  }
  | { kind: "reference"; referenceIds: string[] };

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

function normalizedSnapshotText(value: unknown): string {
  if (typeof value !== "string") return resolutionFailed();
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 50_000) return resolutionFailed();
  return normalized;
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
    return { kind: "topic_text", title };
  }

  if (seed.kind === "reference") {
    return { kind: "reference", referenceIds: canonicalReferenceIds(seed) };
  }

  if (seed.kind !== "topic_url") return invalidSeed();
  exactKeys(seed, ["kind", "url"]);
  const requestedUrl = normalizedHttpUrl(seed.url, invalidSeed);

  let snapshot: Awaited<ReturnType<typeof crawlSourceUrl>>;
  try {
    snapshot = await deps.crawlUrl(requestedUrl);
  } catch (error) {
    if (!publisherBlocked(error)) return resolutionFailed();
    const title = urlTopicHint(requestedUrl);
    const text = `원문 URL을 수집하지 못했습니다. 온라인 검색으로 확인할 주제: ${title}`;
    return {
      kind: "topic_url",
      requestedUrl,
      canonicalUrl: requestedUrl,
      title,
      text,
      contentHash: createHash("sha256").update(text, "utf8").digest("hex"),
      capturedAt: deps.now().toISOString(),
    };
  }

  try {
    const canonicalUrl = normalizedHttpUrl(snapshot?.finalUrl, resolutionFailed);
    const title = normalizedSnapshotTitle(snapshot?.title);
    const text = normalizedSnapshotText(snapshot?.text);
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
    };
  } catch {
    return resolutionFailed();
  }
}
