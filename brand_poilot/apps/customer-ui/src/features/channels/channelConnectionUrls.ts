import type { ChannelType } from "../../types";

export interface ChannelConnectionCallback {
  channel: "instagram";
  outcome: "success" | "cancelled" | "failed";
  reason: ChannelConnectionFailureReason | null;
  consumedKeys: readonly ("instagram" | "reason")[];
}

export type ChannelConnectionFailureReason =
  | "account_mapping_failed"
  | "authentication_required"
  | "connection_failed"
  | "insufficient_permissions"
  | "invalid_callback"
  | "token_exchange_failed";

const channelConnectionFailureReasons = new Set<ChannelConnectionFailureReason>([
  "account_mapping_failed",
  "authentication_required",
  "connection_failed",
  "insufficient_permissions",
  "invalid_callback",
  "token_exchange_failed"
]);

export function channelConnectionUrl(channel: ChannelType, returnTo?: string) {
  if (channel !== "instagram") return null;
  const raw = import.meta.env.VITE_META_OAUTH_START_URL
    ?? `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"}/auth/meta/start`;
  if (!returnTo) return raw;
  const url = new URL(raw, window.location.origin);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

export function channelConnectionAction(channel: ChannelType, connected: boolean) {
  const href = channelConnectionUrl(channel);
  return href
    ? {
      kind: "oauth" as const,
      href,
      label: connected ? "Meta 다시 연결" : "Meta OAuth 연결",
    }
    : {
      kind: "guide" as const,
      href: null,
      label: "연결 준비 중",
    };
}

export function parseChannelConnectionCallback(search: string): ChannelConnectionCallback | null {
  const query = new URLSearchParams(search);
  const result = query.get("instagram");
  if (result === "connected") {
    return {
      channel: "instagram",
      outcome: "success",
      reason: null,
      consumedKeys: ["instagram"]
    };
  }
  if (result === "cancelled") {
    return {
      channel: "instagram",
      outcome: "cancelled",
      reason: null,
      consumedKeys: ["instagram"]
    };
  }
  if (result === "failed") {
    const reason = query.get("reason");
    return {
      channel: "instagram",
      outcome: "failed",
      reason: channelConnectionFailureReasons.has(reason as ChannelConnectionFailureReason)
        ? reason as ChannelConnectionFailureReason
        : "connection_failed",
      consumedKeys: ["instagram", "reason"]
    };
  }
  return null;
}
