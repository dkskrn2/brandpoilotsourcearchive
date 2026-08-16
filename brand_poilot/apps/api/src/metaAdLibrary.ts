import { getMetaGraphJson, MetaGraphRequestError } from "./metaGraph.js";

const AD_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_captions",
  "ad_creative_link_descriptions",
  "ad_snapshot_url",
  "publisher_platforms",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
].join(",");
const PAGE_LIMIT = 50;
const COLLECTION_LIMIT = 100;
const PAGE_ID = /^\d+$/;

type RecordValue = Record<string, unknown>;

export type MetaAdSearchInput =
  | { mode: "keyword"; query: string; country?: string }
  | { mode: "page"; pageIds: string[]; country?: string };

export type NormalizedMetaAdSearchInput =
  | { mode: "keyword"; query: string; country: string }
  | { mode: "page"; pageIds: string[]; country: string };

export interface NormalizedMetaAd {
  providerAdId: string;
  sourcePlatform: "meta_ad_library";
  pageId: string | null;
  pageName: string | null;
  creativeBody: string | null;
  creativeTitle: string | null;
  creativeCaption: string | null;
  creativeDescription: string | null;
  snapshotUrl: string | null;
  publisherPlatforms: Array<"facebook" | "instagram" | "audience_network" | "messenger">;
  deliveryStartedAt: string | null;
  deliveryStoppedAt: string | null;
  activeStatus: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  reachedCountries: string[];
}

export interface FetchMetaAdLibraryResult {
  ads: NormalizedMetaAd[];
  nextCursor: string | null;
}

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const candidate = text(item);
    if (candidate) return candidate;
  }
  return null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function snapshotUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "facebook.com" && !url.hostname.endsWith(".facebook.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function afterCursor(payload: unknown): string | null {
  return text(record(record(record(payload)?.paging)?.cursors)?.after);
}

function ad(value: unknown, country: string): NormalizedMetaAd | null {
  const row = record(value);
  const providerAdId = text(row?.id);
  if (!providerAdId) return null;
  const allowedPlatforms = new Set(["facebook", "instagram", "audience_network", "messenger"] as const);
  const publisherPlatforms = (Array.isArray(row?.publisher_platforms) ? row.publisher_platforms : [])
    .map((platform) => text(platform)?.toLowerCase() ?? "")
    .filter((platform): platform is NormalizedMetaAd["publisherPlatforms"][number] =>
      allowedPlatforms.has(platform as NormalizedMetaAd["publisherPlatforms"][number]));
  return {
    providerAdId,
    sourcePlatform: "meta_ad_library",
    pageId: text(row?.page_id),
    pageName: text(row?.page_name),
    creativeBody: firstText(row?.ad_creative_bodies),
    creativeTitle: firstText(row?.ad_creative_link_titles),
    creativeCaption: firstText(row?.ad_creative_link_captions),
    creativeDescription: firstText(row?.ad_creative_link_descriptions),
    snapshotUrl: snapshotUrl(row?.ad_snapshot_url),
    publisherPlatforms,
    deliveryStartedAt: iso(row?.ad_delivery_start_time),
    deliveryStoppedAt: iso(row?.ad_delivery_stop_time),
    activeStatus: "ACTIVE",
    reachedCountries: [country],
  };
}

export function normalizeMetaAdSearchInput(input: MetaAdSearchInput): NormalizedMetaAdSearchInput {
  const country = text(input.country)?.toUpperCase() ?? "KR";
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("meta_ad_library_search_invalid");
  if (input.mode === "keyword") {
    const query = input.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (query.length < 2 || query.length > 100) throw new Error("meta_ad_library_search_invalid");
    return { mode: "keyword", query, country };
  }
  if (input.mode !== "page" || !Array.isArray(input.pageIds)) {
    throw new Error("meta_ad_library_search_invalid");
  }
  const pageIds = [...new Set(input.pageIds.map((value) => value.trim()))];
  if (pageIds.length < 1 || pageIds.length > 10 || pageIds.some((value) => !PAGE_ID.test(value))) {
    throw new Error("meta_ad_library_search_invalid");
  }
  return { mode: "page", pageIds, country };
}

function stableError(error: unknown): Error {
  if (error instanceof MetaGraphRequestError) {
    if (error.status === 429 || [4, 17, 32, 613].includes(error.code ?? -1)) {
      return new Error("meta_ad_library_rate_limited");
    }
    if (error.status === 401 || [102, 190].includes(error.code ?? -1)) {
      return new Error("meta_ad_library_reconnect_required");
    }
    if (error.status === 403 || [10, 200].includes(error.code ?? -1)) {
      return new Error("meta_ad_library_permission_required");
    }
  }
  return new Error("meta_ad_library_fetch_failed");
}

export async function fetchMetaAdLibrary(input: MetaAdSearchInput & {
  accessToken: string;
  fetcher?: typeof fetch;
  graphVersion?: string;
  timeoutMs?: number;
}): Promise<FetchMetaAdLibraryResult> {
  const normalized = normalizeMetaAdSearchInput(input);
  const fetcher = input.fetcher ?? fetch;
  const graphVersion = input.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v26.0";
  const timeoutMs = Math.max(1, Math.min(input.timeoutMs ?? 25_000, 25_000));
  const signal = AbortSignal.timeout(timeoutMs);
  const collected: NormalizedMetaAd[] = [];
  const visited = new Set<string>();
  let after: string | null = null;
  let nextCursor: string | null = null;

  while (collected.length < COLLECTION_LIMIT) {
    const params: Record<string, string> = {
      access_token: input.accessToken,
      ad_type: "ALL",
      ad_active_status: "ACTIVE",
      ad_reached_countries: JSON.stringify([normalized.country]),
      fields: AD_FIELDS,
      limit: String(PAGE_LIMIT),
    };
    if (normalized.mode === "keyword") params.search_terms = normalized.query;
    else params.search_page_ids = JSON.stringify(normalized.pageIds);
    if (after) params.after = after;

    let payload: unknown;
    try {
      payload = await getMetaGraphJson({
        path: "/ads_archive", params, fetchImpl: fetcher, graphVersion, signal,
      });
    } catch (error) {
      throw stableError(error);
    }
    const rows = Array.isArray(record(payload)?.data) ? record(payload)!.data as unknown[] : [];
    collected.push(...rows
      .map((row) => ad(row, normalized.country))
      .filter((item): item is NormalizedMetaAd => item !== null)
      .slice(0, COLLECTION_LIMIT - collected.length));
    nextCursor = afterCursor(payload);
    if (!nextCursor || rows.length === 0 || collected.length >= COLLECTION_LIMIT || visited.has(nextCursor)) break;
    visited.add(nextCursor);
    after = nextCursor;
  }

  return { ads: collected, nextCursor };
}
