import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublishManagementPreview, resolvePublishPreview } from "./PublishManagementPreview";

afterEach(cleanup);

describe("PublishManagementPreview", () => {
  it("prefers a card image from the existing output JSON", () => {
    const preview = resolvePublishPreview({
      title: "정방형 카드뉴스",
      outputJson: {
        cards: [{ url: "https://cdn.example/card.png", width: 1080, height: 1080 }]
      }
    });

    render(<PublishManagementPreview title="정방형 카드뉴스" preview={preview} />);

    expect(screen.getByRole("img", { name: "정방형 카드뉴스 미리보기" })).toHaveAttribute(
      "src",
      "https://cdn.example/card.png"
    );
  });

  it("renders video with a poster when both are available", () => {
    render(
      <PublishManagementPreview
        title="릴스"
        preview={{ kind: "video", url: "reel.mp4", posterUrl: "poster.jpg" }}
      />
    );

    expect(screen.getByLabelText("릴스 미리보기")).toHaveAttribute("poster", "poster.jpg");
  });

  it("shows text and pending fallbacks without requesting an artifact", () => {
    const { rerender } = render(
      <PublishManagementPreview title="Threads" preview={{ kind: "text", text: "짧은 본문" }} />
    );
    expect(screen.getByText("짧은 본문")).toBeVisible();

    rerender(<PublishManagementPreview title="생성 대기" preview={{ kind: "pending" }} />);
    expect(screen.getByText("콘텐츠 생성 전")).toBeVisible();
  });

  it("shows no-preview for completed content without a usable artifact", () => {
    const preview = resolvePublishPreview({ title: "생성 완료", contentStatus: "completed" });

    render(<PublishManagementPreview title="생성 완료" preview={preview} />);

    expect(screen.getByText("미리보기 없음")).toBeVisible();
    expect(screen.queryByText("콘텐츠 생성 전")).not.toBeInTheDocument();
  });

  it("reserves the pre-generation label for content that has not started", () => {
    const pending = resolvePublishPreview({ title: "생성 전", contentStatus: "pre_generation" });
    const generating = resolvePublishPreview({ title: "생성 중", contentStatus: "generating" });
    const { rerender } = render(<PublishManagementPreview title="생성 전" preview={pending} />);

    expect(screen.getByText("콘텐츠 생성 전")).toBeVisible();
    rerender(<PublishManagementPreview title="생성 중" preview={generating} />);
    expect(screen.getByText("콘텐츠 생성 중")).toBeVisible();
    expect(screen.queryByText("콘텐츠 생성 전")).not.toBeInTheDocument();
  });
});
