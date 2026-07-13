export type SiteLocale = "ko" | "en";

export const SITE_LOCALE_COOKIE = "growthline_locale";
export const SITE_LOCALE_HEADER = "x-growthline-locale";

export function localeFromPathname(pathname: string): SiteLocale {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : "ko";
}

export function localizePath(pathname: string, locale: SiteLocale): Route {
  const koreanPath = pathname === "/en" ? "/" : pathname.replace(/^\/en(?=\/)/, "");

  if (locale === "ko") return (koreanPath || "/") as Route;
  if (koreanPath.startsWith("/content") || koreanPath.startsWith("/brand-pilot-") || koreanPath.startsWith("/admin")) return "/en" as Route;
  return (koreanPath === "/" ? "/en" : `/en${koreanPath}`) as Route;
}
import type { Route } from "next";
