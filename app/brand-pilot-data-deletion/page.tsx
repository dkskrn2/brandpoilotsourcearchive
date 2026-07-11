import type { Metadata } from "next";
import { LegacyContent } from "@/components/legacy-content";

export const metadata: Metadata = { title: "Brand Pilot 사용자 데이터 삭제 안내", alternates: { canonical: "/brand-pilot-data-deletion" } };

export default function DataDeletionPage() {
  return <main><LegacyContent fileName="brand-pilot-data-deletion.html" pageType="legal" /></main>;
}
