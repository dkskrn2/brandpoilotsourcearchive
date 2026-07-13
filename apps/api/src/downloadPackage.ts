import { readFile } from "node:fs/promises";
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
  const storageRoot = path.resolve(storageDir);
  const relativePath = artifactPath.replace(/\\/g, "/").startsWith(`${bucket}/`)
    ? artifactPath
    : path.join(bucket, artifactPath);
  const absolutePath = path.resolve(storageRoot, relativePath);
  if (absolutePath !== storageRoot && !absolutePath.startsWith(`${storageRoot}${path.sep}`)) {
    return null;
  }
  return absolutePath;
}

function imagePathsFromManifest(manifest: unknown) {
  const record = asRecord(manifest);
  const images = Array.isArray(record.images) ? record.images : [];
  return images
    .map((image) => asRecord(image).path)
    .filter((imagePath): imagePath is string => typeof imagePath === "string" && imagePath.length > 0);
}

async function artifactFilesForRecord(
  record: PublishedResultRecord,
  folder: string,
  options: BuildPublishedResultsPackageOptions
): Promise<ZipEntry[]> {
  if (!options.storageDir || !record.artifactBucket || !record.artifactPath) {
    return [];
  }
  const manifestPath = resolveStoragePath(options.storageDir, record.artifactBucket, record.artifactPath);
  if (!manifestPath) {
    return [];
  }

  try {
    const manifestBuffer = await readFile(manifestPath);
    const files = [{ name: `${folder}/images/manifest.json`, data: manifestBuffer }];
    const manifest = JSON.parse(manifestBuffer.toString("utf8")) as unknown;
    for (const imagePath of imagePathsFromManifest(manifest)) {
      const absoluteImagePath = resolveStoragePath(options.storageDir, record.artifactBucket, imagePath);
      if (!absoluteImagePath) continue;
      try {
        files.push({
          name: `${folder}/images/${path.basename(imagePath)}`,
          data: await readFile(absoluteImagePath)
        });
      } catch {
        // A missing local image should not block downloading the rest of the package.
      }
    }
    return files;
  } catch {
    return [];
  }
}

async function filesForRecord(record: PublishedResultRecord, options: BuildPublishedResultsPackageOptions): Promise<ZipEntry[]> {
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
  files.push(...await artifactFilesForRecord(record, folder, options));

  return files;
}

export async function buildPublishedResultsPackage(
  records: PublishedResultRecord[],
  options: BuildPublishedResultsPackageOptions = {},
  now = new Date()
): Promise<DownloadPackage> {
  const date = now.toISOString().slice(0, 10);
  const entries = [
    textFile("published-summary.csv", summaryCsv(records)),
    ...(await Promise.all(records.map((record) => filesForRecord(record, options)))).flat()
  ];
  return {
    fileName: `brand-pilot-published-results-${date}.zip`,
    mimeType: "application/zip",
    buffer: createZipArchive(entries),
    itemCount: records.length
  };
}
