import { describe, expect, it, vi } from "vitest";
import { apiClient, BRAND_STATUS_CHANGED_EVENT } from "./apiClient";

describe("apiClient regression", () => {
  it("notifies the shell after a successful state-changing API request", async () => {
    const listener = vi.fn();
    window.addEventListener(BRAND_STATUS_CHANGED_EVENT, listener);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "source-1" }), { status: 201 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    await client.createSource("brand-1", { sourceType: "owned", url: "https://example.com" });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(BRAND_STATUS_CHANGED_EVENT, listener);
  });

  it("does not notify the shell after a read-only API request", async () => {
    const listener = vi.fn();
    window.addEventListener(BRAND_STATUS_CHANGED_EVENT, listener);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    await client.listSources("brand-1");

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(BRAND_STATUS_CHANGED_EVENT, listener);
  });
});
