import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  readRepresentativeSource,
  type NodeRequestLike,
  type SourceReaderDependencies
} from "./sourceReader.js";

const PUBLIC_IP = "93.184.216.34";

function dependencies(overrides: Partial<SourceReaderDependencies> = {}): SourceReaderDependencies {
  return {
    fetch: vi.fn(async () => new Response("source text", {
      headers: { "content-type": "text/plain" }
    })),
    resolve: vi.fn(async () => [PUBLIC_IP]),
    ...overrides
  };
}

function redirect(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

function incomingResponse(statusCode: number, body: string, headers: Record<string, string>) {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode, headers });
}

function requestMock(
  responses: Array<ReturnType<typeof incomingResponse>>,
  pinnedLookups: string[][]
) {
  const implementation: NodeRequestLike = (url, options, callback) => {
    const request = new EventEmitter() as unknown as ClientRequest;
    request.end = (() => {
      if (!options.lookup) throw new Error("pinned_lookup_required");
      options.lookup("dns-rebinding.example", { all: true }, (error, address) => {
        if (error) return request.emit("error", error);
        const addresses = Array.isArray(address) ? address : [{ address, family: 0 }];
        pinnedLookups.push(addresses.map((item) => item.address));
        callback(responses.shift()! as unknown as IncomingMessage);
      });
      return request;
    }) as ClientRequest["end"];
    return request;
  };
  return vi.fn(implementation);
}

describe("readRepresentativeSource", () => {
  it("pins the production HTTPS connection to only the validated address while preserving Host and TLS SNI", async () => {
    const pinnedLookups: string[][] = [];
    const request = requestMock([
      incomingResponse(200, "source text", { "content-type": "text/plain" })
    ], pinnedLookups);

    await expect(readRepresentativeSource("https://source.example/article", {
      resolve: vi.fn(async () => [PUBLIC_IP]),
      request
    })).resolves.toMatchObject({ sourceMode: "direct_url", fetchStatus: "fetched" });

    expect(pinnedLookups).toEqual([[PUBLIC_IP]]);
    expect(request).toHaveBeenCalledTimes(1);
    const [requestedUrl, options] = request.mock.calls[0];
    expect(requestedUrl).toMatchObject({ hostname: "source.example", pathname: "/article" });
    expect(options).toMatchObject({
      headers: { host: "source.example" },
      servername: "source.example"
    });
  });

  it("revalidates every redirect and pins its connection to that hop's validated addresses", async () => {
    const redirectedIp = "93.184.216.35";
    const pinnedLookups: string[][] = [];
    const request = requestMock([
      incomingResponse(302, "", { location: "https://redirect.example/final" }),
      incomingResponse(200, "redirected source", { "content-type": "text/plain" })
    ], pinnedLookups);
    const resolve = vi.fn(async (hostname: string) => hostname === "source.example" ? [PUBLIC_IP] : [redirectedIp]);

    await expect(readRepresentativeSource("https://source.example/start", { resolve, request }))
      .resolves.toMatchObject({ sourceMode: "direct_url", fetchStatus: "fetched" });

    expect(resolve.mock.calls.map(([hostname]) => hostname)).toEqual(["source.example", "redirect.example"]);
    expect(pinnedLookups).toEqual([[PUBLIC_IP], [redirectedIp]]);
    expect(request.mock.calls.map(([url]) => url.hostname)).toEqual(["source.example", "redirect.example"]);
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://localhost/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/private",
    "http://[::1]/private"
  ])("blocks non-public address %s", async (url) => {
    const deps = dependencies();

    await expect(readRepresentativeSource(url, deps)).resolves.toEqual({
      sourceMode: "url_unavailable",
      fetchStatus: "source_url_blocked",
      sourceText: null
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("blocks a hostname when DNS returns a private address", async () => {
    const deps = dependencies({ resolve: vi.fn(async () => ["10.0.0.8"]) });

    await expect(readRepresentativeSource("https://example.com/private", deps)).resolves.toMatchObject({
      sourceMode: "url_unavailable",
      fetchStatus: "source_url_blocked"
    });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("blocks a public URL that redirects to a private address", async () => {
    const fetchMock = vi.fn(async () => redirect("http://10.0.0.1/private"));
    const deps = dependencies({ fetch: fetchMock });

    await expect(readRepresentativeSource("https://example.com/start", deps)).resolves.toMatchObject({
      sourceMode: "url_unavailable",
      fetchStatus: "source_url_blocked"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops when a response attempts a fourth redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirect("https://example.com/one"))
      .mockResolvedValueOnce(redirect("https://example.com/two"))
      .mockResolvedValueOnce(redirect("https://example.com/three"))
      .mockResolvedValueOnce(redirect("https://example.com/four"));

    await expect(readRepresentativeSource("https://example.com/start", dependencies({ fetch: fetchMock }))).resolves.toEqual({
      sourceMode: "url_unavailable",
      fetchStatus: "source_redirect_limit_exceeded",
      sourceText: null
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects a response whose Content-Length exceeds 2 MiB", async () => {
    const fetchMock = vi.fn(async () => new Response("oversized", {
      headers: {
        "content-type": "text/plain",
        "content-length": String(2 * 1024 * 1024 + 1)
      }
    }));

    await expect(readRepresentativeSource("https://example.com/large", dependencies({ fetch: fetchMock }))).resolves.toMatchObject({
      sourceMode: "url_unavailable",
      fetchStatus: "source_response_too_large",
      sourceText: null
    });
  });

  it("rejects a streamed response after it exceeds 2 MiB", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => new Response(body, {
      headers: { "content-type": "text/plain" }
    }));

    await expect(readRepresentativeSource("https://example.com/stream", dependencies({ fetch: fetchMock }))).resolves.toMatchObject({
      sourceMode: "url_unavailable",
      fetchStatus: "source_response_too_large",
      sourceText: null
    });
  });

  it("rejects image/png responses", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" }
    }));

    await expect(readRepresentativeSource("https://example.com/image.png", dependencies({ fetch: fetchMock }))).resolves.toMatchObject({
      sourceMode: "url_unavailable",
      fetchStatus: "source_mime_unsupported",
      sourceText: null
    });
  });

  it("aborts a request after the timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        }, { once: true });
      });
    });
    const setTimeoutMock: SourceReaderDependencies["setTimeout"] = (callback) => {
      return setTimeout(callback, 0);
    };

    await expect(readRepresentativeSource("https://example.com/slow", dependencies({
      fetch: fetchMock,
      setTimeout: setTimeoutMock,
      clearTimeout: vi.fn()
    }))).resolves.toEqual({
      sourceMode: "url_unavailable",
      fetchStatus: "source_timeout",
      sourceText: null
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/slow", expect.objectContaining({
      redirect: "manual",
      signal: expect.any(AbortSignal)
    }));
  });

  it("times out a stalled DNS lookup before making a request", async () => {
    const fetchMock = vi.fn();
    const resolve = vi.fn(() => new Promise<readonly string[]>(() => undefined));
    const setTimeoutMock: SourceReaderDependencies["setTimeout"] = (callback) => {
      callback();
      return 1;
    };

    await expect(readRepresentativeSource("https://example.com/dns-stall", dependencies({
      fetch: fetchMock,
      resolve,
      setTimeout: setTimeoutMock,
      clearTimeout: vi.fn()
    }))).resolves.toEqual({
      sourceMode: "url_unavailable",
      fetchStatus: "source_timeout",
      sourceText: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("extracts normalized title, description, and main HTML text", async () => {
    const html = `
      <html>
        <head>
          <title> Example   title </title>
          <meta name="description" content=" A useful   description ">
          <style>.hidden { display: none; }</style>
          <script>window.evil = true;</script>
        </head>
        <body>
          <nav>Navigation</nav>
          <main><h1>Main heading</h1><p>Useful   body text.</p><form>Submit me</form></main>
          <footer>Footer</footer>
        </body>
      </html>`;
    const fetchMock = vi.fn(async () => new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    }));

    await expect(readRepresentativeSource("https://example.com/article", dependencies({ fetch: fetchMock }))).resolves.toEqual({
      sourceMode: "direct_url",
      fetchStatus: "fetched",
      sourceText: "Example title\n\nA useful description\n\nMain heading Useful body text."
    });
  });

  it("normalizes and limits text/plain content", async () => {
    const text = ` First\n\n  paragraph \t ${"x".repeat(21_000)}`;
    const fetchMock = vi.fn(async () => new Response(text, {
      headers: { "content-type": "text/plain" }
    }));

    const result = await readRepresentativeSource("https://example.com/article.txt", dependencies({ fetch: fetchMock }));

    expect(result).toMatchObject({ sourceMode: "direct_url", fetchStatus: "fetched" });
    expect(result.sourceText).toHaveLength(20_000);
    expect(result.sourceText).toMatch(/^First paragraph x+$/);
  });

  it.each([null, undefined, "", "   "])("uses topic-only mode when the URL is absent (%s)", async (url) => {
    const deps = dependencies();

    await expect(readRepresentativeSource(url, deps)).resolves.toEqual({
      sourceMode: "topic_only",
      fetchStatus: "no_source_url",
      sourceText: null
    });
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.resolve).not.toHaveBeenCalled();
  });
});
