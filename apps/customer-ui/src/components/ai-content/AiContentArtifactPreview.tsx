import type { MouseEvent, SyntheticEvent } from "react";
import type { AiContentType, AiGenerationOutput } from "../../features/ai-content/types";
import { ArtifactCarousel } from "./ArtifactCarousel";

interface Props {
  type: AiContentType;
  output: AiGenerationOutput;
}

function preventContextMenu(event: MouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

function resizeBlogFrame(event: SyntheticEvent<HTMLIFrameElement>) {
  const frame = event.currentTarget;
  const resize = () => {
    const document = frame.contentDocument;
    const height = document?.documentElement.scrollHeight;
    if (height) frame.style.height = `${Math.max(600, height)}px`;
  };
  resize();
  frame.contentDocument?.querySelectorAll("img").forEach((image) => {
    if (!image.complete) image.addEventListener("load", resize, { once: true });
  });
}

export function AiContentArtifactPreview({ type, output }: Props) {
  const artifact = output.artifact;
  if (!artifact) {
    return <p className="ai-generation-output-list__empty">{output.status === "failed" ? "생성된 결과가 없습니다." : "결과를 생성하고 있습니다."}</p>;
  }

  if (type === "card_news") {
    return <div className="ai-content-artifact ai-content-artifact--gallery" onContextMenu={preventContextMenu}>
      <ArtifactCarousel assets={artifact.assets} />
      {artifact.text ? <div className="ai-content-artifact__copy">{artifact.text}</div> : null}
    </div>;
  }

  if (type === "blog") {
    const cover = artifact.assets.find((asset) => asset.fileName === "cover.png")
      ?? artifact.assets.find((asset) => asset.mimeType?.startsWith("image/") && asset.width === 1200 && asset.height === 630);
    return <div className="ai-content-artifact ai-content-artifact--blog" onContextMenu={preventContextMenu}>
      {cover ? <img className="ai-content-artifact__blog-cover" src={cover.url} alt="블로그 대표 이미지" draggable={false} /> : null}
      {artifact.html ? <iframe title="블로그 미리보기" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={artifact.html} onLoad={resizeBlogFrame} /> : <p>HTML 미리보기를 불러올 수 없습니다.</p>}
    </div>;
  }

  return <div className="ai-content-artifact ai-content-artifact--marketing" onContextMenu={preventContextMenu}>
    {artifact.assets.map((asset, index) => <img key={`${asset.url}-${index}`} src={asset.url} alt={`마케팅 소재 ${index + 1}`} draggable={false} />)}
    {artifact.text ? <div className="ai-content-artifact__copy">{artifact.text}</div> : null}
  </div>;
}
