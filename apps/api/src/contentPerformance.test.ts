import { describe, expect, it, vi } from "vitest";
import {
  createPerformanceAdapterRegistry,
  exposureDelta,
  isPerformanceSyncDue,
  performanceRunDate,
} from "./contentPerformance.js";

describe("content performance scheduling", () => {
  it("uses the KST calendar date across its UTC date rollover", () => {
    expect(performanceRunDate(new Date("2026-07-15T14:59:59.999Z"))).toBe("2026-07-15");
    expect(performanceRunDate(new Date("2026-07-15T15:00:00.000Z"))).toBe("2026-07-16");
  });

  it("becomes due at 03:00 KST", () => {
    expect(isPerformanceSyncDue(new Date("2026-07-15T17:59:59.999Z"))).toBe(false);
    expect(isPerformanceSyncDue(new Date("2026-07-15T18:00:00.000Z"))).toBe(true);
    expect(isPerformanceSyncDue(new Date("2026-07-15T18:00:00.001Z"))).toBe(true);
  });
});

describe("exposureDelta", () => {
  it.each([
    [120, 100, 20],
    [100, 100, 0],
    [90, 100, 0],
    [0, 0, 0],
  ] as const)("calculates %s minus %s as %s without going negative", (current, previous, expected) => {
    expect(exposureDelta(current, previous)).toBe(expected);
  });

  it.each([
    [null, 100],
    [120, null],
    [null, null],
  ] as const)("returns null when either snapshot is unavailable", (current, previous) => {
    expect(exposureDelta(current, previous)).toBeNull();
  });
});

describe("performance adapter registry", () => {
  it("contains exactly the runtime-supported channels", () => {
    const registry = createPerformanceAdapterRegistry();

    expect(Object.keys(registry)).toEqual(["instagram", "threads", "x", "linkedin", "youtube", "tiktok"]);
  });

  it.each([
    [{ data: [{ name: "views", values: [{ value: 321 }] }] }, 321],
    [{ data: [{ name: "views", total_value: { value: 654 } }] }, 654],
    [{ data: [{ name: "views", values: [{ value: 100 }, { value: 200 }] }] }, 200],
    [{ data: [{ name: "views", values: [{ value: 100 }, { value: 200 }], total_value: { value: 654 } }] }, 654],
  ] as const)("collects Instagram views from supported Meta payloads", async (payload, expected) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const registry = createPerformanceAdapterRegistry({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      apiVersion: "v23.0",
    });

    const result = await registry.instagram.collect({
      channel: "instagram",
      accessToken: "SECRET_TOKEN",
      graphHost: "graph.instagram.com",
      externalPostId: "media-1",
    });

    expect(result).toEqual({
      status: "collected",
      exposureCount: expected,
      rawMetrics: payload,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://graph.instagram.com/v23.0/media-1/insights?metric=views",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer SECRET_TOKEN" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each(["23.0", "v23", "v23.0/other", "v23.0?debug=true"])(
    "rejects malformed Meta API version %s",
    (apiVersion) => {
      expect(() => createPerformanceAdapterRegistry({ apiVersion })).toThrow("invalid Meta API version");
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", null])(
    "rejects an invalid views metric without exposing response data: %s",
    async (value) => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        data: [{ name: "views", values: [{ value }] }],
      }), { status: 200 }));
      const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

      await expect(registry.instagram.collect({
        channel: "instagram",
        accessToken: "SECRET_TOKEN",
        externalPostId: "media-1",
      })).resolves.toEqual({
        status: "failed",
        exposureCount: null,
        rawMetrics: {},
        error: "instagram_insights_invalid_views",
      });
    },
  );

  it("sanitizes Meta API errors and never returns the access token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "Token SECRET_TOKEN expired", code: 190 },
    }), { status: 400 }));
    const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await registry.instagram.collect({
      channel: "instagram",
      accessToken: "SECRET_TOKEN",
      externalPostId: "media-1",
    });

    expect(result).toEqual({
      status: "failed",
      exposureCount: null,
      rawMetrics: {},
      error: "instagram_insights_request_failed:400",
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_TOKEN");
  });

  it("sanitizes tokens echoed in successful raw metrics", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ name: "views", total_value: { value: 10 } }],
      diagnostic: "received SECRET_TOKEN from caller",
    }), { status: 200 }));
    const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await registry.instagram.collect({
      channel: "instagram",
      accessToken: "SECRET_TOKEN",
      externalPostId: "media-1",
    });

    expect(result.status).toBe("collected");
    expect(JSON.stringify(result.rawMetrics)).not.toContain("SECRET_TOKEN");
  });

  it("does not call Instagram Insights without an access token", async () => {
    const fetchImpl = vi.fn();
    const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(registry.instagram.collect({
      channel: "instagram",
      accessToken: null,
      externalPostId: "media-1",
    })).resolves.toEqual({
      status: "not_configured",
      exposureCount: null,
      rawMetrics: {},
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsupported Graph hosts without making a request", async () => {
    const fetchImpl = vi.fn();
    const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await registry.instagram.collect({
      channel: "instagram",
      accessToken: "SECRET_TOKEN",
      graphHost: "evil.example.com" as "graph.facebook.com",
      externalPostId: "media-1",
    });

    expect(result).toEqual({
      status: "failed",
      exposureCount: null,
      rawMetrics: {},
      error: "instagram_insights_invalid_graph_host",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["threads", "x", "linkedin", "youtube", "tiktok"] as const)(
    "keeps %s deferred without making an HTTP request",
    async (channel) => {
      const fetchImpl = vi.fn();
      const registry = createPerformanceAdapterRegistry({ fetchImpl: fetchImpl as unknown as typeof fetch });

      await expect(registry[channel].collect({
        channel,
        accessToken: "SECRET_TOKEN",
        externalPostId: "post-1",
      })).resolves.toEqual({
        status: "not_configured",
        exposureCount: null,
        rawMetrics: {},
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
