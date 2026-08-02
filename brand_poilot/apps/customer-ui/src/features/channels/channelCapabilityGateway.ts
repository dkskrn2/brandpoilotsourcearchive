import type { ChannelCapability } from "../../types";

export type ChannelContentFormat =
  | "card_news"
  | "blog"
  | "reel"
  | "marketing_content"
  | "single_image"
  | "channel_text";

export interface ChannelCapabilityFormatOption {
  capability: ChannelCapability;
  supported: boolean;
  disabledReason: string | null;
  resolutionLink: {
    href: "/channels";
    label: string;
  } | null;
}

export interface ChannelCapabilityPolicy {
  readonly retryAllowed: boolean;
  readonly existingDraftMayBeSaved: boolean;
  readonly generationStartAllowed: boolean;
}

export interface ChannelCapabilityIdleState {
  status: "idle";
  capabilities: ChannelCapability[];
  policy: ChannelCapabilityPolicy;
}

export interface ChannelCapabilityLoadingState {
  status: "loading";
  capabilities: ChannelCapability[];
  policy: ChannelCapabilityPolicy;
}

export interface ChannelCapabilityReadyState {
  status: "ready";
  capabilities: ChannelCapability[];
  policy: ChannelCapabilityPolicy;
}

export interface ChannelCapabilityFailureState {
  status: "failure";
  capabilities: ChannelCapability[];
  error: unknown;
  policy: ChannelCapabilityPolicy;
}

export type ChannelCapabilityState =
  | ChannelCapabilityIdleState
  | ChannelCapabilityLoadingState
  | ChannelCapabilityReadyState
  | ChannelCapabilityFailureState;

export type ChannelCapabilityRequest = (
  brandId: string,
  signal: AbortSignal,
) => Promise<ChannelCapability[]>;

const blockedPolicy: ChannelCapabilityPolicy = {
  retryAllowed: false,
  existingDraftMayBeSaved: true,
  generationStartAllowed: false,
};

const readyPolicy: ChannelCapabilityPolicy = {
  retryAllowed: false,
  existingDraftMayBeSaved: true,
  generationStartAllowed: true,
};

const failurePolicy: ChannelCapabilityPolicy = {
  retryAllowed: true,
  existingDraftMayBeSaved: true,
  generationStartAllowed: false,
};

function isOneOf(value: unknown, allowed: readonly string[]) {
  return typeof value === "string" && allowed.includes(value);
}

function isChannelCapability(value: unknown): value is ChannelCapability {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return isOneOf(candidate.channel, [
    "instagram",
    "threads",
    "x",
    "linkedin",
    "youtube",
    "tiktok",
  ])
    && isOneOf(candidate.catalogStatus, ["available", "planned"])
    && typeof candidate.enabled === "boolean"
    && isOneOf(candidate.connectionStatus, [
      "connected",
      "not_connected",
      "needs_attention",
      "expired",
      "insufficient_permissions",
      "mapping_required",
      "publish_failed",
    ])
    && typeof candidate.canGenerate === "boolean"
    && Array.isArray(candidate.generationFormats)
    && candidate.generationFormats.every((format) => isOneOf(format, [
      "card_news",
      "blog",
      "reel",
      "marketing_content",
      "single_image",
      "channel_text",
    ]))
    && Array.isArray(candidate.exportModes)
    && candidate.exportModes.every((mode) => isOneOf(mode, ["image", "html", "text"]))
    && Array.isArray(candidate.publishModes)
    && candidate.publishModes.every((mode) => isOneOf(mode, [
      "instagram_feed_carousel",
      "instagram_story",
      "instagram_reel",
      "instagram_feed_single",
      "threads_text",
      "tiktok_video",
      "youtube_video",
      "youtube_short",
      "linkedin_post",
      "x_post",
    ]))
    && isOneOf(candidate.readiness, [
      "ready",
      "needs_connection",
      "needs_permission",
      "not_supported",
    ])
    && (candidate.reasonCode === null || typeof candidate.reasonCode === "string");
}

async function requestChannelCapabilities(
  brandId: string,
  signal: AbortSignal,
): Promise<ChannelCapability[]> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(
    `${baseUrl}/brands/${encodeURIComponent(brandId)}/channels/capabilities`,
    {
      method: "GET",
      credentials: "include",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Channel capability request failed: ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isChannelCapability)) {
    throw new Error("Channel capability response was invalid");
  }
  return payload;
}

function supportsFormat(
  capability: ChannelCapability,
  format: ChannelContentFormat,
) {
  return capability.catalogStatus === "available"
    && capability.enabled
    && capability.canGenerate
    && capability.readiness === "ready"
    && capability.connectionStatus === "connected"
    && capability.generationFormats.includes(format);
}

function disabledReasonForFormat(
  capability: ChannelCapability,
  format: ChannelContentFormat,
) {
  if (!capability.generationFormats.includes(format)) {
    return "선택한 콘텐츠 형식은 이 채널에서 지원되지 않습니다.";
  }
  if (capability.catalogStatus === "planned") {
    return "이 채널의 콘텐츠 생성 기능은 아직 준비 중입니다.";
  }
  if (!capability.enabled) {
    return "이 채널은 현재 비활성화되어 있습니다.";
  }
  if (capability.readiness === "needs_connection") {
    return "콘텐츠 생성을 사용하려면 먼저 채널을 연결해 주세요.";
  }
  if (capability.readiness === "needs_permission") {
    return "콘텐츠 생성을 사용하려면 채널 권한을 확인해 주세요.";
  }
  return "이 채널의 콘텐츠 생성 기능을 현재 사용할 수 없습니다.";
}

export function supportedChannelsForFormat(
  capabilities: ChannelCapability[],
  format: ChannelContentFormat,
): ChannelCapability[] {
  return capabilities.filter((capability) => supportsFormat(capability, format));
}

export function channelCapabilityOptionsForFormat(
  capabilities: ChannelCapability[],
  format: ChannelContentFormat,
): ChannelCapabilityFormatOption[] {
  return capabilities.map((capability) => {
    const supported = supportsFormat(capability, format);
    return {
      capability,
      supported,
      disabledReason: supported
        ? null
        : disabledReasonForFormat(capability, format),
      resolutionLink: supported
        ? null
        : {
          href: "/channels",
          label: "채널 설정에서 지원 범위 확인",
        },
    };
  });
}

export function createChannelCapabilityGateway(
  request: ChannelCapabilityRequest = requestChannelCapabilities,
) {
  let activeController: AbortController | null = null;
  let activeRequestId = 0;
  let state: ChannelCapabilityState = {
    status: "idle",
    capabilities: [],
    policy: blockedPolicy,
  };

  return {
    getState() {
      return state;
    },
    cancel() {
      activeRequestId += 1;
      activeController?.abort();
      activeController = null;
      state = {
        status: "idle",
        capabilities: [],
        policy: blockedPolicy,
      };
      return state;
    },
    async load(brandId: string): Promise<void> {
      activeController?.abort();
      const controller = new AbortController();
      const requestId = ++activeRequestId;
      activeController = controller;
      state = {
        status: "loading",
        capabilities: [],
        policy: blockedPolicy,
      };
      try {
        const capabilities = await request(brandId, controller.signal);
        if (requestId !== activeRequestId) {
          return;
        }
        state = {
          status: "ready",
          capabilities,
          policy: readyPolicy,
        };
      } catch (error) {
        if (requestId !== activeRequestId) {
          return;
        }
        state = {
          status: "failure",
          capabilities: [],
          error,
          policy: failurePolicy,
        };
      } finally {
        if (requestId === activeRequestId) {
          activeController = null;
        }
      }
    },
  };
}
