import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { GoogleAnalytics } from "@/components/google-analytics";
import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, organizationJsonLd, serializeJsonLd, websiteJsonLd } from "@/lib/seo";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  title: { default: `${SITE_NAME} | 막힌 매출 흐름을 다시 연결합니다`, template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  category: "business",
  referrer: "origin-when-cross-origin",
  openGraph: { type: "website", locale: "ko_KR", siteName: SITE_NAME, title: SITE_NAME, description: DEFAULT_DESCRIPTION, url: "/", images: [DEFAULT_OG_IMAGE] },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: DEFAULT_DESCRIPTION, images: [DEFAULT_OG_IMAGE] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="ko" className={notoSansKr.variable}><body>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }} />
    <SiteHeader />{children}<SiteFooter /><GoogleAnalytics />
  </body></html>;
}
