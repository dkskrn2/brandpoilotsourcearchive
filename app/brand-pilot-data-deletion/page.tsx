import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { deletionSections } from "@/lib/legal-documents";

export const metadata: Metadata = { title: "Brand Pilot 사용자 데이터 삭제 안내", alternates: { canonical: "/brand-pilot-data-deletion" } };

export default function DataDeletionPage() {
  return <LegalDocument title="사용자 데이터 삭제 안내" lead="Brand Pilot에 저장된 계정, 브랜드 자료, 콘텐츠와 외부 채널 연동 정보의 삭제를 요청할 수 있습니다." effectiveDate="2026년 7월 12일" sections={deletionSections} links={[{ href: "/brand-pilot-terms", label: "서비스 이용약관" }, { href: "/brand-pilot-privacy", label: "개인정보 처리방침" }, { href: "/contact", label: "삭제 요청하기" }]} />;
}
