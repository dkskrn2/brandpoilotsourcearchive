import type { AiContentUsage } from "../../features/ai-content/types";

function percent(used: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <div className="dashboard-usage-row">
      <div><span>{label}</span><strong>{used} / {limit}회</strong></div>
      <div className="dashboard-usage-track" role="progressbar" aria-label={`${label} 사용량`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}>
        <span style={{ width: `${percent(used, limit)}%` }} />
      </div>
    </div>
  );
}

export function DashboardUsageCard({ usage }: { usage: AiContentUsage | null }) {
  return (
    <section className="dashboard-section dashboard-usage" aria-labelledby="dashboard-usage-title">
      <div className="dashboard-section__head">
        <div>
          <h2 id="dashboard-usage-title">오늘의 사용량</h2>
          <p>같은 결과물의 중복 다운로드는 차감되지 않습니다.</p>
        </div>
      </div>
      {usage ? (
        <>
          <UsageRow label="AI 생성" used={usage.generationUsed} limit={usage.generationLimit} />
          <UsageRow label="신규 다운로드" used={usage.newDownloadUsed} limit={usage.newDownloadLimit} />
          <small className="dashboard-usage-reset">초기화: {new Date(usage.resetsAt).toLocaleString("ko-KR")}</small>
        </>
      ) : (
        <div className="dashboard-empty">사용량 데이터를 불러올 수 없습니다.</div>
      )}
    </section>
  );
}
