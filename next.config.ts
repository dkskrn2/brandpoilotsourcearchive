import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  turbopack: {
    root: process.cwd()
  },
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/service.html", destination: "/service", permanent: true },
      { source: "/work.html", destination: "/work", permanent: true },
      { source: "/detail.html", destination: "/detail", permanent: true },
      { source: "/contact.html", destination: "/contact", permanent: true },
      { source: "/brand-pilot-privacy.html", destination: "/brand-pilot-privacy", permanent: true },
      { source: "/brand-pilot-terms.html", destination: "/brand-pilot-terms", permanent: true },
      { source: "/brand-pilot-data-deletion.html", destination: "/brand-pilot-data-deletion", permanent: true },
      { source: "/service/brandpilot.html", destination: "/service/brandpilot", permanent: true },
      { source: "/service/service-research.html", destination: "/service/service-research", permanent: true },
      { source: "/service/service-analytics.html", destination: "/service/service-analytics", permanent: true },
      { source: "/service/service-design.html", destination: "/service/service-design", permanent: true },
      { source: "/service/service-consulting.html", destination: "/service/service-consulting", permanent: true },
      { source: "/service/service-writing.html", destination: "/service/service-writing", permanent: true },
      { source: "/service/service-startup.html", destination: "/service/service-startup", permanent: true }
    ];
  }
};

export default nextConfig;
