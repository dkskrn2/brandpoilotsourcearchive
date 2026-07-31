import { Building2, ChevronDown, CreditCard, History, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { BrandLogo } from "../brand/BrandLogo";

interface SidebarBrandProfileProps {
  brandName: string;
  logoUrl: string | null;
  planLabel?: string;
  onOpenSupportHistory?: () => void;
  onNavigate?: () => void;
}

export function SidebarBrandProfile({
  brandName,
  logoUrl,
  planLabel = "FREE 플랜",
  onOpenSupportHistory,
  onNavigate,
}: SidebarBrandProfileProps) {
  const { logout } = useAuth();
  const location = useLocation();
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    closeAndRestoreFocus();
  }

  function handleMenuNavigation() {
    setOpen(false);
    onNavigate?.();
  }

  function handleOpenSupportHistory() {
    setOpen(false);
    triggerRef.current?.focus();
    onNavigate?.();
    onOpenSupportHistory?.();
  }

  async function handleLogout() {
    setLoggingOut(true);
    setOpen(false);
    onNavigate?.();
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="sidebar-brand-profile-menu" ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        className="sidebar-brand-profile"
        type="button"
        aria-label={`${brandName} 계정 메뉴 열기`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <BrandLogo brandName={brandName} logoUrl={logoUrl} className="sidebar-brand-logo" />
        <span className="sidebar-brand-copy">
          <strong>{brandName}</strong>
          <small>{planLabel}</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="sidebar-brand-account-menu" role="menu" aria-label="계정 메뉴">
          <NavLink
            ref={firstItemRef}
            to="/brand-center"
            role="menuitem"
            onClick={handleMenuNavigation}
          >
            <Building2 size={16} aria-hidden="true" />
            브랜드센터
          </NavLink>
          <NavLink to="/billing" role="menuitem" onClick={handleMenuNavigation}>
            <CreditCard size={16} aria-hidden="true" />
            플랜
          </NavLink>
          <button role="menuitem" type="button" onClick={handleOpenSupportHistory}>
            <History size={16} aria-hidden="true" />
            문의 내역
          </button>
          <button role="menuitem" type="button" onClick={handleLogout} disabled={loggingOut}>
            <LogOut size={16} aria-hidden="true" />
            {loggingOut ? "로그아웃 중" : "로그아웃"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
