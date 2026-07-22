import { useEffect, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { api } from "../../lib/apiClient";
import type { ContentOutput, PublishArtifact } from "../../types";
import { Badge } from "../ui/Badge";
import { ListSkeleton } from "../ui/LoadingState";
import { PublishArtifactPreview } from "./PublishArtifactPreview";
import { ChannelLogo } from "../channels/ChannelLogo";

const channelLabels: Record<ContentOutput["channel"], string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok"
};

export function ContentArtifactDialog({ output, onClose }: { output: ContentOutput; onClose: () => void }) {
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setArtifact(null);
    setLoading(true);
    setError(false);
    api.getContentOutputArtifact(output.id)
      .then((next) => {
        if (!ignore) setArtifact(next);
      })
      .catch(() => {
        if (!ignore) setError(true);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [output.id, reloadKey]);

  return (
    <div className="modal-backdrop">
      <section className="modal-panel publish-result-dialog" role="dialog" aria-modal="true" aria-label="생성 콘텐츠 상세">
        <header className="publish-result-dialog__header">
          <div>
            <h2>{output.title}</h2>
            <div className="row-meta channel-identity"><ChannelLogo channel={output.channel} decorative size={16} /><span>{channelLabels[output.channel]}</span></div>
          </div>
          <div className="publish-result-dialog__header-actions">
            <Badge variant="warn">검토 필요</Badge>
            <button className="button publish-result-dialog__close" type="button" onClick={onClose} aria-label="닫기" title="닫기">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="publish-result-dialog__body publish-result-dialog__scroll">
          <section className="publish-result-dialog__preview" aria-label="생성 결과 미리보기">
            {loading ? (
              <ListSkeleton rows={4} columns={2} label="결과물을 불러오는 중입니다." />
            ) : error ? (
              <div className="publish-result-dialog__state" role="alert">
                <strong>결과물을 불러오지 못했습니다.</strong>
                <button className="button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
                  <RotateCcw size={16} aria-hidden="true" /> 다시 시도
                </button>
              </div>
            ) : artifact ? <PublishArtifactPreview artifact={artifact} /> : null}
          </section>
          <aside className="publish-result-dialog__metadata" aria-label="생성 정보">
            <h3>콘텐츠 정보</h3>
            <dl>
              <div><dt>채널</dt><dd className="channel-identity"><ChannelLogo channel={output.channel} decorative size={18} /><span>{channelLabels[output.channel]}</span></dd></div>
              <div><dt>상태</dt><dd>{output.status}</dd></div>
              {output.sourceSummary ? <div><dt>생성 근거</dt><dd>{output.sourceSummary}</dd></div> : null}
            </dl>
          </aside>
        </div>
      </section>
    </div>
  );
}
