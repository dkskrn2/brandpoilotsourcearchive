import {
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function visibleFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function FocusTrap({
  active,
  initialFocusSelector,
  children,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  active: boolean;
  initialFocusSelector?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const initial = initialFocusSelector
      ? container.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    (initial ?? visibleFocusableElements(container)[0] ?? container).focus();
  }, [active, initialFocusSelector]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(event);
    if (!active || event.defaultPrevented || event.key !== "Tab") return;
    const container = containerRef.current;
    if (!container) return;
    const elements = visibleFocusableElements(container);
    if (elements.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const activeElement = document.activeElement as HTMLElement | null;
    if (!activeElement || !elements.includes(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={handleKeyDown} {...props}>
      {children}
    </div>
  );
}
