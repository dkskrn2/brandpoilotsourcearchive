import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildPublishedResultsPackage, type PublishedResultRecord } from "./downloadPackage";

function record(overrides: Partial<PublishedResultRecord> = {}): PublishedResultRecord {
  return {
    id: "queue-1",
    channel: "instagram",
    publishedAt: "2026-07-07T11:30:00.000Z",
    title: "Remote gallery",
    previewTitle: null,
    previewBody: "Gallery body",
    sourceSummary: "Source summary",
    outputJson: { caption: "Gallery body" },
    artifactPublicUrl: "https://cdn.example/manifest.json",
    artifactBucket: null,
    artifactPath: null,
    externalUrl: "https://instagram.com/p/queue-1",
    ...overrides
  };
}

describe("buildPublishedResultsPackage", () => {
  it("keeps a remote partial package and records missing files", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return new Response(JSON.stringify({
          deliveryFormat: "gallery",
          cards: [
            { url: "https://cdn.example/card-01.png", mimeType: "image/png" },
            { url: "https://cdn.example/card-02.png", mimeType: "image/png" }
          ]
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("card-01.png")) return new Response(Buffer.from("available-image"));
      return new Response("missing", { status: 404 });
    });

    const result = await buildPublishedResultsPackage([record()], {
      fetchImpl: fetchImpl as typeof fetch,
      fetchTimeoutMs: 250,
      maxRemoteFileBytes: 1024,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.itemCount).toBe(1);
    expect(result.buffer.includes(Buffer.from("images/manifest.json"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("images/card-01.png"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("available-image"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("missing-files.txt"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("https://cdn.example/card-02.png"))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("rejects an oversized remote file without dropping package metadata", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => String(input).endsWith("manifest.json")
      ? new Response(JSON.stringify({ images: [{ url: "https://cdn.example/large.png", mimeType: "image/png" }] }))
      : new Response(Buffer.alloc(32), { headers: { "content-length": "32" } }));

    const result = await buildPublishedResultsPackage([record()], {
      fetchImpl: fetchImpl as typeof fetch,
      maxRemoteFileBytes: 16,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.buffer.includes(Buffer.from("published-summary.csv"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("missing-files.txt"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("remote_file_too_large"))).toBe(true);
  });

  it("writes inline HTML as a file and still downloads linked assets", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return new Response(JSON.stringify({
          html: "<article>Published page</article>",
          assets: [{ url: "https://cdn.example/page.css", mimeType: "text/css", fileName: "page.css" }]
        }));
      }
      if (url.endsWith("page.css")) return new Response("article { color: black; }");
      throw new Error(`unexpected_fetch:${url}`);
    });

    const result = await buildPublishedResultsPackage([record()], {
      fetchImpl: fetchImpl as typeof fetch,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.buffer.includes(Buffer.from("html/index.html"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("<article>Published page</article>"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("assets/page.css"))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalledWith("<article>Published page</article>", expect.anything());
  });

  it("includes both a remote video and its poster cover", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return new Response(JSON.stringify({
          video: { url: "https://cdn.example/reel.mp4", mimeType: "video/mp4" },
          cover: { url: "https://cdn.example/cover.png", mimeType: "image/png" }
        }));
      }
      if (url.endsWith("reel.mp4")) return new Response("video-bytes");
      if (url.endsWith("cover.png")) return new Response("cover-bytes");
      throw new Error(`unexpected_fetch:${url}`);
    });

    const result = await buildPublishedResultsPackage([record()], {
      fetchImpl: fetchImpl as typeof fetch,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.buffer.includes(Buffer.from("video/reel.mp4"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("video-bytes"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("images/cover.png"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("cover-bytes"))).toBe(true);
  });

  it("resolves relative assets against the manifest and rejects unsafe asset URLs", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://cdn.example/results/manifest.json") {
        return new Response(JSON.stringify({
          assets: [
            { url: "media/relative.png", mimeType: "image/png" },
            { url: "https://other.example/cross-origin.png", mimeType: "image/png" },
            { url: "file:///private/secret.png", mimeType: "image/png" }
          ]
        }));
      }
      if (url === "https://cdn.example/results/media/relative.png") return new Response("relative-image");
      throw new Error(`unsafe_fetch:${url}`);
    });

    const result = await buildPublishedResultsPackage([
      record({ artifactPublicUrl: "https://cdn.example/results/manifest.json" })
    ], { fetchImpl: fetchImpl as typeof fetch, allowedRemoteOrigins: ["https://cdn.example"] });

    expect(result.buffer.includes(Buffer.from("relative-image"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("asset_origin_not_allowed"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("remote_url_protocol_invalid"))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalledWith("https://other.example/cross-origin.png", expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith("file:///private/secret.png", expect.anything());
  });

  it("rejects untrusted manifest origins and redirect targets", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://cdn.example/manifest.json") {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      }
      throw new Error(`unsafe_fetch:${url}`);
    });

    const result = await buildPublishedResultsPackage([
      record({ artifactPublicUrl: "https://untrusted.example/manifest.json" }),
      record({ id: "queue-2", artifactPublicUrl: "https://cdn.example/manifest.json" })
    ], {
      fetchImpl: fetchImpl as typeof fetch,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.buffer.includes(Buffer.from("remote_origin_not_allowed"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("remote_host_not_allowed"))).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalledWith("https://untrusted.example/manifest.json", expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith("http://127.0.0.1/private", expect.anything());
  });

  it("caps record count, entry count, and aggregate bytes", async () => {
    await expect(buildPublishedResultsPackage([record(), record({ id: "queue-2" })], {
      maxRecordCount: 1
    })).rejects.toThrow("download_record_limit_exceeded");

    await expect(buildPublishedResultsPackage([record({ artifactPublicUrl: null })], {
      maxEntryCount: 2
    })).rejects.toThrow("download_entry_limit_exceeded");

    await expect(buildPublishedResultsPackage([record({ artifactPublicUrl: null })], {
      maxTotalBytes: 8
    })).rejects.toThrow("download_size_limit_exceeded");
  });

  it("allocates deterministic unique names when assets share a basename", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("manifest.json")) {
        return new Response(JSON.stringify({
          images: [
            { url: "https://cdn.example/one/image.png", mimeType: "image/png" },
            { url: "https://cdn.example/two/image.png", mimeType: "image/png" }
          ]
        }));
      }
      return new Response(url.endsWith("/one/image.png") ? "one" : "two");
    });

    const result = await buildPublishedResultsPackage([record()], {
      fetchImpl: fetchImpl as typeof fetch,
      allowedRemoteOrigins: ["https://cdn.example"]
    });

    expect(result.buffer.includes(Buffer.from("images/image.png"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("images/image-2.png"))).toBe(true);
  });

  it("does not read local assets outside the declared bucket", async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-artifact-boundary-"));
    const manifestDir = path.join(storageDir, "rendered-content", "queue-1");
    const privateDir = path.join(storageDir, "private-bucket");
    await mkdir(manifestDir, { recursive: true });
    await mkdir(privateDir, { recursive: true });
    await writeFile(path.join(privateDir, "secret.txt"), "must-not-be-included");
    await writeFile(path.join(manifestDir, "manifest.json"), JSON.stringify({
      assets: [{ path: "../private-bucket/secret.txt", mimeType: "text/plain" }]
    }));

    try {
      const result = await buildPublishedResultsPackage([record({
        artifactPublicUrl: null,
        artifactBucket: "rendered-content",
        artifactPath: "queue-1/manifest.json"
      })], { storageDir });

      expect(result.buffer.includes(Buffer.from("must-not-be-included"))).toBe(false);
      expect(result.buffer.includes(Buffer.from("asset_unavailable"))).toBe(true);
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
