import { useMemo, useState } from "react";

import type {
  BadgeVariant,
  ChannelType,
  PublishItem,
  PublishItemReviewTarget,
  PublishItemTarget,
  PublishResultChannel,
  ReviewStatus,
} from "../../types";
import { formatPublishDateTime } from "../../features/publishing/publishCalendar";
import { canReschedulePublishItem, listItems } from "../../features/publishing/publishItems";
import { publishErrorPresentation, publishStatusPresentation } from "../../features/publishing/publishPresentation";
import { ChannelLogo } from "../channels/ChannelLogo";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { canSchedulePublishItem } from "./PublishSchedulePanel";
import { PublishManagementPreview, resolvePublishPreview } from "./PublishManagementPreview";
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementFilterId,
  type PublishManagementStatus,
} from "./publishManagementFilters";

const PAGE_SIZE = 30;

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
};

const channelOrder: ChannelType[] = ["instagram", "threads", "x", "linkedin", "youtube", "tiktok"];

function sortChannels<T extends { channel: ChannelType }>(channels: T[]) {
  return [...channels].sort((left, right) => channelOrder.indexOf(left.channel) - channelOrder.indexOf(right.channel));
}

const resultStatusMeta: Record<PublishResultChannel["status"], { label: string; variant: BadgeVariant; clickable: boolean }> = {
  queued: { label: "게시 대기", variant: "neutral", clickable: false },
  scheduled: { label: "예약", variant: "info", clickable: false },
  publishing: { label: "게시 중", variant: "info", clickable: false },
  published: { label: "성공", variant: "ok", clickable: true },
  failed: { label: "실패", variant: "bad", clickable: true },
  deferred: { label: "이월", variant: "warn", clickable: false },
  cancelled: { label: "취소", variant: "neutral", clickable: false },
};

const reviewStatusMeta: Record<ReviewStatus, { label: string; variant: BadgeVariant }> = {
  generating: { label: "생성 중", variant: "info" },
  generation_failed: { label: "생성 실패", variant: "bad" },
  pending_review: { label: "검토 필요", variant: "warn" },
  auto_approval_blocked: { label: "수동 승인 필요", variant: "bad" },
  approved: { label: "승인됨", variant: "ok" },
  auto_approved: { label: "자동 승인", variant: "ok" },
  rejected: { label: "거절됨", variant: "neutral" },
  regenerating: { label: "재생성 중", variant: "info" },
};

export function publishManagementStatusForItem(item: PublishItem): PublishManagementStatus {
  if (item.contentStatus === "pre_generation" || item.contentStatus === "generating") return "preparing";
  return item.operationalStatus;
}

function isHighlighted(item: PublishItem, highlightedQueueId: string | null) {
  return Boolean(highlightedQueueId && item.targets.some((target) => target.queueId === highlightedQueueId));
}

export interface PublishManagementListProps {
  items: PublishItem[];
  initialFilter: PublishManagementFilterId;
  highlightedQueueId: string | null;
  onSelectResult: (item: PublishItem, target: PublishItemTarget) => void;
  onSelectReviewTarget: (item: PublishItem, target: PublishItemReviewTarget) => void;
  onReviewTargets: (
    targets: PublishItemReviewTarget[],
    action: "approve" | "reject" | "regenerate",
    message: string,
  ) => void;
  reviewingOutputIds: ReadonlySet<string>;
  onRetryPublish: (queueId: string) => void;
  onVerifyPublish: (queueId: string) => void;
  onCancelPublish: (item: PublishItem, target: PublishItemTarget) => void;
  onSchedule: (item: PublishItem, trigger: HTMLButtonElement) => void;
  onReschedule: (item: PublishItem, trigger: HTMLButtonElement) => void;
}

export function PublishManagementList({
  items,
  initialFilter,
  highlightedQueueId,
  onSelectResult,
  onSelectReviewTarget,
  onReviewTargets,
  reviewingOutputIds,
  onRetryPublish,
  onVerifyPublish,
  onCancelPublish,
  onSchedule,
  onReschedule,
}: PublishManagementListProps) {
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const rows = useMemo(() => listItems(items), [items]);
  const statuses = useMemo(() => rows.map(publishManagementStatusForItem), [rows]);
  const counts = useMemo(() => countPublishManagementFilters(statuses), [statuses]);
  const filtered = useMemo(
    () => rows.filter((item) => matchesPublishManagementFilter(publishManagementStatusForItem(item), activeFilter)),
    [activeFilter, rows],
  );

  const visibleItems = useMemo(() => {
    const visible = filtered.slice(0, visibleLimit);
    const highlighted = highlightedQueueId
      ? rows.find((item) => isHighlighted(item, highlightedQueueId))
      : undefined;
    if (!highlighted || visible.some((item) => item.itemKey === highlighted.itemKey)) return visible;
    if (visible.length < visibleLimit) return [...visible, highlighted];
    return [...visible.slice(0, Math.max(0, visible.length - 1)), highlighted];
  }, [filtered, highlightedQueueId, rows, visibleLimit]);

  function changeFilter(filter: PublishManagementFilterId) {
    setActiveFilter(filter);
    setVisibleLimit(PAGE_SIZE);
  }

  return <section className="panel">
    <div className="panel-head"><h2>게시 목록</h2><div className="actions queue-filters">
      {publishManagementFilters.map((filter) => <button key={filter.id} type="button" className={activeFilter === filter.id ? "button primary" : "button"} aria-pressed={activeFilter === filter.id} onClick={() => changeFilter(filter.id)}>{filter.label} <span>{counts[filter.id]}</span></button>)}
    </div></div>
    <div className="panel-body"><div className="publish-management-grid" role="region" aria-label="게시 관리 통합 목록">
      {visibleItems.length === 0 ? <EmptyState title="게시 관리 목록이 비어 있습니다" description="생성, 예약, 게시 결과가 생기면 이 목록에 표시됩니다." /> : visibleItems.map((item) => {
        const meta = publishStatusPresentation(item.operationalStatus);
        const deepLinked = isHighlighted(item, highlightedQueueId);
        const previewTarget = item.targets.find((target) => target.artifactPublicUrl || target.previewBody || target.previewTitle) ?? item.targets[0];
        const reviewTargets = item.reviewTargets ?? [];
        const previewReviewTarget = reviewTargets.find((target) => target.previewBody || target.previewTitle) ?? reviewTargets[0];
        const approvable = reviewTargets.filter((target) => target.status === "pending_review" || target.status === "auto_approval_blocked");
        const rejectable = reviewTargets.filter((target) => target.status === "pending_review" || target.status === "auto_approval_blocked" || target.status === "generation_failed");
        const regeneratable = rejectable.filter((target) => target.channel === "instagram" || target.channel === "threads");
        const reviewPending = reviewTargets.some((target) => reviewingOutputIds.has(target.channelOutputId));
        return <article className={`publish-management-card${deepLinked ? " is-highlighted" : ""}`} aria-label={item.title} data-item-key={item.itemKey} data-publish-focus-key={item.itemKey} data-publish-deep-link={deepLinked ? "true" : undefined} tabIndex={-1} key={item.itemKey}>
          <div className="publish-management-card__preview"><PublishManagementPreview title={item.title} preview={resolvePublishPreview({ title: item.title, artifactPublicUrl: previewTarget?.artifactPublicUrl ?? undefined, outputJson: previewTarget?.outputJson ?? previewReviewTarget?.outputJson, previewBody: previewTarget?.previewBody ?? previewReviewTarget?.previewBody ?? undefined, contentStatus: item.contentStatus })} /></div>
          <div className="publish-management-card__body">
            <div className="publish-management-card__heading"><strong className="publish-management-card__title">{item.title}</strong><Badge variant={meta.variant}>{meta.label}</Badge></div>
            <div className="row-meta">{formatPublishDateTime(item.calendarDate ?? item.createdAt)}</div>
            <div className="publish-management-card__channels">{sortChannels(item.targets).map((target) => {
              const targetMeta = resultStatusMeta[target.status];
              return <button type="button" className={`button ${targetMeta.clickable ? "" : "is-disabled"}`} disabled={!targetMeta.clickable} onClick={() => onSelectResult(item, target)} key={target.queueId}><span className="channel-identity"><ChannelLogo channel={target.channel} decorative size={16} /><span>{channelLabels[target.channel]} {targetMeta.label}</span></span></button>;
            })}</div>
            {reviewTargets.length > 0 ? <div className="publish-management-card__channels">{sortChannels(reviewTargets).map((target) => <Badge variant={reviewStatusMeta[target.status].variant} key={target.channelOutputId}><span className="channel-identity"><ChannelLogo channel={target.channel} decorative size={16} /><span>{channelLabels[target.channel]} {reviewStatusMeta[target.status].label}</span></span></Badge>)}</div> : null}
            {reviewTargets.length > 0 ? <div className="publish-management-card__actions">
              {reviewTargets.filter((target) => !["generating", "generation_failed", "regenerating"].includes(target.status)).map((target) => <button className="button" type="button" key={`review-preview-${target.channelOutputId}`} onClick={() => onSelectReviewTarget(item, target)}>콘텐츠 보기</button>)}
              {approvable.length > 0 ? <button className="button primary" type="button" disabled={reviewPending} onClick={() => onReviewTargets(approvable, "approve", "게시 관리 목록에 등록했습니다.")}>{approvable.some((target) => target.status === "auto_approval_blocked") ? "수동 승인" : "승인"}</button> : null}
              {regeneratable.length > 0 ? <button className="button" type="button" disabled={reviewPending} onClick={() => onReviewTargets(regeneratable, "regenerate", "재생성 요청을 접수했습니다.")}>재생성</button> : null}
              {rejectable.length > 0 ? <button className="button danger" type="button" disabled={reviewPending} onClick={() => onReviewTargets(rejectable, "reject", "콘텐츠를 거절했습니다.")}>거절</button> : null}
            </div> : null}
            {canSchedulePublishItem(item) ? <div className="publish-management-card__actions"><button className="button primary" type="button" onClick={(event) => onSchedule(item, event.currentTarget)}>게시 설정</button></div> : null}
            {canReschedulePublishItem(item) ? <div className="publish-management-card__actions"><button className="button primary" type="button" onClick={(event) => onReschedule(item, event.currentTarget)}>예약 변경</button></div> : null}
            {item.scheduledFor ? <div className="row-meta">원래 예약 {formatPublishDateTime(item.scheduledFor)}</div> : null}
            {item.effectiveScheduledFor && item.effectiveScheduledFor !== item.scheduledFor ? <div className="row-meta">실제 실행 예정 {formatPublishDateTime(item.effectiveScheduledFor)}</div> : null}
            {item.publishedAt ? <div className="row-meta">게시 완료 {formatPublishDateTime(item.publishedAt)}</div> : null}
            {item.lastError ? <div className="row-meta is-error">{publishErrorPresentation(item.lastError).message}</div> : null}
            {item.targets.map((target) => {
              const resultUnknown = target.status === "failed" && target.lastError === "publish_delivery_unknown";
              const errorPresentation = publishErrorPresentation(target.lastError);
              const retryAllowed = target.status === "failed" && errorPresentation.action === "retry_publish";
              const reconnectAllowed = target.status === "failed" && errorPresentation.action === "reconnect_channel";
              const cancellable = item.publicationProgress === "none"
                && !item.targets.some((candidate) => candidate.status === "publishing")
                && (target.status === "queued" || target.status === "scheduled" || target.status === "deferred");
              if (!resultUnknown && !retryAllowed && !reconnectAllowed && !cancellable) return null;
              return <div className="publish-management-card__actions" key={`actions-${target.queueId}`}>
                {resultUnknown ? <button className="button" type="button" onClick={() => onVerifyPublish(target.queueId)}>게시 결과 확인</button> : null}
                {retryAllowed ? <button className="button" type="button" onClick={() => onRetryPublish(target.queueId)}>재시도</button> : null}
                {reconnectAllowed ? <a className="button" href="/channels">채널 다시 연결</a> : null}
                {cancellable ? <button className="button" type="button" onClick={() => onCancelPublish(item, target)}>예약 취소</button> : null}
              </div>;
            })}
          </div>
        </article>;
      })}
    </div>
    {filtered.length > visibleLimit ? <div className="actions"><button className="button" type="button" onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}>더 보기</button></div> : null}
    </div>
  </section>;
}
