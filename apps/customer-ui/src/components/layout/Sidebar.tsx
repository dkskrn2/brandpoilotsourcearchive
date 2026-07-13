import { NavLink } from "react-router-dom";
import { isBrandProfileComplete, isBrandSetupPath } from "../../lib/brandSetup";
import { useBrandStatus } from "../../lib/brandStatus";
import type { BadgeVariant, NavItem } from "../../types";
import { Badge } from "../ui/Badge";

const navItems: NavItem[] = [
  { label: "콘텐츠 검토", path: "/content" },
  { label: "게시 관리", path: "/publish-queue" },
  { label: "소스", path: "/sources" },
  { label: "채널", path: "/channels" },
  { label: "브랜드 설정", path: "/brand-settings" },
  { label: "결제 및 구독", path: "/billing" },
  { label: "고객센터", path: "/support" },
  { label: "관리자 채널", path: "/admin/channels" },
  { label: "온보딩", path: "/onboarding" }
];

function badgeForPath(path: string, status: ReturnType<typeof useBrandStatus>["status"]): { badge: string; variant: BadgeVariant } | null {
  if (!status) return null;
  const publishQueueCount = status.navigation.publishIssues;
  const publishQueueVariant: BadgeVariant = "bad";
  const counts: Record<string, { value: number; variant: BadgeVariant }> = {
    "/onboarding": { value: status.navigation.onboardingRemaining, variant: "warn" },
    "/content": { value: status.navigation.contentReview, variant: "warn" },
    "/publish-queue": { value: publishQueueCount, variant: publishQueueVariant },
    "/channels": { value: status.navigation.channelIssues, variant: "bad" }
  };
  const count = counts[path];
  if (!count || count.value <= 0) return null;
  return { badge: String(count.value), variant: count.variant };
}

export function Sidebar() {
  const { status } = useBrandStatus();
  const brandProfileComplete = isBrandProfileComplete(status);
  const visibleNavItems = navItems.filter((item) => {
    if (item.path !== "/onboarding") return true;
    if (!status) return true;
    return status.navigation.onboardingRemaining > 0 || status.onboarding.remainingCount > 0;
  });

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-badge">BP</span>
        <span>Brand Pilot</span>
      </div>
      <nav className="nav" aria-label="고객 메뉴">
        {visibleNavItems.map((item) => {
          const badge = badgeForPath(item.path, status);
          const locked = !brandProfileComplete && !isBrandSetupPath(item.path);
          if (locked) {
            return (
              <span key={item.path} className="nav-disabled" aria-disabled="true">
                <span>{item.label}</span>
                {badge ? <Badge variant={badge.variant}>{badge.badge}</Badge> : null}
              </span>
            );
          }
          return (
            <NavLink key={item.path} to={item.path} end={item.path === "/onboarding"}>
              <span>{item.label}</span>
              {badge ? <Badge variant={badge.variant}>{badge.badge}</Badge> : null}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
