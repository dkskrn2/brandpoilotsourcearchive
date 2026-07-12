import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandPilotPage } from "@/app/service/[slug]/brand-pilot-page";
import { ServiceDetailPage } from "@/components/service-detail-page";
import { serviceDetails, type ServiceSlug } from "@/lib/service-details";
import { createPageMetadata } from "@/lib/seo";

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
  return createPageMetadata({ title: service.title, description: service.description, path: `/service/${slug}` });
}

export default async function ServiceRoutePage({ params }: PageProps<"/service/[slug]">) {
  const { slug } = await params;
  const service = services[slug as RouteSlug];
  if (!service) notFound();
  if (slug === "brandpilot") return <BrandPilotPage />;
  return <ServiceDetailPage service={serviceDetails[slug as ServiceSlug]} />;
}
