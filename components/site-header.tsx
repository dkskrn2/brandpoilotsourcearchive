import Link from "next/link";
import { List } from "@phosphor-icons/react/dist/ssr";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label="GROWTHLINE 홈">GROWTHLINE</Link>
        <nav className="site-nav" aria-label="주요 메뉴">
          <Link href="/service">Service</Link>
          <Link href="/work">Work</Link>
          <Link href="/content">Content</Link>
          <button className="site-login" type="button" disabled>로그인</button>
          <Link className="button button--small" href="/contact">진단 받기</Link>
        </nav>
        <details className="mobile-menu">
          <summary aria-label="메뉴 열기"><List aria-hidden size={24} weight="bold" /><span>메뉴</span></summary>
          <nav aria-label="모바일 메뉴">
            <Link href="/service">Service</Link>
            <Link href="/work">Work</Link>
            <Link href="/content">Content</Link>
            <button className="site-login" type="button" disabled>로그인</button>
            <Link href="/contact">진단 받기</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
