import type { ContentChannelTarget, ContentOutputFormat } from "../../features/ai-content/types";
import {
  channelCapabilityOptionsForFormat,
  type ChannelCapabilityState,
} from "../../features/channels/channelCapabilityGateway";

const channelLabels: Record<ContentChannelTarget, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  blog_export: "블로그 내보내기",
  youtube: "YouTube",
  tiktok: "TikTok",
};

export function ContentStrategyStep({ outputFormat, channelTargets, brief, loading, capabilityState, onFormatChange, onChannelsChange, onBriefChange, onSubmit }: {
  outputFormat: ContentOutputFormat;
  channelTargets: ContentChannelTarget[];
  brief: string;
  loading: boolean;
  capabilityState: ChannelCapabilityState;
  onFormatChange(value: ContentOutputFormat): void;
  onChannelsChange(value: ContentChannelTarget[]): void;
  onBriefChange(value: string): void;
  onSubmit(): void;
}) {
  const toggle = (channel: ContentChannelTarget) => {
    onChannelsChange(channelTargets.includes(channel)
      ? channelTargets.filter((item) => item !== channel)
      : [...channelTargets, channel]);
  };
  const options = outputFormat
    ? channelCapabilityOptionsForFormat(capabilityState.capabilities, outputFormat)
    : [];
  const catalog = options.map(({ capability, supported, disabledReason }) => ({
    channel: capability.channel as ContentChannelTarget,
    label: channelLabels[capability.channel as ContentChannelTarget],
    disabled: capabilityState.status !== "ready" || !supported,
    reason: disabledReason,
    detail: [
      capability.generationFormats.length ? `생성 ${capability.generationFormats.join(", ")}` : null,
      capability.exportModes.length ? `내보내기 ${capability.exportModes.join(", ")}` : null,
      capability.publishModes.length ? `API 게시 ${capability.publishModes.join(", ")}` : "API 게시 없음",
    ].filter(Boolean).join(" · "),
  }));
  if (outputFormat === "blog") {
    catalog.push({
      channel: "blog_export",
      label: channelLabels.blog_export,
      disabled: false,
      reason: null,
      detail: "HTML 내보내기 · API 게시 없음",
    });
  }
  return <div className="content-strategy-step">
    <label>출력 형식
      <select value={outputFormat} onChange={(event) => onFormatChange(event.target.value as ContentOutputFormat)}>
        <option value="">선택</option>
        <option value="card_news">카드뉴스</option>
        <option value="blog">블로그</option>
        <option value="single_image">단일 이미지</option>
        <option value="channel_text">채널 텍스트</option>
      </select>
    </label>
    <fieldset><legend>채널</legend>
      {capabilityState.status === "loading" ? <p>채널 지원 범위를 확인하는 중입니다.</p> : null}
      {capabilityState.status === "failure" ? <p role="alert">채널 지원 범위를 불러오지 못했습니다. 다시 단계를 열어 재시도해 주세요.</p> : null}
      {catalog.map(({ channel, label, disabled, reason, detail }) => <label key={channel}>
        <input type="checkbox" checked={channelTargets.includes(channel)} disabled={disabled} onChange={() => toggle(channel)} />
        <span>{label}<small>{detail}</small>{disabled && reason ? <small>{reason}</small> : null}</span>
      </label>)}
    </fieldset>
    <label>제작 조건<textarea value={brief} onChange={(event) => onBriefChange(event.target.value)} placeholder="꼭 담을 내용과 피할 표현을 입력하세요." /></label>
    <button type="button" className="button primary" disabled={!outputFormat || channelTargets.length === 0 || loading} onClick={onSubmit}>
      {loading ? "구성안을 만드는 중" : "AI 구성안 만들기"}
    </button>
  </div>;
}
