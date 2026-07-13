import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseWorkerManifest } from "./manifest.js";
import type { InstagramDeliveryFormat } from "./promptBuilder.js";
import type { ClaimedImageJob, ImageRenderer, RenderedImage, RenderedInstagramPackage } from "./worker.js";

const fixturePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

type ImageDimensions = { width: 1080; height: 1080 | 1920 };

async function readPngMetadata(bytes: Buffer) {
  const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => {
    throw new Error("image_render_output_not_png");
  });
  if (metadata.format !== "png" || !metadata.width || !metadata.height) {
    throw new Error("image_render_output_not_png");
  }
  return { width: metadata.width, height: metadata.height };
}

export async function normalizeRenderedPng(
  bytes: Buffer,
  dimensions: ImageDimensions = { width: 1080, height: 1080 }
) {
  const metadata = await readPngMetadata(bytes);
  if (metadata.width * dimensions.height !== metadata.height * dimensions.width) {
    throw new Error("image_render_output_aspect_ratio_invalid");
  }
  return sharp(bytes, { failOn: "error" })
    .resize(dimensions.width, dimensions.height, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function preserveRenderedPng(bytes: Buffer) {
  const metadata = await readPngMetadata(bytes);
  return {
    bytes: await sharp(bytes, { failOn: "error" }).png({ compressionLevel: 9 }).toBuffer(),
    ...metadata
  };
}

function maxImagesFor(job: ClaimedImageJob) {
  const value = Number(job.payload.maxImages);
  if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("image_render_max_images_invalid");
  return value;
}

function deliveryFormatFor(job: ClaimedImageJob): InstagramDeliveryFormat {
  const deliveryFormat = job.payload.deliveryFormat;
  if (
    deliveryFormat !== "instagram_feed_carousel"
    && deliveryFormat !== "instagram_story"
    && deliveryFormat !== "instagram_reel"
  ) {
    throw new Error("image_job_delivery_format_invalid");
  }
  return deliveryFormat;
}

function outputPattern(deliveryFormat: InstagramDeliveryFormat) {
  switch (deliveryFormat) {
    case "instagram_feed_carousel": return /^card-\d{2}\.png$/i;
    case "instagram_story": return /^story\.png$/i;
    case "instagram_reel": return /^scene-\d{2}\.png$/i;
  }
}

function outputName(deliveryFormat: InstagramDeliveryFormat, index: number) {
  switch (deliveryFormat) {
    case "instagram_feed_carousel": return `card-${String(index).padStart(2, "0")}.png`;
    case "instagram_story": return "story.png";
    case "instagram_reel": return `scene-${String(index).padStart(2, "0")}.png`;
  }
}

export async function loadRenderedPackage(
  job: ClaimedImageJob,
  outputDir: string
): Promise<RenderedInstagramPackage> {
  const deliveryFormat = deliveryFormatFor(job);
  const maxImages = maxImagesFor(job);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(path.join(outputDir, "content.json"), "utf8"));
  } catch {
    throw new Error("image_render_content_missing");
  }
  const manifest = parseWorkerManifest(rawManifest, { maxImages });
  if (manifest.deliveryFormat !== deliveryFormat) throw new Error("delivery_format_mismatch");
  if (manifest.promptVersion !== job.payload.promptVersion) throw new Error("prompt_version_mismatch");

  const generatedFiles = (await readdir(outputDir)).filter((file) => outputPattern(deliveryFormat).test(file));
  if (generatedFiles.length !== manifest.selectedAssetCount) {
    throw new Error("image_render_output_count_mismatch");
  }

  const images = await Promise.all(manifest.assets.map(async (asset): Promise<RenderedImage> => {
    const source = await readFile(path.join(outputDir, outputName(deliveryFormat, asset.index)));
    if (deliveryFormat === "instagram_feed_carousel") {
      return {
        index: asset.index,
        bytes: await normalizeRenderedPng(source, { width: 1080, height: 1080 }),
        mimeType: "image/png",
        width: 1080,
        height: 1080
      };
    }
    const preserved = await preserveRenderedPng(source);
    return {
      index: asset.index,
      bytes: preserved.bytes,
      mimeType: "image/png",
      width: preserved.width,
      height: preserved.height
    };
  }));
  return { manifest, images };
}

export function createFixtureRenderer(): ImageRenderer {
  return {
    async renderJob(job) {
      const deliveryFormat = deliveryFormatFor(job);
      const height = deliveryFormat === "instagram_feed_carousel" ? 1080 as const : 1920 as const;
      const promptVersion = deliveryFormat === "instagram_feed_carousel"
        ? "worker-card.v4" as const
        : deliveryFormat === "instagram_story"
          ? "worker-story.v1" as const
          : "worker-reel.v3" as const;
      const asset = { index: 1, role: "hook", embeddedText: "test asset", width: 1080, height };
      const rawManifest = deliveryFormat === "instagram_feed_carousel"
        ? {
            deliveryFormat,
            promptVersion,
            selectedAssetCount: 1,
            caption: "fixture first paragraph\n\nfixture second paragraph",
            hashtags: ["#test1", "#test2", "#test3", "#test4", "#test5"],
            cards: [asset]
          }
        : deliveryFormat === "instagram_story"
          ? { deliveryFormat, promptVersion, selectedAssetCount: 1, story: [asset] }
          : {
              deliveryFormat,
              promptVersion,
              selectedAssetCount: 1,
              caption: "fixture first paragraph\n\nfixture second paragraph",
              hashtags: ["#test1", "#test2", "#test3", "#test4", "#test5"],
              scenes: [asset]
            };
      const fixtureBytes = deliveryFormat === "instagram_feed_carousel"
        ? fixturePng
        : await sharp({ create: { width: 9, height: 16, channels: 4, background: "#ffffff" } }).png().toBuffer();
      return {
        manifest: parseWorkerManifest(rawManifest),
        images: [{
          index: 1,
          bytes: await normalizeRenderedPng(fixtureBytes, { width: 1080, height }),
          mimeType: "image/png",
          width: 1080,
          height
        }]
      };
    }
  };
}

export function createConfiguredRenderer({
  provider,
  commandTemplate,
  nodeEnv
}: {
  provider: string;
  commandTemplate?: string;
  nodeEnv?: string;
}): ImageRenderer {
  if (provider === "fixture") {
    if (nodeEnv !== "test") throw new Error("fixture_renderer_test_only");
    return createFixtureRenderer();
  }
  if (provider !== "command") throw new Error("image_provider_unsupported");
  if (!commandTemplate) throw new Error("IMAGE_RENDER_COMMAND_required");
  return createCommandRenderer(commandTemplate);
}

export function createCommandRenderer(commandTemplate: string): ImageRenderer {
  return {
    async renderJob(job: ClaimedImageJob): Promise<RenderedInstagramPackage> {
      const workDir = await mkdtemp(path.join(os.tmpdir(), "brand-pilot-image-job-"));
      try {
        const jobFile = path.join(workDir, "job.json");
        const outputDir = path.join(workDir, "output");
        await mkdir(outputDir, { recursive: true });
        await writeFile(jobFile, JSON.stringify(job.payload, null, 2), "utf8");
        const command = commandTemplate.replaceAll("{{jobFile}}", jobFile).replaceAll("{{outputDir}}", outputDir);
        await new Promise<void>((resolve, reject) => {
          const child = spawn(command, { shell: true, stdio: "inherit" });
          child.once("error", reject);
          child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`image_render_command_failed:${code ?? "unknown"}`)));
        });
        return await loadRenderedPackage(job, outputDir);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  };
}
