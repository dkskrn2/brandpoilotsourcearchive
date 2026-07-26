export function DashboardPerformancePanel({ children }: { children: React.ReactNode }) {
  return (
    <section className="dashboard-performance-panel" aria-labelledby="dashboard-performance-title">
      <div className="dashboard-performance-panel__head">
        <div>
          <h2 id="dashboard-performance-title">최근 성과</h2>
          <p>실제로 수집된 최근 30일 채널 성과입니다.</p>
        </div>
      </div>
      {children}
    </section>
  );
}
