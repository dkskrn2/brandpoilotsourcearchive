import type { ImageRenderJobBrandContext, ImageRenderJobTopicContext } from "./types.js";

export interface ThreadsRenderJobPayload extends Record<string, unknown> {
  deliveryFormat: "threads_text";
  promptVersion: "worker-threads.v1";
  topic: ImageRenderJobTopicContext;
  brand: ImageRenderJobBrandContext;
  representativeUrl: string | null;
}

export interface ThreadsRenderJobResult {
  jobId: string | null;
  channelOutputId: string | null;
  deliveryFormat: "threads_text";
  promptVersion: "worker-threads.v1";
  title: string;
  text: string;
  sourceMode: "direct_url" | "topic_only" | "url_unavailable";
  fetchStatus: string;
  model: string;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validUrl(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? text : null;
  } catch {
    return null;
  }
}

export function buildThreadsRenderJobPayload(input: {
  topic: ImageRenderJobTopicContext;
  brand: ImageRenderJobBrandContext;
  crawlContentUrl?: string | null;
  referenceUrl?: string | null;
}): ThreadsRenderJobPayload {
  return {
    deliveryFormat: "threads_text",
    promptVersion: "worker-threads.v1",
    topic: input.topic,
    brand: input.brand,
    representativeUrl: validUrl(input.crawlContentUrl) ?? validUrl(input.referenceUrl)
  };
}

export function parseThreadsRenderJobResult(
  value: unknown,
  expected?: { jobId?: string; channelOutputId?: string }
): ThreadsRenderJobResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("text_manifest_invalid");
  }
  const record = value as Record<string, unknown>;
  const jobId = nonEmpty(record.jobId);
  const channelOutputId = nonEmpty(record.channelOutputId);
  if (
    (expected?.jobId && jobId && jobId !== expected.jobId)
    || (expected?.channelOutputId && channelOutputId && channelOutputId !== expected.channelOutputId)
  ) {
    throw new Error("text_manifest_job_mismatch");
  }
  if (record.deliveryFormat !== "threads_text") throw new Error("text_delivery_format_invalid");
  if (record.promptVersion !== "worker-threads.v1") throw new Error("text_prompt_version_invalid");
  const title = nonEmpty(record.title);
  const text = nonEmpty(record.text);
  const fetchStatus = nonEmpty(record.fetchStatus);
  const model = nonEmpty(record.model);
  if (!title) throw new Error("text_title_required");
  if (!text) throw new Error("text_body_required");
  if (!fetchStatus) throw new Error("text_fetch_status_required");
  if (!model) throw new Error("text_model_required");
  const sourceMode = record.sourceMode;
  if (sourceMode !== "direct_url" && sourceMode !== "topic_only" && sourceMode !== "url_unavailable") {
    throw new Error("text_source_mode_invalid");
  }
  return {
    jobId,
    channelOutputId,
    deliveryFormat: "threads_text",
    promptVersion: "worker-threads.v1",
    title,
    text,
    sourceMode,
    fetchStatus,
    model
  };
}
