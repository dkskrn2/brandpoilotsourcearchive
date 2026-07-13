import { ContactForm } from "@/components/contact-form";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "상담 문의",
  description: "유입, 문의, 결제, 운영 중 어디서 매출이 막히는지 확인하고 먼저 바꿀 한 구간을 찾습니다.",
  path: "/contact"
});

export default function ContactPage() {
  return <ContactForm />;
}
