import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BrandAnalysisReviewStep } from "../components/brand-intelligence/BrandAnalysisReviewStep";
import { BrandEvidenceInputStep } from "../components/brand-intelligence/BrandEvidenceInputStep";
import { resolveBrandAnalysisFileMimeType } from "../features/brand-intelligence/brandIntelligenceGateway";
import type { BrandIntelligenceResult } from "../features/brand-intelligence/types";

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
      return <BrandAnalysisReviewStep draft={draft} saving={false} error={null} onChange={setDraft} onConfirm={confirm} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
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
    render(<BrandEvidenceInputStep busy={false} error={null} initialOwnedUrl="https://brand.example.com" onSubmit={submit} />);

    expect(screen.getByRole("textbox", { name: /자사 URL/ })).toHaveValue("https://brand.example.com");
    expect(screen.getByText(/분석 결과를 확인하고 저장할 때 자사 URL에 반영됩니다/)).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    expect(submit).toHaveBeenCalledWith({ ownedUrl: "https://brand.example.com", files: [] });
  });

  it("maps the reviewed category to the catalog and keeps custom subcategories", async () => {
    const confirm = vi.fn(async () => undefined);
    function Harness() {
      const [draft, setDraft] = useState<BrandIntelligenceResult>({ ...initial, primaryCategory: { code: null, name: "광고" } });
      return (
        <BrandAnalysisReviewStep
          draft={draft}
          saving={false}
          error={null}
          categories={[{
            code: "marketing",
            name: "마케팅",
            recommendedHashtags: [],
            subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
          }]}
          onChange={setDraft}
          onConfirm={confirm}
        />
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "분석 결과 대표 분야" }), "marketing");
    await user.click(screen.getByRole("checkbox", { name: "콘텐츠 마케팅" }));
    expect(screen.getByRole("textbox", { name: "직접 입력 세부 분야" })).toHaveValue("콘텐츠 운영");
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeEnabled();
  });
});
