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

    const state = await gateway.load("brand-1");

    expect(state).toEqual({
      status: "ready",
      capabilities: [instagram],
      policy: {
        retryAllowed: false,
        existingDraftMayBeSaved: true,
        generationStartAllowed: true,
      },
    });
    expect(gateway.getState()).toBe(state);
  });

  it("returns a retryable failure policy that permits draft saves but forbids generation", async () => {
    const error = new Error("capability API unavailable");
    const gateway = createChannelCapabilityGateway(async () => {
      throw error;
    });

    const state = await gateway.load("brand-1");

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
    expect(gateway.getState()).toBe(state);
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
    const currentState = await secondLoad;
    first.resolve([oldInstagram]);
    const staleResult = await firstLoad;

    expect(currentState).toMatchObject({
      status: "ready",
      capabilities: [currentThreads],
    });
    expect(staleResult).toBe(currentState);
    expect(gateway.getState()).toBe(currentState);
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
    expect(loadResult).toBe(cancelledState);
    expect(gateway.getState()).toBe(cancelledState);
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
      await expect(gateway.load("brand 1")).resolves.toMatchObject({
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
});
