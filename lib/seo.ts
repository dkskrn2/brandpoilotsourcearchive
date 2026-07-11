import type { Metadata } from "next";

export const SITE_NAME = "GROWTHLINE";
export const SITE_URL = "https://www.danbammsg.co.kr";
export const DEFAULT_OG_IMAGE = "/images/generated/service-architecture-v2.png";
export const DEFAULT_DESCRIPTION = "유입부터 문의와 결제, 운영까지 매출이 멈추는 구간을 찾아 실제 운영 가능한 시스템으로 연결합니다.";

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
  absoluteTitle?: boolean;
};

export function createPageMetadata({ title, description, path, noIndex = false, absoluteTitle = false }: PageMetadataOptions): Metadata {
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    robots: noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      images: [{ url: DEFAULT_OG_IMAGE, width: 1600, height: 1024, alt: `${SITE_NAME} 서비스 구조` }]
    },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE] }
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: "ko-KR",
  publisher: { "@id": `${SITE_URL}/#organization` }
};

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
