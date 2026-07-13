"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeFromPathname, localizePath } from "@/lib/i18n";

export function SiteFooter() {
  const locale = localeFromPathname(usePathname());
  const english = locale === "en";
  const path = (value: string) => localizePath(value, locale);

  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div>
          <strong>GROWTHLINE</strong>
          <p>{english ? "We find the break in your business flow and build the system that reconnects it." : "사업의 흐름을 보고, 필요한 시스템을 만듭니다."}</p>
        </div>
        <nav aria-label={english ? "Footer navigation" : "하단 메뉴"}>
          <Link href={path("/service")}>Service</Link>
          <Link href={path("/product")}>Product</Link>
          <Link href={path("/work")}>Work</Link>
          <Link href="/content" lang={english ? "ko" : undefined}>{english ? "Content (KO)" : "Content"}</Link>
          <Link href={path("/contact")}>Contact</Link>
          <Link href="/brand-pilot-privacy" lang="ko">{english ? "Privacy (KO)" : "개인정보 처리방침"}</Link>
          <Link href="/brand-pilot-terms" lang="ko">{english ? "Terms (KO)" : "서비스 이용약관"}</Link>
          <Link href="/brand-pilot-data-deletion" lang="ko">{english ? "Data deletion (KO)" : "데이터 삭제 안내"}</Link>
        </nav>
      </div>
    </footer>
  );
}
