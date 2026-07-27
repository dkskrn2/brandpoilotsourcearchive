import type { ChannelCapability } from "../../types";

export type ChannelContentFormat =
  | "card_news"
  | "blog"
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
  return response.json() as Promise<ChannelCapability[]>;
}

function supportsFormat(
  capability: ChannelCapability,
  format: ChannelContentFormat,
) {
  return capability.canGenerate && capability.generationFormats.includes(format);
}

export function supportedChannelsForFormat(
  capabilities: ChannelCapability[],
  format: "card_news" | "blog" | "single_image" | "channel_text",
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
        : "선택한 콘텐츠 형식은 이 채널에서 지원되지 않습니다.",
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
    async load(brandId: string) {
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
          return state;
        }
        state = {
          status: "ready",
          capabilities,
          policy: readyPolicy,
        };
      } catch (error) {
        if (requestId !== activeRequestId) {
          return state;
        }
        state = {
          status: "failure",
          capabilities: [],
          error,
          policy: failurePolicy,
        };
      }
      return state;
    },
  };
}
