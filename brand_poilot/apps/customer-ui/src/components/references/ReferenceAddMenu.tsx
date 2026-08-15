import { ChevronDown, Plus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link } from "react-router-dom";

type MenuFocusIntent = "first" | "last" | "next" | "previous";

function menuFocusTarget(
  items: HTMLElement[],
  current: Element | null,
  intent: MenuFocusIntent,
): HTMLElement | undefined {
  if (!items.length) return undefined;
  if (intent === "first") return items[0];
  if (intent === "last") return items[items.length - 1];

  const currentIndex = items.indexOf(current as HTMLElement);
  if (currentIndex < 0) return intent === "next" ? items[0] : items[items.length - 1];
  const offset = intent === "next" ? 1 : -1;
  return items[(currentIndex + offset + items.length) % items.length];
}

export function ReferenceAddMenu({ onUpload }: { onUpload(): void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement>(null);
  const lastItemRef = useRef<HTMLButtonElement>(null);
  const openingFocusRef = useRef<"first" | "last">("first");
  const tabbingRef = useRef(false);

  function getEnabledMenuItems() {
    const items: Array<HTMLElement | null> = [firstItemRef.current, lastItemRef.current];
    return items.filter(
      (item): item is HTMLElement => item !== null && !item.matches(':disabled,[aria-disabled="true"]'),
    );
  }

  useEffect(() => {
    if (!open) return;
    menuFocusTarget(getEnabledMenuItems(), null, openingFocusRef.current)?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const intent = event.key === "ArrowDown" ? "first" : "last";
    openingFocusRef.current = intent;
    if (open) {
      menuFocusTarget(getEnabledMenuItems(), document.activeElement, intent)?.focus();
      return;
    }
    setOpen(true);
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      tabbingRef.current = true;
      return;
    }
    tabbingRef.current = false;

    const intent: MenuFocusIntent | null = event.key === "ArrowDown"
      ? "next"
      : event.key === "ArrowUp"
        ? "previous"
        : event.key === "Home"
          ? "first"
          : event.key === "End"
            ? "last"
            : null;
    if (!intent) return;
    event.preventDefault();
    menuFocusTarget(getEnabledMenuItems(), document.activeElement, intent)?.focus();
  }

  function handleMenuBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (event.relatedTarget === triggerRef.current && !tabbingRef.current) return;
    tabbingRef.current = false;
    setOpen(false);
  }

  function handleUpload() {
    setOpen(false);
    triggerRef.current?.focus();
    onUpload();
  }

  return (
    <div ref={wrapperRef} className="reference-add-menu">
      <button
        ref={triggerRef}
        className="button primary reference-add-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => {
          if (!current) openingFocusRef.current = "first";
          return !current;
        })}
        onKeyDown={handleTriggerKeyDown}
      >
        <Plus size={18} aria-hidden="true" />
        자료 추가
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="reference-add-menu-popover"
          role="menu"
          aria-label="자료 추가"
          onKeyDown={handleMenuKeyDown}
          onBlurCapture={handleMenuBlur}
        >
          <Link
            ref={firstItemRef}
            role="menuitem"
            tabIndex={-1}
            to="/references?view=external-urls"
            onClick={() => setOpen(false)}
          >
            외부 URL 추가
          </Link>
          <button ref={lastItemRef} role="menuitem" tabIndex={-1} type="button" onClick={handleUpload}>
            파일 업로드
          </button>
        </div>
      ) : null}
    </div>
  );
}
