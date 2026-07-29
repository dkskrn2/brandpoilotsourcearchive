import type { PerformanceInsights } from "../../types";

function lastCollected(value: string | null) {
  if (!value) return "아직 수집되지 않음";
  return `최근 수집 ${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value))}`;
}

export function PerformanceSummary({ insights }: { insights: PerformanceInsights }) {
  const dataReady = insights.summary.dataStatus === "sufficient";

  return (
    <section className="performance-summary" aria-label="최근 30일 성과 요약">
      <header className="performance-summary-heading">
        <div>
          <p className="performance-eyebrow">LAST 30 DAYS</p>
          <h2>최근 30일 핵심 성과</h2>
        </div>
        <div className="performance-summary-status">
          <strong className={dataReady ? "is-ready" : "is-insufficient"}>
            {dataReady ? "분석 가능" : "데이터 부족"}
          </strong>
          <span>{lastCollected(insights.lastCollectedAt)}</span>
        </div>
      </header>
      <div className="performance-summary-metrics">
        <div><span>측정 콘텐츠</span><strong>{insights.summary.measuredContentCount.toLocaleString("ko-KR")}건</strong></div>
        <div><span>측정 표본</span><strong>{insights.sampleSize.toLocaleString("ko-KR")}건</strong></div>
        <div><span>누적 노출</span><strong>{insights.summary.totalExposure?.toLocaleString("ko-KR") ?? "미수집"}회</strong></div>
      </div>
    </section>
  );
}
