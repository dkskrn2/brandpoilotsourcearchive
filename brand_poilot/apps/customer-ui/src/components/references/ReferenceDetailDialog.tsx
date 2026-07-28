import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReferenceDetail, ReferenceItem, ReferencePattern } from "../../types";
import { ReferencePatternPanel } from "./ReferencePatternPanel";

export function ReferenceDetailDialog({
  item,
  onClose,
  loadDetail,
  loadPattern,
}: {
  item: ReferenceItem;
  onClose(): void;
  loadDetail(referenceId: string): Promise<ReferenceDetail>;
  loadPattern(referenceId: string): Promise<ReferencePattern>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [pattern, setPattern] = useState<ReferencePattern | null>(null);
  const [detail, setDetail] = useState<ReferenceDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const patternExpected = item.metadata.patternAvailable === true;
  const [loadingPattern, setLoadingPattern] = useState(patternExpected);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
    let active = true;
    void loadDetail(item.id)
      .then((value) => { if (active) setDetail(value); })
      .catch(() => { if (active) setDetailFailed(true); });
    if (patternExpected) {
      void loadPattern(item.id)
        .then((value) => { if (active) setPattern(value); })
        .catch(() => { if (active) setPattern(null); })
        .finally(() => { if (active) setLoadingPattern(false); });
    }
    return () => {
      active = false;
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [item.id, loadDetail, loadPattern, patternExpected]);

  const displayed = detail ?? item;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section ref={dialogRef} className="modal-panel reference-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-detail-title">
        <header>
          <div><h2 id="reference-detail-title">레퍼런스 상세</h2><p className="muted">{displayed.origin} · {displayed.format?.toUpperCase() ?? "형식 없음"}</p></div>
          <button ref={closeRef} className="button" type="button" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="reference-detail-dialog__body">
          {displayed.previewUrl ? <img src={displayed.previewUrl} alt={`${displayed.title} 저장된 미리보기`} /> : <div className="reference-card__fallback">미리보기 없음</div>}
          <div>
            <h2>{displayed.title}</h2>
            {!detail && !detailFailed ? <p>상세 내용을 불러오는 중입니다.</p> : null}
            {detail ? <p>{detail.description ?? detail.body ?? "보관된 본문 요약이 없습니다."}</p> : null}
            {detailFailed ? <p role="alert">저장된 상세 내용을 불러오지 못했습니다.</p> : null}
          </div>
          <ReferencePatternPanel pattern={pattern} loading={loadingPattern} unavailable={!patternExpected} />
        </div>
        <footer>
          {displayed.sourceUrl
            ? <a className="button" href={displayed.sourceUrl} target="_blank" rel="noreferrer">원본 보기</a>
            : <span className="muted">외부 원본은 사용할 수 없지만 저장된 snapshot은 유지됩니다.</span>}
        </footer>
      </section>
    </div>
  );
}
