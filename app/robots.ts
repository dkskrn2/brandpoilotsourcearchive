import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const publicRules = {
    allow: ["/", "/api/content-images/"],
    disallow: ["/admin", "/api/admin", "/api/contact"]
  };
  return {
    rules: [
      { userAgent: "*", ...publicRules },
      { userAgent: "OAI-SearchBot", ...publicRules }
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL
  };
}
