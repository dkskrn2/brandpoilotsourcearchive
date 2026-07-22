import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { updateBrandStatusAction } from "@/app/admin/brand-pilot/actions";
import { BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { getBrandPilotBrand } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 브랜드 상세", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotBrandDetailPage({ params, searchParams }: { params: Promise<{ brandId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { brandId } = await params;
  const returnPath = `/admin/brand-pilot/brands/${brandId}` as Route;
  const session = await requireAdminSession(returnPath);
  const query = await searchParams;
  const notice = typeof query.notice === "string" ? query.notice : "";
  const errorMessage = typeof query.error === "string" ? query.error : "";
  let brand;
  let loadError: string | undefined;
  try { brand = await getBrandPilotBrand(session.username, brandId); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }
  if (!brand) return <BrandPilotAdminShell active="brands"><Link className="admin-editor__back" href="/admin/brand-pilot/brands"><ArrowLeft aria-hidden size={18} /> 브랜드 목록</Link><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;

  const nextStatus = brand.status === "active" ? "paused" : "active";
  const action = updateBrandStatusAction.bind(null, brand.id);
  return <BrandPilotAdminShell active="brands">
    <Link className="admin-editor__back" href="/admin/brand-pilot/brands"><ArrowLeft aria-hidden size={18} /> 브랜드 목록</Link>
    <div className="admin-heading brand-pilot-admin__detail-heading"><div><p>{brand.workspaceName}</p><h1>{brand.name}</h1><span>{brand.owner.displayName ?? "소유자"} · {brand.owner.email ?? "이메일 없음"}</span></div><span className={`brand-pilot-admin__status is-${brand.status}`}>{brand.status === "active" ? "활성" : brand.status === "paused" ? "일시정지" : "비활성"}</span></div>
    {notice && <p className="admin-form-message" role="status">{notice}</p>}
    {errorMessage && <p className="admin-form-message is-error" role="alert">{errorMessage}</p>}
    <div className="brand-pilot-admin__detail-grid">
      <section className="admin-content-panel"><div className="admin-panel-head"><div><h2>운영 정보</h2><p>고객 설정과 오늘 사용량입니다.</p></div></div><dl className="brand-pilot-admin__facts"><div><dt>대표 분야</dt><dd>{brand.category.primary?.name ?? "미설정"}</dd></div><div><dt>핵심 고객</dt><dd>{brand.profile.primaryCustomer ?? "미설정"}</dd></div><div><dt>연결 채널</dt><dd>{brand.connectedChannelCount}개</dd></div><div><dt>DM 자동답변</dt><dd>{brand.dmEnabled ? "사용" : "미사용"}</dd></div><div><dt>자동 승인</dt><dd>{brand.profile.autoApprovalEnabled ? "사용" : "미사용"}</dd></div><div><dt>오늘 AI 생성</dt><dd>{brand.aiContentUsageToday.generationCount}회</dd></div><div><dt>오늘 다운로드</dt><dd>{brand.aiContentUsageToday.downloadCount}회</dd></div><div><dt>최근 활동</dt><dd>{formatAdminDate(brand.lastActivityAt)}</dd></div><div><dt>자사 URL</dt><dd>{brand.ownedSource ? <a href={brand.ownedSource.url} target="_blank" rel="noreferrer">{brand.ownedSource.url}</a> : "미등록"}</dd></div></dl></section>
      <aside className="brand-pilot-admin__status-action"><h2>브랜드 상태 변경</h2>{brand.status === "disabled" ? <p>비활성 브랜드는 이 화면에서 상태를 변경할 수 없습니다.</p> : <form action={action}><input type="hidden" name="status" value={nextStatus} /><label><span>상태 변경 사유</span><textarea name="reason" required maxLength={500} rows={5} placeholder={nextStatus === "paused" ? "일시정지 사유를 입력하세요." : "운영 재개 사유를 입력하세요."} /></label><button type="submit" className={nextStatus === "paused" ? "is-danger" : ""}>{nextStatus === "paused" ? "운영 일시정지" : "운영 재개"}</button><small>변경 내용과 사유는 감사 로그에 기록됩니다.</small></form>}</aside>
    </div>
  </BrandPilotAdminShell>;
}
