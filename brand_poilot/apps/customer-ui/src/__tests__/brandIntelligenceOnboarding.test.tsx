import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BrandAnalysisReviewStep } from "../components/brand-intelligence/BrandAnalysisReviewStep";
import { BrandEvidenceInputStep } from "../components/brand-intelligence/BrandEvidenceInputStep";
import { resolveBrandAnalysisFileMimeType } from "../features/brand-intelligence/brandIntelligenceGateway";
import type { BrandIntelligenceResult } from "../features/brand-intelligence/types";
import type { ContentCategory } from "../types";

const initial: BrandIntelligenceResult = {
  contractVersion: "brand-intelligence-result.v1",
  companyOverview: "회사 개요",
  businessDescription: "사업 소개",
  primaryCategory: { code: "marketing", name: "마케팅" },
  subcategories: [{ code: null, name: "콘텐츠 운영" }],
  primaryTarget: "초기 고객",
  differentiators: "차별점",
  coreAppeal: "소구점",
  competitors: [{ name: "경쟁사", description: "비교 설명", sourceUrls: ["https://example.com"] }],
  evidence: [],
  sourceGaps: [],
};

const completeV2: BrandIntelligenceResult = {
  contractVersion: "brand-intelligence-result.v2",
  companyNameSuggestion: { name: "모종", sourceFactIds: ["fact-company"] },
  oneLineDefinition: "브랜드 운영을 연결하는 서비스",
  companyOverview: "회사 개요",
  businessDescription: "사업 소개",
  primaryCategory: { code: "marketing", name: "마케팅" },
  subcategories: [
    { code: "content", name: "콘텐츠 마케팅" },
    { code: null, name: "브랜드 운영" },
  ],
  primaryTarget: "브랜드 운영팀",
  secondaryTargets: ["소규모 마케팅팀", "콘텐츠 담당자"],
  customerNeeds: ["일관된 메시지", "빠른 검토"],
  valueProposition: "근거 기반 운영",
  differentiators: ["승인된 정보만 사용", "검토 이력 보존"],
  coreAppeal: "안전한 콘텐츠 운영",
  supportingAppeals: ["직접 수정", "승인 중심"],
  offerings: [{
    kind: "product",
    name: "Brand Pilot",
    description: "브랜드 운영 제품",
    target: "마케팅팀",
    benefit: "일관성",
    priceText: "문의",
    purchaseUrl: "https://example.com/buy",
    sourceFactIds: ["fact-offering"],
  }],
  faqSuggestions: [],
  keywords: ["브랜드", "콘텐츠"],
  observedTone: { summary: "명확하고 실용적", sourceFactIds: ["fact-tone"] },
  competitors: [{
    name: "경쟁사 A",
    description: "비교 설명",
    sourceUrls: ["https://example.com/evidence"],
  }],
  marketContext: [],
  evidence: [],
  sourceGaps: ["가격 근거 부족"],
};

const categories: ContentCategory[] = [{
  code: "marketing",
  name: "마케팅",
  recommendedHashtags: [],
  subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
}, {
  code: "commerce",
  name: "커머스",
  recommendedHashtags: [],
  subcategories: [{ code: "store", name: "온라인 스토어" }],
}];

describe("brand intelligence onboarding review", () => {
  it("infers supported MIME types when the browser omits them", () => {
    expect(resolveBrandAnalysisFileMimeType({ name: "brand.md", type: "" })).toBe("text/markdown");
    expect(resolveBrandAnalysisFileMimeType({ name: "products.csv", type: "" })).toBe("text/csv");
    expect(resolveBrandAnalysisFileMimeType({ name: "catalog.xlsx", type: "" })).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("keeps every narrative field editable before confirmation", async () => {
    const confirm = vi.fn(async () => undefined);
    function Harness() {
      const [draft, setDraft] = useState(initial);
      return <BrandAnalysisReviewStep draft={draft} saving={false} error={null} categories={categories} onChange={setDraft} onConfirm={confirm} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "고객·니즈" }));
    const target = screen.getByRole("textbox", { name: "핵심 타깃" });
    await user.clear(target);
    await user.type(target, "수정한 고객");
    expect(target).toHaveValue("수정한 고객");
    await user.click(screen.getByRole("button", { name: "확인하고 저장" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("expands long review text without an internal vertical scrollbar", async () => {
    const confirm = vi.fn(async () => undefined);
    function Harness() {
      const [draft, setDraft] = useState(initial);
      return <BrandAnalysisReviewStep draft={draft} saving={false} error={null} onChange={setDraft} onConfirm={confirm} />;
    }
    const { container } = render(<Harness />);
    const overview = screen.getByRole("textbox", { name: "기업 개요" });
    Object.defineProperty(overview, "scrollHeight", { configurable: true, value: 184 });

    fireEvent.input(overview, { target: { value: "길어진 기업 개요" } });

    expect(overview).toHaveClass("auto-resize-textarea");
    expect(overview).toHaveStyle({ height: "184px", overflowY: "hidden" });
    expect(container.querySelector(".brand-intelligence-review--wide")).toBeInTheDocument();
  });

  it("prefills the registered owned URL without starting analysis automatically", async () => {
    const submit = vi.fn(async () => undefined);
    render(<BrandEvidenceInputStep
      busy={false}
      error={null}
      initialOwnedUrl="https://brand.example.com"
      onSubmit={submit}
    />);

    expect(screen.getByRole("textbox", { name: /자사 URL/ })).toHaveValue("https://brand.example.com");
    expect(screen.getByText(/분석 결과를 확인하고 저장할 때 자사 URL에 반영됩니다/)).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    expect(submit).toHaveBeenCalledWith({
      ownedUrl: "https://brand.example.com",
      files: [],
    });
  });

  it("keeps only catalog categories and subcategories in the confirmed draft", async () => {
    const confirm = vi.fn(async (_draft: BrandIntelligenceResult) => undefined);
    function Harness() {
      const [draft, setDraft] = useState<BrandIntelligenceResult>({ ...initial, primaryCategory: { code: null, name: "광고" } });
      return (
        <BrandAnalysisReviewStep
          draft={draft}
          saving={false}
          error={null}
          categories={categories}
          onChange={setDraft}
          onConfirm={async () => confirm(draft)}
        />
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    expect(screen.queryByRole("textbox", { name: "대표 분야" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "직접 입력 세부 분야" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "분석 결과 대표 분야" }), "marketing");
    await user.click(screen.getByRole("checkbox", { name: "콘텐츠 마케팅" }));
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "확인하고 저장" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
    }));

    await user.selectOptions(screen.getByRole("combobox", { name: "분석 결과 대표 분야" }), "commerce");
    expect(screen.queryByRole("checkbox", { name: "콘텐츠 마케팅" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "온라인 스토어" })).not.toBeChecked();
  });

  it("blocks confirmation when the catalog cannot be loaded", async () => {
    const confirm = vi.fn(async () => undefined);
    render(
      <BrandAnalysisReviewStep
        draft={initial}
        saving={false}
        error={null}
        categories={[]}
        onChange={vi.fn()}
        onConfirm={confirm}
      />,
    );

    expect(screen.getByRole("combobox", { name: "분석 결과 대표 분야" })).toBeDisabled();
    expect(screen.getByText("분야 목록을 불러오지 못했습니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeDisabled();
    await waitFor(() => expect(confirm).not.toHaveBeenCalled());
  });

  it("organizes every production v2 field into review tabs without dropping controls", async () => {
    function Harness() {
      const [draft, setDraft] = useState(completeV2);
      const [companyName, setCompanyName] = useState("모종");
      return <BrandAnalysisReviewStep
        companyName={companyName}
        draft={draft}
        saving={false}
        error={null}
        categories={categories}
        onCompanyNameChange={setCompanyName}
        onChange={setDraft}
        onConfirm={async () => undefined}
      />;
    }
    render(<Harness />);
    const user = userEvent.setup();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "브랜드 핵심",
      "고객·니즈",
      "가치·소구",
      "상품·서비스",
      "경쟁사",
    ]);
    expect(screen.getByRole("textbox", { name: "회사명" })).toHaveValue("모종");
    expect(screen.getByRole("textbox", { name: "한 줄 정의" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "분석 결과 대표 분야" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "고객·니즈" }));
    expect(screen.getByRole("textbox", { name: "핵심 타깃" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "보조 타깃 1" })).toHaveClass("brand-review-list-input");
    expect(screen.getByRole("textbox", { name: "고객 니즈 1" })).toHaveClass("brand-review-list-input");

    await user.click(screen.getByRole("tab", { name: "가치·소구" }));
    expect(screen.getByRole("heading", { name: "가치·소구" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "가치 제안" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "차별점 1" })).toHaveClass("brand-review-list-input");
    expect(screen.getByRole("textbox", { name: "보조 소구점 1" })).toHaveClass("brand-review-list-input");
    expect(screen.getByRole("textbox", { name: "핵심 키워드 1" })).toHaveClass("brand-review-list-input");
    expect(screen.getByRole("textbox", { name: "관찰된 브랜드 톤" })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "상품·서비스" }));
    expect(screen.getByRole("combobox", { name: "대표 상품 1 유형" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 이름" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 설명" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 대상 고객" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 핵심 효익" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 가격" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "대표 상품 1 구매 URL" })).toBeVisible();
    const offering = screen.getByRole("article");
    const offeringTitle = offering.querySelector<HTMLElement>(".brand-review-item-title");
    expect(offeringTitle).not.toBeNull();
    expect(within(offeringTitle!).getByRole("button", { name: "대표 상품 1 삭제" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "대표 상품 1 위로 이동" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "대표 상품 1 아래로 이동" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "경쟁사" }));
    expect(screen.getByRole("textbox", { name: "경쟁사 1 이름" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "경쟁사 1 설명" })).toBeVisible();
    expect(screen.getByRole("link", { name: "근거 보기" })).toHaveAttribute("href", "https://example.com/evidence");
  });

  it("edits array-backed values as separate rows", async () => {
    function Harness() {
      const [draft, setDraft] = useState(completeV2);
      return <>
        <BrandAnalysisReviewStep
          draft={draft}
          saving={false}
          error={null}
          onChange={setDraft}
          onConfirm={async () => undefined}
        />
        <output data-testid="secondary-targets">
          {draft.contractVersion === "brand-intelligence-result.v2"
            ? JSON.stringify(draft.secondaryTargets)
            : "[]"}
        </output>
      </>;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "고객·니즈" }));
    const firstTarget = screen.getByRole("textbox", { name: "보조 타깃 1" });
    await user.clear(firstTarget);
    await user.type(firstTarget, "수정된 보조 타깃");
    await user.click(screen.getByRole("button", { name: "보조 타깃 항목 추가" }));
    await user.type(screen.getByRole("textbox", { name: "보조 타깃 3" }), "새 보조 타깃");
    await user.click(screen.getByRole("button", { name: "보조 타깃 2 삭제" }));
    expect(screen.getByTestId("secondary-targets")).toHaveTextContent(
      '["수정된 보조 타깃","새 보조 타깃"]',
    );
  });
});
