import type { ReturnTypeOfPerformanceViewModel } from "./performanceTypes";

export function PerformanceObservationList({
  observations,
}: {
  observations: ReturnTypeOfPerformanceViewModel["observations"];
}) {
  if (!observations.length) return <p className="performance-state">수집된 성과 관측값이 없습니다.</p>;
  return (
    <div className="performance-evidence-grid">
      <section aria-labelledby="performance-observation-title">
        <h2 id="performance-observation-title">관측</h2>
        <ul>{observations.map((item) => <li key={item.id}>{item.observation}</li>)}</ul>
      </section>
      <section aria-labelledby="performance-interpretation-title">
        <h2 id="performance-interpretation-title">해석</h2>
        <ul>{observations.map((item) => <li key={item.id}>{item.interpretation}</li>)}</ul>
      </section>
    </div>
  );
}
