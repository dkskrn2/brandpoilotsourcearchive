import { useEffect, useLayoutEffect, useState } from "react";
import { X } from "lucide-react";
import type { HelpTourStep } from "../../features/help/helpGuides";

interface CoachmarkOverlayProps {
  step: HelpTourStep;
  current: number;
  total: number;
  onClose(): void;
  onPrevious(): void;
  onNext(): void;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function CoachmarkOverlay({ step, current, total, onClose, onPrevious, onNext }: CoachmarkOverlayProps) {
  const [target, setTarget] = useState<TargetRect | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const element = document.querySelector<HTMLElement>(step.selector);
      if (!element) return setTarget(null);
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      const rect = element.getBoundingClientRect();
      setTarget({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step.selector]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && current > 1) onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, onClose, onNext, onPrevious]);

  if (!target) return null;
  const cardWidth = Math.min(340, window.innerWidth - 32);
  const left = Math.max(16, Math.min(target.left, window.innerWidth - cardWidth - 16));
  const placeBelow = target.top + target.height + 196 < window.innerHeight;
  const top = placeBelow ? target.top + target.height + 12 : Math.max(16, target.top - 188);

  return (
    <div className="coachmark-layer" role="dialog" aria-modal="true" aria-label={`${step.title} 화면 안내`}>
      <div className="coachmark-shade" />
      <div className="coachmark-target" style={{ top: target.top - 5, left: target.left - 5, width: target.width + 10, height: target.height + 10 }} />
      <section className="coachmark-card" style={{ top, left, width: cardWidth }}>
        <header><span>{current} / {total}</span><button type="button" aria-label="화면 안내 닫기" onClick={onClose}><X size={17} /></button></header>
        <h2>{step.title}</h2>
        <p>{step.description}</p>
        <footer>
          <button className="button" type="button" disabled={current === 1} onClick={onPrevious}>이전</button>
          <button className="button primary" type="button" onClick={onNext}>{current === total ? "완료" : "다음"}</button>
        </footer>
      </section>
    </div>
  );
}
