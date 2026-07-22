import { useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import type { InstagramTrendMedia } from "../../types";

const kindLabels: Record<InstagramTrendMedia["kind"], string> = {
  image: "이미지",
  carousel: "캐러셀",
  video: "영상",
  reel: "릴스"
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("ko-KR") : "게시일 없음";
}

export function TrendMediaCard({ media, onSelect, onBookmark, onUnbookmark }: { media: InstagramTrendMedia; onSelect: (media: InstagramTrendMedia) => void; onBookmark?: (media: InstagramTrendMedia) => Promise<void>; onUnbookmark?: (media: InstagramTrendMedia) => Promise<void> }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(media.isSaved);
  const isVideo = media.kind === "video" || media.kind === "reel";
  const previewUrl = media.previewUrl ?? media.mediaUrl;
  const authorLabel = media.username ? `@${media.username}` : "Instagram 인기 콘텐츠";

  useEffect(() => {
    setSaved(media.isSaved);
  }, [media.isSaved]);

  async function toggleBookmark() {
    const action = saved ? onUnbookmark : onBookmark;
    if (!action || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await action(media);
      setSaved((current) => !current);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="trend-media-card">
      <button className="trend-media-card__detail" type="button" onClick={() => onSelect(media)} aria-label={media.username ? `상세 보기 ${authorLabel}` : `${authorLabel} 상세 보기`}>
      <span className="trend-media-card__frame">
        {previewFailed ? (
          <span className="trend-media-card__fallback">
            <strong>미디어 미리보기를 불러오지 못했습니다.</strong>
            <span>Instagram에서 원본을 확인하세요.</span>
          </span>
        ) : !previewUrl ? (
          <span className="trend-media-card__fallback">
            <strong>미리보기를 사용할 수 없습니다.</strong>
            <span>Instagram에서 원본을 확인하세요.</span>
          </span>
        ) : isVideo ? (
          <video
            src={media.mediaUrl ?? previewUrl}
            poster={media.previewUrl ?? undefined}
            preload="metadata"
            muted
            playsInline
            aria-label={`${authorLabel} 미디어 미리보기`}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <img
            src={previewUrl}
            alt={`${authorLabel} 미디어 미리보기`}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        )}
      </span>
      <span className="trend-media-card__body">
        <span className="trend-media-card__topline">
          <strong>{authorLabel}</strong>
          <span className="muted">{kindLabels[media.kind]}</span>
        </span>
        <span className="trend-media-card__meta">
          <span>{formatDate(media.postedAt)}</span>
          {media.likeCount !== null ? <span>좋아요 {media.likeCount.toLocaleString("ko-KR")}</span> : null}
          {media.commentsCount !== null ? <span>댓글 {media.commentsCount.toLocaleString("ko-KR")}</span> : null}
        </span>
      </span>
      </button>
      <button className="trend-media-card__bookmark" type="button" disabled={saving || (saved ? !onUnbookmark : !onBookmark)} aria-label={saved ? `${authorLabel} 저장됨` : `${authorLabel} 북마크`} title={saved ? "저장 해제" : "아카이브에 저장"} onClick={() => void toggleBookmark()}>
        {saved ? <BookmarkCheck size={18} aria-hidden="true" /> : <Bookmark size={18} aria-hidden="true" />}
      </button>
      {saveError ? <span className="trend-media-card__error" role="alert">저장하지 못했습니다.</span> : null}
    </article>
  );
}
