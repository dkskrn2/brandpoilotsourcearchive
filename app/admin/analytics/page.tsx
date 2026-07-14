import type { Metadata } from "next";
import { ArrowSquareOut, ChartBar, FileText, Funnel, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { AdminSidebar } from "@/components/admin-sidebar";
import { getAnalyticsDashboard } from "@/lib/google-analytics";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "GA4 분석",
  description: "Google Analytics 기반 사이트와 콘텐츠 성과 분석",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

function number(value: number) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export default async function AnalyticsPage() {
  await requireAdminSession("/admin/analytics");
  const analytics = await getAnalyticsDashboard();

  return (
    <main className="admin-page">
      <AdminSidebar active="analytics" />
      <section className="admin-workspace">
        <header className="admin-topbar">
          <div><strong>분석</strong><span>Google Analytics 4</span></div>
          <a href="https://analytics.google.com/" target="_blank" rel="noreferrer">GA4에서 자세히 보기 <ArrowSquareOut aria-hidden size={17} /></a>
        </header>

        <div className="admin-canvas admin-analytics">
          <div className="admin-heading">
            <div><p>GA4 ANALYTICS</p><h1>방문이 상담으로 이어지는 흐름</h1><span>사이트와 콘텐츠의 최근 28일 성과를 확인합니다.</span></div>
          </div>

          {analytics.status !== "ready" ? (
            <section className="analytics-notice" role="status">
              <ChartBar aria-hidden size={28} weight="duotone" />
              <div>
                <strong>{analytics.status === "unconfigured" ? "GA4 보고서 연결이 필요합니다." : "GA4 보고서를 지금 불러올 수 없습니다."}</strong>
                <p>{analytics.message}</p>
                <ol>
                  <li>Google Analytics에서 숫자로 된 Property ID를 확인합니다.</li>
                  <li>Google Cloud에서 서비스 계정을 만들고 Google Analytics Data API를 활성화합니다.</li>
                  <li>해당 서비스 계정에 GA4 속성의 뷰어 권한을 부여한 뒤 Vercel 환경변수에 등록합니다.</li>
                </ol>
              </div>
            </section>
          ) : (
            <>
              <section className="analytics-summary" aria-label={analytics.periodLabel + " 핵심 지표"}>
                <article><UsersThree aria-hidden size={22} weight="duotone" /><span>활성 사용자</span><strong>{number(analytics.overview.activeUsers)}</strong><small>{analytics.periodLabel}</small></article>
                <article><ChartBar aria-hidden size={22} weight="duotone" /><span>세션</span><strong>{number(analytics.overview.sessions)}</strong><small>{analytics.periodLabel}</small></article>
                <article><FileText aria-hidden size={22} weight="duotone" /><span>페이지 조회</span><strong>{number(analytics.overview.pageViews)}</strong><small>{analytics.periodLabel}</small></article>
                <article><Funnel aria-hidden size={22} weight="duotone" /><span>상담 완료</span><strong>{number(analytics.overview.leads)}</strong><small>generate_lead 이벤트</small></article>
              </section>

              <section className="analytics-grid">
                <section className="admin-content-panel">
                  <div className="admin-panel-head"><div><h2>상위 페이지</h2><p>조회와 활성 사용자를 함께 봅니다.</p></div></div>
                  <div className="admin-table-wrap">
                    <table className="analytics-table">
                      <thead><tr><th>페이지</th><th>조회</th><th>활성 사용자</th></tr></thead>
                      <tbody>{analytics.topPages.map((page) => <tr key={page.label + "-" + page.detail}><td><strong>{page.label}</strong><small>{page.detail}</small></td><td>{number(page.pageViews ?? 0)}</td><td>{number(page.activeUsers)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>

                <section className="admin-content-panel">
                  <div className="admin-panel-head"><div><h2>유입 채널</h2><p>세션 기준 상위 유입 경로입니다.</p></div></div>
                  <div className="admin-table-wrap">
                    <table className="analytics-table">
                      <thead><tr><th>채널</th><th>세션</th><th>활성 사용자</th></tr></thead>
                      <tbody>{analytics.sources.map((source) => <tr key={source.label}><td><strong>{source.label}</strong></td><td>{number(source.sessions)}</td><td>{number(source.activeUsers)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </section>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
