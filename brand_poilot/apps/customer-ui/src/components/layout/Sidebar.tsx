import {
  CircleHelp,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  customerNavigation,
  onboardingNavigationItem,
} from "../../features/navigation/navigationModel";
import { isBrandProfileComplete, isBrandSetupPath } from "../../lib/brandSetup";
import { useBrandStatus } from "../../lib/brandStatus";
import type { BadgeVariant } from "../../types";
import { Badge } from "../ui/Badge";
import { ProductBrandLogo } from "../brand/ProductBrandLogo";
import { SidebarBrandProfile } from "./SidebarBrandProfile";
import { useHelp } from "../help/HelpContext";
import { useFeedback } from "../feedback/FeedbackContext";

function badgeForPath(path: string, status: ReturnType<typeof useBrandStatus>["status"]): { badge: string; variant: BadgeVariant } | null {
  if (!status) return null;
  const publishQueueCount = status.navigation.publishIssues;
  const publishQueueVariant: BadgeVariant = "bad";
  const counts: Record<string, { value: number; variant: BadgeVariant }> = {
    "/onboarding/brand-intelligence": { value: status.navigation.onboardingRemaining, variant: "warn" },
    "/publish-queue": { value: publishQueueCount, variant: publishQueueVariant },
    "/channels": { value: status.navigation.channelIssues, variant: "bad" }
  };
  const count = counts[path];
  if (!count || count.value <= 0) return null;
  return { badge: String(count.value), variant: count.variant };
}

export function Sidebar({
  variant = "desktop",
  collapsed = false,
  onToggleCollapsed,
  onClose,
  onNavigate,
}: {
  variant?: "desktop" | "mobile";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onClose?: () => void;
  onNavigate?: () => void;
} = {}) {
  const { status } = useBrandStatus();
  const help = useHelp();
  const feedback = useFeedback();
  const brandProfileComplete = isBrandProfileComplete(status);
  const navigationGroups = [
    ...customerNavigation,
    {
      id: "onboarding",
      label: "시작 준비",
      items: [onboardingNavigationItem],
    },
  ];
  const visibleNavGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.path !== "/onboarding/brand-intelligence") return true;
        if (!status) return true;
        return status.navigation.onboardingRemaining > 0 || status.onboarding.remainingCount > 0;
      })
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className={`sidebar sidebar--${variant}${variant === "desktop" && collapsed ? " sidebar--collapsed" : ""}`}>
      <div className="mobile-menu-head">
        <div className="brand">
          <ProductBrandLogo placement="sidebar" />
        </div>
        {variant === "mobile" ? (
          <button className="mobile-menu-close" type="button" aria-label="전체 메뉴 닫기" onClick={onClose} autoFocus>
            <X size={24} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="sidebar-collapse-button"
            type="button"
            aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            aria-expanded={!collapsed}
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {variant === "mobile" ? <h1 className="mobile-menu-title">전체 메뉴</h1> : null}
      <nav className="nav" aria-label="고객 메뉴">
        {visibleNavGroups.map((group) => {
          const headingId = `${variant}-sidebar-nav-${group.id}`;
          return (
            <section className="nav-group" aria-labelledby={headingId} key={group.id}>
              <h2 className="nav-group-label" id={headingId}>{group.label}</h2>
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const badge = badgeForPath(item.path, status);
                  const Icon = item.icon;
                  const locked = !brandProfileComplete && !isBrandSetupPath(item.path);
                  if (locked) {
                    return (
                      <span key={item.path} className="nav-disabled" aria-disabled="true" title={collapsed ? item.label : undefined}>
                        <Icon size={18} aria-hidden="true" data-nav-icon />
                        <span className="nav-item-label">{item.label}</span>
                        {badge ? <Badge variant={badge.variant}>{badge.badge}</Badge> : null}
                      </span>
                    );
                  }
                  if (item.path.startsWith("https://")) {
                    return (
                      <a key={item.path} href={item.path} onClick={onNavigate} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}>
                        <Icon size={18} aria-hidden="true" data-nav-icon />
                        <span className="nav-item-label">{item.label}</span>
                        {badge ? <Badge variant={badge.variant}>{badge.badge}</Badge> : null}
                      </a>
                    );
                  }
                  return (
                    <NavLink key={item.path} to={item.path} end={item.path === "/onboarding/brand-intelligence"} onClick={onNavigate} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined}>
                      <Icon size={18} aria-hidden="true" data-nav-icon />
                      <span className="nav-item-label">{item.label}</span>
                      {badge ? <Badge variant={badge.variant}>{badge.badge}</Badge> : null}
                    </NavLink>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
      <button
        className="sidebar-feedback-button"
        type="button"
        title={collapsed ? "피드백" : undefined}
        aria-label="피드백"
        onClick={() => { onNavigate?.(); feedback?.openFeedback(); }}
      >
        <MessageSquareText size={18} aria-hidden="true" />
        <span><strong>피드백</strong><small>의견 보내기와 통화 문의</small></span>
      </button>
      {help ? <button className="sidebar-help-button" type="button" title={collapsed ? "도움말" : undefined} aria-label={collapsed ? "도움말" : undefined} onClick={() => { onNavigate?.(); help.openHelp(); }}>
        <CircleHelp size={18} aria-hidden="true" />
        <span><strong>도움말</strong><small>현재 화면 안내와 연결 가이드</small></span>
      </button> : null}
      {brandProfileComplete ? <SidebarBrandProfile
        brandName={status?.brandName ?? "모종"}
        logoUrl={status?.logoUrl ?? null}
      /> : null}
    </aside>
  );
}
