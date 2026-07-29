import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { SupportRequestCategory } from "../../types";

const inquiryCategories: Array<{ value: SupportRequestCategory; label: string }> = [
  { value: "bug", label: "오류" },
  { value: "feature", label: "기능 요청" },
  { value: "channel", label: "채널" },
  { value: "account", label: "계정" },
  { value: "other", label: "기타" }
];

export function FeedbackDialog({
  bookingUrl,
  onClose,
  onSubmit
}: {
  bookingUrl: string;
  onClose: () => void;
  onSubmit: (input: {
    category: SupportRequestCategory;
    message: string;
  }) => Promise<void>;
}) {
  const [category, setCategory] = useState<SupportRequestCategory | "">("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const submitLockedRef = useRef(false);
  const lastSubmittedInquiryRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const resolvedBookingUrl = bookingUrl.trim();
  const externalBookingUrl = /^https?:\/\//i.test(resolvedBookingUrl);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    categoryRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  async function submitFeedback(event: React.FormEvent) {
    event.preventDefault();
    const normalized = message.trim();
    if (!category || !normalized || submitLockedRef.current) return;
    const inquiryKey = `${category}:${normalized}`;
    if (inquiryKey === lastSubmittedInquiryRef.current) return;
    submitLockedRef.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      await onSubmit({ category, message: normalized });
      lastSubmittedInquiryRef.current = inquiryKey;
      setCategory("");
      setMessage("");
      setNotice({ type: "success", text: "문의가 접수되었습니다." });
    } catch {
      setNotice({ type: "error", text: "문의를 보내지 못했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      submitLockedRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop feedback-dialog-backdrop"
      data-testid="feedback-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      <section
        ref={dialogRef}
        className="modal-panel feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
      >
        <header className="feedback-dialog__header">
          <div>
            <h2 id="feedback-dialog-title">피드백</h2>
            <p>여러분의 의견이 모종을 더 좋게 만듭니다.</p>
          </div>
          <button className="feedback-dialog__close" type="button" aria-label="피드백 닫기" onClick={onClose}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>

        {resolvedBookingUrl ? (
          <section className="feedback-dialog__card feedback-dialog__booking">
            <h3>통화 문의 예약하기</h3>
            <p>15분 정도의 짧은 통화로 필요한 기능이나 불편한 점을 직접 전해주세요.</p>
            <a
              className="button feedback-dialog__booking-link"
              href={resolvedBookingUrl}
              target={externalBookingUrl ? "_blank" : undefined}
              rel={externalBookingUrl ? "noreferrer" : undefined}
            >
              통화 문의 예약하기 <ExternalLink size={15} aria-hidden="true" />
            </a>
          </section>
        ) : null}

        <form className="feedback-dialog__card feedback-dialog__form" onSubmit={submitFeedback}>
          <div>
            <h3>의견 보내기</h3>
            <p>문의 유형을 고르고 필요한 내용을 남겨주세요.</p>
          </div>
          <label className="feedback-dialog__field" htmlFor="feedback-category">
            <span>문의 유형</span>
            <select
              ref={categoryRef}
              id="feedback-category"
              value={category}
              onChange={(event) => {
                setCategory(event.currentTarget.value as SupportRequestCategory | "");
                setNotice(null);
              }}
            >
              <option value="">문의 유형 선택</option>
              {inquiryCategories.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="sr-only" htmlFor="feedback-message">내용</label>
          <textarea
            id="feedback-message"
            maxLength={2000}
            placeholder="어떤 점이 좋았고, 무엇이 더 필요하신가요?"
            value={message}
            onChange={(event) => { setMessage(event.currentTarget.value); setNotice(null); }}
          />
          <div className="feedback-dialog__form-footer">
            <button className="button primary" type="submit" disabled={!category || !message.trim() || submitting}>
              {submitting ? "보내는 중" : "보내기"}
            </button>
            <small>{message.length.toLocaleString()} / 2,000</small>
          </div>
          {notice ? (
            <p className={`feedback-dialog__notice feedback-dialog__notice--${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
              {notice.text}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
