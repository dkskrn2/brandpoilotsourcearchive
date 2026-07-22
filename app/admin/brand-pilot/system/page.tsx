import type { Metadata } from "next";
import { BrandPilotAdminEmpty, BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { getBrandPilotSystemHealth } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 시스템", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotSystemPage() {
  const session = await requireAdminSession("/admin/brand-pilot/system");
  let health;
  let loadError: string | undefined;
  try { health = await getBrandPilotSystemHealth(session.username); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }
  if (!health) return <BrandPilotAdminShell active="system"><div className="admin-heading"><div><p>런타임</p><h1>시스템</h1></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;
  return <BrandPilotAdminShell active="system"><div className="admin-heading"><div><p>런타임</p><h1>시스템</h1><span>작업 큐, 상시 워커와 스케줄러의 최근 상태입니다.</span></div><small className="brand-pilot-admin__updated">확인 {formatAdminDate(health.checkedAt)}</small></div><section className="brand-pilot-admin__queue" aria-label="작업 큐 상태">{Object.entries(health.queueCounts).length ? Object.entries(health.queueCounts).map(([status, count]) => <article key={status}><span>{status}</span><strong>{count.toLocaleString()}</strong></article>) : <article><span>작업 큐</span><strong>0</strong></article>}</section><section className="admin-content-panel"><div className="admin-panel-head"><div><h2>워커</h2><p>90초 이내 하트비트는 온라인으로 표시합니다.</p></div></div>{health.workers.length ? <div className="admin-table-wrap"><table><thead><tr><th>워커</th><th>유형</th><th>상태</th><th>마지막 하트비트</th></tr></thead><tbody>{health.workers.map((worker) => <tr key={worker.workerId}><td><strong>{worker.workerId}</strong></td><td>{worker.workerType}</td><td><span className={`brand-pilot-admin__status is-${worker.status}`}>{worker.status}</span></td><td>{formatAdminDate(worker.lastHeartbeatAt)}</td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="등록된 워커가 없습니다." description="상시 실행 워커가 시작되면 이곳에 표시됩니다." />}</section><section className="admin-content-panel"><div className="admin-panel-head"><div><h2>최근 스케줄러 실행</h2><p>크롤링과 성과 수집 등 자동화 실행 이력입니다.</p></div></div>{health.schedulers.length ? <div className="admin-table-wrap"><table><thead><tr><th>종류</th><th>상태</th><th>시작</th><th>종료</th></tr></thead><tbody>{health.schedulers.map((run, index) => <tr key={`${run.type}-${run.startedAt}-${index}`}><td>{run.type}</td><td><span className={`brand-pilot-admin__status is-${run.status}`}>{run.status}</span></td><td>{formatAdminDate(run.startedAt)}</td><td>{formatAdminDate(run.finishedAt)}</td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="최근 자동화 실행이 없습니다." description="스케줄러가 실행되면 최근 10건이 표시됩니다." />}</section></BrandPilotAdminShell>;
}
