import { useMemo, useState } from "react";
import { ChannelLogo } from "../channels/ChannelLogo";
import { channelConnectionUrl } from "../../features/channels/channelConnectionUrls";
import {
  buildAiContentPublishOptions,
  type AiContentPublishChannelOption,
} from "../../features/ai-content/aiContentPublishTargets";
import type {
  AiContentPublishTargetInput,
  AiContentPublishTargetResult,
  AiContentType,
} from "../../features/ai-content/types";
import type { ChannelConnection, ChannelType } from "../../types";

interface AiContentPublishPanelProps {
  type: AiContentType;
  assetCount: number;
  channels: readonly ChannelConnection[];
  publishing: boolean;
  results: readonly AiContentPublishTargetResult[];
  onPublish(targets: AiContentPublishTargetInput[]): Promise<void>;
  onConnectionPending?(channel: ChannelType): void;
}

function targetKey(target: AiContentPublishTargetInput) {
  return `${target.channel}:${target.deliveryFormat}`;
}

function resultLabel(result: AiContentPublishTargetResult) {
  if (result.status === "rendering") return "릴스 변환 중";
  if (result.status === "published") return "게시 완료";
  if (result.status === "failed") return "게시 실패";
  if (result.status === "publishing") return "게시 중";
  return "게시 대기";
}

export function aiContentPublishErrorMessage(errorCode: string | null) {
  switch (errorCode) {
    case "channel_oauth_not_connected":
    case "instagram_business_account_id_required":
      return "Instagram 연결이 필요합니다.";
    case "instagram_access_token_required":
    case "oauth_required":
    case "meta_token_invalid":
    case "meta_permission_denied":
    case "meta_graph_401":
    case "meta_graph_403":
      return "Instagram 인증이 만료되었거나 권한이 없습니다.";
    case "instagram_rendered_story_required":
    case "instagram_rendered_manifest_required":
      return "스토리에 사용할 이미지 주소를 확인할 수 없습니다.";
    case "instagram_manifest_fetch_failed":
      return "게시 이미지 준비가 지연되었습니다. 잠시 후 다시 시도해 주세요.";
    case "instagram_story_publish_failed":
    case "story_capability_required":
      return "Instagram 스토리 게시에 실패했습니다.";
    case "instagram_public_url_required":
    case "instagram_media_invalid":
    case "instagram_image_fetch_failed":
      return "Instagram에서 결과물 이미지에 접근하지 못했습니다. 공개 이미지 주소를 확인해 주세요.";
    case "delivery_format_asset_mismatch":
    case "instagram_manifest_delivery_format_mismatch":
      return "선택한 게시 유형과 결과물 형식이 맞지 않습니다.";
    default:
      return errorCode ? `게시 실패 (${errorCode})` : "게시 실패 원인을 확인하지 못했습니다.";
  }
}

function ConnectionAction({
  option,
  onPending,
}: {
  option: AiContentPublishChannelOption;
  onPending?: (channel: ChannelType) => void;
}) {
  const url = channelConnectionUrl(option.channel);
  if (url) {
    return <a className="button" href={url}>연결하기</a>;
  }
  return (
    <button className="button" type="button" onClick={() => onPending?.(option.channel)}>
      연결하기
    </button>
  );
}

export function AiContentPublishPanel({
  type,
  assetCount,
  channels,
  publishing,
  results,
  onPublish,
  onConnectionPending,
}: AiContentPublishPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingChannel, setPendingChannel] = useState<ChannelType | null>(null);
  const options = useMemo(
    () => buildAiContentPublishOptions({ type, assetCount, channels }),
    [type, assetCount, channels],
  );
  const resultMap = useMemo(() => new Map(results.map((result) => [targetKey(result), result])), [results]);
  const targets = options.flatMap((option) => option.formats
    .filter((format) => selected.has(`${option.channel}:${format.deliveryFormat}`))
    .map((format) => ({ channel: option.channel, deliveryFormat: format.deliveryFormat })));

  if (type === "blog") {
    return <p className="small muted ai-publish-panel__unsupported">현재 HTML 결과는 SNS 직접 게시를 지원하지 않습니다.</p>;
  }

  return (
    <section className="ai-publish-panel" aria-label="SNS에 바로 게시">
      <div className="ai-publish-panel__head">
        <div>
          <h4>SNS에 바로 게시</h4>
          <p className="small muted">결과물별로 게시할 채널과 유형을 선택하세요.</p>
        </div>
      </div>

      <div className="ai-publish-channels">
        {options.map((option) => (
          <div className="ai-publish-channel" key={option.channel}>
            <div className="ai-publish-channel__identity">
              <ChannelLogo channel={option.channel} decorative size={22} />
              <div>
                <strong>{option.label}</strong>
                {option.accountLabel ? <span className="small muted">{option.accountLabel}</span> : null}
              </div>
            </div>

            {option.connected && option.formats.length ? (
              <div className="ai-publish-formats">
                {option.formats.map((format) => {
                  const key = `${option.channel}:${format.deliveryFormat}`;
                  const result = resultMap.get(key);
                  const checked = selected.has(key);
                  return (
                    <div className={`ai-publish-format${checked ? " is-selected" : ""}`} key={format.deliveryFormat}>
                      <label title={format.reason ?? undefined}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!format.enabled || publishing || result?.status === "published"}
                          onChange={() => setSelected((current) => {
                            const next = new Set(current);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })}
                        />
                        <span className="ai-publish-format__label">{format.label}</span>
                      </label>
                      {format.reason ? <span className="small muted">{format.reason}</span> : null}
                      {result ? <span className={`ai-publish-result ai-publish-result--${result.status}`}>{resultLabel(result)}</span> : null}
                      {result?.status === "failed" ? (
                        <span className="small bad" role="alert">{aiContentPublishErrorMessage(result.errorCode)}</span>
                      ) : null}
                      {result?.status === "failed" ? (
                        <button
                          type="button"
                          className="button compact"
                          disabled={publishing}
                          onClick={() => void onPublish([{ channel: option.channel, deliveryFormat: format.deliveryFormat }])}
                        >
                          다시 시도
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : option.connected ? (
              <p className="small muted">이 결과 유형은 아직 직접 게시를 지원하지 않습니다.</p>
            ) : (
              <p className="small muted">{option.label} {option.statusLabel}</p>
            )}

            {!option.connected ? (
              <div className="ai-publish-channel__action">
                <ConnectionAction
                  option={option}
                  onPending={(channel) => {
                    setPendingChannel(channel);
                    onConnectionPending?.(channel);
                  }}
                />
                {pendingChannel === option.channel && !channelConnectionUrl(option.channel)
                  ? <span className="small muted">연결 준비 중</span>
                  : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="ai-publish-panel__actions">
        <button
          className="button primary"
          type="button"
          disabled={publishing || targets.length === 0}
          onClick={() => void onPublish(targets)}
        >
          {publishing ? "게시 중" : targets.length > 0 ? `선택한 ${targets.length}개 유형 게시` : "게시 유형 선택"}
        </button>
      </div>
    </section>
  );
}
