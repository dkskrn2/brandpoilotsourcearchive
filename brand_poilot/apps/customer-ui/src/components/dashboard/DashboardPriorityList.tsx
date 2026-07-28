import { Link } from "react-router-dom";
import type { DashboardPriority } from "../../types";

export function DashboardPriorityList({ items }: { items: DashboardPriority[] }) {
  return (
    <section className="dashboard-section dashboard-priority" aria-labelledby="dashboard-priority-title">
      <div className="dashboard-section__head">
        <div>
          <h2 id="dashboard-priority-title">오늘의 우선 작업</h2>
          <p>지금 확인하면 운영 흐름을 빠르게 이어갈 수 있습니다.</p>
        </div>
      </div>
      {items.length > 0 ? (
        <ol className="dashboard-priority-list">
          {items.map((item) => (
            <li className={`is-${item.severity}`} key={item.kind}>
              <span className="dashboard-priority-count">{item.count}</span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
              <Link className="button secondary" to={item.href}>{item.actionLabel}</Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="dashboard-empty">현재 우선 확인할 작업이 없습니다.</div>
      )}
    </section>
  );
}
