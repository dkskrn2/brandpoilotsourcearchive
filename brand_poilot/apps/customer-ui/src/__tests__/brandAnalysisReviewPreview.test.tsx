import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BrandAnalysisReviewPreviewPage } from "../pages/BrandAnalysisReviewPreviewPage";

describe("brand analysis review preview", () => {
  it("renders the complete ui-only review fixture", async () => {
    render(
      <MemoryRouter>
        <BrandAnalysisReviewPreviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "URL 입력하면 AI가 내 서비스를 분석해줘요" })).toBeVisible();
    expect(screen.getByRole("button", { name: "1. 자료 등록" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "2. AI 분석·수정" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "3. 완료" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("complementary", { name: "등록 자료" }))
      .toHaveTextContent("https://www.danbammsg.co.kr/");
    expect(screen.getByRole("heading", { name: "AI 분석 결과를 확인하고 수정하세요" })).toBeVisible();
    expect(screen.queryByText("LOCAL UI PREVIEW")).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("combobox", { name: "분석 결과 대표 분야" })).toHaveValue("marketing");

    await userEvent.click(screen.getByRole("tab", { name: "고객·니즈" }));
    expect(screen.getByRole("textbox", { name: "보조 타깃 1" })).toHaveValue("콘텐츠 운영팀");

    await userEvent.click(screen.getByRole("button", { name: "확인하고 저장" }));
    expect(screen.getByRole("status")).toHaveTextContent("미리보기에서 변경 내용을 확인했습니다.");
  });
});
