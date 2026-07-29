import { Menu } from "lucide-react";
import type { RefObject } from "react";

export function Topbar({
  mobileMenuOpen = false,
  menuButtonRef,
  onOpenMobileMenu,
}: {
  mobileMenuOpen?: boolean;
  menuButtonRef?: RefObject<HTMLButtonElement>;
  onOpenMobileMenu?: () => void;
} = {}) {
  return (
    <header className="topbar">
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
    </header>
  );
}
