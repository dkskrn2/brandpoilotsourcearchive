import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { Badge } from "../ui/Badge";
import type { ChannelConnectionGuide } from "../../features/channels/channelGuides";

export function ChannelConnectionGuideDialog({
  guide,
  onClose
}: {
  guide: ChannelConnectionGuide;
  onClose: () => void;
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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
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

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section
        ref={dialogRef}
        className="modal-panel channel-guide-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-guide-title"
      >
        <header className="channel-guide-dialog__header">
          <div>
            <div className="channel-guide-dialog__eyebrow">
              <span>채널 인증 안내</span>
              <Badge variant={guide.serviceStatus === "available" ? "ok" : "warn"}>
                {guide.serviceStatus === "available" ? "연결 가능" : "연결 준비 중"}
              </Badge>
            </div>
            <h2 id="channel-guide-title">{guide.label} 연결 가이드</h2>
            <p>{guide.summary}</p>
          </div>
          <button ref={closeRef} className="button channel-guide-dialog__close" type="button" aria-label="연결 가이드 닫기" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="channel-guide-dialog__body">
          <section className="channel-guide-section channel-guide-section--notice">
            <h3>연결 전에 준비하세요</h3>
            <ul>{guide.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          {guide.accountSetup.map((section) => (
            <section className="channel-guide-section" key={section.title}>
              <h3>{section.title}</h3>
              <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            </section>
          ))}

          <section className="channel-guide-section">
            <h3>모종에 연결</h3>
            <ol>{guide.oauthSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>

          <section className="channel-guide-section">
            <h3>승인하는 권한</h3>
            <dl className="channel-guide-permissions">
              {guide.permissions.map((permission) => (
                <div key={permission.name}>
                  <dt>{permission.name}</dt>
                  <dd>{permission.purpose}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="channel-guide-section">
            <h3>연결 완료 확인</h3>
            <ul className="channel-guide-checks">{guide.completionChecks.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>

          <section className="channel-guide-section">
            <h3>문제가 생겼을 때</h3>
            <dl className="channel-guide-troubleshooting">
              {guide.troubleshooting.map((item) => (
                <div key={item.problem}>
                  <dt>{item.problem}</dt>
                  <dd>{item.solution}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="channel-guide-section channel-guide-section--operator">
            <h3>모종이 준비하는 항목</h3>
            <p>{guide.operatorNote}</p>
          </section>

          <section className="channel-guide-section">
            <h3>공식 문서</h3>
            <div className="channel-guide-links">
              {guide.officialLinks.map((link) => (
                <a className="button" href={link.href} target="_blank" rel="noreferrer" key={link.href}>
                  {link.label}<ExternalLink size={15} aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        </div>

        <footer className="channel-guide-dialog__footer">
          <button className="button primary" type="button" onClick={onClose}>확인</button>
        </footer>
      </section>
    </div>
  );
}
