import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AiGenerationOutput } from "../../features/ai-content/types";
import { AiContentArtifactPreview } from "./AiContentArtifactPreview";

function output(kind: "image_gallery" | "html" | "image", count = 1): AiGenerationOutput {
  return {
    id: "output-1",
    generationId: "generation-1",
    title: "결과",
    status: "completed",
    failureReason: null,
    downloadedAt: null,
    artifact: {
      queueId: "output-1",
      kind,
      deliveryFormat: null,
      assets: Array.from({ length: count }, (_, index) => ({ url: `https://cdn.test/${index + 1}.png`, fileName: `${index + 1}.png`, mimeType: "image/png", width: 1080, height: 1080 })),
      posterUrl: null,
      html: kind === "html" ? "<article><h1>실제 블로그</h1></article>" : null,
      text: kind === "image" ? "첫 문장\n\n행동 유도" : null,
    },
  };
}

describe("AiContentArtifactPreview", () => {
  it("shows card-news slides one at a time without cropping", async () => {
    const user = userEvent.setup();
    render(<AiContentArtifactPreview type="card_news" output={output("image_gallery", 3)} />);
    expect(screen.getAllByRole("img", { name: /카드뉴스 슬라이드/ })).toHaveLength(1);
    expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 1" })).toHaveAttribute("src", "https://cdn.test/1.png");
    expect(screen.getByText("1 / 3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "다음 이미지" }));
    expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 2" })).toHaveAttribute("src", "https://cdn.test/2.png");
  });

  it("renders blog HTML in a script-disabled sandbox", () => {
    const blogOutput = output("html");
    blogOutput.artifact!.assets = [
      { url: "https://cdn.test/cover.png", fileName: "cover.png", mimeType: "image/png", width: 1200, height: 630 },
      { url: "https://cdn.test/inline-01.png", fileName: "inline-01.png", mimeType: "image/png", width: 1200, height: 800 },
      { url: "https://cdn.test/article.html", fileName: "article.html", mimeType: "text/html", width: null, height: null }
    ];
    render(<AiContentArtifactPreview type="blog" output={blogOutput} />);
    const frame = screen.getByTitle("블로그 미리보기");
    expect(frame).toHaveAttribute("sandbox", "allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
    expect(screen.getByRole("img", { name: "블로그 대표 이미지" })).toHaveAttribute("src", "https://cdn.test/cover.png");
    expect(screen.queryByRole("img", { name: /inline/ })).not.toBeInTheDocument();
  });

  it("renders marketing copy with its image", () => {
    render(<AiContentArtifactPreview type="marketing" output={output("image")} />);
    expect(screen.getByRole("img", { name: "마케팅 소재 1" })).toBeVisible();
    expect(screen.getByText(/첫 문장/)).toBeVisible();
  });
});
