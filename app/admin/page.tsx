import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowSquareOut, Article, ChatCircleDots, FileText } from "@phosphor-icons/react/dist/ssr";
import { AdminSidebar } from "@/components/admin-sidebar";
import { getContentStats, isDatabaseConfigured, listContactInquiries } from "@/lib/content-db";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "콘텐츠 관리자",
  description: "GROWTHLINE 로컬 콘텐츠 관리자입니다.",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminSession("/admin");
  const databaseConfigured = isDatabaseConfigured();
  const [stats, inquiries] = await Promise.all([getContentStats(), listContactInquiries()]);
  return (
    <main className="admin-page">
      <AdminSidebar />
      <section className="admin-workspace">
        <header className="admin-topbar">
          <div><strong>관리자</strong><span>Vercel 콘텐츠 운영</span></div>
          <Link href="/content" target="_blank">콘텐츠 페이지 보기 <ArrowSquareOut aria-hidden size={17} /></Link>
        </header>

        <div className="admin-canvas">
          <div className="admin-heading">
            <div><p>대시보드</p><h1>운영 현황</h1><span>콘텐츠 발행과 상담 접수를 별도 화면에서 관리합니다.</span></div>
          </div>

          {!databaseConfigured && <p className="admin-form-message is-error" role="alert">현재 시드 콘텐츠를 읽기 전용으로 표시합니다. Vercel에 DATABASE_URL을 설정하면 관리 기능이 활성화됩니다.</p>}

          <section className="admin-stats" aria-label="콘텐츠 요약">
            <article><span>전체 콘텐츠</span><strong>{stats.total}</strong><small>PostgreSQL에 저장된 글</small></article>
            <article><span>게시 상태</span><strong>{stats.published}</strong><small>공개 목록에 노출 중</small></article>
            <article><span>임시 저장</span><strong>{stats.draft}</strong><small>작성 또는 검토 중</small></article>
            <article><span>카테고리</span><strong>{stats.categories}</strong><small>사용 중인 분류</small></article>
          </section>

          <section className="admin-dashboard-shortcuts" aria-label="운영 바로가기">
            <Link href="/admin/content">
              <span><FileText aria-hidden size={24} weight="duotone" /></span>
              <div><strong>콘텐츠 관리</strong><p>목록을 검색하고, 새 글 작성·편집·게시 상태를 관리합니다.</p></div>
              <ArrowRight aria-hidden size={20} />
            </Link>
            <Link href="/admin/inquiries">
              <span><ChatCircleDots aria-hidden size={24} weight="duotone" /></span>
              <div><strong>상담 문의</strong><p>홈페이지에서 접수된 상담 요청을 확인하고 바로 연락할 수 있습니다.</p><small>최근 {inquiries.length}건</small></div>
              <ArrowRight aria-hidden size={20} />
            </Link>
          </section>

          <section className="admin-empty-preview">
            <Article aria-hidden size={28} />
            <div><strong>{databaseConfigured ? "Vercel PostgreSQL 연결됨" : "PostgreSQL 연결 대기 중"}</strong><p>{databaseConfigured ? "콘텐츠를 PostgreSQL에 저장하고 공개 페이지에 즉시 반영합니다." : "DATABASE_URL을 입력하기 전까지 시드 콘텐츠만 읽기 전용으로 표시합니다."}</p></div>
          </section>
        </div>
      </section>
    </main>
  );
}
