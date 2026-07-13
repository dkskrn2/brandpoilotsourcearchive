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
const productDescription = "브랜드의 근거와 말투를 지키면서 자료 수집, 콘텐츠 초안, 카드뉴스 이미지, 검토와 Instagram 게시까지 한 흐름으로 관리하는 콘텐츠 운영 제품입니다.";
const productPath = "/product";
const productUrl = absoluteUrl(productPath);
const productId = `${productUrl}#software-application`;

export const metadata: Metadata = createPageMetadata({
  title: "Brand Pilot | 콘텐츠 운영 제품",
  description: productDescription,
  path: productPath
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
  image: absoluteUrl("/images/generated/content-operations-loop.webp"),
  featureList: [
    "브랜드 자료와 참고 소스 관리",
    "브랜드 기준을 반영한 콘텐츠 초안 작성",
    "카드뉴스 이미지 제작",
    "검토와 승인 흐름 관리",
    "Instagram 게시 운영"
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
