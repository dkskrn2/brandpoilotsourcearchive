import type { Metadata } from "next";
import { BrandPilotPage } from "@/app/service/[slug]/brand-pilot-page";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  createPageMetadata,
  ORGANIZATION_ID,
  serializeJsonLd,
  webPageJsonLd
} from "@/lib/seo";

const productName = "Brand Pilot";
const productDescription = "브랜드 기준과 근거를 적용해 자료 수집, 콘텐츠 초안, 카드뉴스, 검수 승인, Instagram 게시를 한 흐름으로 관리하는 콘텐츠 운영 제품입니다.";
const productPath = "/product";
const productUrl = absoluteUrl(productPath);
const productId = `${productUrl}#software-application`;

export const metadata: Metadata = createPageMetadata({
  title: "Brand Pilot | 브랜드 콘텐츠 운영 시스템",
  description: productDescription,
  path: productPath,
  localized: true
});

const breadcrumb = breadcrumbJsonLd([
  { name: "홈", path: "/" },
  { name: "Product", path: productPath }
]);

const pageJsonLd = {
  ...webPageJsonLd({
    name: `${productName} | GROWTHLINE Product`,
    description: productDescription,
    path: productPath,
    hasBreadcrumb: true
  }),
  mainEntity: { "@id": productId }
};

const productJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": productId,
  name: productName,
  alternateName: "BRAND PILOT",
  description: productDescription,
  url: productUrl,
  applicationCategory: "BusinessApplication",
  applicationSubCategory: "ContentOperationsApplication",
  operatingSystem: "Web",
  inLanguage: "ko-KR",
  image: absoluteUrl("/images/product/brand-pilot-workflow-v1.webp"),
  featureList: [
    "웹사이트와 참고 URL, 문서와 노트 관리",
    "브랜드 기준과 근거를 반영한 콘텐츠 초안",
    "최대 5장의 Instagram 카드뉴스 구성",
    "사람 중심의 검토와 승인 흐름",
    "승인된 콘텐츠의 Instagram 게시 연결"
  ],
  provider: { "@id": ORGANIZATION_ID }
};

export default function ProductPage() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd) }} />
    <BrandPilotPage />
  </>;
}
