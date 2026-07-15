export interface ClaimedImageJob {
  id: string;
  leaseToken: string;
  brandId: string;
  channelOutputId: string;
  payload: Record<string, unknown>;
}

import {
  parseWorkerManifest,
  WorkerManifestValidationError,
  type ValidatedWorkerManifest
} from "./manifest.js";
import {
  buildWorkerPrompt,
  type BuildWorkerPromptInput,
  type InstagramDeliveryFormat,
  type WorkerPromptVersion
} from "./promptBuilder.js";
import { readRepresentativeSource, type SourceReadResult } from "./sourceReader.js";

export interface RenderedImage {
  index: number;
  bytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
}

export interface RenderedReelMedia {
  cover: {
    bytes: Buffer;
    mimeType: "image/png";
    width: 1080;
    height: 1920;
  };
  video: {
    bytes: Buffer;
    mimeType: "video/mp4";
    width: 1080;
    height: 1920;
    videoCodec: "h264";
    audioCodec: "aac";
    fps: 30;
  };
}

export interface RenderedInstagramPackage {
  manifest: ValidatedWorkerManifest;
  images: RenderedImage[];
  source?: SourceReadResult;
  reel?: RenderedReelMedia;
}

export interface ReelRenderInput {
  job: ClaimedImageJob;
  scenes: RenderedImage[];
  manifest: ValidatedWorkerManifest & { deliveryFormat: "instagram_reel" };
}

export interface ReelRenderer {
  render(input: ReelRenderInput): Promise<RenderedReelMedia>;
}

export interface WorkerClient {
  claim(workerId: string): Promise<ClaimedImageJob | null>;
  heartbeat(jobId: string, input: { workerId: string; leaseToken: string }): Promise<unknown>;
  complete(jobId: string, input: { workerId: string; leaseToken: string; manifestUrl: string }): Promise<unknown>;
  fail(jobId: string, input: { workerId: string; leaseToken: string; error: string; retryable: boolean; retryAfterMs: number }): Promise<unknown>;
}

export interface ImageRenderer {
  renderJob(job: ClaimedImageJob): Promise<RenderedInstagramPackage>;
}

export interface ImageStorage {
  upload(job: ClaimedImageJob, rendered: RenderedInstagramPackage): Promise<{ manifestUrl: string }>;
}

export type WorkerRunResult =
  | { status: "idle" }
  | { status: "completed"; jobId: string }
  | { status: "failed"; jobId: string };

function maxImagesFor(job: ClaimedImageJob) {
  const maxImages = Number(job.payload.maxImages);
  if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 5) throw new Error("image_render_max_images_invalid");
  return maxImages;
}

function requiredRecord(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`image_job_${key}_required`);
  }
  return value as Record<string, unknown>;
}

function requiredText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`image_job_${key}_required`);
  return value.trim();
}

function nullableText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formatFor(job: ClaimedImageJob) {
  const deliveryFormat = job.payload.deliveryFormat;
  const promptVersion = job.payload.promptVersion;
  const valid = (
    deliveryFormat === "instagram_feed_carousel" && promptVersion === "worker-card.v4"
  ) || (
    deliveryFormat === "instagram_story" && promptVersion === "worker-story.v1"
  ) || (
    deliveryFormat === "instagram_reel" && promptVersion === "worker-reel.v3"
  );
  if (!valid) throw new Error("image_job_format_contract_invalid");
  return { deliveryFormat, promptVersion } as {
    deliveryFormat: InstagramDeliveryFormat;
    promptVersion: WorkerPromptVersion;
  };
}

function promptInputFor(
  job: ClaimedImageJob,
  source: SourceReadResult,
  maxImages: number
): BuildWorkerPromptInput {
  const { deliveryFormat, promptVersion } = formatFor(job);
  const topic = requiredRecord(job.payload, "topic");
  const brand = requiredRecord(job.payload, "brand");
  const representativeUrl = typeof job.payload.representativeUrl === "string"
    && job.payload.representativeUrl.trim().length > 0
    ? job.payload.representativeUrl.trim()
    : null;
  return {
    deliveryFormat,
    promptVersion,
    topic: {
      title: requiredText(topic, "title"),
      angle: requiredText(topic, "angle"),
      targetCustomer: nullableText(topic, "targetCustomer"),
      region: nullableText(topic, "region"),
      season: nullableText(topic, "season"),
      notes: nullableText(topic, "notes")
    },
    brand: {
      name: requiredText(brand, "name"),
      categoryContext: nullableText(brand, "categoryContext") ?? "미설정",
      primaryCustomer: nullableText(brand, "primaryCustomer"),
      description: nullableText(brand, "description"),
      tone: nullableText(brand, "tone"),
      brandColor: nullableText(brand, "brandColor")
    },
    representativeUrl,
    maxImages: maxImages as 5,
    ...source
  };
}

function validateRenderedImages(
  images: RenderedImage[],
  manifest: ValidatedWorkerManifest,
  maxImages: number
) {
  if (
    images.length < 1
    || images.length > maxImages
    || images.length !== manifest.selectedAssetCount
  ) {
    throw new Error("image_render_output_count_invalid");
  }
  images.forEach((image, index) => {
    const dimensionsValid = manifest.deliveryFormat === "instagram_feed_carousel"
      ? image.width === 1080 && image.height === 1080
      : Number.isInteger(image.width) && image.width > 0
        && Number.isInteger(image.height) && image.height > 0;
    if (
      image.index !== index + 1
      || image.mimeType !== "image/png"
      || image.bytes.length === 0
      || !dimensionsValid
    ) {
      throw new Error("image_render_output_invalid");
    }
  });
}

function isRetryableImageRenderError(error: unknown, message: string) {
  return error instanceof WorkerManifestValidationError || /^(codex_image_|image_render_(?:command|content|output)|image_manifest_|image_asset_|asset_|story_asset_|delivery_format_mismatch|prompt_version_mismatch|worker_api_failed:5|blob_upload_failed|image_provider_rate_limited|ffprobe_|reel_|invalid_reel_)/.test(message);
}

function startHeartbeat({
  job,
  workerId,
  client,
  heartbeatIntervalMs
}: {
  job: ClaimedImageJob;
  workerId: string;
  client: WorkerClient;
  heartbeatIntervalMs: number;
}) {
  const intervalMs = Math.max(1, Math.min(heartbeatIntervalMs, 5 * 60 * 1000));
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = Promise.resolve();
  const schedule = () => {
    timer = setTimeout(() => {
      if (stopped) return;
      active = Promise.resolve()
        .then(() => client.heartbeat(job.id, { workerId, leaseToken: job.leaseToken }))
        .catch(() => undefined)
        .then(() => {
          if (!stopped) schedule();
        });
    }, intervalMs);
  };
  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await active;
  };
}

export async function runOnce({
  workerId,
  client,
  renderer,
  storage,
  reelRenderer,
  readSource = readRepresentativeSource,
  buildPrompt = buildWorkerPrompt,
  runTextJob,
  heartbeatIntervalMs = 5 * 60 * 1000,
  retryDelayMs = 5 * 60 * 1000
}: {
  workerId: string;
  client: WorkerClient;
  renderer: ImageRenderer;
  storage: ImageStorage;
  reelRenderer?: ReelRenderer;
  readSource?: (url: string | null | undefined) => Promise<SourceReadResult>;
  buildPrompt?: typeof buildWorkerPrompt;
  runTextJob?: () => Promise<WorkerRunResult>;
  heartbeatIntervalMs?: number;
  retryDelayMs?: number;
}): Promise<WorkerRunResult> {
  const job = await client.claim(workerId);
  if (!job) return runTextJob ? await runTextJob() : { status: "idle" };
  const stopHeartbeat = startHeartbeat({ job, workerId, client, heartbeatIntervalMs });
  try {
    const maxImages = maxImagesFor(job);
    const representativeUrl = typeof job.payload.representativeUrl === "string"
      ? job.payload.representativeUrl
      : null;
    const source = await readSource(representativeUrl).catch((): SourceReadResult => ({
      sourceMode: "url_unavailable",
      fetchStatus: "source_fetch_failed",
      sourceText: null
    }));
    const prompt = buildPrompt(promptInputFor(job, source, maxImages));
    const preparedJob = {
      ...job,
      payload: {
        ...job.payload,
        prompt,
        sourceMode: source.sourceMode,
        fetchStatus: source.fetchStatus,
        sourceText: source.sourceText
      }
    };
    const rendered = await renderer.renderJob(preparedJob);
    const manifest = parseWorkerManifest(rendered.manifest, { maxImages });
    const expectedFormat = formatFor(job);
    if (manifest.deliveryFormat !== expectedFormat.deliveryFormat) throw new Error("delivery_format_mismatch");
    if (manifest.promptVersion !== expectedFormat.promptVersion) throw new Error("prompt_version_mismatch");
    validateRenderedImages(rendered.images, manifest, maxImages);

    const completedPackage: RenderedInstagramPackage = { ...rendered, manifest, source };
    if (manifest.deliveryFormat === "instagram_reel") {
      if (!reelRenderer) throw new Error("reel_renderer_required");
      completedPackage.reel = await reelRenderer.render({
        job: preparedJob,
        scenes: rendered.images,
        manifest
      });
    }
    const { manifestUrl } = await storage.upload(preparedJob, completedPackage);
    await client.complete(job.id, { workerId, leaseToken: job.leaseToken, manifestUrl });
    return { status: "completed", jobId: job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "image_worker_failed";
    await client.fail(job.id, {
      workerId,
      leaseToken: job.leaseToken,
      error: message,
      retryable: isRetryableImageRenderError(error, message),
      retryAfterMs: Math.max(1000, retryDelayMs)
    }).catch(() => undefined);
    return { status: "failed", jobId: job.id };
  } finally {
    await stopHeartbeat();
  }
}
