import { ChevronDown, Menu, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { resolveCustomerPageTitle } from "../../features/navigation/navigationModel";
import { useAuth } from "../../lib/auth";
import { useBrandStatus } from "../../lib/brandStatus";
import { useAiContentUsage } from "../../features/ai-content/AiContentUsageContext";
import { AiContentUsageSummary } from "../ai-content/AiContentUsageSummary";
import { Badge } from "../ui/Badge";

function formatLastGenerated(value: string | null) {
  if (!value) return "마지막 생성: 생성 기록 없음";
  return `마지막 생성: ${new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

export function Topbar({
  mobileMenuOpen = false,
  menuButtonRef,
  onOpenMobileMenu,
}: {
  mobileMenuOpen?: boolean;
  menuButtonRef?: RefObject<HTMLButtonElement>;
  onOpenMobileMenu?: () => void;
} = {}) {
  const { session, logout } = useAuth();
  const location = useLocation();
  const { status, loading, error } = useBrandStatus();
  const { usage } = useAiContentUsage();
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const logoutButtonRef = useRef<HTMLButtonElement>(null);
  const remainingCount = status?.onboarding.remainingCount ?? 0;
  const brandName = session?.brand.name ?? status?.brandName ?? "모종";
  const pageTitle = resolveCustomerPageTitle(location.pathname) ?? "모종";
  const statusLabel = error && !status
    ? "API 확인 필요"
    : loading && !status
      ? "불러오는 중"
      : remainingCount > 0
        ? `${remainingCount}개 항목 필요`
        : "준비 완료";
  const statusVariant = error && !status ? "bad" : remainingCount > 0 ? "warn" : "ok";

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  useEffect(() => {
    if (!accountMenuOpen) return;
    logoutButtonRef.current?.focus();
    function closeAccountMenu(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      accountButtonRef.current?.focus();
    }
    document.addEventListener("keydown", closeAccountMenu);
    return () => document.removeEventListener("keydown", closeAccountMenu);
  }, [accountMenuOpen]);

  return (
    <header className="topbar">
      <div className="topbar-brand-status">
        {onOpenMobileMenu ? (
          <button
            ref={menuButtonRef}
            className="mobile-menu-trigger"
            type="button"
            aria-label="전체 메뉴 열기"
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            onClick={onOpenMobileMenu}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        ) : null}
        <div className="topbar-page-context">
          <p className="topbar-page-title">{pageTitle}</p>
          <span><strong>{brandName}</strong> · {error && !status ? "API 연결 필요" : formatLastGenerated(status?.lastGeneratedAt ?? null).replace("마지막 생성: ", "")}</span>
        </div>
      </div>
      <div className="topbar-actions">
        {usage ? <AiContentUsageSummary usage={usage} /> : null}
        <Badge variant={statusVariant}>{statusLabel}</Badge>
        <div className="topbar-account">
          <button
            ref={accountButtonRef}
            className="topbar-account-trigger"
            type="button"
            aria-label={`${brandName} 계정 메뉴 열기`}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <UserRound size={18} aria-hidden="true" />
            <span>{brandName}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {accountMenuOpen ? (
            <div className="topbar-account-menu" role="menu" aria-label="계정 메뉴">
              <button
                ref={logoutButtonRef}
                role="menuitem"
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "로그아웃 중" : "로그아웃"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
