import type { Metadata } from "next";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { BrandPilotAdminEmpty, BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { listBrandPilotChannels } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 채널 연결", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BrandPilotChannelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminSession("/admin/brand-pilot/channels");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const channel = typeof params.channel === "string" ? params.channel : "";
  const status = typeof params.status === "string" ? params.status : "";
  let result;
  let loadError: string | undefined;
  try { result = await listBrandPilotChannels(session.username, { q, channel, status }); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }
  if (!result) return <BrandPilotAdminShell active="channels"><div className="admin-heading"><div><p>외부 연결</p><h1>채널 연결</h1></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;
  return <BrandPilotAdminShell active="channels"><div className="admin-heading"><div><p>외부 연결</p><h1>채널 연결</h1><span>인증 상태, 만료와 마지막 정상 확인 시점을 점검합니다.</span></div></div><section className="admin-content-panel"><div className="admin-panel-head"><div><h2>연결 목록</h2><p>인증 비밀값은 표시하지 않습니다.</p></div><form className="admin-search" action="/admin/brand-pilot/channels"><label><MagnifyingGlass aria-hidden size={18} /><input name="q" type="search" placeholder="브랜드 또는 계정" defaultValue={q} /></label><select name="channel" defaultValue={channel}><option value="">전체 채널</option><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="x">X</option></select><select name="status" defaultValue={status}><option value="">전체 상태</option><option value="connected">연결됨</option><option value="needs_attention">확인 필요</option><option value="expired">만료</option><option value="not_connected">미연결</option></select><button type="submit">검색</button></form></div>{result.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>브랜드</th><th>채널</th><th>계정</th><th>상태</th><th>만료</th><th>최근 정상 확인</th></tr></thead><tbody>{result.data.map((item) => <tr key={item.id}><td><strong>{item.brandName}</strong></td><td>{item.channel}</td><td>{item.accountLabel ?? item.externalAccountIdMasked ?? "—"}</td><td><span className={`brand-pilot-admin__status is-${item.status}`}>{item.status}</span>{item.lastErrorMessage && <small className="brand-pilot-admin__error-note">{item.lastErrorMessage}</small>}</td><td>{formatAdminDate(item.expiresAt)}</td><td>{formatAdminDate(item.lastHealthyAt)}</td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="등록된 채널 연결이 없습니다." description="검색 조건을 변경하거나 고객의 채널 연결 상태를 확인하세요." />}</section></BrandPilotAdminShell>;
}
