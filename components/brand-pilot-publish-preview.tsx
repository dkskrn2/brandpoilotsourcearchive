import type { BrandPilotPublishingDetail } from "@/lib/brand-pilot-admin";

type MediaItem = { url: string; mimeType: string | null };

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mediaFromValue(value: unknown): MediaItem[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => {
    if (typeof entry === "string") return [{ url: entry, mimeType: null }];
    const item = objectValue(entry);
    if (!item) return [];
    const url = stringValue(item.url) ?? stringValue(item.publicUrl) ?? stringValue(item.public_url);
    if (!url) return [];
    return [{ url, mimeType: stringValue(item.mimeType) ?? stringValue(item.mime_type) }];
  });
}

function mediaKind(item: MediaItem) {
  if (item.mimeType?.startsWith("video/")) return "video";
  if (item.mimeType?.startsWith("image/")) return "image";
  const pathname = item.url.split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov)$/.test(pathname)) return "video";
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(pathname)) return "image";
  return "unknown";
}

function collectMedia(item: BrandPilotPublishingDetail) {
  const output = item.output;
  const candidates = [
    ...mediaFromValue(output.cards),
    ...mediaFromValue(output.slides),
    ...mediaFromValue(output.images),
    ...mediaFromValue(output.media),
    ...mediaFromValue(output.assets),
    ...mediaFromValue(output.story),
    ...mediaFromValue(output.reel),
    ...mediaFromValue(output.post),
    ...mediaFromValue(output.cover),
    ...mediaFromValue(output.thumbnail),
    ...mediaFromValue(output.video),
    ...mediaFromValue(output.videoUrl),
    ...mediaFromValue(output.video_url),
  ];
  if (item.artifact) candidates.unshift({ url: item.artifact.publicUrl, mimeType: item.artifact.mimeType });
  return candidates.filter((media, index, all) => /^https?:\/\//.test(media.url) && all.findIndex((candidate) => candidate.url === media.url) === index);
}

function extractHtml(output: Record<string, unknown>) {
  for (const key of ["html", "contentHtml", "content_html", "bodyHtml", "body_html"]) {
    const value = stringValue(output[key]);
    if (value) return value;
  }
  return null;
}

export function BrandPilotPublishPreview({ item }: { item: BrandPilotPublishingDetail }) {
  const media = collectMedia(item);
  const html = extractHtml(item.output);
  const previewBody = item.previewBody ?? stringValue(item.output.body) ?? stringValue(item.output.caption) ?? stringValue(item.output.text);
  const hasPreview = media.length > 0 || html || previewBody;

  if (!hasPreview) {
    return <div className="brand-pilot-admin__preview-empty"><strong>표시할 결과물이 없습니다.</strong><p>콘텐츠 생성이 완료되면 이미지, 영상, HTML 또는 텍스트가 여기에 표시됩니다.</p></div>;
  }

  return <div className="brand-pilot-admin__preview">
    {media.length > 0 && <div className="brand-pilot-admin__preview-media">
      {media.map((entry) => mediaKind(entry) === "video"
        ? <video key={entry.url} src={entry.url} controls preload="metadata" />
        : mediaKind(entry) === "image"
          // Admin previews accept customer-owned artifact hosts that cannot be known at build time.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img key={entry.url} src={entry.url} alt={item.previewTitle ?? item.contentTitle} loading="lazy" />
          : null)}
    </div>}
    {html && <iframe className="brand-pilot-admin__preview-html" title={`${item.contentTitle} HTML 미리보기`} sandbox="" srcDoc={html} />}
    {previewBody && <article className="brand-pilot-admin__preview-text"><h3>{item.previewTitle ?? item.contentTitle}</h3><p>{previewBody}</p></article>}
  </div>;
}
