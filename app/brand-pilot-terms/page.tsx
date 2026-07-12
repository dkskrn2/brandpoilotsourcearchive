import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { termsSections } from "@/lib/legal-documents";

export const metadata: Metadata = { title: "Brand Pilot 서비스 이용약관", alternates: { canonical: "/brand-pilot-terms" } };

export default function TermsPage() {
  return <LegalDocument title="서비스 이용약관" lead="GROWTHLINE이 제공하는 Brand Pilot의 이용 조건과 이용자 및 운영자의 권리·의무를 안내합니다." effectiveDate="2026년 7월 12일" sections={termsSections} links={[{ href: "/brand-pilot-privacy", label: "개인정보 처리방침" }, { href: "/brand-pilot-data-deletion", label: "사용자 데이터 삭제 안내" }, { href: "/contact", label: "문의하기" }]} />;
}
