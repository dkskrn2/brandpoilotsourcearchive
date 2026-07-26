import type { DashboardKpi } from "../../types";

const integer = new Intl.NumberFormat("ko-KR");

export function DashboardKpiGrid({ items }: { items: DashboardKpi[] }) {
  return (
    <section className="dashboard-summary" aria-label="최근 30일 요약">
      {items.map((item) => (
        <article
          className={`dashboard-metric${item.tone ? ` is-${item.tone}` : ""}`}
          key={item.label}
        >
          <span>{item.label}</span>
          <strong>{item.value === null ? "데이터 없음" : `${integer.format(item.value)}${item.unit}`}</strong>
          <small>{item.description}</small>
        </article>
      ))}
    </section>
  );
}
