import { Badge } from "../ui/Badge";
import { PublishManagementPreview, resolvePublishPreview } from "./PublishManagementPreview";
import type { BadgeVariant, PublishResult, PublishResultChannel, PublishSlot } from "../../types";

const channelLabels: Record<PublishSlot["channel"], string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok"
};

const deliveryFormatLabels: Record<string, string> = {
  instagram_feed_carousel: "카드뉴스",
  instagram_story: "스토리",
  instagram_reel: "Reel",
  threads_text: "텍스트",
  x_post: "게시물",
  linkedin_post: "게시물",
  youtube_video: "영상",
  youtube_short: "Short",
  tiktok_video: "영상"
};

export interface TopicPublishGroupItem {
  slot: PublishSlot;
  result: PublishResult | null;
  resultChannel: PublishResultChannel | null;
}

export interface TopicPublishGroupModel {
  id: string;
  title: string;
  scheduledFor: string | null;
  slotNumber: number | null;
  items: TopicPublishGroupItem[];
}

const statusMeta: Record<PublishSlot["status"], { label: string; variant: BadgeVariant }> = {
  queued: { label: "게시 대기", variant: "neutral" },
  scheduled: { label: "예약", variant: "info" },
  publishing: { label: "게시 중", variant: "info" },
  published: { label: "게시 완료", variant: "ok" },
  failed: { label: "실패", variant: "bad" },
  deferred: { label: "이월", variant: "warn" },
  cancelled: { label: "취소", variant: "neutral" },
  empty: { label: "생성 전", variant: "neutral" }
};

function formatLabel(item: TopicPublishGroupItem) {
  const deliveryFormat = item.resultChannel?.outputJson?.deliveryFormat;
  const format = typeof deliveryFormat === "string" ? deliveryFormatLabels[deliveryFormat] : null;
  const fallback = item.slot.channel === "instagram" ? "카드뉴스"
    : item.slot.channel === "threads" ? "텍스트"
    : item.slot.channel === "x" || item.slot.channel === "linkedin" ? "게시물"
    : "영상";
  return `${channelLabels[item.slot.channel]} · ${format ?? fallback}`;
}

function formatScheduledAt(value: string | null) {
  if (!value) return "정책 배정 대기";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}월 ${part("day")}일 ${part("hour")}:${part("minute")}`;
}

function formatPublishedAt(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function TopicPublishGroup({
  group,
  onSelectResult
}: {
  group: TopicPublishGroupModel;
  onSelectResult: (result: PublishResult, channel: PublishResultChannel) => void;
}) {
  const representative = group.items.find((item) => item.resultChannel) ?? group.items[0];
  const representativeChannel = representative?.resultChannel;
  const statuses = group.items.map((item) => item.slot.status);
  const groupStatus: PublishSlot["status"] = statuses.some((status) => status === "failed") ? "failed"
    : statuses.some((status) => status === "publishing") ? "publishing"
    : statuses.some((status) => status === "scheduled") ? "scheduled"
    : statuses.length > 0 && statuses.every((status) => status === "published") ? "published"
    : statuses.some((status) => status === "queued") ? "queued"
    : statuses[0] ?? "empty";
  const groupMeta = statusMeta[groupStatus];
  const isPreGenerationGroup = group.items.every((item) => item.slot.approvalType === "empty");
  const preview = resolvePublishPreview({
    title: group.title,
    artifactPublicUrl: representativeChannel?.artifactPublicUrl,
    outputJson: representativeChannel?.outputJson,
    previewBody: representativeChannel?.previewBody,
    pending: !representativeChannel && representative?.slot.approvalType === "empty",
    failed: groupStatus === "failed" && !representativeChannel
  });

  return (
    <article className="publish-management-card" aria-label={group.title}>
      <div className="publish-management-card__preview">
        <PublishManagementPreview title={group.title} preview={preview} />
      </div>
      <div className="publish-management-card__body">
        <div className="publish-management-card__heading">
          <strong className="publish-management-card__title">{group.title}</strong>
          <Badge variant={groupMeta.variant}>{isPreGenerationGroup ? "대기" : groupMeta.label}</Badge>
        </div>
        <div className="row-meta">
          {formatScheduledAt(group.scheduledFor)}
          {group.slotNumber ? ` · 슬롯 ${group.slotNumber}` : ""}
        </div>
        <div className="publish-management-card__channels">
          {group.items.map((item) => {
            const label = formatLabel(item);
            const meta = statusMeta[item.slot.status];
            const error = item.slot.lastError ?? item.resultChannel?.lastError;
            const externalUrl = item.resultChannel?.externalUrl;
            const canOpenDetail = item.slot.status === "published" && item.result && item.resultChannel;
            const isPreGeneration = item.slot.approvalType === "empty";
            return (
              <div className="publish-management-card__channel" key={item.slot.id}>
                <div className="publish-management-card__channel-head">
                  {isPreGeneration ? (
                    <button type="button" className="button is-disabled" disabled>{channelLabels[item.slot.channel]} 생성 전</button>
                  ) : canOpenDetail ? (
                    <button
                      type="button"
                      className="button"
                      aria-label={`${label} 상세`}
                      onClick={() => onSelectResult(item.result!, item.resultChannel!)}
                    >
                      {label}
                    </button>
                  ) : <strong>{label}</strong>}
                  <Badge variant={meta.variant}>{isPreGeneration ? "생성 전" : meta.label}</Badge>
                </div>
                {item.resultChannel?.publishedAt ? (
                  <div className="row-meta">게시일시 {formatPublishedAt(item.resultChannel.publishedAt)}</div>
                ) : null}
                {error ? <div className="row-meta">{error}</div> : null}
                <div className="publish-management-card__actions">
                  {externalUrl ? <a className="button" href={externalUrl} target="_blank" rel="noreferrer">게시물 열기</a> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
