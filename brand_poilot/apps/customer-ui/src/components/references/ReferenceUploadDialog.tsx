import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { LibraryGateway } from "../../features/libraries/libraryGateway";
import { ReferenceFileUploader } from "./ReferenceFileUploader";

export function ReferenceUploadDialog({
  brandId,
  gateway,
  onClose,
}: {
  brandId: string;
  gateway: LibraryGateway;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section
        ref={dialogRef}
        className="modal-panel reference-upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-upload-title"
      >
        <header>
          <div>
            <h2 id="reference-upload-title">레퍼런스 파일 업로드</h2>
            <p className="muted">내용 확인이 끝난 파일만 업로드 확인으로 보관합니다.</p>
          </div>
          <button ref={closeRef} className="button" type="button" aria-label="닫기" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <ReferenceFileUploader brandId={brandId} gateway={gateway} />
      </section>
    </div>
  );
}
