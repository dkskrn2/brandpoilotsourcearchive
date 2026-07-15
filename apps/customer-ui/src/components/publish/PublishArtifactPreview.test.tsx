import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublishArtifact, PublishArtifactAsset } from "../../types";
import { PublishArtifactPreview } from "./PublishArtifactPreview";

function asset(fileName: string, mimeType = "image/png"): PublishArtifactAsset {
  return {
    url: `https://cdn.test/${fileName}`,
    fileName,
    mimeType,
    width: 1080,
    height: 1080
  };
}

function artifact(overrides: Partial<PublishArtifact>): PublishArtifact {
  return {
    queueId: "queue-1",
    kind: "unknown",
    deliveryFormat: null,
    assets: [],
    posterUrl: null,
    html: null,
    text: null,
    ...overrides
  };
}

describe("PublishArtifactPreview", () => {
  it("renders every gallery asset as a thumbnail and changes the contained primary image", async () => {
    render(<PublishArtifactPreview artifact={artifact({
      kind: "image_gallery",
      assets: [asset("card-01.png"), asset("card-02.png"), asset("card-03.png")]
    })} />);

    const primaryImage = screen.getByTestId("artifact-primary-image");
    expect(primaryImage).toHaveAttribute("src", "https://cdn.test/card-01.png");
    expect(primaryImage).toHaveAttribute("draggable", "false");
    expect(screen.getAllByRole("button", { name: /미리보기 \d+ 선택/ })).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "미리보기 3 선택" }));

    expect(primaryImage).toHaveAttribute("src", "https://cdn.test/card-03.png");
    expect(screen.getByRole("button", { name: "미리보기 3 선택" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders a single non-draggable image without gallery controls", () => {
    render(<PublishArtifactPreview artifact={artifact({ kind: "image", assets: [asset("story.png")] })} />);

    expect(screen.getByRole("img", { name: "story.png" })).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: /미리보기 \d+ 선택/ })).not.toBeInTheDocument();
  });

  it("renders video controls while disabling download controls and picture-in-picture", () => {
    const { container } = render(<PublishArtifactPreview artifact={artifact({
      kind: "video",
      assets: [asset("result.mp4", "video/mp4")],
      posterUrl: "https://cdn.test/poster.jpg"
    })} />);

    const video = container.querySelector("video");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("controlsList", "nodownload");
    expect(video).toHaveAttribute("disablePictureInPicture");
    expect(video).toHaveAttribute("poster", "https://cdn.test/poster.jpg");
    expect(video).not.toHaveAttribute("autoplay");
  });

  it("replaces a failed video with a useful fallback and failed-file notice", () => {
    const { container } = render(<PublishArtifactPreview artifact={artifact({
      kind: "video",
      assets: [asset("result.mp4", "video/mp4")]
    })} />);

    fireEvent.error(container.querySelector("video") as HTMLVideoElement);

    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(screen.getByText("동영상을 재생할 수 없습니다. 결과 파일을 저장해 확인하세요.")).toBeVisible();
    expect(screen.getByText("1개 파일을 표시하지 못했습니다.")).toBeVisible();
  });

  it("renders HTML in a script-disabled sandbox and a scroll container", () => {
    const { container } = render(<PublishArtifactPreview artifact={artifact({
      kind: "html",
      html: "<main><h1>게시 결과</h1><script>window.bad = true</script></main>"
    })} />);

    const frame = screen.getByTitle("HTML 게시 결과 미리보기");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("<h1>게시 결과</h1>"));
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("default-src 'none'"));
    expect(container.querySelector(".publish-artifact-preview__scroll")).toContainElement(frame);
  });

  it("renders long text in a scroll container", () => {
    const longText = Array.from({ length: 100 }, (_, index) => `본문 ${index + 1}`).join("\n");
    render(<PublishArtifactPreview artifact={artifact({ kind: "text", text: longText })} />);

    expect(screen.getByTestId("artifact-text-scroll")).toHaveClass("publish-artifact-preview__scroll");
    expect(screen.getByText(/본문 100/)).toBeVisible();
  });

  it("shows non-clickable attachment names with text artifacts", () => {
    render(<PublishArtifactPreview artifact={artifact({
      kind: "text",
      text: "게시 본문",
      assets: [asset("source.txt", "text/plain")]
    })} />);

    expect(screen.getByText("게시 본문")).toBeVisible();
    expect(screen.getByText("source.txt")).toBeVisible();
    expect(screen.getByText("첨부 파일은 저장 시 함께 포함됩니다.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("removes failed gallery images, keeps available items, and reports the failed count", () => {
    render(<PublishArtifactPreview artifact={artifact({
      kind: "image_gallery",
      assets: [asset("card-01.png"), asset("card-02.png"), asset("card-03.png")]
    })} />);

    fireEvent.error(screen.getByTestId("artifact-primary-image"));

    expect(screen.getByTestId("artifact-primary-image")).toHaveAttribute("src", "https://cdn.test/card-02.png");
    expect(screen.getAllByRole("button", { name: /미리보기 \d+ 선택/ })).toHaveLength(2);
    expect(screen.getByText("2개 이미지")).toBeVisible();
    expect(screen.getByText("1개 파일을 표시하지 못했습니다.")).toBeVisible();
  });

  it("hides failed single images and reports that no preview remains", () => {
    render(<PublishArtifactPreview artifact={artifact({ kind: "image", assets: [asset("broken.png")] })} />);

    fireEvent.error(screen.getByRole("img", { name: "broken.png" }));

    expect(screen.queryByRole("img", { name: "broken.png" })).not.toBeInTheDocument();
    expect(screen.getByText("미리보기를 불러올 수 없습니다.")).toBeVisible();
    expect(screen.getByText("1개 파일을 표시하지 못했습니다.")).toBeVisible();
  });

  it("shows an unknown-kind fallback with non-clickable file names", () => {
    render(<PublishArtifactPreview artifact={artifact({
      kind: "unknown",
      text: "지원하지 않는 결과 본문",
      assets: [asset("result.bin", "application/octet-stream")]
    })} />);

    expect(screen.getByText("미리보기를 지원하지 않는 형식입니다.")).toBeVisible();
    expect(screen.getByText("지원하지 않는 결과 본문")).toBeVisible();
    expect(screen.getByText("result.bin")).toBeVisible();
    expect(screen.getByText("첨부 파일은 저장 시 함께 포함됩니다.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("https://cdn.test/result.bin")).not.toBeInTheDocument();
  });

  it("keeps HTML fallback attachments informative without exposing asset links", () => {
    render(<PublishArtifactPreview artifact={artifact({
      kind: "html",
      assets: [asset("result.html", "text/html")]
    })} />);

    expect(screen.getByText("미리보기를 불러올 수 없습니다.")).toBeVisible();
    expect(screen.getByText("result.html")).toBeVisible();
    expect(screen.getByText("첨부 파일은 저장 시 함께 포함됩니다.")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText("https://cdn.test/result.html")).not.toBeInTheDocument();
  });

  it("prevents the preview context menu", () => {
    render(<PublishArtifactPreview artifact={artifact({ kind: "image", assets: [asset("result.png")] })} />);
    const preview = screen.getByTestId("publish-artifact-preview");
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const preventDefault = vi.spyOn(contextMenu, "preventDefault");

    fireEvent(preview, contextMenu);

    expect(preventDefault).toHaveBeenCalled();
    expect(contextMenu.defaultPrevented).toBe(true);
  });

  it("shows a useful empty fallback when a known kind has no usable asset", () => {
    render(<PublishArtifactPreview artifact={artifact({ kind: "video" })} />);

    expect(screen.getByText("미리보기를 불러올 수 없습니다.")).toBeVisible();
  });
});
