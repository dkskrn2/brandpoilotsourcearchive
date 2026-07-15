import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { Channel } from "./types.js";

export interface PublishedResultRecord {
  id: string;
  channel: Channel;
  publishedAt: Date | string | null;
  title: string;
  previewTitle: string | null;
  previewBody: string | null;
  sourceSummary: string | null;
  outputJson: unknown;
  artifactPublicUrl: string | null;
  artifactBucket: string | null;
  artifactPath: string | null;
  externalUrl: string | null;
}

export interface BuildPublishedResultsPackageOptions {
  storageDir?: string;
  fetchImpl?: typeof fetch;
  fetchTimeoutMs?: number;
  maxRemoteFileBytes?: number;
  maxRemoteManifestBytes?: number;
  allowedRemoteOrigins?: readonly string[];
  maxRecordCount?: number;
  maxEntryCount?: number;
  maxTotalBytes?: number;
  maxAssetsPerRecord?: number;
}

export interface DownloadPackage {
  fileName: string;
  mimeType: "application/zip";
  buffer: Buffer;
  itemCount: number;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

interface PackageBudget {
  maxEntries: number;
  maxBytes: number;
  entries: ZipEntry[];
  names: Set<string>;
  bytes: number;
}

const DEFAULT_MAX_RECORDS = 100;
const DEFAULT_MAX_ENTRIES = 512;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ASSETS_PER_RECORD = 16;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function createZipArchive(entries: ZipEntry[]) {
  const now = new Date();
  const { dosDate, dosTime } = dosDateTime(now);
  const fileChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    fileChunks.push(localHeader, fileName, data);
    centralChunks.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + data.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralSize, 12);
  endOfCentralDirectory.writeUInt32LE(centralOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...fileChunks, ...centralChunks, endOfCentralDirectory]);
}

function uniqueEntryName(name: string, names: Set<string>) {
  if (!names.has(name)) return name;
  const extension = path.posix.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!names.has(candidate)) return candidate;
  }
  throw new Error("download_entry_name_limit_exceeded");
}

function addEntry(budget: PackageBudget, entry: ZipEntry) {
  if (budget.entries.length >= budget.maxEntries) throw new Error("download_entry_limit_exceeded");
  if (budget.bytes + entry.data.length > budget.maxBytes) throw new Error("download_size_limit_exceeded");
  const name = uniqueEntryName(entry.name, budget.names);
  budget.names.add(name);
  budget.bytes += entry.data.length;
  budget.entries.push({ ...entry, name });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function safeFileSegment(value: string, fallback = "item") {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

function textFile(name: string, content: string): ZipEntry {
  return { name, data: Buffer.from(content, "utf8") };
}

function jsonFile(name: string, content: unknown): ZipEntry {
  return textFile(name, `${JSON.stringify(content, null, 2)}\n`);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function isoDate(value: Date | string | null) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function summaryCsv(records: PublishedResultRecord[]) {
  const header = ["id", "channel", "title", "published_at", "external_url", "artifact_url"];
  const rows = records.map((record) => [
    record.id,
    record.channel,
    record.title,
    isoDate(record.publishedAt),
    record.externalUrl ?? "",
    record.artifactPublicUrl ?? ""
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function instagramFiles(folder: string, output: Record<string, unknown>, fallbackBody: string | null): ZipEntry[] {
  const caption = stringValue(output.caption) || fallbackBody || "";
  const hashtags = stringArray(output.hashtags);
  const slides = output.slides ?? [];
  return [
    textFile(`${folder}/caption.txt`, caption ? `${caption}\n` : ""),
    textFile(`${folder}/hashtags.txt`, hashtags.length ? `${hashtags.join(" ")}\n` : ""),
    jsonFile(`${folder}/slides.json`, slides)
  ];
}

function threadsFiles(folder: string, output: Record<string, unknown>, fallbackBody: string | null): ZipEntry[] {
  const body = stringValue(output.body) || fallbackBody || "";
  return [textFile(`${folder}/thread.txt`, body ? `${body}\n` : "")];
}

function resolveStoragePath(storageDir: string, bucket: string, artifactPath: string) {
  const bucketRoot = path.resolve(storageDir, bucket);
  const normalized = artifactPath.replace(/\\/g, "/");
  const relativePath = normalized.startsWith(`${bucket}/`) ? normalized.slice(bucket.length + 1) : normalized;
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) return null;
  const absolutePath = path.resolve(bucketRoot, relativePath);
  if (absolutePath !== bucketRoot && !absolutePath.startsWith(`${bucketRoot}${path.sep}`)) {
    return null;
  }
  return absolutePath;
}

async function readLocalBuffer(filePath: string, maxBytes: number) {
  const fileStat = await stat(filePath);
  if (fileStat.size > maxBytes) throw new Error(`local_file_too_large:${fileStat.size}`);
  const buffer = await readFile(filePath);
  if (buffer.length > maxBytes) throw new Error(`local_file_too_large:${buffer.length}`);
  return buffer;
}

function isPrivateHost(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (ipVersion === 6) {
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc")
      || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9")
      || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return false;
}

function trustedRemoteUrl(url: URL, allowedOrigins: readonly string[] = []) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("remote_url_protocol_invalid");
  if (isPrivateHost(url.hostname)) throw new Error("remote_host_not_allowed");
  const configuredOrigins = new Set(allowedOrigins.flatMap((value) => {
    try { return [new URL(value).origin]; } catch { return []; }
  }));
  const isVercelBlob = url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  if (!configuredOrigins.has(url.origin) && !isVercelBlob) throw new Error("remote_origin_not_allowed");
  return url;
}

export async function fetchRemoteBuffer(url: string, options: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes: number;
  allowedOrigins?: readonly string[];
  maxRedirects?: number;
}) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("remote_url_invalid");
  }
  parsedUrl = trustedRemoteUrl(parsedUrl, options.allowedOrigins);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs ?? 5_000));
  try {
    let response: Response | null = null;
    const maxRedirects = Math.max(0, options.maxRedirects ?? 3);
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      response = await (options.fetchImpl ?? fetch)(parsedUrl.toString(), {
        signal: controller.signal,
        redirect: "manual"
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("remote_redirect_location_missing");
      if (redirectCount === maxRedirects) throw new Error("remote_redirect_limit_exceeded");
      parsedUrl = trustedRemoteUrl(new URL(location, parsedUrl), options.allowedOrigins);
    }
    if (!response) throw new Error("remote_fetch_failed");
    if (!response.ok) throw new Error(`remote_fetch_failed:${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      throw new Error(`remote_file_too_large:${contentLength}`);
    }
    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > options.maxBytes) throw new Error(`remote_file_too_large:${buffer.length}`);
      return buffer;
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel();
        throw new Error(`remote_file_too_large:${size}`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}

interface ManifestAssetReference {
  url: string | null;
  artifactPath: string | null;
  fileName: string;
  mimeType: string;
}

function extensionMimeType(fileName: string) {
  switch (path.extname(fileName).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".mp4": return "video/mp4";
    case ".webm": return "video/webm";
    case ".html":
    case ".htm": return "text/html";
    case ".txt": return "text/plain";
    default: return "application/octet-stream";
  }
}

function manifestAssetReferences(manifest: unknown): ManifestAssetReference[] {
  const record = asRecord(manifest);
  const values = ["cards", "images", "story", "scenes", "cover", "video", "assets", "files", "html"]
    .flatMap((key) => Array.isArray(record[key]) ? record[key] as unknown[] : record[key] === undefined || record[key] === null ? [] : [record[key]]);
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const item = asRecord(value);
    const directValue = stringValue(value);
    if (directValue.trimStart().startsWith("<")) return [];
    const itemUrl = stringValue(item.url ?? item.publicUrl);
    const url = itemUrl || (/^https?:\/\//i.test(directValue) ? directValue : null);
    const artifactPath = stringValue(item.path) || (!url && directValue ? directValue : null);
    if (!url && !artifactPath) return [];
    const identity = url ?? artifactPath!;
    if (seen.has(identity)) return [];
    seen.add(identity);
    const sourceName = stringValue(item.fileName ?? item.filename ?? item.name) || url || artifactPath || "artifact";
    let fileName = "artifact";
    try {
      fileName = path.basename(url ? new URL(url).pathname : sourceName) || "artifact";
    } catch {
      fileName = path.basename(sourceName.replace(/\\/g, "/")) || "artifact";
    }
    const mimeType = stringValue(item.mimeType ?? item.contentType).split(";", 1)[0] || extensionMimeType(fileName);
    return [{ url, artifactPath, fileName, mimeType }];
  });
}

function remoteUrlForAsset(reference: ManifestAssetReference, manifestUrl: string | null) {
  const rawUrl = reference.url ?? reference.artifactPath;
  if (!rawUrl || !manifestUrl) return { url: null, error: null };
  try {
    const baseUrl = new URL(manifestUrl);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return { url: null, error: "remote_url_protocol_invalid" };
    }
    const resolvedUrl = new URL(rawUrl, baseUrl);
    if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:") {
      return { url: null, error: "remote_url_protocol_invalid" };
    }
    if (resolvedUrl.origin !== baseUrl.origin) {
      return { url: null, error: "asset_origin_not_allowed" };
    }
    return { url: resolvedUrl.toString(), error: null };
  } catch {
    return { url: null, error: "remote_url_invalid" };
  }
}

function zipDirectoryForAsset(reference: ManifestAssetReference) {
  if (reference.mimeType.startsWith("image/")) return "images";
  if (reference.mimeType.startsWith("video/")) return "video";
  if (reference.mimeType === "text/html" || reference.mimeType === "application/xhtml+xml") return "html";
  return "assets";
}

async function artifactFilesForRecord(
  record: PublishedResultRecord,
  options: BuildPublishedResultsPackageOptions,
  budget: PackageBudget,
  folder: string
): Promise<void> {
  if (!record.artifactPublicUrl && (!options.storageDir || !record.artifactBucket || !record.artifactPath)) return;
  const missing: string[] = [];
  let manifestBuffer: Buffer | null = null;
  let manifest: unknown = null;
  const manifestPath = options.storageDir && record.artifactBucket && record.artifactPath
    ? resolveStoragePath(options.storageDir, record.artifactBucket, record.artifactPath)
    : null;

  if (manifestPath) {
    try {
      manifestBuffer = await readLocalBuffer(manifestPath, Math.min(
        options.maxRemoteManifestBytes ?? 2 * 1024 * 1024,
        budget.maxBytes - budget.bytes
      ));
    } catch {
      // A public manifest may still be available when local storage is not mounted.
    }
  }
  if (!manifestBuffer && record.artifactPublicUrl) {
    try {
      manifestBuffer = await fetchRemoteBuffer(record.artifactPublicUrl, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.fetchTimeoutMs,
        maxBytes: Math.min(
          options.maxRemoteManifestBytes ?? 2 * 1024 * 1024,
          budget.maxBytes - budget.bytes
        ),
        allowedOrigins: options.allowedRemoteOrigins
      });
    } catch (error) {
      missing.push(`${record.artifactPublicUrl} - ${error instanceof Error ? error.message : "manifest_fetch_failed"}`);
    }
  }
  if (manifestBuffer) {
    try {
      manifest = JSON.parse(manifestBuffer.toString("utf8"));
    } catch {
      missing.push(`${record.artifactPublicUrl ?? manifestPath ?? "manifest"} - manifest_json_invalid`);
    }
  }

  if (manifestBuffer) addEntry(budget, { name: `${folder}/images/manifest.json`, data: manifestBuffer });
  const manifestRecord = asRecord(manifest);
  const inlineHtml = stringValue(manifestRecord.html).trim();
  if (inlineHtml.startsWith("<")) {
    addEntry(budget, textFile(`${folder}/html/index.html`, inlineHtml));
  }
  const references = manifestAssetReferences(manifest);
  const maxAssets = Math.max(0, options.maxAssetsPerRecord ?? DEFAULT_MAX_ASSETS_PER_RECORD);
  if (references.length > maxAssets) missing.push(`asset_count_exceeded:${references.length}`);
  for (const reference of references.slice(0, maxAssets)) {
    let data: Buffer | null = null;
    if (options.storageDir && record.artifactBucket && reference.artifactPath) {
      const localPath = resolveStoragePath(options.storageDir, record.artifactBucket, reference.artifactPath);
      if (localPath) {
        try {
          data = await readLocalBuffer(localPath, Math.min(
            options.maxRemoteFileBytes ?? 100 * 1024 * 1024,
            budget.maxBytes - budget.bytes
          ));
        } catch {
          // Fall through to the public asset URL.
        }
      }
    }
    const remote = remoteUrlForAsset(reference, record.artifactPublicUrl);
    if (!data && remote.error) {
      missing.push(`${reference.url ?? reference.artifactPath ?? reference.fileName} - ${remote.error}`);
    }
    if (!data && remote.url) {
      try {
        data = await fetchRemoteBuffer(remote.url, {
          fetchImpl: options.fetchImpl,
          timeoutMs: options.fetchTimeoutMs,
          maxBytes: Math.min(
            options.maxRemoteFileBytes ?? 100 * 1024 * 1024,
            budget.maxBytes - budget.bytes
          ),
          allowedOrigins: options.allowedRemoteOrigins
        });
      } catch (error) {
        missing.push(`${remote.url} - ${error instanceof Error ? error.message : "asset_fetch_failed"}`);
      }
    }
    if (!data) {
      if (!remote.url && !remote.error) missing.push(`${reference.artifactPath ?? reference.fileName} - asset_unavailable`);
      continue;
    }
    addEntry(budget, {
      name: `${folder}/${zipDirectoryForAsset(reference)}/${path.basename(reference.fileName)}`,
      data
    });
  }
  if (missing.length > 0) {
    addEntry(budget, textFile(`${folder}/missing-files.txt`, `${missing.join("\n")}\n`));
  }
}

async function filesForRecord(record: PublishedResultRecord, options: BuildPublishedResultsPackageOptions, budget: PackageBudget) {
  const output = asRecord(record.outputJson);
  const titleSegment = safeFileSegment(record.title || record.previewTitle || record.id);
  const folder = `${record.channel}/${titleSegment}-${safeFileSegment(record.id)}`;
  const files = [
    jsonFile(`${folder}/output.json`, output),
    textFile(`${folder}/source-summary.txt`, record.sourceSummary ? `${record.sourceSummary}\n` : "")
  ];

  if (record.externalUrl) {
    files.push(textFile(`${folder}/published-url.txt`, `${record.externalUrl}\n`));
  }
  if (record.artifactPublicUrl) {
    files.push(textFile(`${folder}/artifact-url.txt`, `${record.artifactPublicUrl}\n`));
  }

  if (record.channel === "instagram") {
    files.push(...instagramFiles(folder, output, record.previewBody));
  } else if (record.channel === "threads") {
    files.push(...threadsFiles(folder, output, record.previewBody));
  }
  files.forEach((entry) => addEntry(budget, entry));
  await artifactFilesForRecord(record, options, budget, folder);
}

export async function buildPublishedResultsPackage(
  records: PublishedResultRecord[],
  options: BuildPublishedResultsPackageOptions = {},
  now = new Date()
): Promise<DownloadPackage> {
  const maxRecordCount = Math.max(1, options.maxRecordCount ?? DEFAULT_MAX_RECORDS);
  if (records.length > maxRecordCount) throw new Error("download_record_limit_exceeded");
  const date = now.toISOString().slice(0, 10);
  const budget: PackageBudget = {
    maxEntries: Math.max(1, options.maxEntryCount ?? DEFAULT_MAX_ENTRIES),
    maxBytes: Math.max(1, options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES),
    entries: [],
    names: new Set(),
    bytes: 0
  };
  addEntry(budget, textFile("published-summary.csv", summaryCsv(records)));
  for (const record of records) await filesForRecord(record, options, budget);
  return {
    fileName: `brand-pilot-published-results-${date}.zip`,
    mimeType: "application/zip",
    buffer: createZipArchive(budget.entries),
    itemCount: records.length
  };
}
