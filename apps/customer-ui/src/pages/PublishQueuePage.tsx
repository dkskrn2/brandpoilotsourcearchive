import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, RotateCcw, X } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { PublishArtifactPreview } from "../components/publish/PublishArtifactPreview";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { TopicPublishGroup, type TopicPublishGroupModel } from "../components/publish/TopicPublishGroup";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { BadgeVariant, ChannelType, ContentOutput, PublishArtifact, PublishResult, PublishResultChannel, PublishSlot, ReviewStatus } from "../types";

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

const sourceTypeLabels: Record<PublishResult["sourceType"], string> = {
  topic_table: "주제표",
  source_url: "크롤링",
  mixed: "주제표+크롤링",
  unknown: "미확인"
};

const filters = [
  { id: "all", label: "전체" },
  { id: "generating", label: "생성 중" },
  { id: "needs_review", label: "검토 필요" },
  { id: "queued", label: "대기" },
  { id: "publish_queued", label: "게시 대기" },
  { id: "scheduled", label: "예약" },
  { id: "publishing", label: "게시 중" },
  { id: "completed", label: "완료" },
  { id: "failed", label: "실패" },
  { id: "rejected", label: "거절됨" }
] as const;

type ManagementFilterId = (typeof filters)[number]["id"];
type ManagementStatus = Exclude<ManagementFilterId, "all">;

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
  status: "publish_queued" | "scheduled" | "publishing" | "completed" | "failed";
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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

function statusForPublishResult(result: PublishResult): PublishManagementRow["status"] {
  const statuses = result.channels.map((item) => item.status);

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
    const status: ManagementStatus = statuses.includes("failed") ? "failed"
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
    return <Badge variant="neutral">{channelLabels[channel]} 없음</Badge>;
  }

  const meta = resultStatusMeta[resultChannel.status];
  return (
    <button
      type="button"
      className={`button ${meta.clickable ? "" : "is-disabled"}`}
      disabled={!meta.clickable}
      onClick={() => onSelect(resultChannel)}
    >
      {channelLabels[channel]} {meta.label}
    </button>
  );
}

function WaitingChannelButtons({ slot }: { slot: PublishSlot }) {
  const { renderStatus } = slot;
  const instagramLabel = renderStatus === "running" ? "이미지 생성 중" : renderStatus === "failed" ? "이미지 생성 실패" : renderStatus === "succeeded" ? "게시 준비 완료" : renderStatus === "queued" ? "이미지 생성 대기" : "생성 전";
  return (
    <div className="actions">
      <button type="button" className="button is-disabled" disabled>
        {channelLabels[slot.channel]} {slot.channel === "instagram" ? instagramLabel : "생성 전"}
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
            {channelLabels[output.channel]} {meta.label}
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
            key={`${result.contentId}-${channel}`}
            channel={channel}
            resultChannel={resultChannel}
            onSelect={(selectedChannel) => onSelect(result, selectedChannel)}
          />
        );
      })}
    </div>
  );
}

function ManagementTable({
  rows,
  activeFilter,
  onFilterChange,
  onSelectResult,
  onReviewGroup,
  reviewingOutputIds
}: {
  rows: ManagementRow[];
  activeFilter: ManagementFilterId;
  onFilterChange: (filter: ManagementFilterId) => void;
  onSelectResult: (result: PublishResult, channel: PublishResultChannel) => void;
  onReviewGroup: (outputs: ContentOutput[], action: "approve" | "reject" | "regenerate", message: string) => void;
  reviewingOutputIds: ReadonlySet<string>;
}) {
  const filteredRows = activeFilter === "all" ? rows : rows.filter((row) => row.status === activeFilter);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>게시 목록</h2>
        <div className="actions queue-filters">
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={activeFilter === filter.id ? "button primary" : "button"}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-body">
        {filteredRows.length === 0 ? (
          <EmptyState
            title="게시 관리 목록이 비어 있습니다"
            description="생성, 승인, 예약, 게시 결과가 생기면 이 테이블에 표시됩니다."
          />
        ) : (
          <table className="table" aria-label="게시 관리 통합 목록">
            <thead>
              <tr>
                <th>상태</th>
                <th>콘텐츠</th>
                <th>채널 상태</th>
                <th>소스 구분</th>
                <th>원천 정보</th>
                <th>생성 근거</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => row.kind === "topic_group" ? (
                <TopicPublishGroup key={row.id} group={row.group} onSelectResult={onSelectResult} />
              ) : (
                <tr key={row.id}>
                  <td><Badge variant={statusVariant(row)}>{statusLabel(row)}</Badge></td>
                  <td>
                    <strong>{row.title}</strong>
                    <div className="row-meta">{formatDateTime(row.generatedAt)}</div>
                  </td>
                  <td>
                    {row.kind === "publish" ? (
                      <PublishChannelButtons result={row.result} onSelect={onSelectResult} />
                    ) : row.kind === "waiting" ? (
                      <WaitingChannelButtons slot={row.slot} />
                    ) : (
                      <ReviewChannelBadges outputs={row.outputs} />
                    )}
                  </td>
                  <td>
                    {row.kind === "publish" ? (
                      <Badge variant={row.result.sourceType === "unknown" ? "neutral" : "info"}>
                        {sourceTypeLabels[row.result.sourceType]}
                      </Badge>
                    ) : row.kind === "waiting" ? (
                      <Badge variant={row.slot.sourceType === "unknown" ? "neutral" : "info"}>
                        {sourceTypeLabels[row.slot.sourceType]}
                      </Badge>
                    ) : (
                      <Badge variant="warn">생성 검토</Badge>
                    )}
                  </td>
                  <td>
                    {row.kind === "publish" ? (
                      <>
                        <div className="row-title">{row.result.sourceLabel}</div>
                        {row.result.sourceUrls.map((sourceUrl) => (
                          <div className="row-meta" key={`${row.id}-${sourceUrl}`}>{sourceUrl}</div>
                        ))}
                      </>
                    ) : row.kind === "waiting" ? (
                      <>
                        <div className="row-title">{row.slot.sourceLabel}</div>
                        {row.slot.sourceUrls.map((sourceUrl) => (
                          <div className="row-meta" key={`${row.id}-${sourceUrl}`}>{sourceUrl}</div>
                        ))}
                      </>
                    ) : (
                      <span className="row-meta">검토 대기 콘텐츠</span>
                    )}
                  </td>
                  <td>
                    {row.kind === "publish" ? (
                      <>
                        {uniqueText([row.result.sourceDetail, ...row.result.channels.map((channel) => channel.sourceSummary)]).map((evidence) => (
                          <div className="row-meta" key={`${row.id}-${evidence}`}>{evidence}</div>
                        ))}
                      </>
                    ) : row.kind === "waiting" ? (
                      <div className="row-meta">{row.slot.sourceDetail ?? "LLM 생성 전"}</div>
                    ) : (
                      <>
                        {row.sourceSummary ? <div className="row-meta">{row.sourceSummary}</div> : null}
                        {row.blockReasons.map((reason) => (
                          <div className="row-meta" key={`${row.id}-${reason}`}>{reason}</div>
                        ))}
                        {row.outputs.some((output) => output.status === "generation_failed") ? (
                          <div className="row-meta">콘텐츠 생성에 실패했습니다. 재생성하거나 거절해 주세요.</div>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td>
                    {row.kind === "review" && row.status === "needs_review" ? (() => {
                      const approvableOutputs = outputsForReviewAction(row.outputs, "approve");
                      const regeneratableOutputs = outputsForReviewAction(row.outputs, "regenerate");
                      const rejectableOutputs = outputsForReviewAction(row.outputs, "reject");
                      const reviewPending = row.outputs.some((output) => reviewingOutputIds.has(output.id));
                      return approvableOutputs.length > 0 || regeneratableOutputs.length > 0 || rejectableOutputs.length > 0 ? (
                        <div className="actions">
                        {approvableOutputs.length > 0 ? (
                        <button
                          className="button primary"
                          type="button"
                          disabled={reviewPending}
                          onClick={() => onReviewGroup(approvableOutputs, "approve", "게시 관리 목록에 등록했습니다.")}
                        >
                          {approvableOutputs.some((output) => output.status === "auto_approval_blocked") ? "수동 승인" : "승인"}
                        </button>
                        ) : null}
                        {regeneratableOutputs.length > 0 ? (
                        <button
                          className="button"
                          type="button"
                          disabled={reviewPending}
                          onClick={() => onReviewGroup(regeneratableOutputs, "regenerate", "재생성 요청을 접수했습니다.")}
                        >
                          재생성
                        </button>
                        ) : null}
                        {rejectableOutputs.length > 0 ? (
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
                      ) : <span className="row-meta">-</span>;
                    })() : (
                      <span className="row-meta">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
            <div className="row-meta">
              {channelLabels[channel.channel]}{formatLabel ? ` · ${formatLabel}` : ""}
            </div>
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
              <div className="publish-result-dialog__state" role="status">결과물을 불러오는 중입니다.</div>
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
                <dd>{channelLabels[channel.channel]}</dd>
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
              onClick={() => void downloadResult()}
              disabled={downloadLoading || artifactLoading || artifactError || !artifact}
            >
              <Download size={16} aria-hidden="true" />
              {downloadLoading ? "저장 중..." : "저장"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function PublishQueuePage() {
  const [queueRows, setQueueRows] = useState<PublishSlot[]>([]);
  const [contentOutputs, setContentOutputs] = useState<ContentOutput[]>([]);
  const [publishResults, setPublishResults] = useState<PublishResult[]>([]);
  const [activeFilter, setActiveFilter] = useState<ManagementFilterId>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<{ result: PublishResult; channel: PublishResultChannel } | null>(null);
  const reviewingOutputIdsRef = useRef(new Set<string>());
  const [reviewingOutputIds, setReviewingOutputIds] = useState<Set<string>>(() => new Set());

  const publishedRows = useMemo(() => queueRows.filter((row) => row.status === "published"), [queueRows]);
  const managementRows = useMemo(() => {
    const groupedQueueIds = new Set(queueRows.filter((row) => row.topicPublishGroupId).map((row) => row.id));
    const legacyResults = publishResults.filter((result) => result.channels.some((channel) => !groupedQueueIds.has(channel.queueId)));
    return [...buildTopicGroupRows(queueRows, publishResults), ...buildReviewRows(contentOutputs), ...buildPublishRows(legacyResults)]
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  }, [queueRows, contentOutputs, publishResults]);

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

  useEffect(() => {
    let ignore = false;
    api.listPublishQueue(DEMO_BRAND_ID)
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
    api.listContentOutputs(DEMO_BRAND_ID)
      .then((apiOutputs) => {
        if (!ignore) setContentOutputs(apiOutputs.map(normalizeOutput));
      })
      .catch(() => {
        if (!ignore) setContentOutputs([]);
      });
    api.listPublishResults(DEMO_BRAND_ID)
      .then((apiResults) => {
        if (!ignore) setPublishResults(apiResults);
      })
      .catch(() => {
        if (!ignore) setPublishResults([]);
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function scheduleQueue() {
    try {
      const result = await api.schedulePublishQueue(DEMO_BRAND_ID);
      await Promise.all([refreshQueue(), refreshPublishResults()]);
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
      setNotice(`게시 완료: ${result.publishedUrl ?? result.status}`);
    } catch {
      setNotice("게시 실행에 실패했습니다. 큐 항목 상태를 확인하세요.");
    }
  }

  async function downloadPublishedResults() {
    if (publishedRows.length === 0) {
      setNotice("다운로드할 발송 완료 결과물이 없습니다.");
      return;
    }

    try {
      const result = await api.downloadPublishedResults(DEMO_BRAND_ID);
      const objectUrl = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(`발송 완료 결과물 ${publishedRows.length}건 다운로드를 시작했습니다.`);
    } catch {
      setNotice("완료 결과물 다운로드에 실패했습니다. API 서버와 게시 상태를 확인하세요.");
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
      const nextStatus: ReviewStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : "regenerating";
      await Promise.all(outputIds.map((outputId) => api.reviewContentOutput(outputId, action)));
      setContentOutputs((currentOutputs) => currentOutputs.map((output) => (
        outputIds.includes(output.id) ? { ...output, status: nextStatus } : output
      )));
      await Promise.all([refreshQueue(), refreshPublishResults()]);
      setNotice(message);
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
            <button className="button" type="button" onClick={downloadPublishedResults} disabled={publishedRows.length === 0}>
              완료 결과물 다운로드 ({publishedRows.length})
            </button>
            <button className="button" type="button" onClick={scheduleQueue}>정책 큐 배정</button>
            <button className="button primary" type="button" onClick={publishNext}>다음 게시 실행</button>
          </>
        )}
      />

      {notice ? (
        <Alert title="API 상태" variant={notice.includes("실패") || notice.includes("응답하지") ? "warn" : "ok"}>
          {notice}
        </Alert>
      ) : null}

      <ManagementTable
        rows={managementRows}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onSelectResult={(result, channel) => setSelectedResult({ result, channel })}
        onReviewGroup={(outputs, action, message) => void reviewOutputGroup(outputs, action, message)}
        reviewingOutputIds={reviewingOutputIds}
      />

      {selectedResult ? (
        <PublishResultDialog
          result={selectedResult.result}
          channel={selectedResult.channel}
          onClose={() => setSelectedResult(null)}
        />
      ) : null}
    </section>
  );
}
