import { useEffect, useRef } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { HelpGuide } from "../../features/help/helpGuides";

interface HelpDrawerProps {
  currentGuide: HelpGuide | null;
  guides: HelpGuide[];
  onClose(): void;
  onStartTour(): void;
}

function guidePath(guide: HelpGuide) {
  if (guide.path.includes(":")) return guide.path.startsWith("/ai-content/") ? "/ai-content" : "/";
  return guide.path;
}

export function HelpDrawer({ currentGuide, guides, onClose, onStartTour }: HelpDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="help-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="help-drawer" role="dialog" aria-modal="true" aria-labelledby="help-drawer-title">
        <header className="help-drawer__header">
          <div>
            <span>모종 도움말</span>
            <h2 id="help-drawer-title">{currentGuide?.title ?? "전체 가이드"}</h2>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label="도움말 닫기" onClick={onClose}><X size={19} /></button>
        </header>

        <div className="help-drawer__body">
          {currentGuide ? (
            <section className="help-current-guide">
              <p>{currentGuide.summary}</p>
              {currentGuide.tour.length > 0 ? <button className="button primary" type="button" onClick={onStartTour}><Play size={15} /> 화면 안내 시작</button> : null}
              {currentGuide.sections.map((section) => (
                <section className="help-guide-section" key={section.title}>
                  <h3>{section.title}</h3>
                  <ol>{section.items.map((item) => <li key={item}>{item}</li>)}</ol>
                  {section.links?.length ? <div className="help-guide-links">{section.links.map((link) => link.external ? (
                    <a className="button" key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label}<ExternalLink size={14} /></a>
                  ) : <Link className="button" key={link.href} to={link.href} onClick={onClose}>{link.label}</Link>)}</div> : null}
                </section>
              ))}
            </section>
          ) : <p>현재 화면에 등록된 가이드가 없습니다.</p>}

          <section className="help-guide-index" aria-labelledby="help-guide-index-title">
            <h3 id="help-guide-index-title">다른 화면 가이드</h3>
            <nav aria-label="도움말 문서 목록">
              {guides.filter((guide) => !guide.path.includes(":")).map((guide) => (
                <Link key={guide.id} to={guidePath(guide)} onClick={onClose} aria-current={guide.id === currentGuide?.id ? "page" : undefined}>
                  <strong>{guide.title}</strong>
                  <span>{guide.summary}</span>
                </Link>
              ))}
            </nav>
          </section>
        </div>
      </aside>
    </div>
  );
}
