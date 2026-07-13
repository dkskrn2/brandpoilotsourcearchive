import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminToken } from "@/lib/admin-session";
import { SITE_LOCALE_COOKIE, SITE_LOCALE_HEADER, type SiteLocale } from "@/lib/i18n";

function preferredLocale(request: NextRequest): SiteLocale {
  const saved = request.cookies.get(SITE_LOCALE_COOKIE)?.value;
  if (saved === "ko" || saved === "en") return saved;

  const accepted = request.headers.get("accept-language");
  if (!accepted) return "ko";

  const preferences = accepted
    .split(",")
    .map((part, index) => {
      const [tag = "", quality = "q=1"] = part.trim().toLowerCase().split(";");
      return { tag, quality: Number(quality.replace("q=", "")) || 0, index };
    })
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  const supported = preferences.find(({ tag }) => tag === "ko" || tag.startsWith("ko-") || tag === "en" || tag.startsWith("en-"));
  if (supported) return supported.tag.startsWith("ko") ? "ko" : "en";
  return "en";
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdmin) {
    const session = await verifyAdminToken(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
    const isLogin = pathname === "/admin/login";

    if (!session && !isLogin) {
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(loginUrl);
    }
    if (session && isLogin) return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (pathname === "/" && preferredLocale(request) === "en") {
    const response = NextResponse.redirect(new URL("/en", request.url));
    response.headers.set("Vary", "Accept-Language, Cookie");
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SITE_LOCALE_HEADER, pathname === "/en" || pathname.startsWith("/en/") ? "en" : "ko");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon|robots.txt|sitemap.xml|.*\\..*).*)"]
};
