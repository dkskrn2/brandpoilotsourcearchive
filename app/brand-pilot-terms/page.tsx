import type { Metadata } from "next";
import { LegacyContent } from "@/components/legacy-content";

export const metadata: Metadata = { title: "Brand Pilot 서비스 이용약관", alternates: { canonical: "/brand-pilot-terms" } };

export default function TermsPage() {
  return <main><LegacyContent fileName="brand-pilot-terms.html" pageType="legal" /></main>;
}
