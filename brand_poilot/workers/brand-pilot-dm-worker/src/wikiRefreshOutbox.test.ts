import { describe, expect, it, vi } from "vitest";
import { runWikiRefreshOutboxOnce } from "./wikiRefreshOutbox.js";

describe("runWikiRefreshOutboxOnce", () => {
  it("sweeps one durable product refresh event before Wiki build work", async () => {
    const dispatchWikiRefreshOutboxOnce = vi.fn(async () => ({
      status: "completed" as const,
      eventId: "event-1",
    }));

    await expect(runWikiRefreshOutboxOnce({
      workerId: "wiki-worker-1",
      db: { dispatchWikiRefreshOutboxOnce },
    })).resolves.toEqual({ status: "completed", eventId: "event-1" });
    expect(dispatchWikiRefreshOutboxOnce).toHaveBeenCalledWith("wiki-worker-1");
  });
});
