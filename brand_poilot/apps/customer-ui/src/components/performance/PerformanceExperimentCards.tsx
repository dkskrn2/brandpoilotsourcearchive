import type { PerformanceExperiment } from "../../types";

export function PerformanceExperimentCards({
  experiments,
  busyId,
  batchId,
  onCreate,
}: {
  experiments: PerformanceExperiment[];
  busyId: string | null;
  batchId: string | null;
  onCreate: (experiment: PerformanceExperiment) => void;
}) {
  return (
    <section className="performance-experiments" aria-labelledby="performance-experiment-title">
      <h2 id="performance-experiment-title">다음 실험</h2>
      {experiments.length ? (
        <div className="performance-experiment-grid">
          {experiments.map((experiment) => (
            <article key={experiment.id}>
              <h3>{experiment.title}</h3>
              <p>{experiment.hypothesis}</p>
              <button
                className="button primary"
                type="button"
                disabled={busyId !== null}
                onClick={() => onCreate(experiment)}
              >
                {busyId === experiment.id ? "구성안 준비 중…" : "이 데이터로 AI 구성안 만들기"}
              </button>
            </article>
          ))}
        </div>
      ) : <p className="performance-state">표본이 더 쌓이면 다음 실험을 제안합니다.</p>}
      {batchId ? <a className="button secondary" href={`/ai-content/new?proposalBatch=${encodeURIComponent(batchId)}`}>생성된 구성안 열기</a> : null}
    </section>
  );
}
