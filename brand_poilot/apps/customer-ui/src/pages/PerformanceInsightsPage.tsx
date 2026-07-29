import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { PageSkeleton } from "../components/ui/LoadingState";
import { PerformanceSummary } from "../components/performance/PerformanceSummary";
import { PerformanceObservationList } from "../components/performance/PerformanceObservationList";
import { PerformanceExperimentCards } from "../components/performance/PerformanceExperimentCards";
import { PerformanceContentList } from "../components/performance/PerformanceContentList";
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
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
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

  function openContent(
    content: PerformanceInsights["topContents"][number],
    trigger: HTMLButtonElement,
  ) {
    detailTriggerRef.current = trigger;
    setSelected(content);
  }

  function closeContent() {
    setSelected(null);
    detailTriggerRef.current?.focus();
  }

  if (error) return <section className="content performance-page"><p className="performance-state" role="alert">성과 데이터를 불러오지 못했습니다.</p></section>;
  if (!insights || !viewModel) return <section className="content performance-page"><PageSkeleton label="성과·개선을 불러오는 중입니다." /></section>;

  return (
    <section className="content performance-page">
      <PageHeader title="성과·개선" description="최근 30일의 관측값, 해석, 다음 실험을 구분해 확인합니다." />
      <PerformanceSummary insights={insights} />
      {insights.summary.dataStatus === "insufficient" ? <p className="performance-data-warning">데이터 부족 · 개선 결론을 제시하지 않습니다.</p> : null}
      <PerformanceObservationList observations={viewModel.observations} />
      <PerformanceContentList contents={insights.topContents} onOpen={openContent} />
      <section className="performance-windows" aria-label="측정 구간">
        <span className="performance-windows-label">측정 구간</span>
        {insights.windows.map((window) => <div key={window.window}><strong>{window.window === "24h" ? "24시간" : window.window === "72h" ? "72시간" : "7일"}</strong><span>표본 {window.sampleSize}건</span><span>{window.averageExposure === null ? "미수집" : `평균 ${window.averageExposure.toLocaleString("ko-KR")}회`}</span></div>)}
      </section>
      <PerformanceExperimentCards experiments={viewModel.experiments} busyId={busyId} batchId={batchId} onCreate={createProposal} />
      {selected ? <PerformanceContentDialog content={selected} loadArtifact={loadArtifact} onClose={closeContent} /> : null}
    </section>
  );
}
