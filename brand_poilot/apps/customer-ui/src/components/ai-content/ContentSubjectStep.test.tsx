import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

  it("keeps direct text, URL, and reference mutually exclusive and leaves today disabled", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const { rerender } = render(<ContentSubjectStep
      {...baseProps}
      purpose="informational"
      onModeChange={onModeChange}
      referencePicker={<p>인기 레퍼런스</p>}
    />);

    expect(screen.getByRole("button", { name: /오늘의 주제/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /오늘의 주제/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("준비 중")).toBeVisible();
    expect(screen.getByLabelText("콘텐츠 주제")).toBeVisible();
    expect(screen.queryByLabelText("주제 URL")).not.toBeInTheDocument();
    expect(screen.queryByText("인기 레퍼런스")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "URL" }));
    expect(onModeChange).toHaveBeenCalledWith("topic_url");

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
});
