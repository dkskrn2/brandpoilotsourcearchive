import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AdminSidebar } from "@/components/admin-sidebar";

export type BrandPilotAdminSection = "overview" | "brands" | "channels" | "publishing" | "system" | "audit";

const sections: Array<{ id: BrandPilotAdminSection; href: Route; label: string }> = [
  { id: "overview", href: "/admin/brand-pilot", label: "운영 현황" },
  { id: "brands", href: "/admin/brand-pilot/brands", label: "고객·브랜드" },
  { id: "channels", href: "/admin/brand-pilot/channels", label: "채널 연결" },
  { id: "publishing", href: "/admin/brand-pilot/publishing", label: "콘텐츠·게시" },
  { id: "system", href: "/admin/brand-pilot/system", label: "시스템" },
  { id: "audit", href: "/admin/brand-pilot/audit", label: "감사 로그" },
];

export function BrandPilotAdminShell({ active, children }: { active: BrandPilotAdminSection; children: ReactNode }) {
  return (
    <main className="admin-page">
      <AdminSidebar active="brand-pilot" />
      <section className="admin-workspace">
        <header className="admin-topbar"><div><strong>관리자</strong><span>Brand Pilot 운영</span></div><Link href="/admin">Growthline 관리로 돌아가기</Link></header>
        <div className="admin-canvas brand-pilot-admin">
          <nav className="brand-pilot-admin__nav" aria-label="Brand Pilot 관리자 메뉴">
            {sections.map((section) => <Link key={section.id} className={active === section.id ? "is-active" : ""} href={section.href} aria-current={active === section.id ? "page" : undefined}>{section.label}</Link>)}
          </nav>
          {children}
        </div>
      </section>
    </main>
  );
}

export function BrandPilotAdminError({ message }: { message?: string }) {
  return <section className="brand-pilot-admin__error" role="alert"><strong>Brand Pilot API 상태 확인 필요</strong><p>{message ?? "관리자 데이터를 불러오지 못했습니다. API 주소와 서비스 토큰을 확인하세요."}</p></section>;
}

export function BrandPilotAdminEmpty({ title, description }: { title: string; description: string }) {
  return <div className="admin-list-empty"><strong>{title}</strong><p>{description}</p></div>;
}

export function formatAdminDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value));
}
