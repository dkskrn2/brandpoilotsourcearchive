import { ContactForm } from "@/components/contact-form";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "상담 문의",
  description: "유입, 문의, 결제, 운영 중 어디서 매출이 막히는지 확인하고 먼저 바꿀 한 구간을 찾습니다.",
  path: "/contact"
});

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const plan = typeof query.plan === "string" ? query.plan.toLowerCase() : "";
  const stage = typeof query.stage === "string" ? query.stage : "";
  const initialPlan = plan || ({ "1": "seed", "01": "seed", "2": "series-a", "02": "series-a", "3": "series-b", "03": "series-b" } as Record<string, string>)[stage] || "";
  return <ContactForm initialPlan={initialPlan} />;
}
