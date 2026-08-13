import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentSuggestion } from "../../features/content-suggestions/contentSuggestionGateway";
import { ContentSuggestionCards } from "./ContentSuggestionCards";

const items: ContentSuggestion[] = [
  {
    id: "suggestion-1",
    subcategoryCode: "skin-care",
    subcategoryName: "스킨케어",
    intent: "informational",
    title: "피부 장벽을 지키는 세안 순서",
    whyNow: "환절기 피부 고민이 늘고 있습니다.",
    contentBrief: "초보자가 바로 따라 할 수 있는 체크리스트로 구성합니다.",
  },
  {
    id: "suggestion-2",
    subcategoryCode: "makeup",
    subcategoryName: "메이크업",
    intent: "trend",
    title: "올여름 베이스 메이크업 변화",
    whyNow: "가벼운 표현이 주목받고 있습니다.",
    contentBrief: "최근 변화를 세 가지 포인트로 설명합니다.",
  },
];

describe("ContentSuggestionCards", () => {
  it("shows intent, subcategory and topic without date, source, or a personal-count heading", () => {
    render(<ContentSuggestionCards items={items} onSelect={vi.fn()} />);

    expect(screen.getByText("정보성")).toBeInTheDocument();
    expect(screen.getByText("트렌드")).toBeInTheDocument();
    expect(screen.getByText("스킨케어")).toBeInTheDocument();
    expect(screen.getByText("피부 장벽을 지키는 세안 순서")).toBeInTheDocument();
    expect(screen.queryByText(/내 세부분야 추천/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d{4}[.-]\d{1,2}[.-]\d{1,2}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/출처/)).not.toBeInTheDocument();
  });

  it("uses a real primary button to start AI content creation", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ContentSuggestionCards items={[items[0]!]} onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "AI 콘텐츠로 만들기" });
    expect(button).toHaveClass("button", "primary");
    await user.click(button);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });
});
