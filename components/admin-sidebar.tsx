import Link from "next/link";
import { Article, ChartBar, ChatCircleDots, Gear, House, SignOut, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import { logoutAdminAction } from "@/app/admin/auth-actions";

export function AdminSidebar({ active = "dashboard" }: { active?: "dashboard" | "content" | "analytics" }) {
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <span>G</span>
        <div><strong>GROWTHLINE</strong><small>Content Admin</small></div>
      </div>

      <nav aria-label="관리자 메뉴">
        <Link className={active === "dashboard" ? "is-active" : ""} href="/admin" aria-current={active === "dashboard" ? "page" : undefined}>
          <SquaresFour aria-hidden size={20} weight={active === "dashboard" ? "fill" : "regular"} /><span>대시보드</span>
        </Link>
        <Link className={active === "content" ? "is-active" : ""} href="/admin#content" aria-current={active === "content" ? "page" : undefined}>
          <Article aria-hidden size={20} weight={active === "content" ? "fill" : "regular"} /><span>콘텐츠</span>
        </Link>
        <Link href="/admin#inquiries"><ChatCircleDots aria-hidden size={20} /><span>상담 문의</span></Link>
        <Link className={active === "analytics" ? "is-active" : ""} href="/admin/analytics" aria-current={active === "analytics" ? "page" : undefined}>
          <ChartBar aria-hidden size={20} weight={active === "analytics" ? "fill" : "regular"} /><span>분석</span>
        </Link>
        <button type="button" disabled><Gear aria-hidden size={20} /><span>설정</span><small>준비 중</small></button>
      </nav>

      <div className="admin-sidebar__bottom">
        <Link href="/"><House aria-hidden size={19} /> 사이트로 돌아가기</Link>
        <form action={logoutAdminAction}>
          <button type="submit"><SignOut aria-hidden size={19} /> 로그아웃</button>
        </form>
        <p>Vercel 관리자<br />PostgreSQL에 안전하게 저장됩니다.</p>
      </div>
    </aside>
  );
}
