import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AiContentPhaseProgress } from "./AiContentPhaseProgress";

afterEach(cleanup);

describe("AiContentPhaseProgress", () => {
  it("marks the current phase and keeps the progress display non-interactive", () => {
    render(<AiContentPhaseProgress current="generating" />);

    const progress = screen.getByRole("list", { name: "콘텐츠 생성 단계" });
    expect(within(progress).getByText("콘텐츠 생성").closest("li"))
      .toHaveAttribute("aria-current", "step");
    expect(within(progress).getByText("콘텐츠 설정").closest("li"))
      .toHaveAttribute("data-completed", "true");
    expect(within(progress).getByText("구성안·스타일").closest("li"))
      .toHaveAttribute("data-completed", "true");
    expect(within(progress).queryByRole("link")).not.toBeInTheDocument();
    expect(within(progress).queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the same four labels for every production route", () => {
    render(<AiContentPhaseProgress current="reviewing" />);

    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("콘텐츠 설정")).toBeInTheDocument();
    expect(screen.getByText("구성안·스타일")).toBeInTheDocument();
    expect(screen.getByText("콘텐츠 생성")).toBeInTheDocument();
    expect(screen.getByText("결과 확인")).toBeInTheDocument();
    expect(screen.getByText("목적·원문·형식")).toBeInTheDocument();
    expect(screen.getByText("방향·첨부 선택")).toBeInTheDocument();
    expect(screen.getByText("기획·이미지 제작")).toBeInTheDocument();
    expect(screen.getByText("검토·다운로드·게시")).toBeInTheDocument();
  });
});
