import type { Channel } from "./types.js";

export type PublishAdapterChannel = Channel;
export type PublishCredentialState = "connected" | "not_connected" | "needs_attention";

export interface PublishAdapterRequest {
  channel: PublishAdapterChannel;
  credentialState: PublishCredentialState;
  queueId: string;
  outputJson: Record<string, unknown>;
}

export type PublishAdapterResult =
  | { status: "published"; externalPostId: string; externalUrl: string | null }
  | {
    status: "blocked";
    errorCode: "oauth_required" | "provider_not_implemented";
    retryable: false;
  };

export type PublishAdapterValidation =
  | { valid: true }
  | { valid: false; errorCode: "oauth_required" };

export interface PublishAdapter {
  validate(request: PublishAdapterRequest): PublishAdapterValidation;
  publish(request: PublishAdapterRequest): Promise<PublishAdapterResult>;
}

function validateCredential(request: PublishAdapterRequest): PublishAdapterValidation {
  return request.credentialState === "connected"
    ? { valid: true }
    : { valid: false, errorCode: "oauth_required" };
}

type InstagramPublisher = (request: PublishAdapterRequest) => Promise<PublishAdapterResult>;

function createDeferredProviderAdapter(): PublishAdapter {
  return {
    validate: validateCredential,
    async publish(request) {
      const validation = validateCredential(request);
      if (!validation.valid) {
        return { status: "blocked", errorCode: validation.errorCode, retryable: false };
      }
      return { status: "blocked", errorCode: "provider_not_implemented", retryable: false };
    },
  };
}

export function createPublishAdapterRegistry({ publishInstagram }: {
  publishInstagram: InstagramPublisher;
}): Record<PublishAdapterChannel, PublishAdapter> {
  const deferred = createDeferredProviderAdapter;
  return {
    instagram: { validate: validateCredential, publish: publishInstagram },
    threads: deferred(),
    x: deferred(),
    linkedin: deferred(),
    youtube: deferred(),
    tiktok: deferred(),
  };
}
