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
import { FocusTrap } from "../ui/FocusTrap";
import { SupportRequestHistoryDialog } from "../support/SupportRequestHistoryDialog";

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

function resolvePlanLabel(summary: unknown) {
  if (!summary || typeof summary !== "object") return null;
  const subscription = (summary as { subscription?: unknown }).subscription;
  if (!subscription || typeof subscription !== "object") return null;
  const planName = (subscription as { planName?: unknown }).planName;
  return typeof planName === "string" && planName.trim()
    ? planName.trim()
    : null;
}

export function AppShell({ children }: AppShellProps) {
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(initialDesktopSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pendingFeedbackAfterMobile, setPendingFeedbackAfterMobile] = useState(false);
  const [planLabel, setPlanLabel] = useState("FREE 플랜");
  const [supportHistoryOpen, setSupportHistoryOpen] = useState(false);
  const [pendingSupportHistoryAfterMobile, setPendingSupportHistoryAfterMobile] = useState(false);
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
  const openSupportHistory = useCallback(() => {
    if (mobileMenuOpen) {
      setPendingSupportHistoryAfterMobile(true);
      setMobileMenuOpen(false);
      return;
    }
    setSupportHistoryOpen(true);
  }, [mobileMenuOpen]);

  useEffect(() => {
    let active = true;
    api.getBillingSummary(DEMO_BRAND_ID)
      .then((summary) => {
        const nextPlanLabel = resolvePlanLabel(summary);
        if (active && nextPlanLabel) setPlanLabel(nextPlanLabel);
      })
      .catch(() => {
        // The profile keeps the FREE fallback when billing is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

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
    if (!pendingSupportHistoryAfterMobile || mobileMenuOpen) return;
    setPendingSupportHistoryAfterMobile(false);
    setSupportHistoryOpen(true);
  }, [mobileMenuOpen, pendingSupportHistoryAfterMobile]);

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
                planLabel={planLabel}
                onOpenSupportHistory={openSupportHistory}
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
                <FocusTrap
                  active
                  initialFocusSelector=".nav a"
                  id="mobile-navigation"
                  className="mobile-menu-screen"
                  role="dialog"
                  aria-modal="true"
                  aria-label="전체 메뉴"
                >
                  <Sidebar
                    variant="mobile"
                    onClose={() => setMobileMenuOpen(false)}
                    onNavigate={() => setMobileMenuOpen(false)}
                    planLabel={planLabel}
                    onOpenSupportHistory={openSupportHistory}
                  />
                </FocusTrap>
              ) : null}
              {feedbackOpen ? (
                <FeedbackDialog
                  bookingUrl={import.meta.env.VITE_FEEDBACK_BOOKING_URL ?? ""}
                  onClose={() => setFeedbackOpen(false)}
                  onSubmit={async (input) => { await api.createSupportRequest(DEMO_BRAND_ID, input); }}
                />
              ) : null}
              {supportHistoryOpen ? (
                <SupportRequestHistoryDialog
                  brandId={DEMO_BRAND_ID}
                  onClose={() => setSupportHistoryOpen(false)}
                />
              ) : null}
            </div>
          </FeedbackProvider>
        </HelpProvider>
      </AiContentUsageProvider>
    </BrandStatusProvider>
  );
}
