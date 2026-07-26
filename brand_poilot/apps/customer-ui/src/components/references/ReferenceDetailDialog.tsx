import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReferenceItem, ReferencePattern } from "../../types";
import { ReferencePatternPanel } from "./ReferencePatternPanel";

export function ReferenceDetailDialog({
  item,
  onClose,
  loadPattern,
}: {
  item: ReferenceItem;
  onClose(): void;
  loadPattern(referenceId: string): Promise<ReferencePattern>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [pattern, setPattern] = useState<ReferencePattern | null>(null);
  const patternExpected = item.metadata.patternAvailable === true;
  const [loadingPattern, setLoadingPattern] = useState(patternExpected);
  const summary = typeof item.metadata.summary === "string"
    ? item.metadata.summary
    : typeof item.metadata.caption === "string"
      ? item.metadata.caption
      : null;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    if (patternExpected) {
      void loadPattern(item.id)
        .then(setPattern)
        .catch(() => setPattern(null))
        .finally(() => setLoadingPattern(false));
    }
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [item.id, loadPattern, patternExpected]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section ref={dialogRef} className="modal-panel reference-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-detail-title">
        <header>
          <div><h2 id="reference-detail-title">레퍼런스 상세</h2><p className="muted">{item.origin} · {item.format?.toUpperCase() ?? "형식 없음"}</p></div>
          <button ref={closeRef} className="button" type="button" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="reference-detail-dialog__body">
          {item.previewUrl ? <img src={item.previewUrl} alt={`${item.title} 저장된 미리보기`} /> : <div className="reference-card__fallback">미리보기 없음</div>}
          <div><h2>{item.title}</h2><p>{summary ?? "보관된 본문 요약이 없습니다."}</p></div>
          <ReferencePatternPanel pattern={pattern} loading={loadingPattern} unavailable={!patternExpected} />
        </div>
        <footer>
          {item.sourceUrl
            ? <a className="button" href={item.sourceUrl} target="_blank" rel="noreferrer">원본 보기</a>
            : <span className="muted">외부 원본은 사용할 수 없지만 저장된 snapshot은 유지됩니다.</span>}
        </footer>
      </section>
    </div>
  );
}
