import type { Metadata, Route } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { notFound, redirect } from "next/navigation";
import { deleteArticleAction, updateArticleAction } from "@/app/admin/actions";
import { AdminArticleForm } from "@/components/admin-article-form";
import { AdminDeleteButton } from "@/components/admin-delete-button";
import { AdminSidebar } from "@/components/admin-sidebar";
import { getArticleById, isDatabaseConfigured } from "@/lib/content-db";
import { requireAdminSession } from "@/lib/admin-auth";

export const metadata: Metadata = { title: "콘텐츠 편집", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditContentPage({ params, searchParams }: PageProps<"/admin/content/[id]">) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  await requireAdminSession(`/admin/content/${idParam}`);
  if (!isDatabaseConfigured()) redirect("/admin?error=database" as Route);
  const article = Number.isInteger(id) ? await getArticleById(id) : undefined;
  if (!article) notFound();
  const { notice, error } = await searchParams;
  const updateAction = updateArticleAction.bind(null, article.id);
  const deleteAction = deleteArticleAction.bind(null, article.id);

  return (
    <main className="admin-page admin-page--editor">
      <AdminSidebar active="content" />
      <section className="admin-workspace">
        <header className="admin-topbar"><div><strong>관리자</strong><span>콘텐츠 편집</span></div><Link href={`/content/${article.slug}`} target="_blank">게시 페이지 보기 <ArrowSquareOut aria-hidden size={17} /></Link></header>
        <div className="admin-canvas admin-editor">
          <Link className="admin-editor__back" href="/admin"><ArrowLeft aria-hidden size={18} /> 목록으로</Link>
          <div className="admin-editor__heading"><h1>콘텐츠 편집</h1><p>{article.title}</p></div>
          {notice && <p className="admin-form-message" role="status">{notice}</p>}
          {error && <p className="admin-form-message is-error" role="alert">{error}</p>}
          <AdminArticleForm action={updateAction} article={article} submitLabel="수정 사항 저장" />
          <div className="admin-danger-zone"><div><strong>콘텐츠 삭제</strong><p>삭제한 콘텐츠는 공개 페이지에서도 즉시 사라집니다.</p></div><AdminDeleteButton action={deleteAction} /></div>
        </div>
      </section>
    </main>
  );
}
