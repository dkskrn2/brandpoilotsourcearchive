import type { Channel } from "./types.js";

export type PerformanceChannel = Channel;

export interface PerformanceCollectRequest {
  channel: PerformanceChannel;
  accessToken: string | null;
  deliveryFormat?: string | null;
  graphHost?: "graph.facebook.com" | "graph.instagram.com";
  externalPostId: string;
}

export interface PerformanceCollectResult {
  status: "collected" | "not_configured" | "failed";
  exposureCount: number | null;
  rawMetrics: Record<string, unknown>;
  error?: string;
}

export interface PerformanceAdapter {
  collect(request: PerformanceCollectRequest): Promise<PerformanceCollectResult>;
}

interface PerformanceAdapterRegistryOptions {
  fetchImpl?: typeof fetch;
  apiVersion?: string;
  requestTimeoutMs?: number;
}

const kstDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function kstParts(now: Date) {
  const parts = Object.fromEntries(
    kstDateTime.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour),
  };
}

export function performanceRunDate(now: Date): string {
  const { year, month, day } = kstParts(now);
  return `${year}-${month}-${day}`;
}

export function isPerformanceSyncDue(now: Date): boolean {
  return kstParts(now).hour >= 3;
}

export function exposureDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.max(0, current - previous);
}

export type PerformanceMilestone = "24h" | "72h" | "7d";

export function performanceMilestone(publishedAt: Date, collectedAt: Date): PerformanceMilestone | null {
  const ageHours = (collectedAt.getTime() - publishedAt.getTime()) / (60 * 60 * 1000);
  if (ageHours >= 24 && ageHours < 48) return "24h";
  if (ageHours >= 72 && ageHours < 120) return "72h";
  if (ageHours >= 168 && ageHours < 216) return "7d";
  return null;
}

export function contentPerformanceFeatures(output: unknown, deliveryFormat: string | null | undefined) {
  const record = asRecord(output) ?? {};
  const topic = asRecord(record.topic) ?? {};
  const brief = asRecord(record.qualityBrief) ?? {};
  const evidence = Array.isArray(brief.evidence) ? brief.evidence : [];
  const claims = Array.isArray(brief.specificClaims) ? brief.specificClaims : [];
  return {
    deliveryFormat: typeof record.deliveryFormat === "string" ? record.deliveryFormat : deliveryFormat ?? null,
    topicTitle: typeof topic.title === "string" ? topic.title : null,
    topicAngle: typeof topic.angle === "string" ? topic.angle : null,
    hook: typeof brief.hook === "string" ? brief.hook : null,
    evidenceCount: evidence.length,
    claimCount: claims.length,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseViews(payload: unknown): number | null {
  const data = asRecord(payload)?.data;
  if (!Array.isArray(data)) return null;

  const views = data
    .map(asRecord)
    .find((entry) => entry?.name === "views");
  if (!views) return null;

  const values = views.values;
  const latestValue = Array.isArray(values) && values.length > 0
    ? asRecord(values[values.length - 1])?.value
    : undefined;
  const totalValue = asRecord(views.total_value)?.value;
  const value = totalValue ?? latestValue;
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function sanitizeRawValue(value: unknown, accessToken: string): unknown {
  if (typeof value === "string") {
    return value.split(accessToken).join("[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRawValue(item, accessToken));
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, sanitizeRawValue(item, accessToken)]),
  );
}

function failed(error: string): PerformanceCollectResult {
  return { status: "failed", exposureCount: null, rawMetrics: {}, error };
}

function notConfigured(): PerformanceCollectResult {
  return { status: "not_configured", exposureCount: null, rawMetrics: {} };
}

function unavailable(): PerformanceCollectResult {
  return { status: "collected", exposureCount: null, rawMetrics: { availability: "unavailable" } };
}

function isUnavailableMetaObject(payload: unknown) {
  const error = asRecord(asRecord(payload)?.error);
  return error?.code === 100 && error.error_subcode === 33;
}

function createInstagramAdapter({
  fetchImpl,
  apiVersion,
  requestTimeoutMs,
}: Required<PerformanceAdapterRegistryOptions>): PerformanceAdapter {
  return {
    async collect(request) {
      if (!request.accessToken) return notConfigured();

      const graphHost = request.graphHost ?? "graph.facebook.com";
      if (graphHost !== "graph.facebook.com" && graphHost !== "graph.instagram.com") {
        return failed("instagram_insights_invalid_graph_host");
      }

      const url = new URL(
        `https://${graphHost}/${apiVersion}/${encodeURIComponent(request.externalPostId)}/insights`,
      );
      url.searchParams.set("metric", "views");

      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${request.accessToken}` },
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const payload: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (isUnavailableMetaObject(payload)) return unavailable();
          return failed(`instagram_insights_request_failed:${response.status}`);
        }

        const exposureCount = parseViews(payload);
        if (exposureCount === null && request.deliveryFormat === "instagram_story") return unavailable();
        if (exposureCount === null) return failed("instagram_insights_invalid_views");

        const rawMetrics = sanitizeRawValue(payload, request.accessToken);
        return {
          status: "collected",
          exposureCount,
          rawMetrics: asRecord(rawMetrics) ?? {},
        };
      } catch {
        return failed("instagram_insights_request_failed:network");
      }
    },
  };
}

function createDeferredAdapter(): PerformanceAdapter {
  return { async collect() { return notConfigured(); } };
}

export function createPerformanceAdapterRegistry({
  fetchImpl = fetch,
  apiVersion = process.env.META_GRAPH_VERSION || "v20.0",
  requestTimeoutMs = 10_000,
}: PerformanceAdapterRegistryOptions = {}): Record<PerformanceChannel, PerformanceAdapter> {
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    throw new TypeError("invalid Meta API version");
  }

  return {
    instagram: createInstagramAdapter({ fetchImpl, apiVersion, requestTimeoutMs }),
    threads: createDeferredAdapter(),
    x: createDeferredAdapter(),
    linkedin: createDeferredAdapter(),
    youtube: createDeferredAdapter(),
    tiktok: createDeferredAdapter(),
  };
}
