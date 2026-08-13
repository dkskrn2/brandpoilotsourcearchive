import type { MouseEvent } from "react";
import type { AiGenerationOutput } from "../../features/ai-content/types";
import { ArtifactCarousel } from "./ArtifactCarousel";

interface Props {
  output: AiGenerationOutput;
}

function preventContextMenu(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

function securedBlogDocument(html: string) {
  const document = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("script,style,form,iframe,link,source,svg,noscript,object,embed,video,audio,meta,base").forEach((element) => element.remove());
  document.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const allowedUrl = (name === "src" && element.tagName.toLowerCase() === "img")
        || (name === "href" && element.tagName.toLowerCase() === "a");
      if (name.startsWith("on") || ["style", "srcdoc", "srcset", "poster", "background", "data", "ping", "formaction", "action"].includes(name)) {
        element.removeAttribute(attribute.name);
      } else if ((name === "src" || name === "href") && !allowedUrl) {
        element.removeAttribute(attribute.name);
      } else if (allowedUrl) {
        try {
          if (new URL(attribute.value).protocol !== "https:") element.removeAttribute(attribute.name);
        } catch {
          element.removeAttribute(attribute.name);
        }
      }
    }
  });
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; base-uri 'none'; form-action 'none'; frame-src 'none'">`;
  return `<!doctype html><html><head>${csp}</head><body>${document.body.innerHTML}</body></html>`;
}

export function AiContentArtifactPreview({ output }: Props) {
  const artifact = output.artifact;
  if (!artifact) {
    return <p className="ai-generation-output-list__empty">{output.status === "failed" ? "생성된 결과가 없습니다." : "결과를 생성하고 있습니다."}</p>;
  }

  if (output.outputFormat === "card_news") {
    return <div className="ai-content-artifact ai-content-artifact--gallery" onContextMenu={preventContextMenu}>
      <ArtifactCarousel assets={artifact.assets} />
      {artifact.text ? <div className="ai-content-artifact__copy">{artifact.text}</div> : null}
    </div>;
  }

  if (output.outputFormat === "blog") {
    const cover = artifact.assets.find((asset) => asset.fileName === "cover.png")
      ?? artifact.assets.find((asset) => asset.mimeType?.startsWith("image/") && asset.width === 1200 && asset.height === 630);
    return <div className="ai-content-artifact ai-content-artifact--blog" onContextMenu={preventContextMenu}>
      {cover ? <img className="ai-content-artifact__blog-cover" src={cover.url} alt="블로그 대표 이미지" draggable={false} /> : null}
      {artifact.html ? <iframe title="블로그 미리보기" sandbox="" referrerPolicy="no-referrer" srcDoc={securedBlogDocument(artifact.html)} /> : <p>HTML 미리보기를 불러올 수 없습니다.</p>}
    </div>;
  }

  if (output.outputFormat === "reel") {
    const video = artifact.assets.find((asset) => asset.mimeType === "video/mp4");
    return <div className="ai-content-artifact ai-content-artifact--reel ai-content-artifact--reel-frame" onContextMenu={preventContextMenu}>
      {video ? <video className="ai-content-artifact__reel-video" src={video.url} poster={artifact.posterUrl ?? undefined} controls muted playsInline preload="metadata">릴스 미리보기를 지원하지 않는 브라우저입니다.</video> : <p>동영상 미리보기를 불러올 수 없습니다.</p>}
    </div>;
  }

  return null;
}
