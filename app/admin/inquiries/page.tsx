import type { Metadata } from "next";
import { Article } from "@phosphor-icons/react/dist/ssr";
import { AdminSidebar } from "@/components/admin-sidebar";
import { isDatabaseConfigured, listContactInquiries } from "@/lib/content-db";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "상담 문의", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function formatInquiryDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(value));
}

export default async function InquiriesPage() {
  await requireAdminSession("/admin/inquiries");
  const databaseConfigured = isDatabaseConfigured();
  const inquiries = await listContactInquiries();

  return <main className="admin-page">
    <AdminSidebar active="inquiries" />
    <section className="admin-workspace">
      <header className="admin-topbar"><div><strong>상담 문의</strong><span>홈페이지 접수 관리</span></div></header>
      <div className="admin-canvas">
        <div className="admin-heading"><div><p>INQUIRY MANAGEMENT</p><h1>상담 문의</h1><span>홈페이지에서 접수된 상담 요청을 최신순으로 확인합니다.</span></div></div>
        <section className="admin-content-panel">
          <div className="admin-panel-head"><div><h2>접수 목록</h2><p>연락처와 이메일을 눌러 바로 응대할 수 있습니다.</p></div><strong className="admin-panel-count">최근 {inquiries.length}건</strong></div>
          {!databaseConfigured ? <div className="admin-list-empty"><Article aria-hidden size={30} /><strong>DATABASE_URL을 설정하면 상담 문의가 여기에 저장됩니다.</strong></div> : inquiries.length ? <div className="admin-table-wrap"><table className="admin-inquiry-table"><thead><tr><th>신청자</th><th>연락처</th><th>이메일</th><th>사이트</th><th>문의 내용</th><th>접수</th></tr></thead><tbody>{inquiries.map((inquiry) => <tr key={inquiry.id}><td><strong>{inquiry.name}</strong><a className="admin-inquiry-mobile-contact" href={`tel:${inquiry.phone}`}>{inquiry.phone}</a>{inquiry.email ? <a className="admin-inquiry-mobile-contact" href={`mailto:${inquiry.email}`}>{inquiry.email}</a> : null}</td><td><a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a></td><td>{inquiry.email ? <a href={`mailto:${inquiry.email}`}>{inquiry.email}</a> : "—"}</td><td>{inquiry.site ? <a href={inquiry.site} target="_blank" rel="noreferrer">사이트 보기</a> : "—"}</td><td className="admin-inquiry-message">{inquiry.message || "—"}</td><td>{formatInquiryDate(inquiry.createdAt)}</td></tr>)}</tbody></table></div> : <div className="admin-list-empty"><Article aria-hidden size={30} /><strong>아직 접수된 상담 문의가 없습니다.</strong><p>문의가 접수되면 이 목록에 바로 표시됩니다.</p></div>}
        </section>
      </div>
    </section>
  </main>;
}
