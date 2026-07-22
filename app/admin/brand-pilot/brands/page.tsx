import type { Metadata } from "next";
import Link from "next/link";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { BrandPilotAdminEmpty, BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { listBrandPilotBrands } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 고객·브랜드", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotBrandsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminSession("/admin/brand-pilot/brands");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const status = typeof params.status === "string" ? params.status : "";
  let result;
  let loadError: string | undefined;
  try { result = await listBrandPilotBrands(session.username, { q, status }); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }
  if (!result) return <BrandPilotAdminShell active="brands"><div className="admin-heading"><div><p>고객 운영</p><h1>고객·브랜드</h1></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;
  return <BrandPilotAdminShell active="brands"><div className="admin-heading"><div><p>고객 운영</p><h1>고객·브랜드</h1><span>가입 브랜드의 상태, 연결 채널과 최근 활동을 확인합니다.</span></div></div><section className="admin-content-panel"><div className="admin-panel-head"><div><h2>브랜드 목록</h2><p>총 {result.data.length}개가 표시됩니다.</p></div><form className="admin-search" action="/admin/brand-pilot/brands"><label><MagnifyingGlass aria-hidden size={18} /><input name="q" type="search" placeholder="브랜드 또는 이메일" defaultValue={q} /></label><select name="status" defaultValue={status}><option value="">전체 상태</option><option value="active">활성</option><option value="paused">일시정지</option><option value="disabled">비활성</option></select><button type="submit">검색</button></form></div>{result.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>브랜드</th><th>상태</th><th>대표 분야</th><th>채널</th><th>DM</th><th>최근 활동</th></tr></thead><tbody>{result.data.map((brand) => <tr key={brand.id}><td><Link className="brand-pilot-admin__identity" href={`/admin/brand-pilot/brands/${brand.id}`}><strong>{brand.name}</strong><small>{brand.owner.email ?? brand.workspaceName}</small></Link></td><td><span className={`brand-pilot-admin__status is-${brand.status}`}>{brand.status === "active" ? "활성" : brand.status === "paused" ? "일시정지" : "비활성"}</span></td><td>{brand.category.primary?.name ?? "미설정"}</td><td>{brand.connectedChannelCount}</td><td>{brand.dmEnabled ? "사용" : "미사용"}</td><td>{formatAdminDate(brand.lastActivityAt)}</td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="조건에 맞는 브랜드가 없습니다." description="검색어 또는 상태 조건을 변경해 주세요." />}</section></BrandPilotAdminShell>;
}
