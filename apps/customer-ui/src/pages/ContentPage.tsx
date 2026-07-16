import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { ReelVideoPreview } from "../components/ui/ReelVideoPreview";
import { SquareCarouselPreview } from "../components/ui/SquareCarouselPreview";
import { VerticalImagePreview } from "../components/ui/VerticalImagePreview";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  BadgeVariant,
  ChannelType,
  ContentOutput,
  ContentSourceMode,
  DeliveryFormat,
  ReviewStatus
} from "../types";

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X"
};

const legacyFormatByChannel: Record<ChannelType, DeliveryFormat> = {
  instagram: "instagram_feed_carousel",
  threads: "threads_text",
  tiktok: "tiktok_video",
  youtube: "youtube_video",
  linkedin: "linkedin_post",
  x: "x_post"
};

const formatLabels: Record<DeliveryFormat, string> = {
  instagram_feed_carousel: "Card News",
  instagram_story: "Story",
  instagram_reel: "Reel",
  threads_text: "Threads",
  tiktok_video: "TikTok Video",
  youtube_video: "YouTube Video",
  youtube_short: "YouTube Short",
  linkedin_post: "LinkedIn Post",
  x_post: "X Post"
};

const sourceModeLabels: Record<ContentSourceMode, string> = {
  direct_url: "직접 URL",
  topic_only: "주제 정보",
  url_unavailable: "URL 사용 불가"
};

const reviewMeta: Record<ReviewStatus, { label: string; variant: BadgeVariant }> = {
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

function formatGeneratedAt(value: string) {
  return new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function canApprove(output: ContentOutput) {
  const generationState = output.outputJson?.generationState;
  const artifactStatus = output.outputJson?.artifactStatus;
  return (output.status === "pending_review" || output.status === "auto_approval_blocked")
    && generationState !== "pending"
    && artifactStatus !== "pending";
}

function canReject(output: ContentOutput) {
  return output.status === "pending_review"
    || output.status === "auto_approval_blocked"
    || output.status === "generation_failed";
}

function canRegenerate(output: ContentOutput) {
  return (output.channel === "instagram" || output.channel === "threads") && canReject(output);
}

function visibleBlockReasons(output: ContentOutput) {
  return (output.blockReasons ?? []).filter((reason) => reason !== "generation_failed");
}

function deliveryFormatFor(output: ContentOutput) {
  return output.deliveryFormat ?? output.outputJson?.deliveryFormat ?? legacyFormatByChannel[output.channel];
}

function sourceModeFor(output: ContentOutput) {
  return output.sourceMode ?? output.outputJson?.sourceMode ?? null;
}

function OutputPreview({ output }: { output: ContentOutput }) {
  const deliveryFormat = deliveryFormatFor(output);
  if (deliveryFormat === "instagram_feed_carousel") {
    return <SquareCarouselPreview title={output.previewTitle || output.title} />;
  }
  if (deliveryFormat === "instagram_story") {
    return (
      <VerticalImagePreview
        src={output.previewImageUrl ?? output.outputJson?.story?.url ?? null}
        title={output.previewTitle || output.title}
      />
    );
  }
  if (
    deliveryFormat === "instagram_reel"
    || deliveryFormat === "youtube_video"
    || deliveryFormat === "youtube_short"
    || deliveryFormat === "tiktok_video"
    || output.outputJson?.video
  ) {
    return (
      <ReelVideoPreview
        src={output.previewVideoUrl ?? output.outputJson?.video?.url ?? null}
        poster={output.previewPosterUrl ?? output.outputJson?.cover?.url ?? null}
        title={output.previewTitle || output.title}
        durationSeconds={output.durationSeconds ?? output.outputJson?.video?.durationSeconds ?? null}
      />
    );
  }
  return (
    <section className="channel-text-preview" style={{ display: "grid", gap: 10 }}>
      <strong>{output.previewTitle}</strong>
      <p>{output.previewBody || "저장된 미리보기 본문이 없습니다."}</p>
    </section>
  );
}

export function ContentPage() {
  const [outputs, setOutputs] = useState<ContentOutput[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<{ message: string; variant: "ok" | "warn" } | null>(null);
  const [regenerationReasons, setRegenerationReasons] = useState<Record<string, string>>({});
  const reviewingOutputIdsRef = useRef(new Set<string>());
  const [reviewingOutputIds, setReviewingOutputIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let ignore = false;
    api.listContentOutputs(DEMO_BRAND_ID)
      .then((rows) => {
        if (ignore) return;
        setOutputs(rows);
        setLoadStatus("ready");
      })
      .catch(() => {
        if (ignore) return;
        setLoadStatus("error");
      });
    return () => { ignore = true; };
  }, []);

  const reviewOutputs = useMemo(() => outputs, [outputs]);

  async function review(output: ContentOutput, action: "approve" | "reject" | "regenerate") {
    if (reviewingOutputIdsRef.current.has(output.id)) return;
    reviewingOutputIdsRef.current.add(output.id);
    setReviewingOutputIds((current) => new Set(current).add(output.id));
    const reason = action === "regenerate" ? regenerationReasons[output.id]?.trim() || undefined : undefined;
    try {
      const result = await api.reviewContentOutput(output.id, action, reason);
      if (action === "regenerate") {
        setOutputs((current) => current.map((candidate) => candidate.id === output.id
          ? { ...candidate, id: result.id, status: result.status }
          : candidate));
        try {
          const rows = await api.listContentOutputs(DEMO_BRAND_ID);
          setOutputs(rows);
          setNotice({ message: "재생성 요청을 접수했습니다.", variant: "ok" });
        } catch {
          setNotice({ message: "재생성 요청은 접수했지만 목록을 새로고침하지 못했습니다. 잠시 후 다시 확인하세요.", variant: "warn" });
        }
      } else {
        setOutputs((current) => current.map((candidate) => candidate.id === output.id ? { ...candidate, status: result.status } : candidate));
        setNotice({
          message: action === "approve"
            ? "승인한 콘텐츠를 게시 정책 큐에 등록했습니다."
            : "콘텐츠를 거절했습니다.",
          variant: "ok"
        });
      }
    } catch {
      setNotice({ message: "검토 결과를 저장하지 못했습니다. API 상태를 확인한 뒤 다시 시도하세요.", variant: "warn" });
    } finally {
      reviewingOutputIdsRef.current.delete(output.id);
      setReviewingOutputIds((current) => {
        const next = new Set(current);
        next.delete(output.id);
        return next;
      });
    }
  }

  return (
    <section className="content">
      <PageHeader title="콘텐츠 검토" description="채널별 결과물을 확인하고 승인, 재생성, 거절을 결정합니다. 승인된 결과물은 서비스 정책 시간에 게시됩니다." />
      {notice ? <Alert title="검토 상태" variant={notice.variant}>{notice.message}</Alert> : null}
      {loadStatus === "loading" ? <div role="status" className="muted">콘텐츠 검토 목록을 불러오는 중입니다.</div> : null}
      {loadStatus === "error" ? (
        <Alert title="API 상태" variant="warn">API 서버가 응답하지 않아 콘텐츠 검토 목록을 불러오지 못했습니다.</Alert>
      ) : null}
      {loadStatus === "ready" && reviewOutputs.length === 0 ? (
        <EmptyState title="검토할 콘텐츠가 없습니다" description="콘텐츠가 생성되면 채널별 결과물이 여기에 표시됩니다." />
      ) : loadStatus === "ready" ? (
        <div className="content-review-list">
          {reviewOutputs.map((output) => {
            const meta = reviewMeta[output.status] ?? unknownReviewMeta;
            const deliveryFormat = deliveryFormatFor(output);
            const sourceMode = sourceModeFor(output);
            const blockReasons = visibleBlockReasons(output);
            const showApprove = canApprove(output);
            const showRegenerate = canRegenerate(output);
            const showReject = canReject(output);
            const isReviewing = reviewingOutputIds.has(output.id);
            return (
              <article className="panel content-review-item" key={output.id}>
                <div className="panel-head">
                  <div>
                    <h2>{output.title}</h2>
                    <div className="row-meta">{channelLabels[output.channel]} · {formatGeneratedAt(output.generatedAt)}</div>
                  </div>
                  <div className="actions">
                    <Badge variant="info">{formatLabels[deliveryFormat]}</Badge>
                    {sourceMode ? <Badge variant="neutral">{sourceModeLabels[sourceMode]}</Badge> : null}
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                </div>
                <div className="panel-body grid two content-review-body">
                  <OutputPreview output={output} />
                  <div className="grid content-review-context">
                    <section aria-label="생성 근거" style={{ display: "grid", gap: 8 }}>
                      <strong>생성 근거</strong>
                      <p>{output.sourceSummary || "저장된 생성 근거가 없습니다."}</p>
                    </section>
                    {blockReasons.length > 0 ? <Alert title="자동 승인 차단 사유" variant="warn">{blockReasons.join(" ")}</Alert> : null}
                    {output.status === "generation_failed" ? (
                      <Alert title="생성 실패" variant="warn">콘텐츠 생성에 실패했습니다. 재생성하거나 거절해 주세요.</Alert>
                    ) : null}
                    {showApprove || showRegenerate || showReject ? (
                      <div className="grid">
                        {showRegenerate ? (
                          <label className="field">
                            <span>재생성 요청</span>
                            <input aria-label={`${channelLabels[output.channel]} ${formatLabels[deliveryFormat]} 재생성 사유`} value={regenerationReasons[output.id] ?? ""} onChange={(event) => setRegenerationReasons((current) => ({ ...current, [output.id]: event.target.value }))} placeholder="예: 광고 느낌을 줄이고 더 전문적으로" />
                          </label>
                        ) : null}
                        <div className="actions">
                          {showApprove ? <button className="button primary" type="button" disabled={isReviewing} onClick={() => void review(output, "approve")}>승인 {formatLabels[deliveryFormat]}</button> : null}
                          {showRegenerate ? <button className="button" type="button" disabled={isReviewing} onClick={() => void review(output, "regenerate")}>재생성</button> : null}
                          {showReject ? <button className="button danger" type="button" disabled={isReviewing} onClick={() => void review(output, "reject")}>거절</button> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
