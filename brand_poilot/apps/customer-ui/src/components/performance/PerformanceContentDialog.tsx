import { useEffect, useRef, useState } from "react";
import { PublishArtifactPreview } from "../publish/PublishArtifactPreview";
import type { PerformanceInsights, PublishArtifact } from "../../types";

type Content = PerformanceInsights["topContents"][number];

export function PerformanceContentDialog({
  content,
  loadArtifact,
  onClose,
}: {
  content: Content;
  loadArtifact: (queueId: string) => Promise<PublishArtifact>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    closeRef.current?.focus();
    loadArtifact(content.publishQueueId)
      .then((value) => { if (active) setArtifact(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [content.publishQueueId, loadArtifact]);

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-panel performance-dialog" role="dialog" aria-modal="true" aria-label={content.title}>
        <header><div><h2>{content.title}</h2><p>성과가 수집된 실제 콘텐츠입니다.</p></div><button ref={closeRef} type="button" onClick={onClose}>닫기</button></header>
        {!artifact && !error ? <p role="status">콘텐츠를 불러오는 중입니다.</p> : null}
        {error ? <p role="alert">콘텐츠를 불러오지 못했습니다.</p> : null}
        {artifact ? <PublishArtifactPreview artifact={artifact} /> : null}
      </section>
    </div>
  );
}
