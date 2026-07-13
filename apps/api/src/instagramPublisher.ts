import { getMetaGraphJson, postMetaGraphForm } from "./metaGraph.js";

export interface InstagramCarouselPublishResult {
  externalPostId: string;
  publishedUrl: string | null;
}

interface InstagramPublishBase {
  accessToken: string;
  instagramBusinessAccountId: string;
}

export interface StoredInstagramStoryCapability {
  capabilityStatus: string | null;
  capabilityMetadata: Record<string, unknown>;
  credentialId: string | null;
}

export type InstagramPublishInput = InstagramPublishBase & (
  | {
    deliveryFormat: "instagram_feed_carousel";
    imageUrls: string[];
    caption: string;
  }
  | {
    deliveryFormat: "instagram_story";
    imageUrl: string;
    storyCapability: StoredInstagramStoryCapability;
  }
  | {
    deliveryFormat: "instagram_reel";
    videoUrl: string;
    caption: string;
  }
);

export interface InstagramPublishDependencies {
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  statusPollAttempts?: number;
  statusPollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requirePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("instagram_public_url_required");
  }
  const hostname = url.hostname.toLowerCase();
  const privateIpv4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || !hostname
    || hostname === "localhost"
    || hostname === "::1"
    || hostname.endsWith(".local")
    || privateIpv4
  ) {
    throw new Error("instagram_public_url_required");
  }
}

async function postMetaGraph({
  path,
  body,
  fetchImpl,
  graphVersion
}: {
  path: string;
  body: Record<string, string>;
  fetchImpl: typeof fetch;
  graphVersion: string;
}) {
  const payload = asRecord(await postMetaGraphForm({ path, body, fetchImpl, graphVersion }));
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    throw new Error("instagram_publish_missing_id");
  }
  return payload.id;
}

async function defaultSleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMetaContainer({
  containerId,
  accessToken,
  graphVersion,
  fetchImpl,
  maxAttempts,
  intervalMs,
  sleep
}: {
  containerId: string;
  accessToken: string;
  graphVersion: string;
  fetchImpl: typeof fetch;
  maxAttempts: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const payload = asRecord(await getMetaGraphJson({
      path: `/${containerId}`,
      params: { fields: "status_code", access_token: accessToken },
      fetchImpl,
      graphVersion
    }));
    const statusCode = typeof payload.status_code === "string" ? payload.status_code : "";
    if (statusCode === "FINISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(`instagram_media_container_${statusCode.toLowerCase()}`);
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new Error("instagram_media_container_timeout");
}

function resolveDependencies(deps: InstagramPublishDependencies) {
  return {
    graphVersion: deps.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v20.0",
    fetchImpl: deps.fetchImpl ?? fetch,
    statusPollAttempts: deps.statusPollAttempts ?? 60,
    statusPollIntervalMs: deps.statusPollIntervalMs ?? 5000,
    sleep: deps.sleep ?? defaultSleep
  };
}

async function publishContainer(
  input: InstagramPublishBase,
  containerBody: Record<string, string>,
  deps: ReturnType<typeof resolveDependencies>
): Promise<InstagramCarouselPublishResult> {
  const containerId = await postMetaGraph({
    path: `/${input.instagramBusinessAccountId}/media`,
    body: { ...containerBody, access_token: input.accessToken },
    fetchImpl: deps.fetchImpl,
    graphVersion: deps.graphVersion
  });
  await waitForMetaContainer({
    containerId,
    accessToken: input.accessToken,
    graphVersion: deps.graphVersion,
    fetchImpl: deps.fetchImpl,
    maxAttempts: deps.statusPollAttempts,
    intervalMs: deps.statusPollIntervalMs,
    sleep: deps.sleep
  });
  const externalPostId = await postMetaGraph({
    path: `/${input.instagramBusinessAccountId}/media_publish`,
    body: { creation_id: containerId, access_token: input.accessToken },
    fetchImpl: deps.fetchImpl,
    graphVersion: deps.graphVersion
  });
  return { externalPostId, publishedUrl: null };
}

function storedStoryCapabilityVerified(capability: StoredInstagramStoryCapability) {
  const verifiedCredentialId = capability.capabilityMetadata.verifiedCredentialId;
  return capability.capabilityStatus === "available"
    && capability.capabilityMetadata.scopesVerified === true
    && capability.capabilityMetadata.storyPublishVerified === true
    && typeof verifiedCredentialId === "string"
    && capability.credentialId !== null
    && verifiedCredentialId === capability.credentialId;
}

export async function publishInstagramOutput(
  input: InstagramPublishInput,
  dependencies: InstagramPublishDependencies = {}
): Promise<InstagramCarouselPublishResult> {
  const deps = resolveDependencies(dependencies);
  switch (input.deliveryFormat) {
    case "instagram_feed_carousel":
      return publishInstagramCarouselWithMeta({
        ...input,
        graphVersion: deps.graphVersion,
        fetchImpl: deps.fetchImpl,
        statusPollAttempts: deps.statusPollAttempts,
        statusPollIntervalMs: deps.statusPollIntervalMs,
        sleep: deps.sleep
      });
    case "instagram_story":
      if (!storedStoryCapabilityVerified(input.storyCapability)) {
        throw new Error("story_capability_required");
      }
      requirePublicUrl(input.imageUrl);
      return publishContainer(input, {
        media_type: "STORIES",
        image_url: input.imageUrl
      }, deps);
    case "instagram_reel":
      requirePublicUrl(input.videoUrl);
      return publishContainer(input, {
        media_type: "REELS",
        video_url: input.videoUrl,
        caption: input.caption,
        share_to_feed: "false"
      }, deps);
  }
}

export async function publishInstagramCarouselWithMeta({
  accessToken,
  instagramBusinessAccountId,
  imageUrls,
  caption,
  graphVersion = process.env.META_GRAPH_VERSION || "v20.0",
  fetchImpl = fetch,
  statusPollAttempts = 60,
  statusPollIntervalMs = 5000,
  sleep = defaultSleep
}: {
  accessToken: string;
  instagramBusinessAccountId: string;
  imageUrls: string[];
  caption: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  statusPollAttempts?: number;
  statusPollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<InstagramCarouselPublishResult> {
  if (imageUrls.length === 0) throw new Error("instagram_publish_requires_images");
  const children: string[] = [];

  for (const imageUrl of imageUrls) {
    requirePublicUrl(imageUrl);
    const childId = await postMetaGraph({
      path: `/${instagramBusinessAccountId}/media`,
      body: { image_url: imageUrl, is_carousel_item: "true", access_token: accessToken },
      fetchImpl,
      graphVersion
    });
    await waitForMetaContainer({
      containerId: childId,
      accessToken,
      graphVersion,
      fetchImpl,
      maxAttempts: statusPollAttempts,
      intervalMs: statusPollIntervalMs,
      sleep
    });
    children.push(childId);
  }

  const carouselId = await postMetaGraph({
    path: `/${instagramBusinessAccountId}/media`,
    body: {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
      access_token: accessToken
    },
    fetchImpl,
    graphVersion
  });
  await waitForMetaContainer({
    containerId: carouselId,
    accessToken,
    graphVersion,
    fetchImpl,
    maxAttempts: statusPollAttempts,
    intervalMs: statusPollIntervalMs,
    sleep
  });

  const externalPostId = await postMetaGraph({
    path: `/${instagramBusinessAccountId}/media_publish`,
    body: { creation_id: carouselId, access_token: accessToken },
    fetchImpl,
    graphVersion
  });
  return { externalPostId, publishedUrl: null };
}
