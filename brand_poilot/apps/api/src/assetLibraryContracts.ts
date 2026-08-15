export type ReferenceKind =
  | "saved_brand" | "saved_content" | "trend" | "meta_ad" | "external_url" | "upload" | "owned_performance";
export type ContentPurpose = "informational" | "marketing" | "both";

const SHA256 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FILE_NAME = /^[\p{L}\p{N}._ -]+$/u;
const referenceKinds = new Set<ReferenceKind>([
  "saved_brand", "saved_content", "trend", "meta_ad", "external_url", "upload", "owned_performance",
]);
const contentPurposes = new Set<ContentPurpose>(["informational", "marketing", "both"]);

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function unknownKey(row: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const key = Object.keys(row).find((candidate) => !allowed.includes(candidate));
  if (key) throw new Error(`${prefix}:${key}`);
}

function text(value: unknown, code: string, required = true, maximum = 500): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum) throw new Error(code);
  return normalized;
}

export function parseReservedAvatarId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("asset_library_upload_scope_invalid");
  }
  return value.toLowerCase();
}

export interface AvatarInput { name: string; description: string; }
export function parseAvatarInput(value: unknown): AvatarInput {
  const row = object(value, "avatar_validation_failed:root");
  unknownKey(row, ["name", "description"], "avatar_validation_failed");
  return {
    name: text(row.name, "avatar_validation_failed:name", true, 120),
    description: row.description === undefined
      ? ""
      : text(row.description, "avatar_validation_failed:description", false, 2_000),
  };
}

export interface CreateAvatarInput extends AvatarInput {
  avatarId: string;
  imageSessionIds: string[];
  representativeSessionId: string;
}
export function parseCreateAvatarInput(value: unknown): CreateAvatarInput {
  const row = object(value, "avatar_validation_failed:root");
  unknownKey(
    row,
    ["avatarId", "name", "description", "imageSessionIds", "representativeSessionId"],
    "avatar_validation_failed",
  );
  const base = parseAvatarInput({ name: row.name, description: row.description });
  if (typeof row.avatarId !== "string" || !UUID.test(row.avatarId)) {
    throw new Error("avatar_validation_failed:avatarId");
  }
  if (!Array.isArray(row.imageSessionIds) || row.imageSessionIds.length < 1
    || row.imageSessionIds.length > 5
    || row.imageSessionIds.some((id) => typeof id !== "string" || !UUID.test(id))
    || new Set(row.imageSessionIds).size !== row.imageSessionIds.length) {
    throw new Error("avatar_validation_failed:imageSessionIds");
  }
  if (typeof row.representativeSessionId !== "string"
    || !row.imageSessionIds.includes(row.representativeSessionId)) {
    throw new Error("avatar_validation_failed:representativeSessionId");
  }
  return {
    avatarId: row.avatarId.toLowerCase(),
    ...base,
    imageSessionIds: row.imageSessionIds.map((id) => String(id).toLowerCase()),
    representativeSessionId: row.representativeSessionId.toLowerCase(),
  };
}

export interface AssetUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}
export function parseAssetUploadInput(value: unknown): AssetUploadInput {
  const row = object(value, "asset_upload_validation_failed:root");
  unknownKey(row, ["fileName", "mimeType", "sizeBytes", "checksum"], "asset_upload_validation_failed");
  const fileName = text(row.fileName, "asset_upload_validation_failed:fileName", true, 160);
  if (!SAFE_FILE_NAME.test(fileName) || /[\\/\0\r\n]/.test(fileName) || fileName.includes("..")
    || fileName.startsWith(".") || fileName.endsWith(".")) {
    throw new Error("asset_upload_validation_failed:fileName");
  }
  const mimeType = text(row.mimeType, "asset_upload_validation_failed:mimeType", true, 160).toLowerCase();
  if (!Number.isSafeInteger(row.sizeBytes) || Number(row.sizeBytes) <= 0) {
    throw new Error("asset_upload_validation_failed:sizeBytes");
  }
  const checksum = text(row.checksum, "asset_upload_validation_failed:checksum", true, 64).toLowerCase();
  if (!SHA256.test(checksum)) throw new Error("asset_upload_validation_failed:checksum");
  return { fileName, mimeType, sizeBytes: Number(row.sizeBytes), checksum };
}

export interface ReferenceUrlInput {
  url: string;
  contentPurpose: ContentPurpose;
  title: string;
}
export function parseReferenceUrlInput(value: unknown): ReferenceUrlInput {
  const row = object(value, "reference_validation_failed:root");
  unknownKey(row, ["url", "contentPurpose", "title"], "reference_validation_failed");
  const rawUrl = text(row.url, "reference_validation_failed:url", true, 2_000);
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("reference_validation_failed:url"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("reference_validation_failed:url");
  if (!contentPurposes.has(row.contentPurpose as ContentPurpose)) {
    throw new Error("reference_validation_failed:contentPurpose");
  }
  return {
    url: url.toString(),
    contentPurpose: row.contentPurpose as ContentPurpose,
    title: row.title === undefined ? "" : text(row.title, "reference_validation_failed:title", false, 500),
  };
}

export interface ReferenceFilters {
  q?: string;
  collection?: "all" | "content" | "trend";
  kind?: ReferenceKind;
  contentFamily?: string;
  strategy?: string;
  format?: string;
  origin?: string;
  favorite?: boolean;
  recent?: number;
}
export function parseReferenceFilters(value: unknown): ReferenceFilters {
  const row = object(value ?? {}, "reference_filter_invalid:root");
  unknownKey(row, ["q", "collection", "kind", "contentFamily", "strategy", "format", "origin", "favorite", "recent"], "reference_filter_invalid");
  const result: ReferenceFilters = {};
  if (row.q !== undefined) result.q = text(row.q, "reference_filter_invalid:q", true, 200);
  if (row.collection !== undefined) {
    if (!new Set(["all", "content", "trend"]).has(String(row.collection))) {
      throw new Error("reference_filter_invalid:collection");
    }
    result.collection = row.collection as "all" | "content" | "trend";
  }
  if (row.kind !== undefined) {
    if (!referenceKinds.has(row.kind as ReferenceKind)) throw new Error("reference_filter_invalid:kind");
    result.kind = row.kind as ReferenceKind;
  }
  for (const field of ["contentFamily", "strategy", "format", "origin"] as const) {
    if (row[field] !== undefined) result[field] = text(row[field], `reference_filter_invalid:${field}`, true, 120);
  }
  if (row.favorite !== undefined) {
    if (row.favorite !== true && row.favorite !== false && row.favorite !== "true" && row.favorite !== "false") {
      throw new Error("reference_filter_invalid:favorite");
    }
    result.favorite = row.favorite === true || row.favorite === "true";
  }
  if (row.recent !== undefined) {
    const recent = typeof row.recent === "string" && /^\d+$/.test(row.recent)
      ? Number(row.recent) : row.recent;
    if (!Number.isInteger(recent) || Number(recent) < 1 || Number(recent) > 365) {
      throw new Error("reference_filter_invalid:recent");
    }
    result.recent = Number(recent);
  }
  return result;
}

export interface ReferenceBrandInput {
  platform: string;
  handle: string;
  publicSourceUrl: string;
}
export function parseReferenceBrandInput(value: unknown): ReferenceBrandInput {
  const row = object(value, "reference_brand_validation_failed:root");
  unknownKey(row, ["platform", "handle", "publicSourceUrl"], "reference_brand_validation_failed");
  const platform = text(row.platform, "reference_brand_validation_failed:platform", true, 40).toLowerCase();
  let handle = row.handle === undefined ? "" : text(row.handle, "reference_brand_validation_failed:handle", true, 120);
  let source = row.publicSourceUrl === undefined
    ? ""
    : text(row.publicSourceUrl, "reference_brand_validation_failed:publicSourceUrl", true, 2_000);
  if (source) {
    let url: URL;
    try { url = new URL(source); } catch { throw new Error("reference_brand_validation_failed:publicSourceUrl"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("reference_brand_validation_failed:publicSourceUrl");
    source = url.toString();
    if (!handle) handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
  }
  handle = handle.replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(handle)) throw new Error("reference_brand_validation_failed:handle");
  if (!source) {
    if (platform !== "instagram") throw new Error("reference_brand_validation_failed:publicSourceUrl");
    source = `https://www.instagram.com/${handle}/`;
  }
  return { platform, handle, publicSourceUrl: source };
}

export function parseBooleanAction(value: unknown, field: string): boolean {
  const row = object(value, `reference_validation_failed:${field}`);
  unknownKey(row, [field], "reference_validation_failed");
  if (typeof row[field] !== "boolean") throw new Error(`reference_validation_failed:${field}`);
  return row[field];
}
