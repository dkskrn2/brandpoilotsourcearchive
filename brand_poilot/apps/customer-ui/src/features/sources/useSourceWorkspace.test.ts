import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSourceWorkspace } from "./useSourceWorkspace";

const source = {
  id: "source-1",
  brandId: "brand-1",
  sourceType: "owned" as const,
  url: "https://brand.example",
  title: null,
  status: "ready",
  enabled: true,
  lastCrawledAt: null,
  lastError: null,
};

function client() {
  return {
    listSources: vi.fn(async () => [source]),
    listSourceSnapshots: vi.fn(async () => []),
    listSourceCrawlRuns: vi.fn(async () => []),
    createSource: vi.fn(async () => ({
      source: { ...source, id: "source-2", url: "https://new.example" },
      initialCrawl: { id: "run-1", brandId: "brand-1", sourceUrlId: "source-2", trigger: "new_source" as const, status: "succeeded" as const, attempt: 1, startedAt: null, finishedAt: null, nextRetryAt: null, lastError: null, processed: 1, created: 1, updated: 0, failed: 0 },
    })),
    updateSource: vi.fn(async (_id: string, payload: { enabled?: boolean }) => ({ ...source, enabled: payload.enabled ?? true })),
    retrySource: vi.fn(),
    deleteSource: vi.fn(async () => ({ id: source.id })),
    crawlSources: vi.fn(),
  };
}

describe("useSourceWorkspace", () => {
  it("loads and mutates the shared owned-source collection", async () => {
    const api = client();
    const { result } = renderHook(() => useSourceWorkspace(api, "brand-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([source]);

    await act(() => result.current.add("owned", "https://new.example"));
    expect(api.createSource).toHaveBeenCalledWith("brand-1", { sourceType: "owned", url: "https://new.example" });
    expect(result.current.sources[0].id).toBe("source-2");

    await act(() => result.current.update(source.id, { enabled: false }));
    expect(result.current.sources.find((item) => item.id === source.id)?.enabled).toBe(false);
  });

  it("keeps loaded data while exposing an actionable mutation error", async () => {
    const api = client();
    api.createSource.mockRejectedValueOnce(new Error("source_url_duplicate"));
    const { result } = renderHook(() => useSourceWorkspace(api, "brand-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.add("owned", source.url));
    expect(result.current.sources).toEqual([source]);
    expect(result.current.notice).toContain("이미 등록");
  });
});
