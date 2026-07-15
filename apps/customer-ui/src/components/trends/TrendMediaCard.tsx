import { useState } from "react";
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

export function TrendMediaCard({ media, onSelect }: { media: InstagramTrendMedia; onSelect: (media: InstagramTrendMedia) => void }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const isVideo = media.kind === "video" || media.kind === "reel";
  const previewUrl = media.previewUrl ?? media.mediaUrl;

  return (
    <button className="trend-media-card" type="button" onClick={() => onSelect(media)} aria-label={`상세 보기 @${media.username ?? "알 수 없음"}`}>
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
            aria-label={`@${media.username ?? "알 수 없음"} 미디어 미리보기`}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <img
            src={previewUrl}
            alt={`@${media.username ?? "알 수 없음"} 미디어 미리보기`}
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        )}
      </span>
      <span className="trend-media-card__body">
        <span className="trend-media-card__topline">
          <strong>@{media.username ?? "알 수 없음"}</strong>
          <span className="muted">{kindLabels[media.kind]}</span>
        </span>
        <span className="trend-media-card__meta">
          <span>{formatDate(media.postedAt)}</span>
          {media.likeCount !== null ? <span>좋아요 {media.likeCount.toLocaleString("ko-KR")}</span> : null}
          {media.commentsCount !== null ? <span>댓글 {media.commentsCount.toLocaleString("ko-KR")}</span> : null}
        </span>
      </span>
    </button>
  );
}
