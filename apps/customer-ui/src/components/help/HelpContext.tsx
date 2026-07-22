import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { guideForPath, helpGuides, type HelpGuide, type HelpTourStep } from "../../features/help/helpGuides";
import { CoachmarkOverlay } from "./CoachmarkOverlay";
import { HelpDrawer } from "./HelpDrawer";

interface HelpContextValue {
  currentGuide: HelpGuide | null;
  openHelp(): void;
  startTour(): void;
}

const HelpContext = createContext<HelpContextValue | null>(null);

export function useHelp() {
  return useContext(HelpContext);
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const currentGuide = useMemo(() => guideForPath(location.pathname), [location.pathname]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tour, setTour] = useState<{ steps: HelpTourStep[]; index: number } | null>(null);

  useEffect(() => {
    setDrawerOpen(false);
    setTour(null);
  }, [location.pathname]);

  function startTour() {
    if (!currentGuide) return;
    const visibleSteps = currentGuide.tour.filter((step) => document.querySelector(step.selector));
    if (visibleSteps.length === 0) return;
    setDrawerOpen(false);
    setTour({ steps: visibleSteps, index: 0 });
  }

  const value = useMemo<HelpContextValue>(() => ({
    currentGuide,
    openHelp: () => setDrawerOpen(true),
    startTour
  }), [currentGuide]);

  return (
    <HelpContext.Provider value={value}>
      {children}
      {drawerOpen ? (
        <HelpDrawer
          currentGuide={currentGuide}
          guides={helpGuides}
          onClose={() => setDrawerOpen(false)}
          onStartTour={startTour}
        />
      ) : null}
      {tour ? (
        <CoachmarkOverlay
          step={tour.steps[tour.index]}
          current={tour.index + 1}
          total={tour.steps.length}
          onClose={() => setTour(null)}
          onPrevious={() => setTour((current) => current && current.index > 0 ? { ...current, index: current.index - 1 } : current)}
          onNext={() => setTour((current) => {
            if (!current || current.index >= current.steps.length - 1) return null;
            return { ...current, index: current.index + 1 };
          })}
        />
      ) : null}
    </HelpContext.Provider>
  );
}
