import type { Metadata } from "next";
import { LegacyContent } from "@/components/legacy-content";

export const metadata: Metadata = { title: "Brand Pilot 개인정보 처리방침", alternates: { canonical: "/brand-pilot-privacy" } };

export default function PrivacyPage() {
  return <main><LegacyContent fileName="brand-pilot-privacy.html" pageType="legal" /></main>;
}
