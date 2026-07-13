import { lookup } from "node:dns/promises";
import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { domainToASCII } from "node:url";
import { load } from "cheerio";
import ipaddr from "ipaddr.js";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_SOURCE_CHARS = 20_000;
const ACCEPTED_TYPES = new Set(["text/html", "text/plain", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type ResolveLike = (hostname: string) => Promise<readonly string[]>;
type SetTimeoutLike = (callback: () => void, delayMs: number) => unknown;
type ClearTimeoutLike = (handle: unknown) => void;
export type NodeRequestLike = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

export interface SourceReaderDependencies {
  fetch?: FetchLike;
  resolve: ResolveLike;
  request?: NodeRequestLike;
  setTimeout?: SetTimeoutLike;
  clearTimeout?: ClearTimeoutLike;
}

export type SourceReadResult = {
  sourceMode: "direct_url" | "topic_only" | "url_unavailable";
  fetchStatus:
    | "no_source_url"
    | "fetched"
    | "source_url_blocked"
    | "source_dns_failed"
    | "source_redirect_invalid"
    | "source_redirect_limit_exceeded"
    | "source_http_error"
    | "source_response_too_large"
    | "source_mime_unsupported"
    | "source_timeout"
    | "source_fetch_failed";
  sourceText: string | null;
};

const defaultResolve: ResolveLike = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};
const defaultSetTimeout: SetTimeoutLike = (callback, delayMs) => setTimeout(callback, delayMs);
const defaultClearTimeout: ClearTimeoutLike = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>);

function unavailable(fetchStatus: Exclude<SourceReadResult["fetchStatus"], "no_source_url" | "fetched">): SourceReadResult {
  return { sourceMode: "url_unavailable", fetchStatus, sourceText: null };
}

function normalizedHostname(url: URL) {
  let hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  hostname = hostname.replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return null;

  if (ipaddr.isValid(hostname)) return hostname;
  const asciiHostname = domainToASCII(hostname).toLowerCase().replace(/\.$/, "");
  if (!asciiHostname || asciiHostname.includes(" ")) return null;
  return asciiHostname;
}

function isPublicUnicast(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === "unicast";
}

type TargetValidation =
  | { status: "allowed"; hostname: string; addresses: readonly string[] }
  | { status: "blocked" | "dns_failed" };

async function validateTarget(url: URL, resolve: ResolveLike): Promise<TargetValidation> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return { status: "blocked" };
  const hostname = normalizedHostname(url);
  if (!hostname) return { status: "blocked" };

  if (ipaddr.isValid(hostname)) {
    return isPublicUnicast(hostname)
      ? { status: "allowed", hostname, addresses: [hostname] }
      : { status: "blocked" };
  }

  let addresses: readonly string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return { status: "dns_failed" };
  }
  if (addresses.length === 0 || addresses.some((address) => !isPublicUnicast(address))) {
    return { status: "blocked" };
  }
  return { status: "allowed", hostname, addresses };
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return null;
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function addressFamily(address: string): 4 | 6 {
  return ipaddr.parse(address).kind() === "ipv4" ? 4 : 6;
}

function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const resolved = addresses.map((address) => ({ address, family: addressFamily(address) }));
  return (_hostname, options, callback) => {
    const requestedFamily = options.family === "IPv4"
      ? 4
      : options.family === "IPv6"
        ? 6
        : Number(options.family ?? 0);
    const candidates = requestedFamily === 4 || requestedFamily === 6
      ? resolved.filter(({ family }) => family === requestedFamily)
      : resolved;
    if (candidates.length === 0) {
      const error = Object.assign(new Error("validated_address_family_unavailable"), { code: "ENOTFOUND" });
      callback(error, options.all ? [] : "", requestedFamily || undefined);
      return;
    }
    if (options.all) {
      callback(null, candidates);
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

function responseHeaders(response: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function fetchPinned(
  url: URL,
  init: RequestInit,
  validation: Extract<TargetValidation, { status: "allowed" }>,
  requestOverride?: NodeRequestLike
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requester = requestOverride ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
    const options: RequestOptions & { servername?: string } = {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        host: url.host
      },
      lookup: pinnedLookup(validation.addresses),
      signal: init.signal ?? undefined
    };
    if (url.protocol === "https:" && !ipaddr.isValid(validation.hostname)) {
      options.servername = validation.hostname;
    }
    const request = requester(url, options, (incoming) => {
      const status = incoming.statusCode ?? 500;
      const hasNoBody = status === 204 || status === 205 || status === 304;
      const body = hasNoBody ? null : Readable.toWeb(incoming) as unknown as BodyInit;
      resolve(new Response(body, { status, headers: responseHeaders(incoming) }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already closed or errored.
  }
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractHtml(source: string) {
  const $ = load(source);
  $("script, style, nav, footer, form").remove();

  const title = normalizedText($("title").first().text());
  const description = normalizedText($("meta[name='description']").first().attr("content") ?? "");
  let contentRoot = $("main").first();
  if (contentRoot.length === 0) contentRoot = $("article").first();
  if (contentRoot.length === 0) contentRoot = $("body").first();
  const body = normalizedText(contentRoot
    .find("*")
    .addBack()
    .contents()
    .filter((_, node) => node.type === "text")
    .map((_, node) => $(node).text())
    .get()
    .join(" "));

  return [title, description, body]
    .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index)
    .join("\n\n")
    .slice(0, MAX_SOURCE_CHARS);
}

function extractSourceText(bytes: Uint8Array, mimeType: string) {
  const decoded = new TextDecoder().decode(bytes);
  if (mimeType === "text/plain") return normalizedText(decoded).slice(0, MAX_SOURCE_CHARS);
  return extractHtml(decoded);
}

function contentLengthExceedsLimit(response: Response) {
  const value = response.headers.get("content-length")?.trim();
  return value !== undefined && /^\d+$/.test(value) && Number(value) > MAX_RESPONSE_BYTES;
}

export async function readRepresentativeSource(
  sourceUrl: string | null | undefined,
  dependencies: Partial<SourceReaderDependencies> = {}
): Promise<SourceReadResult> {
  if (typeof sourceUrl !== "string" || sourceUrl.trim().length === 0) {
    return { sourceMode: "topic_only", fetchStatus: "no_source_url", sourceText: null };
  }

  const resolve = dependencies.resolve ?? defaultResolve;
  const scheduleTimeout = dependencies.setTimeout ?? defaultSetTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? defaultClearTimeout;

  let currentUrl: URL;
  try {
    currentUrl = new URL(sourceUrl.trim());
  } catch {
    return unavailable("source_url_blocked");
  }

  let redirects = 0;
  while (true) {
    const controller = new AbortController();
    const timeoutHandle = scheduleTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const validation = await awaitWithAbort(validateTarget(currentUrl, resolve), controller.signal);
    if (!validation) {
      cancelTimeout(timeoutHandle);
      return unavailable("source_timeout");
    }
    if (validation.status !== "allowed") {
      cancelTimeout(timeoutHandle);
      return unavailable(validation.status === "blocked" ? "source_url_blocked" : "source_dns_failed");
    }

    let response: Response;
    try {
      const init = { redirect: "manual" as const, signal: controller.signal };
      response = dependencies.fetch
        ? await dependencies.fetch(currentUrl.toString(), init)
        : await fetchPinned(currentUrl, init, validation, dependencies.request);
    } catch {
      cancelTimeout(timeoutHandle);
      return unavailable(controller.signal.aborted ? "source_timeout" : "source_fetch_failed");
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await cancelBody(response);
      cancelTimeout(timeoutHandle);
      if (redirects >= MAX_REDIRECTS) return unavailable("source_redirect_limit_exceeded");

      const location = response.headers.get("location");
      if (!location) return unavailable("source_redirect_invalid");
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        return unavailable("source_redirect_invalid");
      }
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      await cancelBody(response);
      cancelTimeout(timeoutHandle);
      return unavailable("source_http_error");
    }
    if (contentLengthExceedsLimit(response)) {
      await cancelBody(response);
      cancelTimeout(timeoutHandle);
      return unavailable("source_response_too_large");
    }

    const mimeType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    if (!ACCEPTED_TYPES.has(mimeType)) {
      await cancelBody(response);
      cancelTimeout(timeoutHandle);
      return unavailable("source_mime_unsupported");
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await readBoundedBody(response);
    } catch {
      cancelTimeout(timeoutHandle);
      return unavailable(controller.signal.aborted ? "source_timeout" : "source_fetch_failed");
    }
    cancelTimeout(timeoutHandle);
    if (!bytes) return unavailable("source_response_too_large");

    try {
      return {
        sourceMode: "direct_url",
        fetchStatus: "fetched",
        sourceText: extractSourceText(bytes, mimeType)
      };
    } catch {
      return unavailable("source_fetch_failed");
    }
  }
}
