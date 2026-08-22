import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import sharp from "sharp";
import type { AiContentRenderedAsset } from "./aiContentRenderClient.js";
import type { InstagramDeliveryFormat } from "./promptBuilder.js";
import type { ClaimedImageJob, ImageStorage, RenderedInstagramPackage } from "./worker.js";

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`image_job_${key}_required`);
  return value.trim();
}

function pathSegment(value: string, key: string) {
  const segment = value.trim();
  if (!segment || segment === "." || segment === ".." || /[\\/]/.test(segment)) {
    throw new Error(`image_job_${key}_invalid`);
  }
  return segment;
}

function deliveryFormatFor(job: ClaimedImageJob): InstagramDeliveryFormat {
  const deliveryFormat = requiredString(job.payload, "deliveryFormat");
  if (
    deliveryFormat !== "instagram_feed_carousel"
    && deliveryFormat !== "instagram_story"
    && deliveryFormat !== "instagram_reel"
  ) {
    throw new Error("image_job_delivery_format_unsupported");
  }
  return deliveryFormat;
}

function imageName(deliveryFormat: InstagramDeliveryFormat, index: number) {
  switch (deliveryFormat) {
    case "instagram_feed_carousel": return `card-${String(index).padStart(2, "0")}.png`;
    case "instagram_story": return "story.png";
    case "instagram_reel": return `scene-${String(index).padStart(2, "0")}.png`;
  }
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createBlobStorage({ token, model }: { token: string; model: string }): ImageStorage {
  return {
    async upload(job: ClaimedImageJob, rendered: RenderedInstagramPackage) {
      try {
        const deliveryFormat = deliveryFormatFor(job);
        if (rendered.manifest.deliveryFormat !== deliveryFormat) throw new Error("delivery_format_mismatch");
        const promptVersion = requiredString(job.payload, "promptVersion");
        if (rendered.manifest.promptVersion !== promptVersion) throw new Error("prompt_version_mismatch");
        if (!rendered.source) throw new Error("image_job_source_result_required");

        const brandId = pathSegment(job.brandId, "brandId");
        const contentTopicId = pathSegment(requiredString(job.payload, "contentTopicId"), "contentTopicId");
        const jobId = pathSegment(job.id, "jobId");
        const storagePrefix = `brands/${brandId}/topics/${contentTopicId}/${deliveryFormat}/${jobId}`;
        const imageChecksums = rendered.images.map((image) => sha256(image.bytes));
        if (new Set(imageChecksums).size !== imageChecksums.length) {
          throw new Error("asset_checksum_duplicate");
        }
        const uploadedAssets = [];
        for (const [offset, image] of rendered.images.entries()) {
          const manifestAsset = rendered.manifest.assets[offset];
          if (!manifestAsset || manifestAsset.index !== image.index) throw new Error("image_render_output_count_mismatch");
          const pathname = `${storagePrefix}/${imageName(deliveryFormat, image.index)}`;
          const uploaded = await put(pathname, image.bytes, {
            access: "public",
            token,
            contentType: image.mimeType,
            addRandomSuffix: false,
            allowOverwrite: true
          });
          uploadedAssets.push({
            index: image.index,
            role: manifestAsset.role,
            embeddedText: manifestAsset.embeddedText,
            url: uploaded.url,
            mimeType: image.mimeType,
            width: image.width,
            height: image.height,
            checksum: imageChecksums[offset]
          });
        }
        if (uploadedAssets.length !== rendered.manifest.selectedAssetCount) {
          throw new Error("image_render_output_count_mismatch");
        }

        const representativeUrl = typeof job.payload.representativeUrl === "string"
          && job.payload.representativeUrl.trim().length > 0
          ? job.payload.representativeUrl.trim()
          : null;
        const commonManifest = {
          jobId: job.id,
          channelOutputId: job.channelOutputId,
          model,
          deliveryFormat,
          promptVersion,
          representativeUrl,
          sourceMode: rendered.source.sourceMode,
          fetchStatus: rendered.source.fetchStatus,
          selectedAssetCount: rendered.manifest.selectedAssetCount,
          validation: rendered.manifest.validation
        };

        let manifest: Record<string, unknown>;
        if (rendered.manifest.deliveryFormat === "instagram_feed_carousel") {
          manifest = {
            ...commonManifest,
            caption: rendered.manifest.caption,
            hashtags: rendered.manifest.hashtags,
            images: uploadedAssets,
            cards: uploadedAssets
          };
        } else if (rendered.manifest.deliveryFormat === "instagram_story") {
          manifest = { ...commonManifest, story: uploadedAssets[0] };
        } else {
          if (!rendered.reel) throw new Error("reel_renderer_required");
          const uploadedCover = await put(`${storagePrefix}/cover.png`, rendered.reel.cover.bytes, {
            access: "public",
            token,
            contentType: rendered.reel.cover.mimeType,
            addRandomSuffix: false,
            allowOverwrite: true
          });
          const uploadedVideo = await put(`${storagePrefix}/reel.mp4`, rendered.reel.video.bytes, {
            access: "public",
            token,
            contentType: rendered.reel.video.mimeType,
            addRandomSuffix: false,
            allowOverwrite: true
          });
          manifest = {
            ...commonManifest,
            caption: rendered.manifest.caption,
            hashtags: rendered.manifest.hashtags,
            scenes: uploadedAssets,
            cover: {
              url: uploadedCover.url,
              mimeType: rendered.reel.cover.mimeType,
              width: rendered.reel.cover.width,
              height: rendered.reel.cover.height,
              checksum: sha256(rendered.reel.cover.bytes)
            },
            video: {
              url: uploadedVideo.url,
              mimeType: rendered.reel.video.mimeType,
              width: rendered.reel.video.width,
              height: rendered.reel.video.height,
              videoCodec: rendered.reel.video.videoCodec,
              audioCodec: rendered.reel.video.audioCodec,
              fps: rendered.reel.video.fps,
              checksum: sha256(rendered.reel.video.bytes)
            }
          };
        }

        const uploadedManifest = await put(`${storagePrefix}/manifest.json`, JSON.stringify(manifest), {
          access: "public",
          token,
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true
        });
        return { manifestUrl: uploadedManifest.url };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`blob_upload_failed:${message}`);
      }
    }
  };
}

export interface AiContentBlobStorage {
  readOwned(storagePath: string, constraints?: AiContentOwnedBlobReadConstraints): Promise<Buffer>;
  uploadAsset(input: { path: string; bytes: Buffer; index: number; width: number; height: number }): Promise<AiContentRenderedAsset>;
  uploadVideo(input: { path: string; bytes: Buffer; width: number; height: number; durationSeconds: number; videoCodec: "h264"; audioCodec: "aac"; fps: 30 }): Promise<{ url: string; checksum: string }>;
  uploadText(input: { path: string; text: string; contentType: "text/html; charset=utf-8" | "application/json" }): Promise<{ url: string; checksum: string }>;
}

export interface AiContentOwnedBlobReadConstraints {
  maxBytes: number;
  expectedSizeBytes: number;
  expectedContentType: "image/png" | "image/jpeg" | "image/webp";
}

export const AI_CONTENT_OWNED_IMAGE_MAX_BYTES = 5_000_000;

function ownedPath(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some((segment) => !segment || segment === "." || segment === "..") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new Error("ai_content_owned_blob_path_invalid");
  }
  return value;
}

function isBlobAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  const status = Number(value.status ?? value.statusCode);
  const code = typeof value.code === "string" ? value.code : "";
  const message = error instanceof Error ? error.message : "";
  return status === 409 || /already.?exists|conflict/i.test(`${code} ${message}`);
}

async function bufferFromBlobResult(result: Awaited<ReturnType<typeof get>>): Promise<Buffer | null> {
  if (!result || result.statusCode === 304 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

function normalizedImageContentType(value: unknown): "image/png" | "image/jpeg" | "image/webp" | null {
  if (typeof value !== "string") return null;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/png" || normalized === "image/x-png") return "image/png";
  if (normalized === "image/jpeg" || normalized === "image/jpg" || normalized === "image/pjpeg") return "image/jpeg";
  if (normalized === "image/webp" || normalized === "image/x-webp") return "image/webp";
  return null;
}

function assertDeclaredReadConstraints(constraints: AiContentOwnedBlobReadConstraints): void {
  if (!Number.isSafeInteger(constraints.maxBytes) || constraints.maxBytes < 1
    || !Number.isSafeInteger(constraints.expectedSizeBytes) || constraints.expectedSizeBytes < 1) {
    throw new Error("ai_content_owned_blob_size_mismatch");
  }
  if (constraints.expectedSizeBytes > Math.min(constraints.maxBytes, AI_CONTENT_OWNED_IMAGE_MAX_BYTES)) {
    throw new Error("ai_content_owned_blob_size_limit_exceeded");
  }
  if (normalizedImageContentType(constraints.expectedContentType) !== constraints.expectedContentType) {
    throw new Error("ai_content_owned_blob_content_type_mismatch");
  }
}

function assertBlobMetadata(
  result: NonNullable<Awaited<ReturnType<typeof get>>>,
  constraints: AiContentOwnedBlobReadConstraints,
): void {
  const metadataSize = result.blob.size;
  if (typeof metadataSize !== "number" || !Number.isSafeInteger(metadataSize) || metadataSize < 1) {
    throw new Error("ai_content_owned_blob_size_mismatch");
  }
  if (metadataSize > Math.min(constraints.maxBytes, AI_CONTENT_OWNED_IMAGE_MAX_BYTES)) {
    throw new Error("ai_content_owned_blob_size_limit_exceeded");
  }
  if (metadataSize !== constraints.expectedSizeBytes) throw new Error("ai_content_owned_blob_size_mismatch");
  const metadataContentType = normalizedImageContentType(result.blob.contentType);
  if (metadataContentType === null || metadataContentType !== constraints.expectedContentType) {
    throw new Error("ai_content_owned_blob_content_type_mismatch");
  }
}

export function createAiContentBlobStorage({ token }: { token: string }): AiContentBlobStorage {
  const read = async (storagePath: string, constraints?: AiContentOwnedBlobReadConstraints) => {
    const pathname = ownedPath(storagePath);
    if (constraints) assertDeclaredReadConstraints(constraints);
    const result = await get(pathname, { access: "public", token, useCache: false });
    if (constraints && result && result.statusCode !== 304) assertBlobMetadata(result, constraints);
    const bytes = await bufferFromBlobResult(result);
    return { result, bytes };
  };
  return {
    async readOwned(storagePath, constraints) {
      const { bytes } = await read(storagePath, constraints);
      if (!bytes) throw new Error("ai_content_owned_blob_unavailable");
      return bytes;
    },
    async uploadAsset(input) {
      const pathname = ownedPath(input.path);
      const checksum = sha256(input.bytes);
      const existing = await read(pathname);
      if (existing.bytes) {
        const metadata = await sharp(existing.bytes, { failOn: "error" }).metadata().catch(() => null);
        if (
          sha256(existing.bytes) !== checksum || metadata?.format !== "png"
          || metadata.width !== input.width || metadata.height !== input.height
          || existing.result?.blob.contentType !== "image/png"
        ) throw new Error("ai_content_asset_storage_conflict");
        return { index: input.index, url: existing.result.blob.url, storagePath: pathname, mimeType: "image/png", width: input.width, height: input.height, checksum };
      }
      const uploaded = await put(pathname, input.bytes, { access: "public", token, contentType: "image/png", addRandomSuffix: false, allowOverwrite: false });
      return { index: input.index, url: uploaded.url, storagePath: pathname, mimeType: "image/png", width: input.width, height: input.height, checksum };
    },
    async uploadVideo(input) {
      const pathname = ownedPath(input.path);
      const checksum = sha256(input.bytes);
      const existing = await read(pathname);
      if (existing.bytes) {
        if (sha256(existing.bytes) !== checksum || existing.result?.blob.contentType !== "video/mp4") {
          throw new Error("ai_content_package_storage_conflict");
        }
        return { url: existing.result.blob.url, checksum };
      }
      try {
        const uploaded = await put(pathname, input.bytes, { access: "public", token, contentType: "video/mp4", addRandomSuffix: false, allowOverwrite: false });
        return { url: uploaded.url, checksum };
      } catch (error) {
        if (!isBlobAlreadyExists(error)) throw error;
        let concurrent: Awaited<ReturnType<typeof read>>;
        try { concurrent = await read(pathname); } catch { throw error; }
        if (!concurrent.bytes) throw error;
        if (sha256(concurrent.bytes) !== checksum || concurrent.result?.blob.contentType !== "video/mp4") {
          throw new Error("ai_content_package_storage_conflict");
        }
        return { url: concurrent.result.blob.url, checksum };
      }
    },
    async uploadText(input) {
      const pathname = ownedPath(input.path);
      const bytes = Buffer.from(input.text, "utf8");
      const checksum = sha256(bytes);
      const existing = await read(pathname);
      if (existing.bytes) {
        if (sha256(existing.bytes) !== checksum) throw new Error("ai_content_package_storage_conflict");
        return { url: existing.result!.blob.url, checksum };
      }
      const uploaded = await put(pathname, bytes, { access: "public", token, contentType: input.contentType, addRandomSuffix: false, allowOverwrite: false });
      return { url: uploaded.url, checksum };
    },
  };
}
