import type { ChannelType } from "../../types";

export function channelConnectionUrl(channel: ChannelType) {
  if (channel !== "instagram") return null;
  return import.meta.env.VITE_META_OAUTH_START_URL
    ?? `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"}/auth/meta/start`;
}
