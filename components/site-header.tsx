"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { List } from "@phosphor-icons/react";
import { localeFromPathname, localizePath, SITE_LOCALE_COOKIE } from "@/lib/i18n";

export function SiteHeader() {
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const english = locale === "en";
  const path = (value: string) => localizePath(value, locale);
  const switchLocale = english ? "ko" : "en";
  const switchHref = localizePath(pathname, switchLocale);
  const labels = english
    ? { home: "GROWTHLINE home", navigation: "Main navigation", login: "Login", contact: "Get a diagnosis", menu: "Menu", open: "Open menu" }
    : { home: "GROWTHLINE 홈", navigation: "주요 메뉴", login: "로그인", contact: "진단 받기", menu: "메뉴", open: "메뉴 열기" };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const rememberLocale = () => {
    document.cookie = `${SITE_LOCALE_COOKIE}=${switchLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href={path("/")} aria-label={labels.home}>GROWTHLINE</Link>
        <nav className="site-nav" aria-label={labels.navigation}>
          <Link href={path("/service")}>Service</Link>
          <Link href={path("/product")}>Product</Link>
          <Link href={path("/work")}>Work</Link>
          <Link href="/content" lang={english ? "ko" : undefined}>{english ? "Content (KO)" : "Content"}</Link>
          <a className="language-switch" href={switchHref} hrefLang={switchLocale} onClick={rememberLocale}>{english ? "KO" : "EN"}</a>
          <button className="site-login" type="button" disabled>{labels.login}</button>
          <Link className="button button--small" href={path("/contact")}>{labels.contact}</Link>
        </nav>
        <details className="mobile-menu">
          <summary aria-label={labels.open}><List aria-hidden size={24} weight="bold" /><span>{labels.menu}</span></summary>
          <nav aria-label={english ? "Mobile navigation" : "모바일 메뉴"}>
            <Link href={path("/service")}>Service</Link>
            <Link href={path("/product")}>Product</Link>
            <Link href={path("/work")}>Work</Link>
            <Link href="/content" lang={english ? "ko" : undefined}>{english ? "Content (KO)" : "Content"}</Link>
            <a className="language-switch" href={switchHref} hrefLang={switchLocale} onClick={rememberLocale}>{english ? "한국어로 보기" : "View in English"}</a>
            <button className="site-login" type="button" disabled>{labels.login}</button>
            <Link href={path("/contact")}>{labels.contact}</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}
