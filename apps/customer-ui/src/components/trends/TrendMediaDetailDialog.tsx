import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { InstagramTrendMedia } from "../../types";

const kindLabels: Record<InstagramTrendMedia["kind"], string> = {
  image: "이미지",
  carousel: "캐러셀",
  video: "영상",
  reel: "릴스"
};

export function TrendMediaDetailDialog({
  media,
  onClose,
  onSave
}: {
  media: InstagramTrendMedia;
  onClose: () => void;
  onSave: () => Promise<{ alreadySaved: boolean }>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(media.isSaved);
  const isVideo = media.kind === "video" || media.kind === "reel";
  const previewUrl = media.previewUrl ?? media.mediaUrl;

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function saveSource() {
    if (saved || isSaving) return;
    setIsSaving(true);
    try {
      const result = await onSave();
      setSaved(true);
      if (result.alreadySaved) setSaved(true);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="modal-panel trend-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="trend-detail-title">
        <header className="trend-detail-dialog__header">
          <div>
            <h2 id="trend-detail-title">Instagram 트렌드 상세</h2>
            <p className="muted">@{media.username ?? "알 수 없음"} · {kindLabels[media.kind]}</p>
          </div>
          <button ref={closeRef} className="button trend-detail-dialog__close" type="button" aria-label="닫기" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="trend-detail-dialog__body">
          <div className="trend-detail-dialog__media">
            {!previewUrl || previewFailed ? (
              <div className="trend-media-card__fallback">
                <strong>{previewFailed ? "미디어 미리보기를 불러오지 못했습니다." : "미리보기를 사용할 수 없습니다."}</strong>
                <span>Instagram에서 원본을 확인하세요.</span>
              </div>
            ) : isVideo ? (
              <video src={media.mediaUrl ?? previewUrl} poster={media.previewUrl ?? undefined} preload="metadata" muted playsInline onError={() => setPreviewFailed(true)} />
            ) : (
              <img src={previewUrl} alt={`@${media.username ?? "알 수 없음"} 미디어 원본`} loading="lazy" onError={() => setPreviewFailed(true)} />
            )}
          </div>
          <div className="trend-detail-dialog__copy">
            <p>{media.caption ?? "캡션이 없습니다."}</p>
            <dl>
              <div><dt>게시일</dt><dd>{media.postedAt ? new Date(media.postedAt).toLocaleString("ko-KR") : "게시일 없음"}</dd></div>
              {media.likeCount !== null ? <div><dt>좋아요</dt><dd>{media.likeCount.toLocaleString("ko-KR")}</dd></div> : null}
              {media.commentsCount !== null ? <div><dt>댓글</dt><dd>{media.commentsCount.toLocaleString("ko-KR")}</dd></div> : null}
            </dl>
          </div>
        </div>
        <footer className="trend-detail-dialog__footer">
          <a className="button" href={media.permalink} target="_blank" rel="noreferrer">Instagram에서 보기</a>
          <button className="button primary" type="button" disabled={saved || isSaving} onClick={saveSource}>
            {saved ? "저장됨" : isSaving ? "저장 중..." : "참고 소스로 저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}
