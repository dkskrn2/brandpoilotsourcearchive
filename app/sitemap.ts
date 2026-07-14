import type { MetadataRoute } from "next";
import { listIndexableArticles } from "@/lib/content-db";
import { SITE_URL } from "@/lib/seo";

const routes = [
  "",
  "/service",
  "/service/service-research",
  "/service/service-analytics",
  "/service/service-design",
  "/service/service-consulting",
  "/service/service-writing",
  "/service/service-startup",
  "/product",
  "/product/pricing",
  "/work",
  "/content",
  "/contact",
  "/brand-pilot-privacy",
  "/brand-pilot-terms",
  "/brand-pilot-data-deletion"
];

const englishRoutes = [
  "/en",
  "/en/service",
  "/en/service/service-research",
  "/en/service/service-analytics",
  "/en/service/service-design",
  "/en/service/service-consulting",
  "/en/service/service-writing",
  "/en/service/service-startup",
  "/en/product",
  "/en/work",
  "/en/contact"
];

const localizedKoreanRoutes = new Set(routes.filter((route) => route === "" || route === "/service" || route.startsWith("/service/") || route === "/product" || route === "/work" || route === "/contact"));

function alternatesFor(route: string) {
  const koreanRoute = route === "/en" ? "" : route.startsWith("/en/") ? route.slice(3) : route;
  if (!localizedKoreanRoutes.has(koreanRoute)) return undefined;
  const englishRoute = koreanRoute === "" ? "/en" : `/en${koreanRoute}`;
  return {
    languages: {
      "ko-KR": `${SITE_URL}${koreanRoute}`,
      en: `${SITE_URL}${englishRoute}`,
      "x-default": `${SITE_URL}${koreanRoute}`
    }
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const contentRoutes = await listIndexableArticles();
  const staticEntries = [...routes, ...englishRoutes].map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: (route === "" || route === "/en" ? "weekly" : "monthly") as "weekly" | "monthly",
    priority: route === "" || route === "/en" ? 1 : 0.7,
    ...(alternatesFor(route) ? { alternates: alternatesFor(route) } : {})
  }));
  const contentEntries = contentRoutes.map((article) => ({
    url: `${SITE_URL}/content/${article.slug}`,
    lastModified: new Date(article.updatedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7
  }));
  return [...staticEntries, ...contentEntries];
}
