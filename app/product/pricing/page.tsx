import type { Metadata } from "next";
import { BrandPilotPricingPage } from "@/app/product/pricing/brand-pilot-pricing-page";
import {
  breadcrumbJsonLd,
  createPageMetadata,
  serializeJsonLd,
  webPageJsonLd
} from "@/lib/seo";

const pricingPath = "/product/pricing";
const pricingDescription = "브랜드 수, 월간 발행량, 검토 인원과 게시 범위에 맞춰 Brand Pilot 도입 플랜과 견적 기준을 안내합니다.";

export const metadata: Metadata = createPageMetadata({
  title: "Brand Pilot 요금제 | 브랜드 콘텐츠 운영 견적",
  description: pricingDescription,
  path: pricingPath
});

const breadcrumb = breadcrumbJsonLd([
  { name: "홈", path: "/" },
  { name: "Product", path: "/product" },
  { name: "요금제", path: pricingPath }
]);

const pageJsonLd = webPageJsonLd({
  name: "Brand Pilot 요금제",
  description: pricingDescription,
  path: pricingPath,
  hasBreadcrumb: true
});

export default function BrandPilotPricingRoute() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <BrandPilotPricingPage />
  </>;
}
