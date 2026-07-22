import type { Metadata } from "next";
import { BrandPilotAdminEmpty, BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { listBrandPilotAuditEvents } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 감사 로그", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminSession("/admin/brand-pilot/audit");
  const params = await searchParams;
  const eventType = typeof params.eventType === "string" ? params.eventType : "";
  const brandId = typeof params.brandId === "string" ? params.brandId : "";
  let result;
  let loadError: string | undefined;
  try { result = await listBrandPilotAuditEvents(session.username, { eventType, brandId }); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }
  if (!result) return <BrandPilotAdminShell active="audit"><div className="admin-heading"><div><p>변경 추적</p><h1>감사 로그</h1></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;
  return <BrandPilotAdminShell active="audit"><div className="admin-heading"><div><p>변경 추적</p><h1>감사 로그</h1><span>관리자와 시스템이 실행한 주요 변경을 확인합니다.</span></div></div><section className="admin-content-panel"><div className="admin-panel-head"><div><h2>변경 이력</h2><p>민감한 인증값은 기록하거나 표시하지 않습니다.</p></div><form className="admin-search" action="/admin/brand-pilot/audit"><input name="eventType" placeholder="이벤트 유형" defaultValue={eventType} /><input name="brandId" placeholder="브랜드 UUID" defaultValue={brandId} /><button type="submit">검색</button></form></div>{result.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>이벤트</th><th>대상</th><th>실행자</th><th>사유</th><th>발생</th></tr></thead><tbody>{result.data.map((event) => <tr key={event.id}><td><strong>{event.eventType}</strong></td><td>{event.entityType}{event.entityId ? ` · ${event.entityId.slice(0, 8)}` : ""}</td><td>{event.actorId ?? event.actorType}</td><td className="brand-pilot-admin__wrap">{event.reason ?? "—"}</td><td>{formatAdminDate(event.createdAt)}</td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="조건에 맞는 감사 이벤트가 없습니다." description="필터를 제거하거나 변경 작업이 발생한 뒤 다시 확인하세요." />}</section></BrandPilotAdminShell>;
}
