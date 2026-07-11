import Link from "next/link";
import { Article, ChartBar, Gear, House, SquaresFour } from "@phosphor-icons/react/dist/ssr";

export function AdminSidebar({ active = "dashboard" }: { active?: "dashboard" | "content" }) {
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
        <button type="button" disabled><ChartBar aria-hidden size={20} /><span>분석</span><small>준비 중</small></button>
        <button type="button" disabled><Gear aria-hidden size={20} /><span>설정</span><small>준비 중</small></button>
      </nav>

      <div className="admin-sidebar__bottom">
        <Link href="/"><House aria-hidden size={19} /> 사이트로 돌아가기</Link>
        <p>로컬 콘텐츠 관리자<br />데이터는 이 컴퓨터에 저장됩니다.</p>
      </div>
    </aside>
  );
}
