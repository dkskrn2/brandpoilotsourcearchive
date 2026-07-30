import { describe, expect, it, vi } from "vitest";
import type { SourceReadResult } from "./sourceReader.js";
import { runTextOnce, type ClaimedTextJob } from "./textWorker.js";

function claimedTextJob(): ClaimedTextJob {
  return {
    id: "text-job-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    channelOutputId: "output-1",
    leaseToken: "text-lease-1",
    attemptCount: 1,
    payload: {
      deliveryFormat: "threads_text",
      promptVersion: "worker-threads.v1",
      topic: {
        title: "Topic",
        angle: "Angle",
        targetCustomer: "Customer",
        region: "Seoul",
        season: "Summer",
        notes: "Notes"
      },
      brand: {
        name: "Brand",
        categoryContext: "Business / Marketing",
        primaryCustomer: "Customer",
        description: "Description",
        tone: "Tone",
        brandColor: "#112233"
      },
      representativeUrl: "https://source.example/article"
    }
  };
}

function client(job: ClaimedTextJob | null = claimedTextJob()) {
  return {
    claim: vi.fn(async () => job),
    heartbeat: vi.fn(async () => ({ status: "running" })),
    complete: vi.fn(async () => ({ status: "succeeded" })),
    fail: vi.fn(async () => undefined)
  };
}

const fetchedSource: SourceReadResult = {
  sourceMode: "direct_url",
  fetchStatus: "fetched",
  sourceText: "representative source text"
};

describe("Threads text worker", () => {
  it("claims, reads the representative URL, generates one post, and completes with the lease", async () => {
    const textClient = client();
    const result = {
      deliveryFormat: "threads_text" as const,
      promptVersion: "worker-threads.v1" as const,
      title: "Threads title",
      text: "Threads body",
      sourceMode: "direct_url" as const,
      fetchStatus: "fetched" as const,
      model: "codex-cli"
    };
    const generator = { model: "codex-cli", generate: vi.fn(async () => result) };
    const readSource = vi.fn(async () => fetchedSource);

    await expect(runTextOnce({ workerId: "worker-1", client: textClient, generator, readSource }))
      .resolves.toEqual({ status: "completed", jobId: "text-job-1" });

    expect(textClient.claim).toHaveBeenCalledWith("worker-1");
    expect(readSource).toHaveBeenCalledWith("https://source.example/article");
    expect(generator.generate).toHaveBeenCalledWith({
      prompt: expect.stringContaining("Threads 게시물 1개"),
      source: fetchedSource
    });
    expect(textClient.complete).toHaveBeenCalledWith("text-job-1", {
      workerId: "worker-1",
      leaseToken: "text-lease-1",
      result
    });
    expect(textClient.fail).not.toHaveBeenCalled();
  });

  it("continues with topic-only safeguards when the representative URL fetch fails", async () => {
    const textClient = client();
    const unavailable: SourceReadResult = {
      sourceMode: "url_unavailable",
      fetchStatus: "source_fetch_failed",
      sourceText: null
    };
    const generator = {
      model: "codex-cli",
      generate: vi.fn(async ({ source }: { source: SourceReadResult }) => ({
        deliveryFormat: "threads_text" as const,
        promptVersion: "worker-threads.v1" as const,
        title: "Title",
        text: "Text",
        sourceMode: source.sourceMode,
        fetchStatus: source.fetchStatus,
        model: "codex-cli"
      }))
    };

    await expect(runTextOnce({
      workerId: "worker-1",
      client: textClient,
      generator,
      readSource: vi.fn(async () => { throw new Error("network"); })
    })).resolves.toEqual({ status: "completed", jobId: "text-job-1" });

    expect(generator.generate).toHaveBeenCalledWith(expect.objectContaining({ source: unavailable }));
  });

  it("reports Codex failures with the existing image failure body", async () => {
    const textClient = client();
    const generator = {
      model: "codex-cli",
      generate: vi.fn(async () => { throw new Error("codex_text_generation_failed:1"); })
    };

    await expect(runTextOnce({
      workerId: "worker-1",
      client: textClient,
      generator,
      readSource: vi.fn(async () => fetchedSource),
      retryDelayMs: 60_000
    })).resolves.toEqual({ status: "failed", jobId: "text-job-1" });

    expect(textClient.fail).toHaveBeenCalledWith("text-job-1", {
      workerId: "worker-1",
      leaseToken: "text-lease-1",
      error: "codex_text_generation_failed:1",
      retryable: true,
      retryAfterMs: 60_000
    });
  });

  it("returns idle when no text job is available", async () => {
    const textClient = client(null);
    const generator = { model: "codex-cli", generate: vi.fn() };

    await expect(runTextOnce({ workerId: "worker-1", client: textClient, generator }))
      .resolves.toEqual({ status: "idle" });
    expect(generator.generate).not.toHaveBeenCalled();
  });
});
