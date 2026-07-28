import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { PageSkeleton } from "../components/ui/LoadingState";
import { PerformanceSummary } from "../components/performance/PerformanceSummary";
import { PerformanceObservationList } from "../components/performance/PerformanceObservationList";
import { PerformanceExperimentCards } from "../components/performance/PerformanceExperimentCards";
import { PerformanceContentDialog } from "../components/performance/PerformanceContentDialog";
import { createPerformanceViewModel } from "../features/performance/performanceViewModel";
import { performanceGateway } from "../features/performance/performanceGateway";
import { DEMO_BRAND_ID } from "../lib/apiClient";
import type { PerformanceExperiment, PerformanceInsights } from "../types";

export function PerformanceInsightsPage() {
  const [insights, setInsights] = useState<PerformanceInsights | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<PerformanceInsights["topContents"][number] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const loadArtifact = useCallback((queueId: string) => performanceGateway.getArtifact(queueId), []);

  useEffect(() => {
    let active = true;
    performanceGateway.getInsights(DEMO_BRAND_ID)
      .then((value) => { if (active) setInsights(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  const viewModel = useMemo(() => insights ? createPerformanceViewModel(insights) : null, [insights]);

  async function createProposal(experiment: PerformanceExperiment) {
    setBusyId(experiment.id);
    setBatchId(null);
    try {
      const result = await performanceGateway.createProposalBatch(DEMO_BRAND_ID, experiment);
      setBatchId(result.batchId);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <section className="content performance-page"><p className="performance-state" role="alert">성과 데이터를 불러오지 못했습니다.</p></section>;
  if (!insights || !viewModel) return <section className="content performance-page"><PageSkeleton label="성과·개선을 불러오는 중입니다." /></section>;

  return (
    <section className="content performance-page">
      <PageHeader title="성과·개선" description="최근 30일의 관측값, 해석, 다음 실험을 구분해 확인합니다." />
      <PerformanceSummary insights={insights} />
      {insights.summary.dataStatus === "insufficient" ? <p className="performance-data-warning">데이터 부족 · 개선 결론을 제시하지 않습니다.</p> : null}
      <PerformanceObservationList observations={viewModel.observations} />
      <section className="performance-windows" aria-label="측정 구간">
        {insights.windows.map((window) => <div key={window.window}><strong>{window.window}</strong><span>표본 {window.sampleSize}건</span><span>{window.averageExposure === null ? "미수집" : `평균 ${window.averageExposure.toLocaleString("ko-KR")}회`}</span></div>)}
      </section>
      <section className="performance-top" aria-labelledby="performance-top-title">
        <h2 id="performance-top-title">성과 콘텐츠</h2>
        {insights.topContents.length ? <ul>{insights.topContents.map((content) => <li key={content.publishQueueId}><button type="button" onClick={() => setSelected(content)} aria-label={`${content.title} 상세 보기`}><span>{content.title}</span><strong>{content.exposureCount?.toLocaleString("ko-KR") ?? "미수집"}회</strong></button></li>)}</ul> : <p className="performance-state">성과가 수집된 콘텐츠가 없습니다.</p>}
      </section>
      <PerformanceExperimentCards experiments={viewModel.experiments} busyId={busyId} batchId={batchId} onCreate={createProposal} />
      {selected ? <PerformanceContentDialog content={selected} loadArtifact={loadArtifact} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
