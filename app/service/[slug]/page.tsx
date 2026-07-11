import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandPilotPage } from "@/app/service/[slug]/brand-pilot-page";
import { LegacyContent } from "@/components/legacy-content";
import { createPageMetadata } from "@/lib/seo";

const services = {
  "service-research": { title: "UX 리서치", description: "고객이 왜 들어오고 어디서 멈추는지 확인해 개선 순서를 찾습니다.", fileName: "service/service-research.html" },
  "service-analytics": { title: "데이터 분석", description: "쌓인 데이터를 다음 판단과 행동으로 연결합니다.", fileName: "service/service-analytics.html" },
  "service-design": { title: "전환 중심 설계", description: "보기 좋은 화면을 고객의 다음 행동으로 연결합니다.", fileName: "service/service-design.html" },
  "service-consulting": { title: "비즈니스 로직 설계", description: "개발 전에 업무 흐름, 범위, 판단 기준부터 합의합니다.", fileName: "service/service-consulting.html" },
  "service-writing": { title: "설득 카피라이팅", description: "고객이 가격, 신뢰, 위험 때문에 망설이는 지점에 답합니다.", fileName: "service/service-writing.html" },
  "service-startup": { title: "스타트업 구축", description: "실제 고객이 써볼 수 있는 최소 기능부터 출시합니다.", fileName: "service/service-startup.html" },
  brandpilot: { title: "Brand Pilot", description: "브랜드의 말투와 근거를 지키며 초안부터 게시까지 관리합니다.", fileName: "service/brandpilot.html" }
} as const;

type ServiceSlug = keyof typeof services;

export function generateStaticParams() {
  return Object.keys(services).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/service/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const service = services[slug as ServiceSlug];
  if (!service) return {};
  return createPageMetadata({ title: service.title, description: service.description, path: `/service/${slug}` });
}

export default async function ServiceDetailPage({ params }: PageProps<"/service/[slug]">) {
  const { slug } = await params;
  const service = services[slug as ServiceSlug];
  if (!service) notFound();
  if (slug === "brandpilot") return <BrandPilotPage />;
  return <main><LegacyContent fileName={service.fileName} pageType="service-detail" /></main>;
}
