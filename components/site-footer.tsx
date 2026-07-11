import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <strong>GROWTHLINE</strong>
          <p>사업의 흐름을 보고, 필요한 시스템을 만듭니다.</p>
        </div>
        <nav aria-label="하단 메뉴">
          <Link href="/service">Service</Link>
          <Link href="/work">Work</Link>
          <Link href="/content">Content</Link>
          <Link href="/contact">Contact</Link>
          <Link href="/brand-pilot-privacy">개인정보 처리방침</Link>
          <Link href="/brand-pilot-terms">서비스 이용약관</Link>
          <Link href="/brand-pilot-data-deletion">데이터 삭제 안내</Link>
        </nav>
      </div>
    </footer>
  );
}
