import type { ContentOutputJson } from "../../types";

export type PublishCardPreview =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string; posterUrl?: string | null }
  | { kind: "text"; text: string }
  | { kind: "document" }
  | { kind: "pending" }
  | { kind: "failed" };

interface PreviewSource {
  title: string;
  previewImageUrl?: string | null;
  previewVideoUrl?: string | null;
  previewPosterUrl?: string | null;
  previewBody?: string | null;
  artifactPublicUrl?: string | null;
  outputJson?: ContentOutputJson | Record<string, unknown>;
  pending?: boolean;
  failed?: boolean;
}

function assetUrl(value: unknown) {
  if (!value || typeof value !== "object" || !("url" in value)) return null;
  return typeof value.url === "string" ? value.url : null;
}

export function resolvePublishPreview(source: PreviewSource): PublishCardPreview {
  if (source.failed) return { kind: "failed" };
  if (source.pending) return { kind: "pending" };
  if (source.previewVideoUrl) {
    return {
      kind: "video",
      url: source.previewVideoUrl,
      posterUrl: source.previewPosterUrl
    };
  }
  if (source.previewImageUrl) return { kind: "image", url: source.previewImageUrl };

  const outputJson = source.outputJson ?? {};
  const video = assetUrl(outputJson.video);
  if (video) {
    return {
      kind: "video",
      url: video,
      posterUrl: assetUrl(outputJson.cover)
    };
  }

  const cards = Array.isArray(outputJson.cards) ? outputJson.cards : [];
  const scenes = Array.isArray(outputJson.scenes) ? outputJson.scenes : [];
  const image = assetUrl(cards[0])
    ?? assetUrl(outputJson.story)
    ?? assetUrl(outputJson.cover)
    ?? assetUrl(scenes[0]);

  if (image) return { kind: "image", url: image };
  if (source.previewBody?.trim()) return { kind: "text", text: source.previewBody.trim() };
  if (typeof outputJson.html === "string" || outputJson.deliveryFormat === "html" || source.artifactPublicUrl) {
    return { kind: "document" };
  }
  return { kind: "pending" };
}

export function PublishManagementPreview({
  title,
  preview
}: {
  title: string;
  preview: PublishCardPreview;
}) {
  if (preview.kind === "image") {
    return <img className="publish-card__media-object" src={preview.url} alt={`${title} 미리보기`} />;
  }
  if (preview.kind === "video") {
    return (
      <video
        className="publish-card__media-object"
        src={preview.url}
        poster={preview.posterUrl ?? undefined}
        aria-label={`${title} 미리보기`}
        muted
        preload="metadata"
      />
    );
  }
  if (preview.kind === "text") {
    return <p className="publish-card__text-preview">{preview.text}</p>;
  }
  if (preview.kind === "document") {
    return <div className="publish-card__placeholder">문서 콘텐츠</div>;
  }
  if (preview.kind === "failed") {
    return <div className="publish-card__placeholder is-failed">콘텐츠 생성 실패</div>;
  }
  return <div className="publish-card__placeholder">콘텐츠 생성 전</div>;
}
