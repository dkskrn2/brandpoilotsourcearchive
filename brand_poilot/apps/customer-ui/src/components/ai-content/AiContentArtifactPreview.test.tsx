import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AiGenerationOutput } from "../../features/ai-content/types";
import { AiContentArtifactPreview } from "./AiContentArtifactPreview";

function output(outputFormat: AiGenerationOutput["outputFormat"], kind: "image_gallery" | "html" | "video", count = 1): AiGenerationOutput {
  return {
    id: "output-1",
    generationId: "generation-1",
    title: "결과",
    status: "completed",
    manifestVersion: "ai-content.v3",
    outputFormat,
    failureReason: null,
    downloadedAt: null,
    artifact: {
      queueId: "output-1",
      kind,
      deliveryFormat: null,
      assets: Array.from({ length: count }, (_, index) => ({ url: `https://cdn.test/${index + 1}.png`, fileName: `${index + 1}.png`, mimeType: "image/png", width: 1080, height: 1080 })),
      posterUrl: null,
      html: kind === "html" ? "<article><h1>실제 블로그</h1></article>" : null,
      text: outputFormat === "card_news" ? "첫 문장\n\n행동 유도" : null,
    },
  };
}

describe("AiContentArtifactPreview", () => {
  it("shows card-news slides one at a time without cropping", async () => {
    const user = userEvent.setup();
    render(<AiContentArtifactPreview output={output("card_news", "image_gallery", 3)} />);
    expect(screen.getAllByRole("img", { name: /카드뉴스 슬라이드/ })).toHaveLength(1);
    expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 1" })).toHaveAttribute("src", "https://cdn.test/1.png");
    expect(screen.getByText("1 / 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음 이미지" }));
    expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 2" })).toHaveAttribute("src", "https://cdn.test/2.png");
  });

  it("renders blog HTML in a script-disabled sandbox", () => {
    const blogOutput = output("blog", "html");
    blogOutput.artifact!.assets = [
      { url: "https://cdn.test/cover.png", fileName: "cover.png", mimeType: "image/png", width: 1200, height: 630 },
      { url: "https://cdn.test/inline-01.png", fileName: "inline-01.png", mimeType: "image/png", width: 1200, height: 800 },
      { url: "https://cdn.test/article.html", fileName: "article.html", mimeType: "text/html", width: null, height: null }
    ];
    render(<AiContentArtifactPreview output={blogOutput} />);
    const frame = screen.getByTitle("블로그 미리보기");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(screen.getByRole("img", { name: "블로그 대표 이미지" })).toHaveAttribute("src", "https://cdn.test/cover.png");
    expect(screen.queryByRole("img", { name: /inline/ })).not.toBeInTheDocument();
  });

  it("renders a zero-image blog in a scriptless sanitized iframe", () => {
    const blog = output("blog", "html");
    blog.artifact!.assets = [];
    blog.artifact!.html = '<article onclick="alert(1)"><h1>안전한 블로그</h1><script>alert(1)</script></article>';
    render(<AiContentArtifactPreview output={blog} />);

    const frame = screen.getByTitle("블로그 미리보기");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("안전한 블로그");
    expect(frame.getAttribute("srcdoc")).not.toMatch(/<script|onclick=/i);
    expect(screen.queryByRole("img", { name: "블로그 대표 이미지" })).not.toBeInTheDocument();
  });

  it("plays the final reel MP4 muted with controls and the first scene as poster", () => {
    const reel = output("reel", "video", 0);
    reel.artifact!.assets = [
      { url: "https://cdn.test/scene-01.png", fileName: "scene-01.png", mimeType: "image/png", width: 1080, height: 1920 },
      { url: "https://cdn.test/reel.mp4", fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920 },
    ];
    reel.artifact!.posterUrl = "https://cdn.test/scene-01.png";
    const { container } = render(<AiContentArtifactPreview output={reel} />);

    const video = container.querySelector("video");
    expect(container.querySelector(".ai-content-artifact--reel-frame")).toContainElement(video);
    expect(video).toHaveClass("ai-content-artifact__reel-video");
    expect(video).toHaveAttribute("src", "https://cdn.test/reel.mp4");
    expect(video).toHaveAttribute("poster", "https://cdn.test/scene-01.png");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveProperty("muted", true);
    expect(video).toHaveAttribute("playsinline");
  });

  it("does not reinterpret a reel without its final MP4 as an image result", () => {
    const reel = output("reel", "video", 0);
    reel.artifact!.assets = [
      { url: "https://cdn.test/scene.png", fileName: "scene.png", mimeType: "image/png", width: 1080, height: 1920 },
    ];

    const { container } = render(<AiContentArtifactPreview output={reel} />);

    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(screen.getByText("동영상 미리보기를 불러올 수 없습니다.")).toBeVisible();
  });
});
