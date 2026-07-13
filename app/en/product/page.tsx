import type { Metadata } from "next";
import { EnglishBrandPilotPage } from "@/app/en/product/brand-pilot-page-en";
import { absoluteUrl, breadcrumbJsonLd, createPageMetadata, ORGANIZATION_ID, serializeJsonLd, webPageJsonLd } from "@/lib/seo";

const productName = "Brand Pilot";
const productDescription = "A content-operations product connecting sources, on-brand drafts, carousel images, human approval, and Instagram publishing in one workflow.";
const productPath = "/en/product";
const productUrl = absoluteUrl(productPath);
const productId = `${productUrl}#software-application`;

export const metadata: Metadata = createPageMetadata({ title: "Brand Pilot | Brand content operations", description: productDescription, path: productPath, locale: "en", localized: true });

const breadcrumb = breadcrumbJsonLd([{ name: "Home", path: "/en" }, { name: "Product", path: productPath }]);
const pageJsonLd = { ...webPageJsonLd({ name: `${productName} | GROWTHLINE Product`, description: productDescription, path: productPath, hasBreadcrumb: true, language: "en" }), mainEntity: { "@id": productId } };
const productJsonLd = {
  "@context": "https://schema.org", "@type": "SoftwareApplication", "@id": productId, name: productName, alternateName: "BRAND PILOT", description: productDescription, url: productUrl,
  applicationCategory: "BusinessApplication", applicationSubCategory: "ContentOperationsApplication", operatingSystem: "Web", inLanguage: "en",
  image: absoluteUrl("/images/product/brand-pilot-workflow-v1.webp"),
  featureList: ["Website, reference URL, document, and note sources", "Drafts grounded in brand rules and evidence", "Instagram carousels of up to five images", "Human-centered review and approval", "Instagram publishing for approved content"],
  provider: { "@id": ORGANIZATION_ID }
};

export default function EnglishProductPage() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd) }} />
    <EnglishBrandPilotPage />
  </>;
}
