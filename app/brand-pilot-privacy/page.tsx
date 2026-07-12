import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { privacySections } from "@/lib/legal-documents";

export const metadata: Metadata = { title: "Brand Pilot 개인정보 처리방침", alternates: { canonical: "/brand-pilot-privacy" } };

export default function PrivacyPage() {
  return <LegalDocument title="개인정보 처리방침" lead="GROWTHLINE은 Brand Pilot 운영에 필요한 범위에서만 개인정보와 이용자 콘텐츠를 처리합니다." effectiveDate="2026년 7월 12일" sections={privacySections} links={[{ href: "/brand-pilot-terms", label: "서비스 이용약관" }, { href: "/brand-pilot-data-deletion", label: "사용자 데이터 삭제 안내" }, { href: "/contact", label: "문의하기" }]} />;
}
