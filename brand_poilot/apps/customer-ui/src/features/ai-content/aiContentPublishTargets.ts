import type { ChannelConnection, ChannelType, DeliveryFormat } from "../../types";
import type { ContentOutputFormatV2 } from "./types";

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

function instagramFormats(outputFormat: ContentOutputFormatV2, assetCount: number): AiContentPublishFormatOption[] {
  if (outputFormat === "reel") {
    return [{
      deliveryFormat: "instagram_reel",
      label: "릴스",
      enabled: assetCount >= 1,
      reason: assetCount >= 1 ? null : "영상 결과 필요",
    }];
  }
  if (outputFormat !== "card_news") return [];

  const feed: AiContentPublishFormatOption = {
    deliveryFormat: "instagram_feed_carousel",
    label: "게시물",
    enabled: assetCount >= 1,
    reason: assetCount >= 1 ? null : "이미지 결과 필요",
  };

  return [
    feed,
    {
      deliveryFormat: "instagram_story",
      label: "스토리",
      enabled: assetCount >= 1,
      reason: assetCount >= 1 ? null : "이미지 결과 필요",
    },
  ];
}

export function buildAiContentPublishOptions({
  outputFormat,
  assetCount,
  channels,
}: {
  outputFormat: ContentOutputFormatV2;
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
      formats: connected && channelType === "instagram" ? instagramFormats(outputFormat, assetCount) : [],
    };
  });
}
