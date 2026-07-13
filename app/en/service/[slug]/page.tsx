import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ServiceDetailPage } from "@/components/service-detail-page";
import { englishServiceDetails, type EnglishServiceSlug } from "@/lib/service-details-en";
import { breadcrumbJsonLd, createPageMetadata, serializeJsonLd, serviceJsonLd, webPageJsonLd } from "@/lib/seo";

const services = {
  ...englishServiceDetails,
  brandpilot: { title: "Brand Pilot", description: "Manage evidence, drafts, review, and publishing without losing the brand voice." }
} as const;

type RouteSlug = keyof typeof services;

export function generateStaticParams() {
  return Object.keys(services).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/en/service/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const service = services[slug as RouteSlug];
  if (!service) return {};
  return createPageMetadata({ title: service.title, description: service.description, path: `/en/service/${slug}`, locale: "en", localized: true });
}

export default async function EnglishServiceDetailPage({ params }: PageProps<"/en/service/[slug]">) {
  const { slug } = await params;
  if (slug === "brandpilot") permanentRedirect("/en/product");
  const service = englishServiceDetails[slug as EnglishServiceSlug];
  if (!service) notFound();

  const path = `/en/service/${slug}`;
  const breadcrumb = breadcrumbJsonLd([{ name: "Home", path: "/en" }, { name: "Services", path: "/en/service" }, { name: service.title, path }]);
  const pageJsonLd = webPageJsonLd({ name: service.title, description: service.description, path, hasBreadcrumb: true, language: "en" });
  const structuredService = serviceJsonLd({ name: service.title, description: service.description, path, language: "en" });

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredService) }} />
    <ServiceDetailPage service={service} locale="en" />
  </>;
}
