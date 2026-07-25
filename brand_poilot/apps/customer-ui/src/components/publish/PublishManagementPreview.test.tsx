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
});
