import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContentSuggestionList } from "../../features/content-suggestions/contentSuggestionGateway";
import type { ProductServiceItem } from "../../features/libraries/libraryGateway";
import { ContentSubjectStep } from "./ContentSubjectStep";

const approvedProduct: ProductServiceItem = {
  id: "product-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  kind: "product",
  displayName: "승인 세럼",
  status: "active",
  activeVersionId: "product-version-1",
  activeVersion: {
    id: "product-version-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    productServiceId: "product-1",
    sourceAnalysisId: null,
    version: 1,
    status: "approved",
    profile: {
      contractVersion: "product-service.v1",
      name: "승인 세럼",
      kind: "product",
      description: "민감 피부용",
      features: [],
      benefits: [],
      cautions: [],
      audiences: [],
      appealsByTarget: {},
      evergreenPurchaseInfo: "",
      sourceUrls: [],
    },
    evidence: [],
    approvedAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  },
  draft: null,
};

const suggestions: ContentSuggestionList = {
  category: { code: "beauty", name: "뷰티" },
  personal: [{
    id: "suggestion-personal",
    subcategoryCode: "skin-care",
    subcategoryName: "스킨케어",
    intent: "informational",
    title: "피부 장벽을 지키는 세안 순서",
    whyNow: "환절기 피부 고민이 늘고 있습니다.",
    contentBrief: "초보자용 체크리스트로 구성합니다.",
  }],
  general: [{
    id: "suggestion-general",
    subcategoryCode: "makeup",
    subcategoryName: "메이크업",
    intent: "trend",
    title: "올여름 베이스 메이크업 변화",
    whyNow: "가벼운 표현이 주목받고 있습니다.",
    contentBrief: "최근 변화를 세 가지로 정리합니다.",
  }],
};

const baseProps = {
  mode: "topic_text" as const,
  topicText: "피부 관리",
  topicUrl: "",
  contentInstruction: "",
  products: [
    approvedProduct,
    { ...approvedProduct, id: "archived", displayName: "보관 제품", status: "archived" as const },
    {
      ...approvedProduct,
      id: "draft",
      displayName: "미승인 제품",
      activeVersion: approvedProduct.activeVersion
        ? { ...approvedProduct.activeVersion, status: "draft" as const }
        : null,
    },
  ],
  selectedProductId: null,
  referenceValid: false,
  loading: false,
  onModeChange: vi.fn(),
  onTopicTextChange: vi.fn(),
  onTopicUrlChange: vi.fn(),
  onContentInstructionChange: vi.fn(),
  onProductChange: vi.fn(),
  onComplete: vi.fn(),
};

describe("ContentSubjectStep", () => {
  it("shows no product or Wiki controls for informational content", () => {
    render(<ContentSubjectStep {...baseProps} purpose="informational" referencePicker={<p>레퍼런스 목록</p>} />);

    expect(screen.queryByRole("combobox", { name: "제품·서비스" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Wiki/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("콘텐츠 주제")).toHaveValue("피부 관리");
    expect(screen.getByLabelText("콘텐츠 지시 (선택)")).toBeInTheDocument();
  });

  it("requires one approved active product for marketing content", async () => {
    const user = userEvent.setup();
    const onProductChange = vi.fn();
    render(<ContentSubjectStep
      {...baseProps}
      purpose="marketing"
      onProductChange={onProductChange}
      referencePicker={<p>레퍼런스 목록</p>}
    />);

    const productSelect = screen.getByRole("combobox", { name: "제품·서비스" });
    expect(productSelect).toBeRequired();
    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "승인 세럼" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "보관 제품" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "미승인 제품" })).not.toBeInTheDocument();

    await user.selectOptions(productSelect, "product-1");
    expect(onProductChange).toHaveBeenCalledWith("product-1");
  });

  it("does not accept a stale product ID that is outside the approved active options", () => {
    render(<ContentSubjectStep
      {...baseProps}
      purpose="marketing"
      selectedProductId="stale-product"
      referencePicker={<p>레퍼런스 목록</p>}
    />);

    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
  });

  it("does not complete the URL material step with a malformed URL", () => {
    render(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      mode="topic_url"
      topicUrl="not-a-url"
      referencePicker={<p>레퍼런스 목록</p>}
    />);

    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
  });

  it("does not complete a suggestion with only a stale ID and no topic", () => {
    render(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      mode="suggestion"
      topicText="   "
      selectedSuggestionId="stale-suggestion"
      referencePicker={<p>레퍼런스 목록</p>}
    />);

    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
  });

  it("keeps entry modes mutually exclusive and opens today's suggestions", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const { rerender } = render(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      onModeChange={onModeChange}
      referencePicker={<p>인기 레퍼런스</p>}
    />);

    expect(screen.getByRole("button", { name: "오늘의 주제" })).toBeEnabled();
    expect(screen.getByLabelText("콘텐츠 주제")).toBeVisible();
    expect(screen.queryByLabelText("주제 URL")).not.toBeInTheDocument();
    expect(screen.queryByText("인기 레퍼런스")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "URL" }));
    expect(onModeChange).toHaveBeenCalledWith("topic_url");

    await user.click(screen.getByRole("button", { name: "오늘의 주제" }));
    expect(onModeChange).toHaveBeenCalledWith("suggestion");

    rerender(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      mode="reference"
      referenceValid
      onModeChange={onModeChange}
      referencePicker={<p>인기 레퍼런스</p>}
    />);
    expect(screen.getByText("인기 레퍼런스")).toBeVisible();
    expect(screen.queryByLabelText("콘텐츠 주제")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("주제 URL")).not.toBeInTheDocument();
  });

  it("shows personal cards immediately and filters the general suggestions without date or source", async () => {
    const user = userEvent.setup();
    const onSuggestionSelect = vi.fn();
    render(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      mode="suggestion"
      suggestions={suggestions}
      selectedSuggestionId={null}
      onSuggestionSelect={onSuggestionSelect}
      referencePicker={<p>레퍼런스 목록</p>}
    />);

    expect(screen.getByText("피부 장벽을 지키는 세안 순서")).toBeVisible();
    expect(screen.queryByText(/내 세부분야 추천/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 주제" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "주제 유형" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "세부분야" })).toBeVisible();
    expect(screen.queryByText(/출처/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d{4}[.-]\d{1,2}[.-]\d{1,2}/)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "AI 콘텐츠로 만들기" })[0]!);
    expect(onSuggestionSelect).toHaveBeenCalledWith(suggestions.personal[0]);
  });
});
