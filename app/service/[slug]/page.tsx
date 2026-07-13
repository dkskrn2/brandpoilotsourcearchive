import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ServiceDetailPage } from "@/components/service-detail-page";
import { serviceDetails, type ServiceSlug } from "@/lib/service-details";
import { breadcrumbJsonLd, createPageMetadata, serializeJsonLd, serviceJsonLd, webPageJsonLd } from "@/lib/seo";

const services = {
  ...serviceDetails,
  brandpilot: { title: "Brand Pilot", description: "브랜드의 말투와 근거를 지키며 초안부터 게시까지 관리합니다." }
} as const;

type RouteSlug = keyof typeof services;

export function generateStaticParams() {
  return Object.keys(services).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/service/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const service = services[slug as RouteSlug];
  if (!service) return {};
  return createPageMetadata({ title: service.title, description: service.description, path: `/service/${slug}`, localized: true });
}

export default async function ServiceRoutePage({ params }: PageProps<"/service/[slug]">) {
  const { slug } = await params;
  if (slug === "brandpilot") permanentRedirect("/product");
  const service = services[slug as RouteSlug];
  if (!service) notFound();
  const servicePath = `/service/${slug}`;
  const breadcrumb = breadcrumbJsonLd([
    { name: "홈", path: "/" },
    { name: "서비스", path: "/service" },
    { name: service.title, path: servicePath }
  ]);
  const pageJsonLd = webPageJsonLd({ name: service.title, description: service.description, path: servicePath, hasBreadcrumb: true });
  const structuredService = serviceJsonLd({ name: service.title, description: service.description, path: servicePath });
  const page = <ServiceDetailPage service={serviceDetails[slug as ServiceSlug]} />;

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(pageJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumb) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredService) }} />
    {page}
  </>;
}
