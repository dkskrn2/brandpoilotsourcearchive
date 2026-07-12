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
  "/service/brandpilot",
  "/work",
  "/content",
  "/contact",
  "/brand-pilot-privacy",
  "/brand-pilot-terms",
  "/brand-pilot-data-deletion"
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const contentRoutes = await listIndexableArticles();
  const staticEntries = routes.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: (route === "" ? "weekly" : "monthly") as "weekly" | "monthly",
    priority: route === "" ? 1 : 0.7
  }));
  const contentEntries = contentRoutes.map((article) => ({
    url: `${SITE_URL}/content/${article.slug}`,
    lastModified: new Date(article.updatedAt),
    changeFrequency: "monthly" as const,
    priority: 0.7
  }));
  return [...staticEntries, ...contentEntries];
}
