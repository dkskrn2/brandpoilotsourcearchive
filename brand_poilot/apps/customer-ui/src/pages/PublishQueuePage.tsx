import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Download, ExternalLink, List, RotateCcw, X } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { PublishArtifactPreview } from "../components/publish/PublishArtifactPreview";
import { ContentArtifactDialog } from "../components/publish/ContentArtifactDialog";
import { ChannelLogo } from "../components/channels/ChannelLogo";
import { PublishManagementPreview, resolvePublishPreview } from "../components/publish/PublishManagementPreview";
import { CardSkeleton, InlineSpinner, ListSkeleton } from "../components/ui/LoadingState";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { TopicPublishGroup, type TopicPublishGroupModel } from "../components/publish/TopicPublishGroup";
import { PublishCalendar } from "../components/publish/PublishCalendar";
import {
  countPublishManagementFilters,
  matchesPublishManagementFilter,
  publishManagementFilters,
  type PublishManagementFilterId,
  type PublishManagementStatus
} from "../components/publish/publishManagementFilters";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import { entryFromSlot, monthPeriod, PUBLISH_CALENDAR_USAGE_CHANGED_EVENT, type CalendarEntry } from "../features/publishing/publishCalendar";
import { clearPublishCalendarBulkDraft, loadPublishCalendarBulkDraft, savePublishCalendarBulkDraft, type PublishCalendarBulkDraft, type PublishCalendarBulkDraftRow } from "../features/publishing/publishCalendarBulkDraft";
import type { BadgeVariant, ChannelType, ContentOutput, PublishArtifact, PublishCalendarContentCandidate, PublishCalendarManualOptions, PublishCalendarManualSlotInput, PublishCalendarNewContentSetup, PublishCalendarSettings, PublishCalendarSlot, PublishResult, PublishResultChannel, PublishSlot, ReviewStatus } from "../types";

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X"
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
  cancelled: { label: "취소", variant: "neutral", clickable: false }
};

const reviewStatusMeta: Record<ReviewStatus, { label: string; variant: BadgeVariant }> = {
  generating: { label: "생성 중", variant: "info" },
  generation_failed: { label: "생성 실패", variant: "bad" },
  pending_review: { label: "검토 필요", variant: "warn" },
  approved: { label: "승인됨", variant: "ok" },
  auto_approved: { label: "자동 승인", variant: "ok" },
  auto_approval_blocked: { label: "자동 승인 차단", variant: "bad" },
  regenerating: { label: "재생성 중", variant: "info" },
  rejected: { label: "거절됨", variant: "neutral" }
};

const unknownReviewMeta: { label: string; variant: BadgeVariant } = {
  label: "상태 확인 필요",
  variant: "neutral"
};

type ManagementFilterId = PublishManagementFilterId;
type ManagementStatus = PublishManagementStatus;
type PublishView = "list" | "calendar";

interface ReviewManagementRow {
  kind: "review";
  id: string;
  contentId: string;
  title: string;
  generatedAt: string;
  status: "generating" | "needs_review" | "rejected";
  outputs: ContentOutput[];
  sourceSummary: string;
  blockReasons: string[];
}

interface PublishManagementRow {
  kind: "publish";
  id: string;
  contentId: string;
  title: string;
  generatedAt: string;
  status: "publish_queued" | "scheduled" | "publishing" | "completed" | "result_unknown" | "failed";
  result: PublishResult;
}

interface WaitingManagementRow {
  kind: "waiting";
  id: string;
  contentId: string;
  title: string;
  generatedAt: string;
  status: "queued";
  slot: PublishSlot;
}

interface TopicGroupManagementRow {
  kind: "topic_group";
  id: string;
  contentId: string;
  title: string;
  generatedAt: string;
  status: ManagementStatus;
  group: TopicPublishGroupModel;
}

type ManagementRow = ReviewManagementRow | PublishManagementRow | WaitingManagementRow | TopicGroupManagementRow;

function rowContainsQueueId(row: ManagementRow, queueId: string | null) {
  if (!queueId) return false;
  if (row.kind === "topic_group") return row.group.items.some((item) => item.slot.id === queueId);
  if (row.kind === "publish") return row.result.channels.some((channel) => channel.queueId === queueId);
  if (row.kind === "waiting") return row.slot.id === queueId;
  return false;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function PublishedAtCell({ result }: { result: PublishResult }) {
  const publishedChannels = result.channels.filter((channel) => channel.publishedAt);
  if (publishedChannels.length === 0) return <span className="row-meta">-</span>;

  return (
    <>
      {publishedChannels.map((channel) => (
        <div className="row-meta" key={`${channel.queueId}-published-at`}>
          {channelLabels[channel.channel]} {formatDateTime(channel.publishedAt!)}
        </div>
      ))}
    </>
  );
}

function normalizeOutput(output: ContentOutput): ContentOutput {
  return {
    ...output,
    topicId: output.topicId ?? "DB",
    sourceSummary: output.sourceSummary ?? "DB에 저장된 생성 근거",
    previewTitle: output.previewTitle ?? output.title,
    previewBody: output.previewBody ?? ""
  };
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function isGeneratedOutput(output: ContentOutput) {
  const generationState = output.outputJson?.generationState;
  const artifactStatus = output.outputJson?.artifactStatus;
  if (generationState === "pending" || generationState === "failed" || artifactStatus === "pending" || artifactStatus === "failed") {
    return false;
  }
  return output.status === "pending_review" || output.status === "auto_approval_blocked" || output.status === "rejected";
}

function statusForPublishResult(result: PublishResult): PublishManagementRow["status"] {
  const statuses = result.channels.map((item) => item.status);

  if (result.channels.some((channel) => channel.status === "failed" && channel.lastError === "publish_delivery_unknown")) return "result_unknown";
  if (statuses.some((status) => status === "failed" || status === "cancelled")) return "failed";
  if (statuses.some((status) => status === "publishing")) return "publishing";
  if (statuses.some((status) => status === "scheduled")) return "scheduled";
  if (statuses.length > 0 && statuses.every((status) => status === "published")) return "completed";
  return "publish_queued";
}

function statusLabel(row: ManagementRow) {
  const labels: Record<ManagementStatus, string> = {
    needs_review: "검토 필요",
    generating: "생성 중",
    queued: "대기",
    publish_queued: "게시 대기",
    scheduled: "예약",
    publishing: "게시 중",
    completed: "완료",
    result_unknown: "결과 확인 필요",
    failed: "실패",
    rejected: "거절됨"
  };
  return labels[row.status];
}

function statusVariant(row: ManagementRow): BadgeVariant {
  const variants: Record<ManagementStatus, BadgeVariant> = {
    needs_review: "warn",
    generating: "info",
    queued: "neutral",
    publish_queued: "neutral",
    scheduled: "info",
    publishing: "info",
    completed: "ok",
    result_unknown: "warn",
    failed: "bad",
    rejected: "neutral"
  };
  return variants[row.status];
}

function buildReviewRows(outputs: ContentOutput[]): ReviewManagementRow[] {
  const visibleStatuses = new Set<ReviewStatus>([
    "generating",
    "generation_failed",
    "pending_review",
    "auto_approval_blocked",
    "regenerating",
    "rejected"
  ]);
  const groups = new Map<string, ContentOutput[]>();

  for (const output of outputs) {
    if (!visibleStatuses.has(output.status)) continue;
    const key = output.contentId;
    groups.set(key, [...(groups.get(key) ?? []), output]);
  }

  return Array.from(groups.entries()).map(([contentId, groupedOutputs]) => {
    const firstOutput = groupedOutputs[0];
    const hasActionable = groupedOutputs.some((output) => (
      output.status === "pending_review"
      || output.status === "auto_approval_blocked"
      || output.status === "generation_failed"
    ));
    const hasGenerating = groupedOutputs.some((output) => output.status === "generating" || output.status === "regenerating");
    return {
      kind: "review",
      id: `review-${contentId}`,
      contentId,
      title: firstOutput.title,
      generatedAt: firstOutput.generatedAt,
      status: hasActionable ? "needs_review" : hasGenerating ? "generating" : "rejected",
      outputs: groupedOutputs,
      sourceSummary: uniqueText(groupedOutputs.map((output) => output.sourceSummary)).join(" | "),
      blockReasons: uniqueText(groupedOutputs.flatMap((output) => output.blockReasons ?? []))
        .filter((reason) => reason !== "generation_failed")
    };
  });
}

function buildPublishRows(results: PublishResult[]): PublishManagementRow[] {
  return results.map((result) => ({
    kind: "publish",
    id: `publish-${result.contentId}`,
    contentId: result.contentId,
    title: result.title,
    generatedAt: result.generatedAt,
    status: statusForPublishResult(result),
    result
  }));
}

function buildWaitingRows(queueRows: PublishSlot[]): WaitingManagementRow[] {
  return queueRows
    .filter((row) => row.approvalType === "empty")
    .map((row) => ({
      kind: "waiting",
      id: `waiting-${row.id}`,
      contentId: row.id,
      title: row.title,
      generatedAt: row.queuedAt,
      status: "queued",
      slot: row
    }));
}

function queueStatus(row: PublishSlot): ManagementStatus {
  if (row.approvalType === "empty") return "queued";
  if (row.status === "published") return "completed";
  if (row.status === "failed" && row.lastError === "publish_delivery_unknown") return "result_unknown";
  if (row.status === "failed" || row.status === "cancelled") return "failed";
  if (row.status === "publishing") return "publishing";
  if (row.status === "scheduled") return "scheduled";
  return "publish_queued";
}

function buildTopicGroupRows(queueRows: PublishSlot[], results: PublishResult[]): TopicGroupManagementRow[] {
  const resultByQueueId = new Map<string, { result: PublishResult; channel: PublishResultChannel }>();
  for (const result of results) {
    for (const channel of result.channels) resultByQueueId.set(channel.queueId, { result, channel });
  }

  const grouped = new Map<string, PublishSlot[]>();
  for (const slot of queueRows) {
    const representedByLegacyResult = resultByQueueId.has(slot.id) && !slot.topicPublishGroupId;
    if (representedByLegacyResult) continue;
    if (!slot.topicPublishGroupId && slot.scheduledFor === undefined && slot.approvalType !== "empty") continue;
    const key = slot.topicPublishGroupId ?? `legacy:${slot.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), slot]);
  }

  return Array.from(grouped.entries()).map(([id, slots]) => {
    const statuses = slots.map(queueStatus);
    const status: ManagementStatus = statuses.includes("result_unknown") ? "result_unknown"
      : statuses.includes("failed") ? "failed"
      : statuses.includes("publishing") ? "publishing"
      : statuses.includes("scheduled") ? "scheduled"
      : statuses.every((value) => value === "completed") ? "completed"
      : statuses.every((value) => value === "queued") ? "queued"
      : "publish_queued";
    const first = slots[0];
    return {
      kind: "topic_group",
      id: `topic-group-${id}`,
      contentId: id,
      title: first.title,
      generatedAt: first.scheduledFor ?? first.queuedAt,
      status,
      group: {
        id,
        title: first.title,
        scheduledFor: first.scheduledFor ?? null,
        slotNumber: first.slotNumber ?? null,
        items: slots.map((slot) => {
          const match = resultByQueueId.get(slot.id);
          return { slot, result: match?.result ?? null, resultChannel: match?.channel ?? null };
        })
      }
    };
  });
}

function ResultStatusButton({
  channel,
  resultChannel,
  onSelect
}: {
  channel: ChannelType;
  resultChannel?: PublishResultChannel;
  onSelect: (channel: PublishResultChannel) => void;
}) {
  if (!resultChannel) {
    return <Badge variant="neutral"><span className="channel-identity"><ChannelLogo channel={channel} decorative size={16} /><span>{channelLabels[channel]} 없음</span></span></Badge>;
  }

  const meta = resultStatusMeta[resultChannel.status];
  return (
    <button
      type="button"
      className={`button ${meta.clickable ? "" : "is-disabled"}`}
      disabled={!meta.clickable}
      onClick={() => onSelect(resultChannel)}
    >
      <span className="channel-identity"><ChannelLogo channel={channel} decorative size={16} /><span>{channelLabels[channel]} {meta.label}</span></span>
    </button>
  );
}

function WaitingChannelButtons({ slot }: { slot: PublishSlot }) {
  const { renderStatus } = slot;
  const instagramLabel = renderStatus === "running" ? "이미지 생성 중" : renderStatus === "failed" ? "이미지 생성 실패" : renderStatus === "succeeded" ? "게시 준비 완료" : renderStatus === "queued" ? "이미지 생성 대기" : "생성 전";
  return (
    <div className="actions">
      <button type="button" className="button is-disabled" disabled>
        <span className="channel-identity"><ChannelLogo channel={slot.channel} decorative size={16} /><span>{channelLabels[slot.channel]} {slot.channel === "instagram" ? instagramLabel : "생성 전"}</span></span>
      </button>
    </div>
  );
}

function ReviewChannelBadges({ outputs }: { outputs: ContentOutput[] }) {
  return (
    <div className="actions">
      {outputs.map((output) => {
        const meta = reviewStatusMeta[output.status] ?? unknownReviewMeta;
        return (
          <Badge key={output.id} variant={meta.variant}>
            <span className="channel-identity"><ChannelLogo channel={output.channel} decorative size={16} /><span>{channelLabels[output.channel]} {meta.label}</span></span>
          </Badge>
        );
      })}
    </div>
  );
}

function outputsForReviewAction(outputs: ContentOutput[], action: "approve" | "reject" | "regenerate") {
  if (action === "approve") {
    return outputs.filter((output) => (
      output.status === "pending_review" || output.status === "auto_approval_blocked"
    ) && output.outputJson?.generationState !== "pending" && output.outputJson?.artifactStatus !== "pending");
  }
  const reviewable = outputs.filter((output) => (
    output.status === "pending_review"
    || output.status === "auto_approval_blocked"
    || output.status === "generation_failed"
  ));
  return action === "regenerate"
    ? reviewable.filter((output) => output.channel === "instagram" || output.channel === "threads")
    : reviewable;
}

function PublishChannelButtons({
  result,
  onSelect
}: {
  result: PublishResult;
  onSelect: (result: PublishResult, channel: PublishResultChannel) => void;
}) {
  return (
    <div className="actions">
      {sortChannels(result.channels).map((resultChannel) => {
        const channel = resultChannel.channel;
        return (
          <ResultStatusButton
            key={`${result.contentId}-${resultChannel.queueId}`}
            channel={channel}
            resultChannel={resultChannel}
            onSelect={(selectedChannel) => onSelect(result, selectedChannel)}
          />
        );
      })}
    </div>
  );
}

function previewForManagementRow(row: Exclude<ManagementRow, TopicGroupManagementRow>) {
  if (row.kind === "waiting") {
    return resolvePublishPreview({ title: row.title, pending: true });
  }
  if (row.kind === "publish") {
    const channel = sortChannels(row.result.channels)[0];
    return resolvePublishPreview({
      title: row.title,
      artifactPublicUrl: channel?.artifactPublicUrl,
      outputJson: channel?.outputJson,
      previewBody: channel?.previewBody,
      failed: row.status === "failed" && !channel
    });
  }

  const output = row.outputs.find(isGeneratedOutput) ?? row.outputs[0];
  return resolvePublishPreview({
    title: row.title,
    previewImageUrl: output?.previewImageUrl,
    previewVideoUrl: output?.previewVideoUrl,
    previewPosterUrl: output?.previewPosterUrl,
    previewBody: output?.previewBody,
    outputJson: output?.outputJson,
    pending: !output || output.status === "generating" || output.status === "regenerating",
    failed: output?.status === "generation_failed"
  });
}

function ReviewCardActions({
  row,
  onSelectReviewOutput,
  onReviewGroup,
  reviewingOutputIds
}: {
  row: ReviewManagementRow;
  onSelectReviewOutput: (output: ContentOutput) => void;
  onReviewGroup: (outputs: ContentOutput[], action: "approve" | "reject" | "regenerate", message: string) => void;
  reviewingOutputIds: ReadonlySet<string>;
}) {
  const approvableOutputs = outputsForReviewAction(row.outputs, "approve");
  const regeneratableOutputs = outputsForReviewAction(row.outputs, "regenerate");
  const rejectableOutputs = outputsForReviewAction(row.outputs, "reject");
  const reviewPending = row.outputs.some((output) => reviewingOutputIds.has(output.id));

  return (
    <div className="publish-management-card__actions">
      {row.outputs.filter(isGeneratedOutput).map((output) => (
        <button className="button" type="button" key={`preview-${output.id}`} onClick={() => onSelectReviewOutput(output)}>
          콘텐츠 보기
        </button>
      ))}
      {row.outputs.some((output) => !isGeneratedOutput(output)) ? <span className="row-meta">콘텐츠 미생성</span> : null}
      {row.status === "needs_review" && approvableOutputs.length > 0 ? (
        <button
          className="button primary"
          type="button"
          disabled={reviewPending}
          onClick={() => onReviewGroup(approvableOutputs, "approve", "게시 관리 목록에 등록했습니다.")}
        >
          {approvableOutputs.some((output) => output.status === "auto_approval_blocked") ? "수동 승인" : "승인"}
        </button>
      ) : null}
      {row.status === "needs_review" && regeneratableOutputs.length > 0 ? (
        <button
          className="button"
          type="button"
          disabled={reviewPending}
          onClick={() => onReviewGroup(regeneratableOutputs, "regenerate", "재생성 요청을 접수했습니다.")}
        >
          재생성
        </button>
      ) : null}
      {row.status === "needs_review" && rejectableOutputs.length > 0 ? (
        <button
          className="button danger"
          type="button"
          disabled={reviewPending}
          onClick={() => onReviewGroup(rejectableOutputs, "reject", "콘텐츠를 거절했습니다.")}
        >
          거절
        </button>
      ) : null}
    </div>
  );
}

function ManagementCardGrid({
  rows,
  activeFilter,
  onFilterChange,
  onSelectResult,
  onSelectReviewOutput,
  onReviewGroup,
  reviewingOutputIds,
  highlightedQueueId,
  onRetryPublish,
  onVerifyPublish,
  onCancelPublish
}: {
  rows: ManagementRow[];
  activeFilter: ManagementFilterId;
  onFilterChange: (filter: ManagementFilterId) => void;
  onSelectResult: (result: PublishResult, channel: PublishResultChannel) => void;
  onSelectReviewOutput: (output: ContentOutput) => void;
  onReviewGroup: (outputs: ContentOutput[], action: "approve" | "reject" | "regenerate", message: string) => void;
  reviewingOutputIds: ReadonlySet<string>;
  highlightedQueueId: string | null;
  onRetryPublish: (queueId: string) => void;
  onVerifyPublish: (queueId: string) => void;
  onCancelPublish: (queueId: string) => void;
}) {
  const counts = countPublishManagementFilters(rows.map((row) => row.status));
  const filteredRows = rows.filter((row) => (
    matchesPublishManagementFilter(row.status, activeFilter) || rowContainsQueueId(row, highlightedQueueId)
  ));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>게시 목록</h2>
        <div className="actions queue-filters">
          {publishManagementFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={activeFilter === filter.id ? "button primary" : "button"}
              aria-pressed={activeFilter === filter.id}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label} <span>{counts[filter.id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        <div className="publish-management-grid" role="region" aria-label="게시 관리 통합 목록">
          {filteredRows.length === 0 ? (
            <EmptyState
              title="게시 관리 목록이 비어 있습니다"
              description="생성, 승인, 예약, 게시 결과가 생기면 이 목록에 표시됩니다."
            />
          ) : filteredRows.map((row) => row.kind === "topic_group" ? (
              <TopicPublishGroup
                key={row.id}
                group={row.group}
                onSelectResult={onSelectResult}
                onRetry={onRetryPublish}
                onVerify={onVerifyPublish}
                onCancel={onCancelPublish}
                highlightedQueueId={highlightedQueueId}
              />
            ) : (
              <article
                className={`publish-management-card${rowContainsQueueId(row, highlightedQueueId) ? " is-highlighted" : ""}`}
                aria-label={row.title}
                key={row.id}
                data-publish-deep-link={rowContainsQueueId(row, highlightedQueueId) ? "true" : undefined}
                tabIndex={rowContainsQueueId(row, highlightedQueueId) ? -1 : undefined}
              >
                <div className="publish-management-card__preview">
                  <PublishManagementPreview title={row.title} preview={previewForManagementRow(row)} />
                </div>
                <div className="publish-management-card__body">
                  <div className="publish-management-card__heading">
                    <strong className="publish-management-card__title">{row.title}</strong>
                    <Badge variant={statusVariant(row)}>{statusLabel(row)}</Badge>
                  </div>
                  <div className="row-meta">{formatDateTime(row.generatedAt)}</div>
                  <div className="publish-management-card__channels">
                    {row.kind === "publish" ? (
                      <PublishChannelButtons result={row.result} onSelect={onSelectResult} />
                    ) : row.kind === "waiting" ? (
                      <WaitingChannelButtons slot={row.slot} />
                    ) : (
                      <ReviewChannelBadges outputs={row.outputs} />
                    )}
                  </div>
                  {row.kind === "publish" ? <PublishedAtCell result={row.result} /> : null}
                  {row.kind === "publish" ? row.result.channels.map((channel) => {
                    const resultUnknown = channel.status === "failed" && channel.lastError === "publish_delivery_unknown";
                    const retryAllowed = channel.status === "failed"
                      && (channel.lastError === "oauth_required" || channel.lastError === "provider_not_implemented");
                    if (!resultUnknown && !retryAllowed && channel.status !== "failed") return null;
                    return (
                      <div className="publish-management-card__actions" key={`recovery-${channel.queueId}`}>
                        {resultUnknown ? (
                          <button className="button" type="button" onClick={() => onVerifyPublish(channel.queueId)}>게시 결과 확인</button>
                        ) : retryAllowed ? (
                          <button className="button" type="button" onClick={() => onRetryPublish(channel.queueId)}>재시도</button>
                        ) : (
                          <span className="row-meta">서버가 이 실패의 재시도를 허용하지 않습니다.</span>
                        )}
                      </div>
                    );
                  }) : null}
                  {row.kind === "review" ? (
                    <ReviewCardActions
                      row={row}
                      onSelectReviewOutput={onSelectReviewOutput}
                      onReviewGroup={onReviewGroup}
                      reviewingOutputIds={reviewingOutputIds}
                    />
                  ) : null}
                </div>
              </article>
            ))}
        </div>
      </div>
    </section>
  );
}

function PublishResultDialog({
  result,
  channel,
  onClose
}: {
  result: PublishResult;
  channel: PublishResultChannel;
  onClose: () => void;
}) {
  const meta = resultStatusMeta[channel.status];
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(true);
  const [artifactError, setArtifactError] = useState(false);
  const [artifactReloadKey, setArtifactReloadKey] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    setArtifact(null);
    setArtifactLoading(true);
    setArtifactError(false);

    api.getPublishArtifact(channel.queueId)
      .then((nextArtifact) => {
        if (!ignore) setArtifact(nextArtifact);
      })
      .catch(() => {
        if (!ignore) setArtifactError(true);
      })
      .finally(() => {
        if (!ignore) setArtifactLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [channel.queueId, artifactReloadKey]);

  const formatLabels: Record<string, string> = {
    instagram_feed_carousel: "카드뉴스",
    instagram_story: "스토리",
    instagram_reel: "Reel",
    threads_text: "텍스트",
    tiktok_video: "영상",
    youtube_video: "영상",
    youtube_short: "Short",
    linkedin_post: "게시물",
    x_post: "텍스트",
    image_gallery: "카드뉴스",
    image: "이미지",
    video: "영상",
    html: "HTML",
    text: "텍스트",
    unknown: "알 수 없음"
  };
  const formatLabel = artifact ? formatLabels[artifact.deliveryFormat ?? artifact.kind] ?? artifact.deliveryFormat ?? "알 수 없음" : null;
  const externalPostId = channel.externalPostId?.split("/").filter(Boolean).at(-1) ?? null;
  const sourceSummary = channel.sourceSummary ?? result.sourceDetail;

  async function downloadResult() {
    setDownloadLoading(true);
    setDownloadMessage(null);
    try {
      const download = await api.downloadPublishResult(channel.queueId);
      const objectUrl = URL.createObjectURL(download.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = download.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloadMessage({ text: "게시 결과 저장을 시작했습니다.", error: false });
    } catch (error) {
      const entitlementRequired = error instanceof Error && error.message.includes("download_entitlement_required");
      setDownloadMessage({
        text: entitlementRequired
          ? "이 결과를 저장하려면 다운로드 권한이 필요합니다. 결제 페이지에서 이용 권한을 확인하세요."
          : "게시 결과 저장에 실패했습니다. 잠시 후 다시 시도하세요.",
        error: true
      });
    } finally {
      setDownloadLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-panel publish-result-dialog" role="dialog" aria-modal="true" aria-label="업로드 콘텐츠 상세">
        <header className="publish-result-dialog__header">
          <div>
            <h2>{result.title}</h2>
            <div className="row-meta channel-identity"><ChannelLogo channel={channel.channel} decorative size={16} /><span>{channelLabels[channel.channel]}{formatLabel ? ` · ${formatLabel}` : ""}</span></div>
          </div>
          <div className="publish-result-dialog__header-actions">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <button className="button publish-result-dialog__close" type="button" onClick={onClose} aria-label="닫기" title="닫기">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="publish-result-dialog__body publish-result-dialog__scroll">
          <section className="publish-result-dialog__preview" aria-label="게시 결과 미리보기">
            {artifactLoading ? (
              <ListSkeleton rows={4} columns={2} label="결과물을 불러오는 중입니다." />
            ) : artifactError ? (
              <div className="publish-result-dialog__state" role="alert">
                <strong>결과물을 불러오지 못했습니다.</strong>
                {channel.previewTitle ? <div>{channel.previewTitle}</div> : null}
                {channel.previewBody ? <p>{channel.previewBody}</p> : null}
                <button className="button" type="button" onClick={() => setArtifactReloadKey((key) => key + 1)}>
                  <RotateCcw size={16} aria-hidden="true" />
                  다시 시도
                </button>
              </div>
            ) : artifact ? (
              <PublishArtifactPreview artifact={artifact} />
            ) : null}
          </section>

          <aside className="publish-result-dialog__metadata" aria-label="업로드 정보">
            <h3>업로드 정보</h3>
            <dl>
              <div>
                <dt>채널</dt>
                <dd className="channel-identity"><ChannelLogo channel={channel.channel} decorative size={18} /><span>{channelLabels[channel.channel]}</span></dd>
              </div>
              {formatLabel ? (
                <div>
                  <dt>콘텐츠 형식</dt>
                  <dd>{formatLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt>게시 상태</dt>
                <dd><Badge variant={meta.variant}>{meta.label}</Badge></dd>
              </div>
              {channel.publishedAt ? (
                <div>
                  <dt>게시 시각</dt>
                  <dd>{formatDateTime(channel.publishedAt)}</dd>
                </div>
              ) : null}
              {channel.failedAt ? (
                <div>
                  <dt>실패 시각</dt>
                  <dd>{formatDateTime(channel.failedAt)}</dd>
                </div>
              ) : null}
              {externalPostId ? (
                <div>
                  <dt>외부 게시 ID</dt>
                  <dd>{externalPostId}</dd>
                </div>
              ) : null}
              {channel.externalUrl ? (
                <div>
                  <dt>외부 게시 URL</dt>
                  <dd><a href={channel.externalUrl} target="_blank" rel="noreferrer">원본 URL 열기</a></dd>
                </div>
              ) : null}
              {sourceSummary ? (
                <div>
                  <dt>생성 근거</dt>
                  <dd>{sourceSummary}</dd>
                </div>
              ) : null}
              {channel.lastError ? (
                <div>
                  <dt>오류 사유</dt>
                  <dd>{channel.lastError}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        </div>

        <footer className="publish-result-dialog__footer">
          <div className="publish-result-dialog__feedback" aria-live="polite">
            {downloadMessage ? (
              <span className={downloadMessage.error ? "is-error" : ""}>{downloadMessage.text}</span>
            ) : null}
          </div>
          <div className="actions">
            {channel.externalUrl ? (
              <a className="button" href={channel.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                원본 게시물 열기
              </a>
            ) : null}
            <button
              className="button primary"
              type="button"
              aria-label="저장"
              aria-busy={downloadLoading}
              onClick={() => void downloadResult()}
              disabled={downloadLoading || artifactLoading || artifactError || !artifact}
            >
              {downloadLoading ? <InlineSpinner label="게시 결과 저장 중" /> : <Download size={16} aria-hidden="true" />}
              저장
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function PublishQueuePage() {
  const initialQuery = useMemo(() => new URLSearchParams(window.location.search), []);
  const highlightedQueueId = useMemo(() => initialQuery.get("queueId"), [initialQuery]);
  const [view, setView] = useState<PublishView>(() => initialQuery.get("view") === "calendar" ? "calendar" : "list");
  const [calendarBulkDraft, setCalendarBulkDraft] = useState<PublishCalendarBulkDraft | null>(() => loadPublishCalendarBulkDraft(initialQuery.get("calendarBatchDraft")));
  const [calendarMonth, setCalendarMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).replace("/", "-"));
  const [calendarSettings, setCalendarSettings] = useState<PublishCalendarSettings | null>(null);
  const [calendarManualOptions, setCalendarManualOptions] = useState<PublishCalendarManualOptions | null>(null);
  const [calendarManualOptionsError, setCalendarManualOptionsError] = useState<string | null>(null);
  const [calendarSlots, setCalendarSlots] = useState<PublishCalendarSlot[]>([]);
  const [calendarSlotsLoading, setCalendarSlotsLoading] = useState(false);
  const [calendarChannels, setCalendarChannels] = useState<ChannelType[]>([]);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarSettingsError, setCalendarSettingsError] = useState<string | null>(null);
  const [calendarSlotsError, setCalendarSlotsError] = useState<string | null>(null);
  const [queueRows, setQueueRows] = useState<PublishSlot[]>([]);
  const [contentOutputs, setContentOutputs] = useState<ContentOutput[]>([]);
  const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
  const [activeFilter, setActiveFilter] = useState<ManagementFilterId>(() => {
    const requested = new URLSearchParams(window.location.search).get("status");
    return publishManagementFilters.some((filter) => filter.id === requested) ? requested as ManagementFilterId : "all";
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<{ result: PublishResult; channel: PublishResultChannel } | null>(null);
  const [selectedReviewOutput, setSelectedReviewOutput] = useState<ContentOutput | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const reviewingOutputIdsRef = useRef(new Set<string>());
  const [reviewingOutputIds, setReviewingOutputIds] = useState<Set<string>>(() => new Set());

  const managementRows = useMemo(() => {
    const groupedQueueIds = new Set(queueRows.filter((row) => row.topicPublishGroupId).map((row) => row.id));
    const legacyResults = publishResults.filter((result) => result.channels.some((channel) => !groupedQueueIds.has(channel.queueId)));
    return [...buildTopicGroupRows(queueRows, publishResults), ...buildReviewRows(contentOutputs), ...buildPublishRows(legacyResults)]
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  }, [queueRows, contentOutputs, publishResults]);
  const calendarEntries = useMemo<CalendarEntry[]>(() => calendarSlots.map(entryFromSlot), [calendarSlots]);
  const assignableCalendarContents = useMemo(() => managementRows.flatMap((row) => row.kind === "topic_group" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.group.id) && (row.status === "queued" || row.status === "publish_queued")
    ? [{ id: row.group.id, title: row.title }]
    : []), [managementRows]);

  useEffect(() => {
    if (initialLoading || view !== "list" || !highlightedQueueId) return;
    const highlighted = document.querySelector<HTMLElement>('[data-publish-deep-link="true"]');
    if (!highlighted) return;
    highlighted.scrollIntoView?.({ behavior: "smooth", block: "center" });
    highlighted.focus();
  }, [highlightedQueueId, initialLoading, managementRows, view]);

  function changeView(nextView: PublishView) {
    setView(nextView);
    const query = new URLSearchParams(window.location.search);
    query.set("view", nextView);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}`);
  }

  function onViewTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: PublishView) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = current === "list" ? "calendar" : "list";
    changeView(next);
    document.getElementById(`publish-view-tab-${next}`)?.focus();
  }

  async function refreshQueue() {
    const apiRows = await api.listPublishQueue(DEMO_BRAND_ID);
    setQueueRows(apiRows);
  }

  async function refreshContentOutputs() {
    const apiOutputs = await api.listContentOutputs(DEMO_BRAND_ID);
    setContentOutputs(apiOutputs.map(normalizeOutput));
  }

  async function refreshPublishResults() {
    const apiResults = await api.listPublishResults(DEMO_BRAND_ID);
    setPublishResults(apiResults);
  }

  async function refreshRecoveryState() {
    try {
      await Promise.all([refreshQueue(), refreshPublishResults()]);
      setNotice("게시 상태를 서버에서 다시 확인했습니다.");
    } catch {
      setNotice("목록을 새로고침하지 못해 기존 상태를 표시합니다.");
    }
  }

  async function retryPublish(queueId: string) {
    try {
      await api.retryPublishQueueItem(queueId);
      await refreshRecoveryState();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "publish_queue_not_retryable";
      setNotice(`재시도할 수 없습니다: ${reason}`);
    }
  }

  async function cancelPublish(queueId: string) {
    try {
      await api.cancelPublishQueueItem(queueId);
      await refreshRecoveryState();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "publish_queue_not_cancellable";
      setNotice(`취소할 수 없습니다: ${reason}`);
    }
  }

  useEffect(() => {
    let ignore = false;
    const queueRequest = api.listPublishQueue(DEMO_BRAND_ID)
      .then((apiRows) => {
        if (!ignore) {
          setQueueRows(apiRows);
          setNotice(null);
        }
      })
      .catch(() => {
        if (!ignore) {
          setQueueRows([]);
          setNotice("API 서버가 응답하지 않아 게시 관리 목록을 불러오지 못했습니다.");
        }
      });
    const outputsRequest = api.listContentOutputs(DEMO_BRAND_ID)
      .then((apiOutputs) => {
        if (!ignore) setContentOutputs(apiOutputs.map(normalizeOutput));
      })
      .catch(() => {
        if (!ignore) setContentOutputs([]);
      });
    const resultsRequest = api.listPublishResults(DEMO_BRAND_ID)
      .then((apiResults) => {
        if (!ignore) setPublishResults(apiResults);
      })
      .catch(() => {
        if (!ignore) setPublishResults([]);
      });
    void Promise.allSettled([queueRequest, outputsRequest, resultsRequest]).then(() => {
      if (!ignore) setInitialLoading(false);
    });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    if (view !== "calendar") return () => { ignore = true; };
    if (typeof api.listChannels === "function") {
      void api.listChannels(DEMO_BRAND_ID)
        .then((channels) => { if (!ignore) setCalendarChannels(channels.filter((channel) => channel.type === "instagram" && channel.enabled && channel.status === "connected").map((channel) => channel.type)); })
        .catch(() => { if (!ignore) setCalendarChannels([]); });
    }
    const period = monthPeriod(calendarMonth);
    if (typeof api.getPublishCalendarSettings === "function") {
      void api.getPublishCalendarSettings(DEMO_BRAND_ID)
        .then((settings) => { if (!ignore) { setCalendarSettings(settings); setCalendarSettingsError(null); } })
        .catch(() => { if (!ignore) { setCalendarSettings(null); setCalendarSettingsError("자동 게시 설정을 불러오지 못했습니다."); } });
    }
    if (typeof api.getPublishCalendarManualOptions === "function") {
      void api.getPublishCalendarManualOptions(DEMO_BRAND_ID)
        .then((options) => { if (!ignore) { setCalendarManualOptions(options); setCalendarManualOptionsError(null); } })
        .catch(() => { if (!ignore) { setCalendarManualOptions(null); setCalendarManualOptionsError("수동 게시 선택 항목을 불러오지 못했습니다."); } });
    }
    if (typeof api.listPublishCalendarSlots === "function") {
      setCalendarSlotsLoading(true);
      setCalendarSlots([]);
      setCalendarSlotsError(null);
      void api.listPublishCalendarSlots(DEMO_BRAND_ID, period)
        .then((slots) => { if (!ignore) { setCalendarSlots(slots); setCalendarSlotsError(null); setCalendarSlotsLoading(false); } })
        .catch(() => { if (!ignore) { setCalendarSlots([]); setCalendarSlotsError("캘린더 슬롯을 불러오지 못했습니다."); setCalendarSlotsLoading(false); } });
    } else {
      setCalendarSlots([]);
      setCalendarSlotsLoading(false);
    }
    return () => { ignore = true; };
  }, [calendarMonth, view]);

  const loadCalendarCandidates = useCallback(async (kind: "generating" | "completed_unpublished"): Promise<PublishCalendarContentCandidate[]> => {
    if (typeof api.listPublishCalendarContentCandidates !== "function") return [];
    const result = await api.listPublishCalendarContentCandidates(DEMO_BRAND_ID, kind);
    return result.items;
  }, []);

  async function provisionCalendarContent(input: PublishCalendarManualSlotInput) {
    if (typeof api.provisionPublishCalendarManualSlot !== "function") return false;
    try {
      const slot = await api.provisionPublishCalendarManualSlot(DEMO_BRAND_ID, input);
      setCalendarSlots((current) => [...current.filter((item) => item.id !== slot.id), slot]);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice("콘텐츠를 연결해 게시 일정을 추가했습니다.");
      return true;
    } catch {
      setNotice("콘텐츠를 게시 일정에 연결하지 못했습니다.");
      return false;
    }
  }

  function startCalendarContent(input: { scheduledFor: string; contentFormat: "card_news" | "reel"; setup: PublishCalendarNewContentSetup }) {
    const params = new URLSearchParams({
      proposalFamily: input.setup.purpose,
      proposalFormat: input.contentFormat,
      proposalChannels: "instagram",
      calendarScheduledFor: input.scheduledFor,
      calendarIdempotencyKey: crypto.randomUUID(),
    });
    if (input.setup.topicText) params.set("proposalTopic", input.setup.topicText);
    if (input.setup.topicUrl) params.set("proposalUrl", input.setup.topicUrl);
    if (input.setup.contentSuggestionId) { params.set("view", "suggestions"); params.set("suggestionId", input.setup.contentSuggestionId); }
    if (input.setup.referenceId) params.set("reference", input.setup.referenceId);
    if (input.setup.productId) params.set("product", input.setup.productId);
    if (input.setup.contentInstruction) params.set("proposalBrief", input.setup.contentInstruction);
    window.location.assign(`/ai-content/new?${params}`);
  }

  function continueCalendarBulk(draft: PublishCalendarBulkDraft, row: PublishCalendarBulkDraftRow) {
    const params = new URLSearchParams({
      proposalFamily: row.setup.purpose,
      proposalFormat: row.contentFormat,
      proposalChannels: "instagram",
      calendarBatchDraft: draft.id,
      calendarBatchRow: row.clientRowId,
    });
    if (row.setup.topicText) params.set("proposalTopic", row.setup.topicText);
    if (row.setup.topicUrl) params.set("proposalUrl", row.setup.topicUrl);
    if (row.setup.contentSuggestionId) { params.set("view", "suggestions"); params.set("suggestionId", row.setup.contentSuggestionId); }
    if (row.setup.referenceId) params.set("reference", row.setup.referenceId);
    if (row.setup.productId) params.set("product", row.setup.productId);
    if (row.setup.contentInstruction) params.set("proposalBrief", row.setup.contentInstruction);
    window.location.assign(`/ai-content/new?${params}`);
  }

  function startCalendarBulk(rows: PublishCalendarBulkDraftRow[]) {
    const draft = { id: crypto.randomUUID(), rows };
    savePublishCalendarBulkDraft(draft);
    setCalendarBulkDraft(draft);
    continueCalendarBulk(draft, rows[0]);
  }

  async function provisionCalendarBatch(draft: PublishCalendarBulkDraft) {
    if (typeof api.provisionPublishCalendarManualSlotsBatch !== "function" || draft.rows.some((row) => !row.generationId)) return false;
    try {
      const result = await api.provisionPublishCalendarManualSlotsBatch(DEMO_BRAND_ID, {
        idempotencyKey: draft.id,
        rows: draft.rows.map((row) => ({ clientRowId: row.clientRowId, scheduledFor: row.scheduledFor, channel: "instagram" as const, contentFormat: row.contentFormat, source: { kind: "existing_generation" as const, generationId: row.generationId! } })),
      });
      setCalendarSlots((current) => [...current.filter((slot) => !result.slots.some((item) => item.id === slot.id)), ...result.slots]);
      clearPublishCalendarBulkDraft(draft.id);
      setCalendarBulkDraft(null);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`${result.slots.length}개 콘텐츠의 게시 일정을 배정했습니다.`);
      return true;
    } catch { setNotice("일괄 게시 일정을 배정하지 못했습니다. 입력과 한도를 확인하세요."); return false; }
  }

  async function cancelCalendarSlot(slotId: string) {
    try {
      const slot = await api.cancelPublishCalendarSlot(DEMO_BRAND_ID, slotId);
      setCalendarSlots((current) => current.map((item) => item.id === slot.id ? slot : item));
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      const refreshed = await Promise.allSettled([refreshQueue(), refreshPublishResults()]);
      setNotice(refreshed.some((result) => result.status === "rejected") ? "게시 슬롯을 취소했습니다. 운영 목록 새로고침은 일부 실패했습니다." : "게시 슬롯을 취소했습니다.");
    } catch { setNotice("게시 슬롯을 취소하지 못했습니다."); }
  }

  async function assignCalendarSlot(slotId: string, content: { id: string; title: string }) {
    try {
      const slot = await api.assignPublishCalendarSlot(DEMO_BRAND_ID, slotId, { topicPublishGroupId: content.id, title: content.title });
      setCalendarSlots((current) => current.map((item) => item.id === slot.id ? slot : item));
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice("선택한 콘텐츠를 슬롯에 배정했습니다.");
      return true;
    } catch { setNotice("콘텐츠를 슬롯에 배정하지 못했습니다."); return false; }
  }

  async function saveCalendarSettings(input: Omit<PublishCalendarSettings, "brandId" | "updatedAt">) {
    setCalendarSaving(true);
    try {
      const settings = await api.savePublishCalendarSettings(DEMO_BRAND_ID, input);
      setCalendarSettings(settings);
      setNotice(settings.enabled ? "자동 게시 설정을 저장했습니다." : "자동 게시를 껐습니다. 기존 예약은 유지됩니다.");
      return { ok: true as const };
    } catch { return { ok: false as const, message: "자동 게시 설정을 저장하지 못했습니다." }; } finally { setCalendarSaving(false); }
  }

  async function scheduleQueue() {
    try {
      const result = await api.schedulePublishQueue(DEMO_BRAND_ID);
      await Promise.all([refreshQueue(), refreshPublishResults()]);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`큐 배정 완료: 처리 ${result.processed}개, 배정 ${result.updated}개`);
    } catch {
      setNotice("큐 배정에 실패했습니다. API 서버와 게시 관리 상태를 확인하세요.");
    }
  }

  async function publishNext() {
    const target = queueRows.find((row) => row.status === "scheduled");
    if (!target) {
      setNotice("게시할 예약 콘텐츠가 없습니다.");
      return;
    }

    try {
      const result = await api.publishQueueItem(target.id);
      await Promise.all([refreshQueue(), refreshPublishResults()]);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`게시 완료: ${result.publishedUrl ?? result.status}`);
    } catch {
      setNotice("게시 실행에 실패했습니다. 큐 항목 상태를 확인하세요.");
    }
  }

  async function generateNextContent() {
    try {
      const result = await api.generateContent(DEMO_BRAND_ID);
      await Promise.all([refreshContentOutputs(), refreshQueue(), refreshPublishResults()]);
      setNotice(`콘텐츠 생성 완료: 처리 ${result.processed}개, 생성 ${result.created}개`);
    } catch {
      setNotice("콘텐츠 생성 실행에 실패했습니다. 사용 가능한 주제표 행과 API 상태를 확인하세요.");
    }
  }

  async function reviewOutputGroup(outputs: ContentOutput[], action: "approve" | "reject" | "regenerate", message: string) {
    const outputIds = outputs.map((output) => output.id);
    if (outputIds.some((outputId) => reviewingOutputIdsRef.current.has(outputId))) return;
    outputIds.forEach((outputId) => reviewingOutputIdsRef.current.add(outputId));
    setReviewingOutputIds((current) => new Set([...current, ...outputIds]));
    try {
      const results = await Promise.allSettled(outputIds.map((outputId) => api.reviewContentOutput(outputId, action)));
      const successfulResults = new Map(results.flatMap((result, index) => result.status === "fulfilled"
        ? [[outputIds[index], result.value] as const]
        : []));
      setContentOutputs((currentOutputs) => currentOutputs.map((output) => {
        const result = successfulResults.get(output.id);
        return result ? { ...output, id: result.id, status: result.status } : output;
      }));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      let refreshFailed = false;
      try {
        await Promise.all([refreshContentOutputs(), refreshQueue(), refreshPublishResults()]);
      } catch {
        refreshFailed = true;
      }
      setNotice(failedCount > 0
        ? `일부 검토 결과를 저장하지 못했습니다. 성공 ${outputIds.length - failedCount}개, 실패 ${failedCount}개입니다.`
        : refreshFailed
          ? "검토 결과는 저장했지만 목록을 새로고침하지 못했습니다. 잠시 후 다시 확인하세요."
          : message);
    } catch {
      const actionLabels = {
        approve: "승인",
        reject: "거절",
        regenerate: "재생성 요청"
      };
      setNotice(`${actionLabels[action]} 처리에 실패했습니다. API 상태를 확인하세요.`);
    } finally {
      outputIds.forEach((outputId) => reviewingOutputIdsRef.current.delete(outputId));
      setReviewingOutputIds((current) => {
        const next = new Set(current);
        outputIds.forEach((outputId) => next.delete(outputId));
        return next;
      });
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="게시 관리"
        description="생성 검토, 예약, 발송 상태, 실패 사유, 완료 결과물을 하나의 운영 화면에서 관리합니다."
        actions={(
          <>
            <button className="button" type="button" onClick={generateNextContent}>콘텐츠 생성</button>
            <button className="button" type="button" onClick={scheduleQueue}>정책 큐 배정</button>
            <button className="button primary" type="button" onClick={publishNext}>다음 게시 실행</button>
          </>
        )}
      />

      <div className="publish-view-toolbar">
        <div className="publish-view-tabs" role="tablist" aria-label="게시 관리 보기">
          <button id="publish-view-tab-list" className={view === "list" ? "is-active" : ""} type="button" role="tab" aria-controls="publish-view-panel" aria-selected={view === "list"} tabIndex={view === "list" ? 0 : -1} onKeyDown={(event) => onViewTabKeyDown(event, "list")} onClick={() => changeView("list")}><List size={17} aria-hidden="true" /> 목록</button>
          <button id="publish-view-tab-calendar" className={view === "calendar" ? "is-active" : ""} type="button" role="tab" aria-controls="publish-view-panel" aria-selected={view === "calendar"} tabIndex={view === "calendar" ? 0 : -1} onKeyDown={(event) => onViewTabKeyDown(event, "calendar")} onClick={() => changeView("calendar")}><CalendarDays size={17} aria-hidden="true" /> 캘린더</button>
        </div>
      </div>

      {notice ? (
        <Alert title="API 상태" variant={notice.includes("실패") || notice.includes("응답하지") ? "warn" : "ok"}>
          {notice}
        </Alert>
      ) : null}

      <div id="publish-view-panel" role="tabpanel" aria-labelledby={`publish-view-tab-${view}`}>
      {initialLoading ? (
        <section className="panel"><div className="panel-body"><CardSkeleton count={6} label="게시 관리 목록을 불러오는 중입니다." /></div></section>
      ) : view === "calendar" ? (
        <PublishCalendar
          monthKey={calendarMonth}
          entries={calendarEntries}
          connectedChannels={calendarChannels}
          settings={calendarSettings}
          manualOptions={calendarManualOptions}
          manualOptionsError={calendarManualOptionsError}
          settingsError={calendarSettingsError}
          slotsError={calendarSlotsError}
          slotsLoading={calendarSlotsLoading}
          assignableContents={assignableCalendarContents}
          saving={calendarSaving}
          onMonthChange={setCalendarMonth}
          onLoadCandidates={loadCalendarCandidates}
          onProvision={provisionCalendarContent}
          onStartNew={startCalendarContent}
          initialBulkDraft={calendarBulkDraft}
          onStartBulk={startCalendarBulk}
          onContinueBulk={continueCalendarBulk}
          onProvisionBatch={provisionCalendarBatch}
          onAssign={assignCalendarSlot}
          onCancel={(slotId) => void cancelCalendarSlot(slotId)}
          onSaveSettings={saveCalendarSettings}
        />
      ) : (
        <ManagementCardGrid
          rows={managementRows}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onSelectResult={(result, channel) => setSelectedResult({ result, channel })}
          onSelectReviewOutput={setSelectedReviewOutput}
          onReviewGroup={(outputs, action, message) => void reviewOutputGroup(outputs, action, message)}
          reviewingOutputIds={reviewingOutputIds}
          highlightedQueueId={highlightedQueueId}
          onRetryPublish={(queueId) => void retryPublish(queueId)}
          onVerifyPublish={() => void refreshRecoveryState()}
          onCancelPublish={(queueId) => void cancelPublish(queueId)}
        />
      )}
      </div>

      {selectedResult ? (
        <PublishResultDialog
          result={selectedResult.result}
          channel={selectedResult.channel}
          onClose={() => setSelectedResult(null)}
        />
      ) : null}
      {selectedReviewOutput ? (
        <ContentArtifactDialog output={selectedReviewOutput} onClose={() => setSelectedReviewOutput(null)} />
      ) : null}
    </section>
  );
}
