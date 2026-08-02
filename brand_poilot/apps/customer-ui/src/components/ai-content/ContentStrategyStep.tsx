import { useEffect } from "react";
import { FileCode2 } from "lucide-react";
import type {
  ContentChannelTarget,
  ContentOutputFormatV2,
} from "../../features/ai-content/types";
import {
  supportedChannelsForFormat,
  type ChannelCapabilityState,
} from "../../features/channels/channelCapabilityGateway";
import { ChannelLogo } from "../channels/ChannelLogo";

const formatLabels: Array<[ContentOutputFormatV2, string]> = [
  ["card_news", "카드뉴스"],
  ["blog", "블로그"],
  ["reel", "릴스(세로 이미지)"],
  ["marketing_content", "마케팅 콘텐츠"],
];

const channelLabels = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
} as const;

export function ContentStrategyStep({
  outputFormat,
  channelTarget,
  channelTargets,
  loading,
  capabilityState,
  onFormatChange,
  onChannelChange,
  onChannelsChange,
  onSubmit,
}: {
  outputFormat: ContentOutputFormatV2;
  channelTarget?: ContentChannelTarget | null;
  /** @deprecated Legacy caller compatibility. New setup writes exactly one target. */
  channelTargets?: ContentChannelTarget[];
  /** @deprecated The optional instruction moved to ContentSubjectStep. */
  brief?: string;
  loading: boolean;
  capabilityState: ChannelCapabilityState;
  onFormatChange(value: ContentOutputFormatV2): void;
  onChannelChange?(value: ContentChannelTarget | null): void;
  /** @deprecated Legacy caller compatibility. */
  onChannelsChange?(value: ContentChannelTarget[]): void;
  /** @deprecated The optional instruction moved to ContentSubjectStep. */
  onBriefChange?(value: string): void;
  onSubmit(): void;
}) {
  const selectedTarget = channelTarget ?? channelTargets?.[0] ?? null;
  const setSelectedTarget = (value: ContentChannelTarget | null) => {
    onChannelChange?.(value);
    onChannelsChange?.(value ? [value] : []);
  };
  const remoteOptions = supportedChannelsForFormat(capabilityState.capabilities, outputFormat);
  const hasLocalBlog = outputFormat === "blog";
  const selectedTargetSupported = Boolean(selectedTarget) && (
    selectedTarget === "blog_export"
      ? hasLocalBlog
      : capabilityState.status === "ready"
        && remoteOptions.some((capability) => capability.channel === selectedTarget)
  );

  useEffect(() => {
    if (!selectedTarget || capabilityState.status === "loading" || selectedTargetSupported) return;
    onChannelChange?.(null);
    onChannelsChange?.([]);
  }, [capabilityState.status, onChannelChange, onChannelsChange, selectedTarget, selectedTargetSupported]);

  function changeFormat(next: ContentOutputFormatV2) {
    const remoteStillCompatible = selectedTarget && selectedTarget !== "blog_export"
      ? supportedChannelsForFormat(capabilityState.capabilities, next)
        .some((capability) => capability.channel === selectedTarget)
      : false;
    const localStillCompatible = selectedTarget === "blog_export" && next === "blog";
    onFormatChange(next);
    if (selectedTarget && !remoteStillCompatible && !localStillCompatible) setSelectedTarget(null);
  }

  return <div className="content-strategy-step">
    <fieldset className="content-format-options">
      <legend>출력 형식</legend>
      {formatLabels.map(([value, label]) => <label key={value}>
        <input
          type="radio"
          name="content-output-format"
          value={value}
          checked={outputFormat === value}
          onChange={() => changeFormat(value)}
        />
        <span>{label}</span>
      </label>)}
    </fieldset>

    <fieldset className="content-channel-logo-options">
      <legend>업로드 방식</legend>
      {capabilityState.status === "loading" ? <p>채널 지원 범위를 확인하는 중입니다.</p> : null}
      {capabilityState.status === "failure" ? <p role="alert">채널 지원 범위를 불러오지 못했습니다. 다시 단계를 열어 재시도해 주세요.</p> : null}
      {remoteOptions.map((capability) => {
        const label = channelLabels[capability.channel];
        return <button
          type="button"
          key={capability.channel}
          title={label}
          aria-label={label}
          aria-pressed={selectedTarget === capability.channel}
          onClick={() => setSelectedTarget(capability.channel)}
        >
          <ChannelLogo channel={capability.channel} decorative size={28} />
          <span className="visually-hidden">{label}</span>
        </button>;
      })}
      {hasLocalBlog ? <button
        type="button"
        title="블로그 파일 내보내기"
        aria-label="블로그 파일 내보내기"
        aria-pressed={selectedTarget === "blog_export"}
        onClick={() => setSelectedTarget("blog_export")}
      >
        <FileCode2 aria-hidden="true" size={28} />
        <span className="visually-hidden">블로그 파일 내보내기</span>
      </button> : null}
      {capabilityState.status === "ready" && remoteOptions.length === 0 && !hasLocalBlog
        ? <p>사용 가능한 업로드 방식이 없습니다. 채널을 연결하고 활성화한 뒤 다시 확인해 주세요.</p>
        : null}
    </fieldset>

    <button
      type="button"
      className="button primary"
      disabled={!selectedTargetSupported || loading}
      onClick={onSubmit}
    >{loading ? "구성안을 만드는 중" : "AI 구성안 만들기"}</button>
  </div>;
}
