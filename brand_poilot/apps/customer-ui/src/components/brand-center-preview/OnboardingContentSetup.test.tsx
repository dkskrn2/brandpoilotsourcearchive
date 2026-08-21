import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentSuggestionGateway } from "../../features/content-suggestions/contentSuggestionGateway";
import { OnboardingContentSetup } from "./OnboardingContentSetup";

const suggestion = {
  id: "11111111-1111-4111-8111-111111111111",
  subcategoryCode: "brand-ops",
  subcategoryName: "브랜드 운영",
  intent: "informational" as const,
  title: "브랜드 톤을 정리하는 세 가지 기준",
  whyNow: "일관된 운영이 중요해졌습니다.",
  contentBrief: "세 가지 기준을 설명합니다.",
  sources: [{
    url: "https://source.example/report",
    title: "브랜드 운영 보고서",
    publisher: "Example",
    publishedAt: null,
  }],
};

describe("OnboardingContentSetup", () => {
  it("selects category, subcategory, today's topic and sends the optional prompt", async () => {
    const suggestionGateway: ContentSuggestionGateway = {
      list: vi.fn(),
      get: vi.fn(),
      listForSelection: vi.fn(async () => ({
        category: { code: "software", name: "소프트웨어" },
        personal: [suggestion],
        general: [],
      })),
    };
    const onStart = vi.fn(async () => undefined);
    render(<OnboardingContentSetup
      brandId="brand-1"
      categories={[{
        code: "software",
        name: "소프트웨어",
        recommendedHashtags: [],
        subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
      }]}
      suggestionGateway={suggestionGateway}
      starting={false}
      onStart={onStart}
    />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "분야" }), "software");
    await user.click(screen.getByRole("checkbox", { name: "브랜드 운영" }));
    expect(await screen.findByText(suggestion.title)).toBeVisible();
    expect(suggestionGateway.listForSelection).toHaveBeenCalledWith(
      "brand-1", "software", ["brand-ops"], expect.any(AbortSignal),
    );
    await user.click(screen.getByRole("button", { name: "AI 콘텐츠로 만들기" }));
    expect(screen.getByRole("link", { name: "브랜드 운영 보고서" }))
      .toHaveAttribute("href", "https://source.example/report");
    await user.type(screen.getByRole("textbox", { name: "콘텐츠 지시 (선택)" }), "초보자 관점으로 써줘");
    await user.click(screen.getByRole("button", { name: "카드뉴스 만들기" }));

    expect(onStart).toHaveBeenCalledWith({
      categoryCode: "software",
      subcategoryCodes: ["brand-ops"],
      suggestionId: suggestion.id,
      contentInstruction: "초보자 관점으로 써줘",
    });
  });

  it("limits detailed-field selection to five items and shows the count", async () => {
    const suggestionGateway: ContentSuggestionGateway = {
      list: vi.fn(),
      get: vi.fn(),
      listForSelection: vi.fn(async () => ({
        category: { code: "software", name: "소프트웨어" },
        personal: [],
        general: [],
      })),
    };
    render(<OnboardingContentSetup
      brandId="brand-1"
      categories={[{
        code: "software",
        name: "소프트웨어",
        recommendedHashtags: [],
        subcategories: Array.from({ length: 6 }, (_, index) => ({
          code: `detail-${index + 1}`,
          name: `세부분야 ${index + 1}`,
        })),
      }]}
      suggestionGateway={suggestionGateway}
      starting={false}
      onStart={vi.fn()}
    />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "분야" }), "software");
    for (let index = 1; index <= 5; index += 1) {
      await user.click(screen.getByRole("checkbox", { name: `세부분야 ${index}` }));
    }

    expect(screen.getByText("선택 5/5")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "세부분야 6" })).toBeDisabled();
  });

  it("clears a selected topic as soon as its detailed field is removed", async () => {
    const suggestionGateway: ContentSuggestionGateway = {
      list: vi.fn(),
      get: vi.fn(),
      listForSelection: vi.fn()
        .mockResolvedValueOnce({
          category: { code: "software", name: "소프트웨어" },
          personal: [suggestion],
          general: [],
        })
        .mockImplementation(() => new Promise(() => undefined)),
    };
    render(<OnboardingContentSetup
      brandId="brand-1"
      categories={[{
        code: "software",
        name: "소프트웨어",
        recommendedHashtags: [],
        subcategories: [
          { code: "brand-ops", name: "브랜드 운영" },
          { code: "automation", name: "자동화" },
        ],
      }]}
      suggestionGateway={suggestionGateway}
      starting={false}
      onStart={vi.fn()}
    />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByRole("combobox", { name: "분야" }), "software");
    await user.click(screen.getByRole("checkbox", { name: "브랜드 운영" }));
    await user.click(await screen.findByRole("button", { name: "AI 콘텐츠로 만들기" }));
    expect(screen.getByRole("button", { name: "카드뉴스 만들기" })).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "자동화" }));
    await user.click(screen.getByRole("checkbox", { name: "브랜드 운영" }));

    expect(screen.queryByRole("button", { name: "카드뉴스 만들기" })).not.toBeInTheDocument();
  });
});
