import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { api } from "../../lib/apiClient";
import { FocusTrap } from "../ui/FocusTrap";
import { SupportRequestHistory } from "./SupportRequestHistory";

export interface SupportRequestHistoryDialogProps {
  brandId: string;
  onClose: () => void;
  listRequests?: typeof api.listSupportRequests;
}

export function SupportRequestHistoryDialog({
  brandId,
  onClose,
  listRequests = api.listSupportRequests,
}: SupportRequestHistoryDialogProps) {
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop support-history-dialog-backdrop"
      data-testid="support-history-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <FocusTrap
        active
        initialFocusSelector="[data-support-history-dialog-close]"
        className="modal-panel support-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-history-dialog-title"
      >
        <header className="support-history-dialog__header">
          <div>
            <h2 id="support-history-dialog-title">문의 내역</h2>
            <p>접수한 문의와 운영자 답변을 확인하세요.</p>
          </div>
          <button
            className="feedback-dialog__close"
            data-support-history-dialog-close
            type="button"
            aria-label="문의 내역 닫기"
            onClick={onClose}
          >
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="support-history-dialog__body">
          <SupportRequestHistory
            brandId={brandId}
            listRequests={listRequests}
            embedded
          />
        </div>
      </FocusTrap>
    </div>
  );
}
