interface VerticalImagePreviewProps {
  src: string | null;
  title: string;
}

const frameStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  width: "min(100%, 320px)",
  aspectRatio: "9 / 16",
  margin: "0 auto",
  overflow: "hidden",
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#f8fafc"
};

export function VerticalImagePreview({ src, title }: VerticalImagePreviewProps) {
  const label = `Instagram Story 미리보기: ${title}`;

  return (
    <figure style={{ margin: 0 }}>
      <div style={frameStyle}>
        {src ? (
          <img
            src={src}
            alt={label}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span className="muted small" role="img" aria-label={label}>Story 이미지 준비 중</span>
        )}
      </div>
      <figcaption className="muted small" style={{ marginTop: 8, textAlign: "center" }}>
        Instagram Story · 1080 x 1920
      </figcaption>
    </figure>
  );
}
