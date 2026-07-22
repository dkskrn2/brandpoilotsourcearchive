import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginAdminAction } from "@/app/admin/auth-actions";
import { getAdminSession } from "@/lib/admin-auth";
import { isAdminConfigured } from "@/lib/admin-session";

export const metadata: Metadata = {
  title: "관리자 로그인",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  if (await getAdminSession()) redirect("/admin");
  const { error, next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/admin";
  const configured = isAdminConfigured();
  const configuredUsername = process.env.ADMIN_USERNAME?.trim() ?? "";

  return (
    <main className="admin-login-page">
      <section className="admin-login-card">
        <p>GROWTHLINE ADMIN</p>
        <h1>관리자 로그인</h1>
        <span>등록된 관리자 계정으로 콘텐츠를 관리합니다.</span>

        {!configured && (
          <p className="admin-form-message is-error" role="alert">
            관리자 환경변수가 설정되지 않았습니다. Vercel 설정을 먼저 완료해 주세요.
          </p>
        )}
        {error === "invalid" && (
          <p className="admin-form-message is-error" role="alert">아이디 또는 비밀번호가 올바르지 않습니다.</p>
        )}

        <form action={loginAdminAction}>
          <input type="hidden" name="next" value={nextPath} />
          <label>
            <span>아이디</span>
            <input name="username" autoComplete="username" required defaultValue={configuredUsername} disabled={!configured} />
          </label>
          <label>
            <span>비밀번호</span>
            <input name="password" type="password" autoComplete="current-password" required disabled={!configured} />
          </label>
          <button type="submit" disabled={!configured}>로그인</button>
        </form>
      </section>
    </main>
  );
}
