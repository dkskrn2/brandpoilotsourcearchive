import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CardSkeleton,
  InlineSpinner,
  ListSkeleton,
  LoadingOverlay,
  PageSkeleton
} from "../components/ui/LoadingState";

afterEach(cleanup);

describe("loading state components", () => {
  it("exposes an accessible busy status without exposing decorative blocks", () => {
    render(<PageSkeleton label="페이지를 불러오는 중입니다." />);

    const status = screen.getByRole("status", { name: "페이지를 불러오는 중입니다." });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveClass("skeleton-page");
  });

  it("renders stable list and card placeholder counts", () => {
    const { rerender } = render(<ListSkeleton rows={4} columns={3} label="목록 로딩" />);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(4);

    rerender(<CardSkeleton count={6} label="카드 로딩" />);
    expect(screen.getAllByTestId("skeleton-card")).toHaveLength(6);
  });

  it("provides overlay and inline spinner variants", () => {
    render(
      <>
        <LoadingOverlay label="새로고침 중" />
        <InlineSpinner label="저장 중" />
      </>
    );

    expect(screen.getByRole("status", { name: "새로고침 중" })).toBeVisible();
    expect(screen.getByLabelText("저장 중")).toBeVisible();
  });
});
