import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiContentUsageProvider, useAiContentUsage } from "./AiContentUsageContext";
import { mockAiContentGateway } from "./mockAiContentGateway";

function Probe() {
  const { usage, loading, refresh } = useAiContentUsage();
  return <div><span>{usage ? `${usage.generationLimit - usage.generationUsed}` : "none"}</span><span>{loading ? "loading" : "idle"}</span><button onClick={() => void refresh()}>refresh</button></div>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("AiContentUsageProvider", () => {
  it("loads usage once and exposes a refresh function", async () => {
    const getUsage = vi.fn(mockAiContentGateway.getUsage);
    render(<AiContentUsageProvider gateway={{ ...mockAiContentGateway, getUsage }} brandId="brand-1"><Probe /></AiContentUsageProvider>);
    expect(await screen.findByText("3")).toBeVisible();
    expect(getUsage).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: "refresh" }).click();
    await waitFor(() => expect(getUsage).toHaveBeenCalledTimes(2));
  });

  it("keeps descendants usable when usage loading fails", async () => {
    const gateway = { ...mockAiContentGateway, getUsage: vi.fn(async () => { throw new Error("offline"); }) };
    render(<AiContentUsageProvider gateway={gateway} brandId="brand-1"><Probe /></AiContentUsageProvider>);
    expect(await screen.findByText("none")).toBeVisible();
  });

  it("keeps the latest usage when overlapping requests finish in reverse order", async () => {
    const first = deferred<Awaited<ReturnType<typeof mockAiContentGateway.getUsage>>>();
    const second = deferred<Awaited<ReturnType<typeof mockAiContentGateway.getUsage>>>();
    const getUsage = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    render(<AiContentUsageProvider gateway={{ ...mockAiContentGateway, getUsage }} brandId="brand-1"><Probe /></AiContentUsageProvider>);
    await waitFor(() => expect(getUsage).toHaveBeenCalledTimes(1));
    screen.getByRole("button", { name: "refresh" }).click();
    await waitFor(() => expect(getUsage).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({ generationUsed: 4, generationLimit: 5, newDownloadUsed: 2, newDownloadLimit: 10, resetsAt: "2026-07-20T00:00:00+09:00" });
      await second.promise;
    });
    expect(await screen.findByText("1")).toBeVisible();
    expect(screen.getByText("idle")).toBeVisible();

    await act(async () => {
      first.resolve({ generationUsed: 1, generationLimit: 5, newDownloadUsed: 1, newDownloadLimit: 10, resetsAt: "2026-07-19T00:00:00+09:00" });
      await first.promise;
    });
    expect(screen.getByText("1")).toBeVisible();
    expect(screen.queryByText("4")).not.toBeInTheDocument();
  });
});
