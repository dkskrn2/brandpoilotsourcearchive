import type {
  ChannelCapability,
  ChannelConnection,
  ChannelStatus,
  ChannelType,
  DeliveryFormat,
} from "../../types";

export interface ChannelCapabilityRowView {
  key: "connection" | "generation" | "export" | "publish";
  label: string;
  state: string;
  detail: string;
  tone: "ok" | "warn" | "neutral";
}

export interface ChannelCapabilityCardView {
  channel: ChannelType;
  label: string;
  accountLabel: string;
  rows: ChannelCapabilityRowView[];
  repairAction: {
    kind: "oauth" | "guide";
    label: string;
  };
}

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

const generationLabels: Record<ChannelCapability["generationFormats"][number], string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  single_image: "단일 이미지",
  channel_text: "채널 텍스트",
};

const exportLabels: Record<ChannelCapability["exportModes"][number], string> = {
  image: "이미지",
  html: "HTML",
  text: "텍스트",
};

const publishLabels: Partial<Record<DeliveryFormat, string>> = {
  instagram_feed_single: "Instagram 피드",
  instagram_feed_carousel: "Instagram 피드",
  instagram_story: "정적 Story",
  instagram_reel: "기존 Reel 결과",
  threads_text: "Threads 텍스트",
  x_post: "X 게시물",
  linkedin_post: "LinkedIn 게시물",
  youtube_video: "YouTube 영상",
  youtube_short: "YouTube Shorts",
  tiktok_video: "TikTok 영상",
};

const connectionReasonLabels: Partial<Record<ChannelStatus | string, string>> = {
  connected: "연결됨",
  not_connected: "미연결",
  mapping_required: "전문 계정 매핑 필요",
  professional_account_required: "전문 계정 매핑 필요",
  insufficient_permissions: "게시 권한 승인 필요",
  missing_required_scopes: "게시 권한 승인 필요",
  expired: "인증 만료",
  credential_expired: "인증 만료",
  needs_attention: "인증 정보 확인 필요",
  meta_token_invalid: "인증 정보 확인 필요",
  meta_permission_denied: "게시 권한 승인 필요",
  publish_failed: "게시 상태 확인 필요",
  credential_invalid: "인증 정보 확인 필요",
  channel_needs_attention: "인증 정보 확인 필요",
};

const generationReasonLabels: Record<string, string> = {
  video_generation_out_of_scope: "현재 영상 콘텐츠 생성은 제공하지 않습니다.",
};

function uniqueLabels<T extends string>(
  values: readonly T[],
  labels: Partial<Record<T, string>>,
) {
  return [...new Set(values.map((value) => labels[value] ?? value))].join(", ");
}

export function channelCapabilityViewModel(
  capability: ChannelCapability,
  connection: ChannelConnection | null,
): ChannelCapabilityCardView {
  const planned = capability.catalogStatus === "planned";
  const connectionReason = capability.reasonCode
    ? connectionReasonLabels[capability.reasonCode]
    : null;
  const connectionState = planned
    ? "연결 준비 중"
    : connectionReason
      ?? connectionReasonLabels[capability.connectionStatus]
      ?? "상태 확인 필요";
  const generationDetail = capability.canGenerate
    ? uniqueLabels(capability.generationFormats, generationLabels)
    : generationReasonLabels[capability.reasonCode ?? ""]
      ?? "이 채널용 콘텐츠 생성은 현재 지원하지 않습니다.";
  const exportDetail = capability.exportModes.length > 0
    ? uniqueLabels(capability.exportModes, exportLabels)
    : "내보내기 형식이 준비되지 않았습니다.";
  const publishDetail = planned
    ? "실제 API 게시 연동은 아직 제공하지 않습니다."
    : capability.publishModes.length > 0 && capability.readiness === "ready"
      ? uniqueLabels(capability.publishModes, publishLabels)
      : connectionReason ?? "연결과 게시 권한을 확인해 주세요.";

  return {
    channel: capability.channel,
    label: channelLabels[capability.channel],
    accountLabel: connection?.accountLabel ?? "연결 전",
    rows: [
      {
        key: "connection",
        label: "계정 연결",
        state: connectionState,
        detail: connection?.accountLabel ?? "연결 전",
        tone: !planned && capability.connectionStatus === "connected" ? "ok" : "warn",
      },
      {
        key: "generation",
        label: "콘텐츠 생성/변환",
        state: capability.canGenerate ? "가능" : "생성 불가",
        detail: generationDetail,
        tone: capability.canGenerate ? "ok" : "neutral",
      },
      {
        key: "export",
        label: "파일·텍스트 내보내기",
        state: capability.exportModes.length > 0 ? "가능" : "미지원",
        detail: exportDetail,
        tone: capability.exportModes.length > 0 ? "ok" : "neutral",
      },
      {
        key: "publish",
        label: "API 실제 게시",
        state: planned
          ? "지원 준비 중"
          : capability.publishModes.length > 0 && capability.readiness === "ready"
            ? "게시 가능"
            : "게시 불가",
        detail: publishDetail,
        tone: !planned && capability.publishModes.length > 0 && capability.readiness === "ready"
          ? "ok"
          : "warn",
      },
    ],
    repairAction: capability.channel === "instagram"
      ? {
        kind: "oauth",
        label: capability.connectionStatus === "not_connected" ? "Meta OAuth 연결" : "Meta 다시 연결",
      }
      : { kind: "guide", label: "연결 안내 보기" },
  };
}
