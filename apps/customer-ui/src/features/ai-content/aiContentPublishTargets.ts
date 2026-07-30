import type { ChannelConnection, ChannelType, DeliveryFormat } from "../../types";
import type { AiContentType } from "./types";

export interface AiContentPublishFormatOption {
  deliveryFormat: DeliveryFormat;
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface AiContentPublishChannelOption {
  channel: ChannelType;
  label: string;
  connected: boolean;
  accountLabel: string | null;
  statusLabel: string;
  formats: AiContentPublishFormatOption[];
}

const channelOrder: ChannelType[] = ["instagram", "threads", "x", "linkedin", "tiktok", "youtube"];

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
};

function isConnected(channel: ChannelConnection | undefined) {
  return Boolean(channel && channel.enabled && channel.status === "connected" && channel.oauthState === "connected");
}

function instagramFormats(type: AiContentType, assetCount: number): AiContentPublishFormatOption[] {
  if (type === "blog") return [];

  const feed: AiContentPublishFormatOption = type !== "card_news" && assetCount === 1
    ? { deliveryFormat: "instagram_feed_single", label: "게시물", enabled: true, reason: null }
    : {
      deliveryFormat: "instagram_feed_carousel",
      label: "게시물",
      enabled: type === "card_news" ? assetCount >= 1 : assetCount >= 2,
      reason: (type === "card_news" ? assetCount >= 1 : assetCount >= 2) ? null : "이미지 결과 필요",
    };

  return [
    feed,
    {
      deliveryFormat: "instagram_story",
      label: "스토리",
      enabled: assetCount >= 1,
      reason: assetCount >= 1 ? null : "이미지 결과 필요",
    },
    {
      deliveryFormat: "instagram_reel",
      label: "릴스",
      enabled: assetCount >= 1,
      reason: assetCount >= 1 ? "세로형 영상으로 변환 후 게시" : "이미지 결과 필요",
    },
  ];
}

export function buildAiContentPublishOptions({
  type,
  assetCount,
  channels,
}: {
  type: AiContentType;
  assetCount: number;
  channels: readonly ChannelConnection[];
}): AiContentPublishChannelOption[] {
  const channelMap = new Map(channels.map((channel) => [channel.type, channel]));

  return channelOrder.map((channelType) => {
    const channel = channelMap.get(channelType);
    const connected = isConnected(channel);
    return {
      channel: channelType,
      label: channel?.label || channelLabels[channelType],
      connected,
      accountLabel: connected && channel?.accountLabel ? channel.accountLabel : null,
      statusLabel: connected ? "연결됨" : "OAuth 게시 계정 미연결",
      formats: connected && channelType === "instagram" ? instagramFormats(type, assetCount) : [],
    };
  });
}
