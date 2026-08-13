import { describe, expect, it, vi } from "vitest";
import { createContentSuggestionGateway } from "./contentSuggestionGateway";

const response = {
  category: { code: "beauty", name: "뷰티" },
  personal: [{
    id: "suggestion-1",
    subcategoryCode: "skin-care",
    subcategoryName: "스킨케어",
    intent: "trend" as const,
    title: "장벽 케어 루틴",
    whyNow: "환절기 검색량이 늘고 있습니다.",
    contentBrief: "민감 피부가 실천할 수 있는 순서로 정리합니다.",
  }],
  general: [],
};

describe("contentSuggestionGateway", () => {
  it("loads the current brand's suggestions with the customer session", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const gateway = createContentSuggestionGateway({ baseUrl: "https://api.example.test", fetcher });

    await expect(gateway.list("brand-1")).resolves.toEqual(response);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/brands/brand-1/content-suggestions",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("loads one suggestion for a deep link and forwards AbortSignal", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response.personal[0]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const gateway = createContentSuggestionGateway({ baseUrl: "https://api.example.test", fetcher });
    const controller = new AbortController();

    await expect(gateway.get("brand-1", "suggestion-1", controller.signal)).resolves.toEqual(response.personal[0]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/brands/brand-1/content-suggestions/suggestion-1",
      expect.objectContaining({ method: "GET", credentials: "include", signal: controller.signal }),
    );
  });
});
