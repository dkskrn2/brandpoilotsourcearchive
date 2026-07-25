import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
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
