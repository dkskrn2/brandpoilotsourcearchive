import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { BrandPilotAdminEmpty, BrandPilotAdminError, BrandPilotAdminShell, formatAdminDate } from "@/components/brand-pilot-admin-shell";
import { listBrandPilotPublishing } from "@/lib/brand-pilot-admin";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "Brand Pilot 콘텐츠·게시", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  queued: "대기",
  scheduled: "예약",
  publishing: "게시 중",
  published: "완료",
  failed: "실패",
  deferred: "이월",
  cancelled: "취소",
};

export default async function BrandPilotPublishingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminSession("/admin/brand-pilot/publishing");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const channel = typeof params.channel === "string" ? params.channel : "";
  const status = typeof params.status === "string" ? params.status : "";
  let result;
  let loadError: string | undefined;
  try { result = await listBrandPilotPublishing(session.username, { q, channel, status }); }
  catch (error) { loadError = error instanceof Error ? error.message : undefined; }

  if (!result) return <BrandPilotAdminShell active="publishing"><div className="admin-heading"><div><p>콘텐츠 운영</p><h1>콘텐츠·게시</h1></div></div><BrandPilotAdminError message={loadError} /></BrandPilotAdminShell>;

  return <BrandPilotAdminShell active="publishing">
    <div className="admin-heading"><div><p>콘텐츠 운영</p><h1>콘텐츠·게시</h1><span>생성 결과와 채널별 게시 상태, 실패 이력을 확인합니다.</span></div></div>
    <section className="admin-content-panel">
      <div className="admin-panel-head"><div><h2>게시 목록</h2><p>실제 게시 큐 기준이며 비밀 인증 정보는 표시하지 않습니다.</p></div><form className="admin-search" action="/admin/brand-pilot/publishing"><label><MagnifyingGlass aria-hidden size={18} /><input name="q" type="search" placeholder="브랜드 또는 콘텐츠" defaultValue={q} /></label><select name="channel" defaultValue={channel}><option value="">전체 채널</option><option value="instagram">Instagram</option><option value="threads">Threads</option><option value="youtube">YouTube</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="x">X</option></select><select name="status" defaultValue={status}><option value="">전체 게시 상태</option><option value="queued">대기</option><option value="scheduled">예약</option><option value="publishing">게시 중</option><option value="published">완료</option><option value="failed">실패</option><option value="deferred">이월</option><option value="cancelled">취소</option></select><button type="submit">검색</button></form></div>
      {result.data.length ? <div className="admin-table-wrap"><table><thead><tr><th>브랜드·콘텐츠</th><th>채널·형식</th><th>출력 상태</th><th>게시 상태</th><th>게시 일시</th><th>시도</th><th>상세</th></tr></thead><tbody>{result.data.map((item) => <tr key={item.id}><td><Link className="brand-pilot-admin__identity" href={`/admin/brand-pilot/publishing/${item.id}` as Route}><strong>{item.contentTitle}</strong><small>{item.brandName}{item.topicTitle ? ` · ${item.topicTitle}` : ""}</small></Link></td><td><span className="brand-pilot-admin__channel">{item.channel}</span><small className="brand-pilot-admin__format">{item.deliveryFormat ?? "기본 형식"}</small></td><td><span className={`brand-pilot-admin__status is-${item.outputStatus}`}>{item.outputStatus}</span></td><td><span className={`brand-pilot-admin__status is-${item.queueStatus}`}>{statusLabel[item.queueStatus] ?? item.queueStatus}</span>{item.lastError && <small className="brand-pilot-admin__error-note">{item.lastError}</small>}</td><td>{formatAdminDate(item.publishedAt ?? item.scheduledFor ?? item.queuedAt)}</td><td>{item.attemptCount}회</td><td><Link className="brand-pilot-admin__detail-link" href={`/admin/brand-pilot/publishing/${item.id}` as Route} aria-label={`${item.contentTitle} 상세 보기`}><ArrowRight aria-hidden size={18} /></Link></td></tr>)}</tbody></table></div> : <BrandPilotAdminEmpty title="게시 항목이 없습니다." description="검색 조건을 변경하거나 콘텐츠 생성·승인 상태를 확인하세요." />}
    </section>
  </BrandPilotAdminShell>;
}
