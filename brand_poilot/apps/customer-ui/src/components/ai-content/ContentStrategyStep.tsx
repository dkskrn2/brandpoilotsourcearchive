import type { ContentChannelTarget, ContentOutputFormat } from "../../features/ai-content/types";

const channels: Array<[ContentChannelTarget, string]> = [
  ["instagram", "Instagram"],
  ["threads", "Threads"],
  ["x", "X"],
  ["linkedin", "LinkedIn"],
  ["blog_export", "블로그 내보내기"],
  ["youtube", "YouTube (영상 형식 미지원)"],
  ["tiktok", "TikTok (영상 형식 미지원)"],
];

export function ContentStrategyStep({ outputFormat, channelTargets, brief, loading, onFormatChange, onChannelsChange, onBriefChange, onSubmit }: {
  outputFormat: ContentOutputFormat;
  channelTargets: ContentChannelTarget[];
  brief: string;
  loading: boolean;
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
    <fieldset><legend>채널</legend>{channels.map(([channel, label]) => {
      const disabled = channel === "youtube" || channel === "tiktok";
      return <label key={channel}>
        <input type="checkbox" checked={channelTargets.includes(channel)} disabled={disabled} onChange={() => toggle(channel)} />
        {label}
      </label>;
    })}</fieldset>
    <label>제작 조건<textarea value={brief} onChange={(event) => onBriefChange(event.target.value)} placeholder="꼭 담을 내용과 피할 표현을 입력하세요." /></label>
    <button type="button" className="button primary" disabled={!outputFormat || channelTargets.length === 0 || loading} onClick={onSubmit}>
      {loading ? "구성안을 만드는 중" : "AI 구성안 만들기"}
    </button>
  </div>;
}
