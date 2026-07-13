import { useEffect, useState } from "react";

interface ReelVideoPreviewProps {
  src: string | null;
  poster: string | null;
  title: string;
  durationSeconds?: number | null;
}

function formatDuration(durationSeconds: number) {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ReelVideoPreview({ src, poster, title, durationSeconds = null }: ReelVideoPreviewProps) {
  const [metadataDuration, setMetadataDuration] = useState<number | null>(durationSeconds);
  const label = `Instagram Reel 미리보기: ${title}`;

  useEffect(() => {
    setMetadataDuration(durationSeconds);
  }, [durationSeconds, src]);

  return (
    <figure style={{ width: "min(100%, 320px)", margin: "0 auto" }}>
      {src ? (
        <video
          aria-label={label}
          src={src}
          poster={poster ?? undefined}
          controls
          preload="metadata"
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration)) setMetadataDuration(duration);
          }}
          style={{
            display: "block",
            width: "100%",
            aspectRatio: "9 / 16",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            background: "#111827",
            objectFit: "cover"
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={label}
          style={{
            display: "grid",
            placeItems: "center",
            width: "100%",
            aspectRatio: "9 / 16",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            background: "#111827",
            color: "#fff"
          }}
        >
          Reel 영상 준비 중
        </div>
      )}
      <figcaption
        className="muted small"
        style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 8 }}
      >
        <span>Instagram Reel · 1080 x 1920</span>
        <span>{metadataDuration === null ? "길이 확인 중" : `길이 ${formatDuration(metadataDuration)}`}</span>
      </figcaption>
    </figure>
  );
}
