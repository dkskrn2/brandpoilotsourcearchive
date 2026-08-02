import { describe, expect, it, vi } from "vitest";
import type { ChannelCapability } from "../../types";
import {
  channelCapabilityOptionsForFormat,
  createChannelCapabilityGateway,
  supportedChannelsForFormat,
} from "./channelCapabilityGateway";

function capability(
  channel: ChannelCapability["channel"],
  generationFormats: ChannelCapability["generationFormats"],
  overrides: Partial<ChannelCapability> = {},
): ChannelCapability {
  return {
    channel,
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats,
    exportModes: ["image"],
    publishModes: [],
    readiness: "ready",
    reasonCode: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("supportedChannelsForFormat", () => {
  it("returns only channels that support the selected content format", () => {
    const instagram = capability("instagram", ["card_news", "single_image"]);
    const threads = capability("threads", ["channel_text"]);
    const linkedin = capability("linkedin", ["blog", "channel_text"]);

    expect(supportedChannelsForFormat(
      [instagram, threads, linkedin],
      "card_news",
    )).toEqual([instagram]);
  });

  it("does not treat a listed format as supported when generation is disabled", () => {
    const unavailableInstagram = capability(
      "instagram",
      ["card_news"],
      { canGenerate: false },
    );

    expect(supportedChannelsForFormat(
      [unavailableInstagram],
      "card_news",
    )).toEqual([]);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["planned", { catalogStatus: "planned" as const }],
    ["not connected", { connectionStatus: "not_connected" as const }],
    ["not ready", { readiness: "needs_connection" as const }],
  ])("does not expose a remote channel when it is %s", (_case, overrides) => {
    const item = capability("instagram", ["reel"], overrides);

    expect(supportedChannelsForFormat([item], "reel")).toEqual([]);
  });

  it("supports the V2 reel and marketing content formats", () => {
    const instagram = capability("instagram", ["reel", "marketing_content"]);

    expect(supportedChannelsForFormat([instagram], "reel")).toEqual([instagram]);
    expect(supportedChannelsForFormat([instagram], "marketing_content")).toEqual([instagram]);
  });
});

describe("channelCapabilityOptionsForFormat", () => {
  it("provides disabled guidance and a channel-settings link for unsupported channels", () => {
    const instagram = capability("instagram", ["card_news"]);
    const threads = capability("threads", ["channel_text"]);

    expect(channelCapabilityOptionsForFormat(
      [instagram, threads],
      "card_news",
    )).toEqual([
      {
        capability: instagram,
        supported: true,
        disabledReason: null,
        resolutionLink: null,
      },
      {
        capability: threads,
        supported: false,
        disabledReason: "선택한 콘텐츠 형식은 이 채널에서 지원되지 않습니다.",
        resolutionLink: {
          href: "/channels",
          label: "채널 설정에서 지원 범위 확인",
        },
      },
    ]);
  });

  it("distinguishes unavailable generation from an unsupported format", () => {
    const plannedLinkedIn = capability(
      "linkedin",
      ["blog"],
      {
        catalogStatus: "planned",
        canGenerate: false,
        readiness: "not_supported",
        reasonCode: "provider_not_implemented",
      },
    );

    expect(channelCapabilityOptionsForFormat(
      [plannedLinkedIn],
      "blog",
    )[0]).toMatchObject({
      supported: false,
      disabledReason: "이 채널의 콘텐츠 생성 기능은 아직 준비 중입니다.",
      resolutionLink: {
        href: "/channels",
        label: "채널 설정에서 지원 범위 확인",
      },
    });
  });
});

describe("createChannelCapabilityGateway", () => {
  it("starts idle with generation blocked before any capability request", () => {
    const gateway = createChannelCapabilityGateway(async () => []);

    expect(gateway.getState()).toEqual({
      status: "idle",
      capabilities: [],
      policy: {
        retryAllowed: false,
        existingDraftMayBeSaved: true,
        generationStartAllowed: false,
      },
    });
  });

  it("passes an AbortSignal and exposes a blocked loading state while the request is pending", () => {
    const pending = deferred<ChannelCapability[]>();
    const request = vi.fn((_brandId: string, _signal: AbortSignal) => pending.promise);
    const gateway = createChannelCapabilityGateway(request);

    void gateway.load("brand-1");

    expect(request).toHaveBeenCalledWith("brand-1", expect.any(AbortSignal));
    expect(gateway.getState()).toEqual({
      status: "loading",
      capabilities: [],
      policy: {
        retryAllowed: false,
        existingDraftMayBeSaved: true,
        generationStartAllowed: false,
      },
    });
  });

  it("exposes capabilities as ready only after a successful response", async () => {
    const instagram = capability("instagram", ["card_news"]);
    const request = vi.fn(async () => [instagram]);
    const gateway = createChannelCapabilityGateway(request);

    const loadResult = await gateway.load("brand-1");
    const state = gateway.getState();

    expect(loadResult).toBeUndefined();
    expect(state).toEqual({
      status: "ready",
      capabilities: [instagram],
      policy: {
        retryAllowed: false,
        existingDraftMayBeSaved: true,
        generationStartAllowed: true,
      },
    });
  });

  it("returns a retryable failure policy that permits draft saves but forbids generation", async () => {
    const error = new Error("capability API unavailable");
    const gateway = createChannelCapabilityGateway(async () => {
      throw error;
    });

    await gateway.load("brand-1");
    const state = gateway.getState();

    expect(state).toEqual({
      status: "failure",
      capabilities: [],
      error,
      policy: {
        retryAllowed: true,
        existingDraftMayBeSaved: true,
        generationStartAllowed: false,
      },
    });
  });

  it("aborts the previous request when a newer load starts", async () => {
    const requests: Array<{
      pending: ReturnType<typeof deferred<ChannelCapability[]>>;
      signal: AbortSignal;
    }> = [];
    const gateway = createChannelCapabilityGateway((_brandId, signal) => {
      const pending = deferred<ChannelCapability[]>();
      requests.push({ pending, signal });
      return pending.promise;
    });

    const firstLoad = gateway.load("brand-1");
    const secondLoad = gateway.load("brand-2");

    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);

    requests[1].pending.resolve([]);
    requests[0].pending.resolve([]);
    await Promise.all([firstLoad, secondLoad]);
  });

  it("never lets an older response replace or reappear after a newer request starts", async () => {
    const first = deferred<ChannelCapability[]>();
    const second = deferred<ChannelCapability[]>();
    const request = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const gateway = createChannelCapabilityGateway(request);
    const oldInstagram = capability("instagram", ["card_news"]);
    const currentThreads = capability("threads", ["channel_text"]);

    const firstLoad = gateway.load("brand-1");
    const secondLoad = gateway.load("brand-2");
    second.resolve([currentThreads]);
    await secondLoad;
    const currentState = gateway.getState();
    first.resolve([oldInstagram]);
    const staleResult = await firstLoad;

    expect(currentState).toMatchObject({
      status: "ready",
      capabilities: [currentThreads],
    });
    expect(staleResult).toBeUndefined();
    expect(gateway.getState()).toBe(currentState);
  });

  it("ignores a stale late rejection even when the requester ignores AbortSignal", async () => {
    const first = deferred<ChannelCapability[]>();
    const second = deferred<ChannelCapability[]>();
    const request = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const gateway = createChannelCapabilityGateway(request);
    const currentThreads = capability("threads", ["channel_text"]);

    const staleLoad = gateway.load("brand-A");
    const currentLoad = gateway.load("brand-B");
    second.resolve([currentThreads]);
    await currentLoad;
    const currentState = gateway.getState();
    first.reject(new Error("late brand-A failure"));

    await expect(staleLoad).resolves.toBeUndefined();
    expect(gateway.getState()).toBe(currentState);
    expect(currentState).toMatchObject({
      status: "ready",
      capabilities: [currentThreads],
    });
  });

  it("cancels the active request without converting AbortError into API failure", async () => {
    let requestSignal!: AbortSignal;
    const gateway = createChannelCapabilityGateway((_brandId, signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("Request aborted", "AbortError"));
        });
      });
    });
    const load = gateway.load("brand-1");

    const cancelledState = gateway.cancel();
    const loadResult = await load;

    expect(requestSignal.aborted).toBe(true);
    expect(cancelledState).toEqual({
      status: "idle",
      capabilities: [],
      policy: {
        retryAllowed: false,
        existingDraftMayBeSaved: true,
        generationStartAllowed: false,
      },
    });
    expect(loadResult).toBeUndefined();
    expect(gateway.getState()).toBe(cancelledState);
  });

  it("keeps cancellation authoritative when the requester ignores AbortSignal", async () => {
    const pending = deferred<ChannelCapability[]>();
    const gateway = createChannelCapabilityGateway(() => pending.promise);
    const load = gateway.load("brand-1");

    const cancelledState = gateway.cancel();
    pending.resolve([capability("instagram", ["card_news"])]);

    await expect(load).resolves.toBeUndefined();
    expect(gateway.getState()).toBe(cancelledState);
    expect(cancelledState.status).toBe("idle");
  });

  it("requests the brand capability endpoint with the request signal by default", async () => {
    const instagram = capability("instagram", ["card_news"]);
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify([instagram]),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ));
    vi.stubGlobal("fetch", fetcher);

    try {
      const gateway = createChannelCapabilityGateway();
      await expect(gateway.load("brand 1")).resolves.toBeUndefined();
      expect(gateway.getState()).toMatchObject({
        status: "ready",
        capabilities: [instagram],
      });
      expect(fetcher).toHaveBeenCalledWith(
        "http://localhost:4000/brands/brand%201/channels/capabilities",
        {
          method: "GET",
          credentials: "include",
          signal: expect.any(AbortSignal),
        },
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [
      "a non-2xx response",
      () => new Response("service unavailable", { status: 503 }),
    ],
    [
      "invalid JSON",
      () => new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
    [
      "a non-array payload",
      () => new Response(JSON.stringify({ capabilities: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
    [
      "an array containing an invalid capability",
      () => new Response(JSON.stringify([{ channel: "instagram" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ],
  ])("keeps generation blocked when the default request receives %s", async (
    _case,
    response,
  ) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));

    try {
      const gateway = createChannelCapabilityGateway();
      await gateway.load("brand-1");

      expect(gateway.getState()).toMatchObject({
        status: "failure",
        capabilities: [],
        policy: {
          retryAllowed: true,
          existingDraftMayBeSaved: true,
          generationStartAllowed: false,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not abort a request controller after that request has settled", async () => {
    let requestSignal!: AbortSignal;
    const gateway = createChannelCapabilityGateway(async (_brandId, signal) => {
      requestSignal = signal;
      return [];
    });

    await gateway.load("brand-1");
    gateway.cancel();

    expect(requestSignal.aborted).toBe(false);
  });
});
