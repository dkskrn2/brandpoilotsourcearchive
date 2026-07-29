import type { ReturnTypeOfPerformanceViewModel } from "./performanceTypes";

export function PerformanceObservationList({
  observations,
}: {
  observations: ReturnTypeOfPerformanceViewModel["observations"];
}) {
  if (!observations.length) return <p className="performance-state">수집된 성과 관측값이 없습니다.</p>;
  return (
    <section className="performance-evidence" aria-labelledby="performance-evidence-title">
      <header className="performance-section-heading">
        <div>
          <p className="performance-eyebrow">EVIDENCE</p>
          <h2 id="performance-evidence-title">관측과 해석</h2>
        </div>
        <p>측정값과 그 의미를 한 쌍으로 확인합니다.</p>
      </header>
      <div className="performance-evidence-list">
        {observations.map((item) => (
          <article
            aria-label={`${item.observation} 관측과 해석`}
            className="performance-evidence-item"
            key={item.id}
          >
            <div>
              <span>관측</span>
              <strong>{item.observation}</strong>
            </div>
            <div>
              <span>해석</span>
              <p>{item.interpretation}</p>
              {item.confidence ? <small>신뢰도 {item.confidence}</small> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
