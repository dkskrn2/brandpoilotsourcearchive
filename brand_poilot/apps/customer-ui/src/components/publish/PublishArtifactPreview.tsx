import { useEffect, useState, type MouseEvent } from "react";
import type { PublishArtifact, PublishArtifactAsset } from "../../types";

function assetLabel(asset: PublishArtifactAsset, index: number) {
  return asset.fileName?.trim() || `게시 결과 파일 ${index + 1}`;
}

function EmptyPreview() {
  return <p className="publish-artifact-preview__empty">미리보기를 불러올 수 없습니다.</p>;
}

function FailedAssetNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return <div className="publish-artifact-preview__missing" role="status">{count}개 파일을 표시하지 못했습니다.</div>;
}

function useAvailableAssets(artifact: PublishArtifact) {
  const [failedUrls, setFailedUrls] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setFailedUrls(new Set());
  }, [artifact.queueId]);

  return {
    assets: artifact.assets.filter((asset) => !failedUrls.has(asset.url)),
    failedCount: failedUrls.size,
    markFailed(asset: PublishArtifactAsset) {
      setFailedUrls((current) => {
        if (current.has(asset.url)) return current;
        const next = new Set(current);
        next.add(asset.url);
        return next;
      });
    }
  };
}

function AttachmentList({ assets }: { assets: PublishArtifactAsset[] }) {
  if (assets.length === 0) return null;

  return (
    <div className="publish-artifact-preview__attachments">
      <p>첨부 파일은 저장 시 함께 포함됩니다.</p>
      <ul className="publish-artifact-preview__files" aria-label="게시 결과 파일">
        {assets.map((asset, index) => (
          <li key={`${asset.url}-${index}`}>{assetLabel(asset, index)}</li>
        ))}
      </ul>
    </div>
  );
}

function GalleryPreview({ artifact }: { artifact: PublishArtifact }) {
  const { assets, failedCount, markFailed } = useAvailableAssets(artifact);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(artifact.assets[0]?.url ?? null);
  const selectedAsset = assets.find((asset) => asset.url === selectedUrl) ?? assets[0];

  useEffect(() => {
    setSelectedUrl(artifact.assets[0]?.url ?? null);
  }, [artifact.queueId]);

  return (
    <div className="publish-artifact-preview__gallery">
      <div className="publish-artifact-preview__primary publish-artifact-preview__scroll">
        {selectedAsset ? (
          <img
            data-testid="artifact-primary-image"
            src={selectedAsset.url}
            alt={assetLabel(selectedAsset, artifact.assets.indexOf(selectedAsset))}
            draggable={false}
            onError={() => markFailed(selectedAsset)}
          />
        ) : <EmptyPreview />}
      </div>
      <div className="publish-artifact-preview__gallery-meta">
        <span>{assets.length}개 이미지</span>
        <FailedAssetNotice count={failedCount} />
      </div>
      <div className="publish-artifact-preview__thumbnails" aria-label="이미지 미리보기 목록">
        {assets.map((asset, index) => (
          <button
            className={`publish-artifact-preview__thumbnail${asset.url === selectedAsset?.url ? " is-selected" : ""}`}
            type="button"
            key={`${asset.url}-${index}`}
            aria-label={`미리보기 ${index + 1} 선택`}
            aria-pressed={asset.url === selectedAsset?.url}
            onClick={() => setSelectedUrl(asset.url)}
          >
            <img src={asset.url} alt="" draggable={false} onError={() => markFailed(asset)} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ImagePreview({ artifact }: { artifact: PublishArtifact }) {
  const { assets, failedCount, markFailed } = useAvailableAssets(artifact);
  const image = assets[0];

  return (
    <div className="publish-artifact-preview__image publish-artifact-preview__scroll">
      {image ? (
        <img
          src={image.url}
          alt={assetLabel(image, artifact.assets.indexOf(image))}
          draggable={false}
          onError={() => markFailed(image)}
        />
      ) : <EmptyPreview />}
      <FailedAssetNotice count={failedCount} />
    </div>
  );
}

function VideoPreview({ artifact }: { artifact: PublishArtifact }) {
  const video = artifact.assets[0];
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    setVideoFailed(false);
    setPosterFailed(false);
  }, [artifact.queueId]);

  if (!video) return <EmptyPreview />;

  return (
    <div className="publish-artifact-preview__video publish-artifact-preview__scroll">
      {videoFailed ? (
        <div className="publish-artifact-preview__video-fallback">
          {artifact.posterUrl && !posterFailed ? (
            <img
              src={artifact.posterUrl}
              alt="동영상 포스터"
              draggable={false}
              onError={() => setPosterFailed(true)}
            />
          ) : null}
          <strong>동영상을 재생할 수 없습니다. 결과 파일을 저장해 확인하세요.</strong>
          <FailedAssetNotice count={1} />
        </div>
      ) : (
        <video
          src={video.url}
          poster={artifact.posterUrl ?? undefined}
          controls
          controlsList="nodownload"
          disablePictureInPicture
          preload="metadata"
          onError={() => setVideoFailed(true)}
        >
          동영상 미리보기를 지원하지 않는 브라우저입니다.
        </video>
      )}
    </div>
  );
}

function securedHtmlDocument(html: string) {
  const securityHead = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${securityHead}`);
  return `<!doctype html><html><head>${securityHead}</head><body>${html}</body></html>`;
}

function HtmlPreview({ artifact }: { artifact: PublishArtifact }) {
  if (!artifact.html) {
    return (
      <div className="publish-artifact-preview__fallback">
        <EmptyPreview />
        <AttachmentList assets={artifact.assets} />
      </div>
    );
  }

  return (
    <div className="publish-artifact-preview__html publish-artifact-preview__scroll">
      <iframe
        title="HTML 게시 결과 미리보기"
        sandbox=""
        srcDoc={securedHtmlDocument(artifact.html)}
      />
    </div>
  );
}

function TextPreview({ artifact }: { artifact: PublishArtifact }) {
  if (!artifact.text) return <EmptyPreview />;

  return (
    <div
      className="publish-artifact-preview__text publish-artifact-preview__scroll"
      data-testid="artifact-text-scroll"
    >
      <div className="publish-artifact-preview__text-content">{artifact.text}</div>
      <AttachmentList assets={artifact.assets} />
    </div>
  );
}

function UnknownPreview({ artifact }: { artifact: PublishArtifact }) {
  return (
    <div className="publish-artifact-preview__fallback publish-artifact-preview__scroll">
      <strong>미리보기를 지원하지 않는 형식입니다.</strong>
      {artifact.text ? <p>{artifact.text}</p> : null}
      <AttachmentList assets={artifact.assets} />
    </div>
  );
}

export function PublishArtifactPreview({ artifact }: { artifact: PublishArtifact }) {
  function preventContextMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
  }

  let preview;
  switch (artifact.kind) {
    case "image_gallery":
      preview = <GalleryPreview artifact={artifact} />;
      break;
    case "image":
      preview = <ImagePreview artifact={artifact} />;
      break;
    case "video":
      preview = <VideoPreview artifact={artifact} />;
      break;
    case "html":
      preview = <HtmlPreview artifact={artifact} />;
      break;
    case "text":
      preview = <TextPreview artifact={artifact} />;
      break;
    case "unknown":
      preview = <UnknownPreview artifact={artifact} />;
      break;
  }

  return (
    <div
      className={`publish-artifact-preview publish-artifact-preview--${artifact.kind}`}
      data-testid="publish-artifact-preview"
      onContextMenu={preventContextMenu}
    >
      {preview}
    </div>
  );
}
