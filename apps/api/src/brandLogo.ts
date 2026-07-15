import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BrandProfileDto } from "./types.js";

const maxLogoBytes = 2 * 1024 * 1024;
export const brandLogoRequestBodyLimit = 3 * 1024 * 1024;
const mimeExtensions = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

export interface BrandLogoUploadInput {
  fileName: string;
  mimeType: string;
  fileBase64: string;
}

interface ParsedBrandLogoUpload {
  fileName: string;
  mimeType: keyof typeof mimeExtensions;
  extension: (typeof mimeExtensions)[keyof typeof mimeExtensions];
  bytes: Buffer;
}

export interface BrandLogoStorage {
  upload(path: string, bytes: Buffer, mimeType: string): Promise<{ publicUrl: string }>;
  remove(path: string): Promise<void>;
}

export interface BrandLogoProfileStore {
  getContext(brandId: string): Promise<{ workspaceId: string }>;
  replace(brandId: string, input: { logoUrl: string; logoStoragePath: string }): Promise<{
    previousStoragePath: string | null;
    profile: BrandProfileDto;
  }>;
  clear(brandId: string): Promise<{ previousStoragePath: string | null; profile: BrandProfileDto }>;
}

export interface BrandLogoService {
  upload(brandId: string, input: BrandLogoUploadInput): Promise<BrandProfileDto>;
  remove(brandId: string): Promise<BrandProfileDto>;
}

function isPng(bytes: Buffer) {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(bytes: Buffer) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Buffer) {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function imageBytesMatchMime(bytes: Buffer, mimeType: keyof typeof mimeExtensions) {
  if (mimeType === "image/png") return isPng(bytes);
  if (mimeType === "image/jpeg") return isJpeg(bytes);
  return isWebp(bytes);
}

export function parseBrandLogoUpload(input: BrandLogoUploadInput): ParsedBrandLogoUpload {
  const mimeType = input.mimeType.trim().toLowerCase();
  if (!(mimeType in mimeExtensions)) throw new Error("brand_logo_unsupported_type");
  if (!input.fileName.trim() || input.fileName.length > 255) throw new Error("brand_logo_invalid_file");

  const normalized = input.fileBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!normalized || !/^[a-z0-9+/]*={0,2}$/i.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("brand_logo_invalid_file");
  }
  if (normalized.length > Math.ceil(maxLogoBytes / 3) * 4 + 4) throw new Error("brand_logo_file_too_large");

  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length > maxLogoBytes) throw new Error("brand_logo_file_too_large");
  if (!imageBytesMatchMime(bytes, mimeType as keyof typeof mimeExtensions)) throw new Error("brand_logo_invalid_file");
  return {
    fileName: input.fileName,
    mimeType: mimeType as keyof typeof mimeExtensions,
    extension: mimeExtensions[mimeType as keyof typeof mimeExtensions],
    bytes
  };
}

export function createBrandLogoService({
  storage,
  store,
  uuid = randomUUID,
  onCleanupError = (error, path) => console.warn("brand_logo_cleanup_failed", { path, error })
}: {
  storage: BrandLogoStorage;
  store: BrandLogoProfileStore;
  uuid?: () => string;
  onCleanupError?: (error: unknown, path: string) => void;
}): BrandLogoService {
  async function removeQuietly(path: string) {
    try {
      await storage.remove(path);
    } catch (error) {
      onCleanupError(error, path);
    }
  }

  return {
    async upload(brandId, input) {
      const parsed = parseBrandLogoUpload(input);
      const context = await store.getContext(brandId);
      const path = `${context.workspaceId}/${brandId}/logo-${uuid()}.${parsed.extension}`;
      const uploaded = await storage.upload(path, parsed.bytes, parsed.mimeType);
      let replaced: Awaited<ReturnType<BrandLogoProfileStore["replace"]>>;
      try {
        replaced = await store.replace(brandId, { logoUrl: uploaded.publicUrl, logoStoragePath: path });
      } catch (error) {
        await removeQuietly(path);
        throw error;
      }
      if (replaced.previousStoragePath && replaced.previousStoragePath !== path) {
        await removeQuietly(replaced.previousStoragePath);
      }
      return replaced.profile;
    },

    async remove(brandId) {
      const cleared = await store.clear(brandId);
      if (cleared.previousStoragePath) await removeQuietly(cleared.previousStoragePath);
      return cleared.profile;
    }
  };
}

export function createPostgresBrandLogoStore(
  pool: Pool,
  getBrandProfile: (brandId: string) => Promise<BrandProfileDto>
): BrandLogoProfileStore {
  async function updateLogo(brandId: string, logo: { logoUrl: string | null; logoStoragePath: string | null }) {
    const client = await pool.connect();
    let previousStoragePath: string | null = null;
    try {
      await client.query("begin");
      const current = await client.query(
        `select bp.logo_storage_path
         from brands b
         join brand_profiles bp on bp.brand_id = b.id
         where b.id = $1 and b.deleted_at is null
         for update of bp`,
        [brandId]
      );
      if (!current.rowCount) throw new Error("brand_profile_not_found");
      previousStoragePath = current.rows[0].logo_storage_path ?? null;
      await client.query(
        `update brand_profiles
         set logo_url = $2, logo_storage_path = $3, updated_at = now()
         where brand_id = $1`,
        [brandId, logo.logoUrl, logo.logoStoragePath]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { previousStoragePath, profile: await getBrandProfile(brandId) };
  }

  return {
    async getContext(brandId) {
      const result = await pool.query(
        `select b.workspace_id
         from brands b
         join brand_profiles bp on bp.brand_id = b.id
         where b.id = $1 and b.deleted_at is null`,
        [brandId]
      );
      if (!result.rowCount) throw new Error("brand_profile_not_found");
      return { workspaceId: result.rows[0].workspace_id };
    },
    replace(brandId, input) {
      return updateLogo(brandId, input);
    },
    clear(brandId) {
      return updateLogo(brandId, { logoUrl: null, logoStoragePath: null });
    }
  };
}

function encodedStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function createSupabaseBrandLogoStorage({
  supabaseUrl = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  bucket = process.env.SUPABASE_BRAND_ASSETS_BUCKET ?? "brand-assets",
  fetcher = fetch
}: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  bucket?: string;
  fetcher?: typeof fetch;
} = {}): BrandLogoStorage {
  function configuration() {
    if (!supabaseUrl?.trim() || !serviceRoleKey?.trim()) throw new Error("brand_logo_storage_not_configured");
    return { baseUrl: supabaseUrl.replace(/\/$/, ""), key: serviceRoleKey };
  }

  return {
    async upload(path, bytes, mimeType) {
      const { baseUrl, key } = configuration();
      const objectPath = `${encodeURIComponent(bucket)}/${encodedStoragePath(path)}`;
      const response = await fetcher(`${baseUrl}/storage/v1/object/${objectPath}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          apikey: key,
          "content-type": mimeType,
          "x-upsert": "false"
        },
        body: new Blob([Uint8Array.from(bytes)], { type: mimeType })
      });
      if (!response.ok) throw new Error("brand_logo_storage_upload_failed");
      return { publicUrl: `${baseUrl}/storage/v1/object/public/${objectPath}` };
    },

    async remove(path) {
      const { baseUrl, key } = configuration();
      const objectPath = `${encodeURIComponent(bucket)}/${encodedStoragePath(path)}`;
      const response = await fetcher(`${baseUrl}/storage/v1/object/${objectPath}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${key}`, apikey: key }
      });
      if (!response.ok && response.status !== 404) throw new Error("brand_logo_storage_delete_failed");
    }
  };
}
