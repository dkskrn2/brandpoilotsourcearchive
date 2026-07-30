import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublishArtifactAsset } from "../../types";
import { ArtifactCarousel } from "./ArtifactCarousel";

function asset(index: number, width = 1080, height = 1350): PublishArtifactAsset {
  return {
    url: `https://cdn.test/slide-${index}.png`,
    fileName: `slide-${index}.png`,
    mimeType: "image/png",
    width,
    height,
  };
}

describe("ArtifactCarousel", () => {
  it("moves one slide at a time and wraps in both directions", async () => {
    const user = userEvent.setup();
    const { container } = render(<ArtifactCarousel assets={[asset(1), asset(2), asset(3)]} />);

    expect(container.querySelectorAll(".artifact-carousel__slide img")).toHaveLength(3);
    expect(container.querySelector(".artifact-carousel__track")).toHaveStyle({ transform: "translateX(0%)" });
    expect(screen.getByText("1 / 3")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "이전 이미지" }));
    expect(container.querySelector(".artifact-carousel__track")).toHaveStyle({ transform: "translateX(-200%)" });
    expect(screen.getByText("3 / 3")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "다음 이미지" }));
    expect(container.querySelector(".artifact-carousel__track")).toHaveStyle({ transform: "translateX(0%)" });
  });

  it("resets to the first slide and applies its dimensions when assets change", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<ArtifactCarousel assets={[asset(1), asset(2)]} />);
    await user.click(screen.getByRole("button", { name: "다음 이미지" }));
    expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 2" })).toBeVisible();

    rerender(<ArtifactCarousel assets={[asset(4, 1080, 1920)]} />);

    await waitFor(() => expect(screen.getByRole("img", { name: "카드뉴스 슬라이드 1" })).toHaveAttribute("src", "https://cdn.test/slide-4.png"));
    expect(container.querySelector(".artifact-carousel__stage")).toHaveStyle({ aspectRatio: "1080 / 1920" });
    expect(screen.queryByRole("button", { name: "이전 이미지" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다음 이미지" })).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });
});
