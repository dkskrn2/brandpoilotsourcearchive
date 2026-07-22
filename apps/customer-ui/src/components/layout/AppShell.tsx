import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { BrandStatusProvider } from "../../lib/brandStatus";
import { ScrollToTopButton } from "./ScrollToTopButton";
import { HelpProvider } from "../help/HelpContext";
import { AiContentUsageProvider } from "../../features/ai-content/AiContentUsageContext";
import { FeedbackDialog } from "../feedback/FeedbackDialog";
import { FeedbackProvider } from "../feedback/FeedbackContext";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";

interface AppShellProps {
  children: React.ReactNode;
}

const desktopSidebarStorageKey = "mojong:desktop-sidebar:v1";

function initialDesktopSidebarCollapsed() {
  try {
    return window.localStorage.getItem(desktopSidebarStorageKey) === "collapsed";
  } catch {
    return false;
  }
}

export function AppShell({ children }: AppShellProps) {
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(initialDesktopSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pendingFeedbackAfterMobile, setPendingFeedbackAfterMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const location = useLocation();
  const openFeedback = useCallback(() => {
    if (mobileMenuOpen) {
      setPendingFeedbackAfterMobile(true);
      setMobileMenuOpen(false);
      return;
    }
    setFeedbackOpen(true);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (wasOpenRef.current && !mobileMenuOpen) menuButtonRef.current?.focus();
    wasOpenRef.current = mobileMenuOpen;
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!pendingFeedbackAfterMobile || mobileMenuOpen) return;
    setPendingFeedbackAfterMobile(false);
    setFeedbackOpen(true);
  }, [mobileMenuOpen, pendingFeedbackAfterMobile]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  function toggleDesktopSidebar() {
    setDesktopSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        window.localStorage.setItem(desktopSidebarStorageKey, next ? "collapsed" : "expanded");
      } catch {
        // The sidebar remains usable when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <BrandStatusProvider>
      <AiContentUsageProvider>
        <HelpProvider>
          <FeedbackProvider onOpenFeedback={openFeedback}>
            <div className={`app${desktopSidebarCollapsed ? " app--sidebar-collapsed" : ""}`}>
              <Sidebar
                collapsed={desktopSidebarCollapsed}
                onToggleCollapsed={toggleDesktopSidebar}
              />
              <main className="main">
                <Topbar
                  mobileMenuOpen={mobileMenuOpen}
                  menuButtonRef={menuButtonRef}
                  onOpenMobileMenu={() => setMobileMenuOpen(true)}
                />
                {children}
                <ScrollToTopButton />
              </main>
              {mobileMenuOpen ? (
                <div id="mobile-navigation" className="mobile-menu-screen" role="dialog" aria-modal="true" aria-label="전체 메뉴">
                  <Sidebar
                    variant="mobile"
                    onClose={() => setMobileMenuOpen(false)}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                </div>
              ) : null}
              {feedbackOpen ? (
                <FeedbackDialog
                  bookingUrl={import.meta.env.VITE_FEEDBACK_BOOKING_URL ?? ""}
                  onClose={() => setFeedbackOpen(false)}
                  onSubmit={async (message) => { await api.createFeedbackSubmission(DEMO_BRAND_ID, message); }}
                />
              ) : null}
            </div>
          </FeedbackProvider>
        </HelpProvider>
      </AiContentUsageProvider>
    </BrandStatusProvider>
  );
}
