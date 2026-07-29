import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { PublishArtifactPreview } from "../publish/PublishArtifactPreview";
import type { PerformanceInsights, PublishArtifact } from "../../types";
import { ChannelLogo } from "../channels/ChannelLogo";
import { FocusTrap } from "../ui/FocusTrap";

type Content = PerformanceInsights["topContents"][number];

const channelLabels: Record<Content["channel"], string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

export function PerformanceContentDialog({
  content,
  loadArtifact,
  onClose,
}: {
  content: Content;
  loadArtifact: (queueId: string) => Promise<PublishArtifact>;
  onClose: () => void;
}) {
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setArtifact(null);
    setLoading(true);
    setError(false);
    loadArtifact(content.publishQueueId)
      .then((value) => {
        if (active) setArtifact(value);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [content.publishQueueId, loadArtifact, reloadKey]);

  return (
    <FocusTrap
      active
      initialFocusSelector="[data-performance-dialog-close]"
      className="modal-backdrop"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-panel performance-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
      >
        <header className="performance-dialog__header">
          <div>
            <span className="performance-dialog__channel channel-identity">
              <ChannelLogo channel={content.channel} decorative size={18} />
              {channelLabels[content.channel]}
            </span>
            <h2>{content.title}</h2>
            <p>성과가 수집된 실제 콘텐츠입니다.</p>
          </div>
          <button
            className="button performance-dialog__close"
            type="button"
            data-performance-dialog-close
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="performance-dialog__body">
          {loading ? <p className="performance-dialog__state" role="status">콘텐츠를 불러오는 중입니다.</p> : null}
          {!loading && error ? (
            <div className="performance-dialog__state" role="alert">
              <strong>콘텐츠를 불러오지 못했습니다.</strong>
              <span>잠시 후 다시 시도해 주세요.</span>
              <button
                className="button"
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                <RefreshCw size={16} aria-hidden="true" />
                다시 시도
              </button>
            </div>
          ) : null}
          {!loading && artifact ? <PublishArtifactPreview artifact={artifact} /> : null}
        </div>
        {content.externalUrl ? (
          <footer className="performance-dialog__footer">
            <a
              className="button"
              href={content.externalUrl}
              target="_blank"
              rel="noreferrer"
            >
              원문 열기
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          </footer>
        ) : null}
      </section>
    </FocusTrap>
  );
}
