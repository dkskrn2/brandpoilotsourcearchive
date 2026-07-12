import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { createArticleAction } from "@/app/admin/actions";
import { AdminArticleForm } from "@/components/admin-article-form";
import { AdminSidebar } from "@/components/admin-sidebar";
import { requireAdminSession } from "@/lib/admin-auth";
import { isDatabaseConfigured } from "@/lib/content-db";

export const metadata: Metadata = { title: "새 콘텐츠 작성", robots: { index: false, follow: false } };

export default async function NewContentPage({ searchParams }: PageProps<"/admin/content/new">) {
  await requireAdminSession("/admin/content/new");
  if (!isDatabaseConfigured()) redirect("/admin?error=database" as Route);
  const { error } = await searchParams;
  return (
    <main className="admin-page admin-page--editor">
      <AdminSidebar active="content" />
      <section className="admin-workspace">
        <header className="admin-topbar"><div><strong>관리자</strong><span>새 콘텐츠 작성</span></div><Link href="/content" target="_blank">콘텐츠 페이지 보기 <ArrowSquareOut aria-hidden size={17} /></Link></header>
        <div className="admin-canvas admin-editor">
          <Link className="admin-editor__back" href="/admin"><ArrowLeft aria-hidden size={18} /> 목록으로</Link>
          <div className="admin-editor__heading"><h1>새 콘텐츠 작성</h1><p>임시 저장하거나 바로 게시할 수 있습니다.</p></div>
          {error && <p className="admin-form-message is-error" role="alert">{error}</p>}
          <AdminArticleForm action={createArticleAction} submitLabel="콘텐츠 저장" />
        </div>
      </section>
    </main>
  );
}
