import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

const visibilityThreshold = 320;

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(() => window.scrollY > visibilityThreshold);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > visibilityThreshold);
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  if (!visible) return null;
  return (
    <button
      className="scroll-to-top"
      type="button"
      aria-label="맨 위로"
      title="맨 위로"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowUp size={20} aria-hidden="true" />
    </button>
  );
}
