import type { Metadata } from "next";

export const SITE_NAME = "GROWTHLINE";
export const SITE_URL = "https://www.danbammsg.co.kr";
export const DEFAULT_OG_IMAGE = "/images/generated/service-architecture-v2.png";
export const DEFAULT_DESCRIPTION = "유입부터 문의와 결제, 운영까지 매출이 멈추는 구간을 찾아 실제 운영 가능한 시스템으로 연결합니다.";
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

export function absoluteUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}

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
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: SITE_URL,
  description: DEFAULT_DESCRIPTION,
  logo: {
    "@type": "ImageObject",
    url: absoluteUrl("/icon"),
    width: 512,
    height: 512
  },
  image: absoluteUrl(DEFAULT_OG_IMAGE),
  areaServed: { "@type": "Country", name: "대한민국" },
  knowsAbout: ["UX 리서치", "데이터 분석", "전환 설계", "비즈니스 로직", "웹서비스 구축", "콘텐츠 운영"]
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  name: SITE_NAME,
  url: SITE_URL,
  description: DEFAULT_DESCRIPTION,
  inLanguage: "ko-KR",
  publisher: { "@id": ORGANIZATION_ID }
};

type BreadcrumbItem = { name: string; path: string };

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  const pageUrl = absoluteUrl(items.at(-1)?.path ?? "/");
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "@id": `${pageUrl}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path)
    }))
  };
}

export function webPageJsonLd({ name, description, path, type = "WebPage", hasBreadcrumb = false }: {
  name: string;
  description: string;
  path: string;
  type?: "WebPage" | "CollectionPage" | "ContactPage";
  hasBreadcrumb?: boolean;
}) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "ko-KR",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORGANIZATION_ID },
    ...(hasBreadcrumb ? { breadcrumb: { "@id": `${url}#breadcrumb` } } : {})
  };
}

export function serviceJsonLd({ name, description, path }: { name: string; description: string; path: string }) {
  const url = absoluteUrl(path);
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": `${url}#service`,
    name,
    description,
    url,
    provider: { "@id": ORGANIZATION_ID },
    areaServed: { "@type": "Country", name: "대한민국" },
    audience: { "@type": "BusinessAudience", audienceType: "온라인 사업자 및 기업" },
    mainEntityOfPage: { "@id": `${url}#webpage` }
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}
