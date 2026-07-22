import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { getBrandPilotOverview } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 운영 현황", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotAdminOverviewPage() {
  const session = await requireAdminSession("/admin/brand-pilot");
  let overview;
  let loadError: string | undefined;
  try {
    overview = await getBrandPilotOverview(session.username);
  } catch (error) {
    loadError = error instanceof Error ? error.message : undefined;
  }
  if (!overview) {
    return <BrandPilotAdminShell active="overview"><div className="admin-heading"><div><p>Brand Pilot</p><h1>운영 현황</h1><span>Brand Pilot API만 일시적으로 사용할 수 없습니다.</span></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;
  }
  const stats = [
    ["활성 브랜드", overview.brands.active, `일시정지 ${overview.brands.paused} · 비활성 ${overview.brands.disabled}`],
    ["채널 연결", overview.channels.connected, `확인 필요 ${overview.channels.needsAttention}`],
    ["생성 성공", overview.generation24h.succeeded, `최근 24시간 · 실패 ${overview.generation24h.failed}`],
    ["게시 대기", overview.publishing.scheduled, `검토 ${overview.publishing.pendingReview} · 실패 ${overview.publishing.failed}`],
    ["DM 답변", overview.dm24h.replied, `수신 ${overview.dm24h.received} · 실패 ${overview.dm24h.failed}`],
    ["Wiki 갱신", overview.wiki24h.succeeded, `최근 24시간 · 실패 ${overview.wiki24h.failed}`],
    ["온라인 워커", overview.workers.online, `지연 ${overview.workers.stale}`],
  ] as const;
  return (
      <BrandPilotAdminShell active="overview">
        <div className="admin-heading"><div><p>Brand Pilot</p><h1>운영 현황</h1><span>브랜드, 생성, 게시, DM과 워커 상태를 한곳에서 확인합니다.</span></div><small className="brand-pilot-admin__updated">갱신 {formatAdminDate(overview.generatedAt)}</small></div>
        <section className="brand-pilot-admin__stats" aria-label="Brand Pilot 운영 요약">{stats.map(([label, value, note]) => <article key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{note}</small></article>)}</section>
        <div className="brand-pilot-admin__columns">
          <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>최근 오류</h2><p>게시와 작업 큐에서 가장 최근 발생한 오류입니다.</p></div></div>{overview.recentErrors.length ? <div className="admin-table-wrap"><table><thead><tr><th>구분</th><th>오류</th><th>발생</th></tr></thead><tbody>{overview.recentErrors.map((error) => <tr key={`${error.source}-${error.id}`}><td>{error.source}</td><td className="brand-pilot-admin__wrap">{error.code}</td><td>{formatAdminDate(error.occurredAt)}</td></tr>)}</tbody></table></div> : <div className="admin-list-empty"><strong>최근 오류가 없습니다.</strong><p>게시 및 작업 큐가 정상 상태입니다.</p></div>}</section>
          <section className="brand-pilot-admin__quick"><h2>운영 바로가기</h2><Link href="/admin/brand-pilot/brands"><span><strong>고객·브랜드</strong><small>브랜드 상태와 온보딩 확인</small></span><ArrowRight aria-hidden /></Link><Link href="/admin/brand-pilot/channels"><span><strong>채널 연결</strong><small>연결 오류와 만료 확인</small></span><ArrowRight aria-hidden /></Link><Link href="/admin/brand-pilot/system"><span><strong>시스템</strong><small>워커와 작업 큐 확인</small></span><ArrowRight aria-hidden /></Link></section>
        </div>
    </BrandPilotAdminShell>
  );
}
