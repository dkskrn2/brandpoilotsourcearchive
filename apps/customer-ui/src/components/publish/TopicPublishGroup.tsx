import { Badge } from "../ui/Badge";
import type { BadgeVariant, PublishResult, PublishResultChannel, PublishSlot } from "../../types";

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
  if (deliveryFormat === "instagram_reel") return "Instagram · Reel";
  if (deliveryFormat === "instagram_story") return "Instagram · 스토리";
  if (deliveryFormat === "instagram_feed_carousel") return "Instagram · 카드뉴스";
  if (item.slot.channel === "instagram") return "Instagram · 카드뉴스";
  if (item.slot.channel === "threads") return "Threads · 텍스트";
  return item.slot.channel;
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

export function TopicPublishGroup({
  group,
  onSelectResult
}: {
  group: TopicPublishGroupModel;
  onSelectResult: (result: PublishResult, channel: PublishResultChannel) => void;
}) {
  return (
    <tr>
      <td>
        <strong>{group.title}</strong>
        <div className="row-meta">{formatScheduledAt(group.scheduledFor)}</div>
        {group.slotNumber ? <div className="row-meta">슬롯 {group.slotNumber}</div> : null}
        {group.items.some((item) => item.slot.approvalType === "empty") ? <Badge variant="neutral">대기</Badge> : null}
        <div className="row-meta">{group.items[0]?.slot.sourceLabel}</div>
        {group.items[0]?.slot.sourceUrls.map((url) => <div className="row-meta" key={url}>{url}</div>)}
      </td>
      <td colSpan={6}>
        <div className="grid">
          {group.items.map((item) => {
            const label = formatLabel(item);
            const meta = statusMeta[item.slot.status];
            const error = item.slot.lastError ?? item.resultChannel?.lastError;
            const externalUrl = item.resultChannel?.externalUrl;
            const canOpenDetail = item.slot.status === "published" && item.result && item.resultChannel;
            const isPreGeneration = item.slot.approvalType === "empty";
            return (
              <div className="preview" key={item.slot.id}>
                <div className="panel-head">
                  {isPreGeneration ? (
                    <button type="button" className="button is-disabled" disabled>{item.slot.channel === "instagram" ? "Instagram" : "Threads"} 생성 전</button>
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
                {error ? <div className="row-meta">{error}</div> : null}
                <div className="actions">
                  {externalUrl ? <a className="button" href={externalUrl} target="_blank" rel="noreferrer">게시물 열기</a> : null}
                </div>
              </div>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
