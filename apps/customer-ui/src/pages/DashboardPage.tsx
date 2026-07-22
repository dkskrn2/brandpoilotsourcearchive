import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, RefreshCw, X } from "lucide-react";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import { PageSkeleton } from "../components/ui/LoadingState";
import { PageGuideButton } from "../components/layout/PageHeader";
import { ChannelLogo } from "../components/channels/ChannelLogo";
import { PublishArtifactPreview } from "../components/publish/PublishArtifactPreview";
import { FeatureSuggestionBanner } from "../components/feedback/FeatureSuggestionBanner";
import type { ChannelStatus, ChannelType, Dashboard, PublishArtifact } from "../types";

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok"
};

const channelOrder = Object.keys(channelLabels) as ChannelType[];

const connectionLabels: Record<ChannelStatus, string> = {
  connected: "연결됨",
  not_connected: "연결 전",
  needs_attention: "확인 필요",
  expired: "연결 만료",
  insufficient_permissions: "권한 확인 필요",
  mapping_required: "계정 확인 필요",
  publish_failed: "게시 실패"
};

const formatLabels: Record<string, string> = {
  instagram_feed_carousel: "카드뉴스",
  instagram_story: "스토리",
  instagram_reel: "Reel",
  threads_text: "텍스트",
  tiktok_video: "영상",
  youtube_video: "영상",
  youtube_short: "Short",
  linkedin_post: "게시물",
  x_post: "텍스트"
};

const integer = new Intl.NumberFormat("ko-KR");

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(new Date(value));
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00+09:00`));
}

function count(value: number) {
  return `${integer.format(value)}건`;
}

function exposure(value: number | null) {
  return value === null ? "데이터 없음" : `${integer.format(value)}회`;
}

function lastCollected(value: string | null) {
  return value ? `${formatDate(value)} 수집` : "아직 수집되지 않음";
}

function attentionMessage(type: Dashboard["attentionItems"][number]["type"]) {
  const messages: Record<Dashboard["attentionItems"][number]["type"], string> = {
    publish_failed: "게시 처리에 실패했습니다. 채널 연결과 게시 설정을 확인해 주세요.",
    channel_error: "채널 연결 상태를 확인해 주세요.",
    sync_failed: "채널 성과 일부를 수집하지 못했습니다.",
    stale_sync: "채널 성과 수집 상태를 확인해 주세요."
  };
  return messages[type];
}

function uniqueAttentionItems(items: Dashboard["attentionItems"]) {
  const seen = new Set<string>();
  return (items ?? []).filter((item) => {
    const key = `${item.type}:${item.channel ?? "all"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type PerformanceContent = Dashboard["topContents"][number];

function DashboardPerformanceDialog({ content, onClose }: { content: PerformanceContent; onClose: () => void }) {
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [artifactError, setArtifactError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setArtifact(null);
    setArtifactError(false);
    api.getPublishArtifact(content.publishQueueId)
      .then((result) => { if (!ignore) setArtifact(result); })
      .catch(() => { if (!ignore) setArtifactError(true); });
    return () => { ignore = true; };
  }, [content.publishQueueId, reloadKey]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="modal-panel publish-result-dialog dashboard-performance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-performance-dialog-title"
      >
        <header className="publish-result-dialog__header">
          <div>
            <h2 id="dashboard-performance-dialog-title">{content.title}</h2>
            <small>{channelLabels[content.channel]} 게시 성과</small>
          </div>
          <button className="button secondary publish-result-dialog__close" type="button" onClick={onClose} aria-label="닫기" title="닫기">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="publish-result-dialog__body">
          <div className="publish-result-dialog__preview publish-result-dialog__scroll">
            {artifact ? <PublishArtifactPreview artifact={artifact} /> : artifactError ? (
              <div className="publish-result-dialog__state" role="alert">
                <p>결과물을 불러오지 못했습니다.</p>
                <button className="button secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>
                  <RefreshCw size={16} aria-hidden="true" /> 다시 시도
                </button>
              </div>
            ) : (
              <div className="publish-result-dialog__state" role="status" aria-label="성과 콘텐츠를 불러오는 중입니다.">
                <span className="spinner" aria-hidden="true" />
                <p>결과물을 불러오는 중입니다.</p>
              </div>
            )}
          </div>

          <aside className="publish-result-dialog__metadata publish-result-dialog__scroll" aria-label="게시 정보">
            <h3>게시 정보</h3>
            <dl>
              <div><dt>채널</dt><dd className="channel-identity"><ChannelLogo channel={content.channel} decorative size={18} /><span>{channelLabels[content.channel]}</span></dd></div>
              <div><dt>게시 유형</dt><dd>{content.deliveryFormat ? formatLabels[content.deliveryFormat] ?? content.deliveryFormat : "-"}</dd></div>
              <div><dt>게시일</dt><dd>{formatDate(content.publishedAt)}</dd></div>
              <div><dt>조회·노출</dt><dd><strong>{exposure(content.exposureCount)}</strong></dd></div>
            </dl>
          </aside>
        </div>

        <footer className="publish-result-dialog__footer">
          <span className="publish-result-dialog__feedback">최근 수집된 성과 기준</span>
          {content.externalUrl ? (
            <a className="button primary" href={content.externalUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} aria-hidden="true" /> 원본 게시물 보기
            </a>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function DailyExposureChart({ rows }: { rows: Dashboard["dailyExposure"] }) {
  const visibleChannels = channelOrder.filter((channel) => (
    rows.some((row) => row.channels[channel] !== null && row.channels[channel] !== undefined)
  ));
  const days = rows.map((row) => ({
    date: row.date,
    channels: visibleChannels.flatMap((channel) => {
      const value = row.channels[channel];
      return value === null || value === undefined ? [] : [{ channel, value }];
    })
  }));
  const totals = days.map((day) => day.channels.reduce((sum, item) => sum + item.value, 0));
  const maximum = Math.max(...totals, 1);
  const chartWidth = 900;
  const chartHeight = 220;
  const baseline = 180;
  const plotHeight = 150;
  const slotWidth = chartWidth / Math.max(days.length, 1);
  const barWidth = Math.max(4, Math.min(24, slotWidth * 0.62));
  const chartLabel = days.map((day, index) => {
    const channels = day.channels
      .map((item) => `${channelLabels[item.channel]} ${integer.format(item.value)}회`)
      .join(", ");
    return `${formatLongDate(day.date)} 합계 ${integer.format(totals[index])}회${channels ? `, ${channels}` : ""}`;
  }).join("; ");

  return (
    <div className="dashboard-chart-frame">
      <ul className="dashboard-chart-legend" aria-label="조회·노출 채널 범례">
        {visibleChannels.map((channel) => (
          <li key={channel}>
            <span className={`dashboard-chart-legend__swatch is-${channel}`} aria-hidden="true" />
            {channelLabels[channel]}
          </li>
        ))}
      </ul>
      <div className="dashboard-chart-scroll">
        <svg
          className="dashboard-chart"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={`최근 30일 일별 조회·노출: ${chartLabel}`}
          preserveAspectRatio="none"
        >
          <line x1="0" y1={baseline} x2={chartWidth} y2={baseline} className="dashboard-chart__axis" />
          {days.map((day, index) => {
            const x = index * slotWidth + (slotWidth - barWidth) / 2;
            let stackedHeight = 0;
            return (
              <g key={day.date}>
                {day.channels.map((item) => {
                  const height = (item.value / maximum) * plotHeight;
                  stackedHeight += height;
                  return (
                    <rect
                      key={item.channel}
                      x={x}
                      y={baseline - stackedHeight}
                      width={barWidth}
                      height={height}
                      className={`dashboard-chart__bar is-${item.channel}`}
                    >
                      <title>{`${formatLongDate(day.date)} ${channelLabels[item.channel]} ${integer.format(item.value)}회, 합계 ${integer.format(totals[index])}회`}</title>
                    </rect>
                  );
                })}
                {(index === 0 || index === days.length - 1) ? (
                  <text x={x + barWidth / 2} y="205" textAnchor="middle" className="dashboard-chart__label">
                    {day.date.slice(5).replace("-", ".")}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function DashboardContent({ dashboard }: { dashboard: Dashboard }) {
  const [selectedContent, setSelectedContent] = useState<PerformanceContent | null>(null);
  const attentionItems = uniqueAttentionItems(dashboard.attentionItems);
  const summary = [
    { label: "발행 완료", value: count(dashboard.summary.publishedCount) },
    { label: "조회·노출", value: exposure(dashboard.summary.exposureCount) },
    { label: "검토 필요", value: count(dashboard.summary.pendingReviewCount) },
    { label: "게시 실패", value: count(dashboard.summary.failedPublishCount), tone: dashboard.summary.failedPublishCount > 0 ? "danger" : undefined }
  ];
  const workflow = [
    { label: "대기 주제", value: dashboard.workflow.queuedTopics },
    { label: "생성 중", value: dashboard.workflow.generating },
    { label: "검토 대기", value: dashboard.workflow.pendingReview },
    { label: "예약·발행", value: dashboard.workflow.scheduledOrPublished }
  ];

  return (
    <>
      <header className="dashboard-head" data-guide="page-header">
        <div>
          <h1>전체 현황</h1>
          <p>최근 30일 · {formatDate(dashboard.generatedAt)} 기준</p>
        </div>
        <div className="actions"><span className="dashboard-collected">성과 {lastCollected(dashboard.lastCollectedAt)}</span><PageGuideButton /></div>
      </header>

      <section className="dashboard-summary" aria-label="최근 30일 요약">
        {summary.map((item) => (
          <article className={`dashboard-metric${item.tone ? ` is-${item.tone}` : ""}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-workflow-title">
        <div className="dashboard-section__head">
          <div>
            <h2 id="dashboard-workflow-title">현재 콘텐츠 운영 흐름</h2>
            <p>주제 등록부터 예약·발행까지의 현재 작업 수입니다.</p>
          </div>
        </div>
        <ol className="dashboard-workflow">
          {workflow.map((item, index) => (
            <li key={item.label}>
              <span className="dashboard-workflow__index">{index + 1}</span>
              <span>{item.label}</span>
              <strong>{count(item.value)}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-chart-title">
        <div className="dashboard-section__head">
          <div>
            <h2 id="dashboard-chart-title">일별 조회·노출 추이</h2>
            <p>채널에서 수집된 일별 증가량 합계입니다.</p>
          </div>
        </div>
        {dashboard.dailyExposure.length > 0 ? (
          <DailyExposureChart rows={dashboard.dailyExposure} />
        ) : (
          <div className="dashboard-empty">표시할 일별 조회·노출 데이터가 없습니다.</div>
        )}
      </section>

      <div className="dashboard-columns">
        <section className="dashboard-section" aria-labelledby="dashboard-channels-title">
          <div className="dashboard-section__head">
            <h2 id="dashboard-channels-title">채널별 성과</h2>
          </div>
          {dashboard.channelPerformance.length > 0 ? (
            <div className="dashboard-table-scroll">
              <table className="dashboard-table">
                <thead><tr><th>채널</th><th>상태</th><th>발행</th><th>조회·노출</th></tr></thead>
                <tbody>
                  {dashboard.channelPerformance.map((item) => {
                    const disconnected = item.connectionStatus === "not_connected";
                    return (
                      <tr key={item.channel}>
                        <th scope="row"><span className="channel-identity"><ChannelLogo channel={item.channel} decorative size={18} /><span>{channelLabels[item.channel]}</span></span></th>
                        <td><span className={`dashboard-status is-${item.connectionStatus}`}>{connectionLabels[item.connectionStatus]}</span></td>
                        <td>{disconnected ? "-" : count(item.publishedCount)}</td>
                        <td>
                          <strong>{disconnected ? "연결 전" : exposure(item.exposureCount)}</strong>
                          {!disconnected ? <small>{lastCollected(item.lastCollectedAt)}</small> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="dashboard-empty">표시할 채널 성과가 없습니다.</div>}
        </section>

        <section className="dashboard-section" aria-labelledby="dashboard-top-title">
          <div className="dashboard-section__head">
            <h2 id="dashboard-top-title">성과가 좋았던 콘텐츠</h2>
          </div>
          {dashboard.topContents.length > 0 ? (
            <ol className="dashboard-top-list">
              {dashboard.topContents.map((item, index) => (
                <li key={item.publishQueueId}>
                  <button type="button" className="dashboard-top-list__button" onClick={() => setSelectedContent(item)} aria-label={`${item.title} 상세 보기`}>
                    <span className="dashboard-top-list__rank">{index + 1}</span>
                    <span className="dashboard-top-list__content">
                      <strong>{item.title}</strong>
                      <small className="channel-identity"><ChannelLogo channel={item.channel} decorative size={16} /><span>{channelLabels[item.channel]}{item.deliveryFormat ? ` · ${formatLabels[item.deliveryFormat] ?? item.deliveryFormat}` : ""} · {formatDate(item.publishedAt)}</span></small>
                    </span>
                    <span className="dashboard-top-list__exposure">{exposure(item.exposureCount)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <div className="dashboard-empty">최근 30일에 성과가 수집된 콘텐츠가 없습니다.</div>}
        </section>
      </div>

      <section className="dashboard-section dashboard-attention" aria-labelledby="dashboard-attention-title">
        <div className="dashboard-section__head">
          <h2 id="dashboard-attention-title">확인 필요</h2>
        </div>
        {attentionItems.length > 0 ? (
          <ul>
            {attentionItems.map((item) => (
              <li key={`${item.type}-${item.channel ?? "all"}`}>
                <AlertTriangle size={18} aria-hidden="true" />
                <div>
                  {item.channel ? <strong className="channel-identity"><ChannelLogo channel={item.channel} decorative size={18} /><span>{channelLabels[item.channel]}</span></strong> : null}
                  <span>{attentionMessage(item.type)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="dashboard-empty">현재 확인할 항목이 없습니다.</div>}
      </section>

      <FeatureSuggestionBanner />

      {selectedContent ? <DashboardPerformanceDialog content={selectedContent} onClose={() => setSelectedContent(null)} /> : null}
    </>
  );
}

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setDashboard(null);
    setError(false);
    api.getDashboard(DEMO_BRAND_ID)
      .then((result) => { if (!ignore) setDashboard(result); })
      .catch(() => { if (!ignore) setError(true); });
    return () => { ignore = true; };
  }, [reloadKey]);

  const state = useMemo(() => {
    if (error) return "error";
    if (!dashboard) return "loading";
    return "ready";
  }, [dashboard, error]);

  if (state === "loading") {
    return <section className="content dashboard-page"><PageSkeleton label="대시보드를 불러오는 중입니다." /></section>;
  }
  if (state === "error" || !dashboard) {
    return (
      <section className="content dashboard-page">
        <div className="dashboard-page-state" role="alert">
          <strong>대시보드를 불러오지 못했습니다.</strong>
          <span>잠시 후 다시 시도하세요.</span>
          <button className="button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={16} aria-hidden="true" /> 다시 시도
          </button>
        </div>
      </section>
    );
  }

  return <section className="content dashboard-page"><DashboardContent dashboard={dashboard} /></section>;
}
