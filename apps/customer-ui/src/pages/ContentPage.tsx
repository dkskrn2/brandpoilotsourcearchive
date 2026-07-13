import { useEffect, useMemo, useState } from "react";
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
  x: "X"
};

const legacyFormatByChannel: Record<ChannelType, DeliveryFormat> = {
  instagram: "instagram_feed_carousel",
  threads: "threads_text",
  tiktok: "tiktok_video",
  youtube: "youtube_video",
  x: "x_post"
};

const formatLabels: Record<DeliveryFormat, string> = {
  instagram_feed_carousel: "Card News",
  instagram_story: "Story",
  instagram_reel: "Reel",
  threads_text: "Threads",
  tiktok_video: "TikTok Video",
  youtube_video: "YouTube Video",
  x_post: "X Post"
};

const sourceModeLabels: Record<ContentSourceMode, string> = {
  direct_url: "직접 URL",
  topic_only: "주제 정보",
  url_unavailable: "URL 사용 불가"
};

const reviewMeta: Record<ReviewStatus, { label: string; variant: BadgeVariant }> = {
  pending_review: { label: "검토 필요", variant: "warn" },
  approved: { label: "승인됨", variant: "ok" },
  auto_approved: { label: "자동 승인", variant: "ok" },
  auto_approval_blocked: { label: "자동 승인 차단", variant: "bad" },
  regenerating: { label: "재생성 중", variant: "info" },
  rejected: { label: "거절됨", variant: "neutral" }
};

function formatGeneratedAt(value: string) {
  return new Date(value).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function canReview(status: ReviewStatus) {
  return status === "pending_review" || status === "auto_approval_blocked";
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
  if (deliveryFormat === "instagram_reel") {
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
    const reason = action === "regenerate" ? regenerationReasons[output.id]?.trim() || undefined : undefined;
    try {
      const result = await api.reviewContentOutput(output.id, action, reason);
      setOutputs((current) => current.map((candidate) => candidate.id === output.id ? { ...candidate, status: result.status } : candidate));
      setNotice({
        message: action === "approve"
          ? "승인한 콘텐츠를 게시 정책 큐에 등록했습니다."
          : action === "reject"
            ? "콘텐츠를 거절했습니다."
            : "재생성 요청을 접수했습니다.",
        variant: "ok"
      });
    } catch {
      setNotice({ message: "검토 결과를 저장하지 못했습니다. API 상태를 확인한 뒤 다시 시도하세요.", variant: "warn" });
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
            const meta = reviewMeta[output.status];
            const deliveryFormat = deliveryFormatFor(output);
            const sourceMode = sourceModeFor(output);
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
                    {output.blockReasons && output.blockReasons.length > 0 ? <Alert title="자동 승인 차단 사유" variant="warn">{output.blockReasons.join(" ")}</Alert> : null}
                    {canReview(output.status) ? (
                      <div className="grid">
                        <label className="field">
                          <span>재생성 요청</span>
                          <input aria-label={`${channelLabels[output.channel]} ${formatLabels[deliveryFormat]} 재생성 사유`} value={regenerationReasons[output.id] ?? ""} onChange={(event) => setRegenerationReasons((current) => ({ ...current, [output.id]: event.target.value }))} placeholder="예: 광고 느낌을 줄이고 더 전문적으로" />
                        </label>
                        <div className="actions">
                          <button className="button primary" type="button" onClick={() => void review(output, "approve")}>승인 {formatLabels[deliveryFormat]}</button>
                          <button className="button" type="button" onClick={() => void review(output, "regenerate")}>재생성</button>
                          <button className="button danger" type="button" onClick={() => void review(output, "reject")}>거절</button>
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
