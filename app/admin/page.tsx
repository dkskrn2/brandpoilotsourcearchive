import type { Metadata } from "next";
import Link from "next/link";
import { ArrowSquareOut, Article, FileText, MagnifyingGlass, NotePencil, Plus } from "@phosphor-icons/react/dist/ssr";
import { toggleArticleStatusAction } from "@/app/admin/actions";
import { AdminSidebar } from "@/components/admin-sidebar";
import { formatPublishedDate, getContentStats, isDatabaseConfigured, listArticles, listContactInquiries } from "@/lib/content-db";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "콘텐츠 관리자",
  description: "GROWTHLINE 로컬 콘텐츠 관리자입니다.",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  await requireAdminSession("/admin");
  const { q, status, notice, error } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const selectedStatus = status === "draft" || status === "published" ? status : undefined;
  const databaseConfigured = isDatabaseConfigured();
  const [articles, stats, inquiries] = await Promise.all([
    listArticles({ query, status: selectedStatus }),
    getContentStats(),
    listContactInquiries()
  ]);
  const formatInquiryDate = (value: string) => new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
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
            <div><p>대시보드</p><h1>콘텐츠 운영 현황</h1><span>등록된 글과 발행 상태를 한곳에서 관리합니다.</span></div>
            {databaseConfigured
              ? <Link className="admin-create-button" href="/admin/content/new"><Plus aria-hidden size={18} weight="bold" /> 새 글 작성</Link>
              : <span className="admin-create-button is-disabled"><Plus aria-hidden size={18} weight="bold" /> DB 설정 필요</span>}
          </div>

          {notice && <p className="admin-form-message" role="status">{notice}</p>}
          {error && <p className="admin-form-message is-error" role="alert">{error === "database" ? "DATABASE_URL을 설정한 뒤 다시 시도해 주세요." : "요청을 처리하지 못했습니다."}</p>}
          {!databaseConfigured && <p className="admin-form-message is-error" role="alert">현재 시드 콘텐츠를 읽기 전용으로 표시합니다. Vercel에 DATABASE_URL을 설정하면 관리 기능이 활성화됩니다.</p>}

          <section className="admin-stats" aria-label="콘텐츠 요약">
            <article><span>전체 콘텐츠</span><strong>{stats.total}</strong><small>PostgreSQL에 저장된 글</small></article>
            <article><span>게시 상태</span><strong>{stats.published}</strong><small>공개 목록에 노출 중</small></article>
            <article><span>임시 저장</span><strong>{stats.draft}</strong><small>작성 또는 검토 중</small></article>
            <article><span>카테고리</span><strong>{stats.categories}</strong><small>사용 중인 분류</small></article>
          </section>

          <section className="admin-content-panel" id="content">
            <div className="admin-panel-head">
              <div><h2>콘텐츠 목록</h2><p>검색, 편집, 게시 전환과 삭제를 관리합니다.</p></div>
              <form className="admin-search" action="/admin">
                <label><MagnifyingGlass aria-hidden size={18} /><input type="search" name="q" aria-label="콘텐츠 검색" placeholder="제목 검색" defaultValue={query} /></label>
                <select name="status" aria-label="게시 상태" defaultValue={selectedStatus ?? ""}><option value="">전체 상태</option><option value="published">게시 중</option><option value="draft">임시 저장</option></select>
                <button type="submit">검색</button>
              </form>
            </div>

            {articles.length ? (
              <div className="admin-table-wrap">
                <table>
                  <thead><tr><th>제목</th><th>카테고리</th><th>상태</th><th>게시일</th><th><span className="sr-only">관리</span></th></tr></thead>
                  <tbody>
                    {articles.map((article) => {
                      const nextStatus = article.status === "published" ? "draft" : "published";
                      const statusAction = toggleArticleStatusAction.bind(null, article.id);
                      return (
                        <tr key={article.id}>
                          <td>
                            <div className="admin-title-cell"><span><FileText aria-hidden size={19} /></span><div><strong>{article.title}</strong><small>/content/{article.slug}</small></div></div>
                            <div className="admin-mobile-row-actions">
                              <span>{article.category}</span>
                              <span>{formatPublishedDate(article.publishedAt)}</span>
                              <form action={statusAction}><input type="hidden" name="status" value={nextStatus} /><button className={`admin-status admin-status--${article.status}`} type="submit" disabled={!databaseConfigured}>{article.status === "published" ? "게시 중" : "임시 저장"}</button></form>
                              <Link className="admin-mobile-edit-link" href={`/admin/content/${article.id}`}><NotePencil aria-hidden size={17} /> 편집</Link>
                            </div>
                          </td>
                          <td>{article.category}</td>
                          <td><form action={statusAction}><input type="hidden" name="status" value={nextStatus} /><button className={`admin-status admin-status--${article.status}`} type="submit" title={article.status === "published" ? "임시 저장으로 전환" : "게시로 전환"} disabled={!databaseConfigured}>{article.status === "published" ? "게시 중" : "임시 저장"}</button></form></td>
                          <td>{formatPublishedDate(article.publishedAt)}</td>
                          <td><Link className="admin-edit-link" href={`/admin/content/${article.id}`} aria-label={`${article.title} 편집`}><NotePencil aria-hidden size={19} /></Link></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-list-empty"><Article aria-hidden size={30} /><strong>조건에 맞는 콘텐츠가 없습니다.</strong><p>검색어를 바꾸거나 새 콘텐츠를 작성해보세요.</p></div>
            )}
          </section>

          <section className="admin-content-panel" id="inquiries">
            <div className="admin-panel-head">
              <div><h2>상담 문의</h2><p>홈페이지에서 접수된 최근 문의를 확인합니다.</p></div>
              <strong className="admin-panel-count">최근 {inquiries.length}건</strong>
            </div>
            {!databaseConfigured ? (
              <div className="admin-list-empty"><Article aria-hidden size={30} /><strong>DATABASE_URL을 설정하면 상담 문의가 여기에 저장됩니다.</strong></div>
            ) : inquiries.length ? (
              <div className="admin-table-wrap">
                <table className="admin-inquiry-table">
                  <thead><tr><th>신청자</th><th>사이트</th><th>문의 내용</th><th>접수</th></tr></thead>
                  <tbody>{inquiries.map((inquiry) => (
                    <tr key={inquiry.id}>
                      <td><strong>{inquiry.name}</strong><small>{inquiry.phone}</small></td>
                      <td>{inquiry.site ? <a href={inquiry.site} target="_blank" rel="noreferrer">사이트 보기</a> : "—"}</td>
                      <td className="admin-inquiry-message">{inquiry.message || "—"}</td>
                      <td>{formatInquiryDate(inquiry.createdAt)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="admin-list-empty"><Article aria-hidden size={30} /><strong>아직 접수된 상담 문의가 없습니다.</strong><p>문의가 접수되면 이 목록에 바로 표시됩니다.</p></div>
            )}
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
