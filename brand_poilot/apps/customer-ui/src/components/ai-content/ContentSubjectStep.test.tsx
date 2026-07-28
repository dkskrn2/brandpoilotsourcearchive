import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProductServiceItem, WikiItem } from "../../features/libraries/libraryGateway";
import { ContentSubjectStep } from "./ContentSubjectStep";

const product: ProductServiceItem = {
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

const wiki: WikiItem = {
  id: "wiki-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  itemType: "guide",
  title: "민감 피부 가이드",
  content: "가이드 본문",
  status: "active",
  origin: "manual",
  provenance: {},
  createdByUserId: "user-1",
  approvedByUserId: "user-1",
  approvedAt: "2026-07-28T00:00:00.000Z",
  sourceKind: "guide",
  sourceId: "wiki-1",
  activeVersionId: "wiki-version-1",
  lastBuiltAt: "2026-07-28T00:00:00.000Z",
  buildStatus: "active",
};

describe("ContentSubjectStep", () => {
  it("connects brand topic, active Wiki, approved product, and the existing new-analysis flow", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const onWikiIdsChange = vi.fn();
    const onProductChange = vi.fn();
    const onStartNewAnalysis = vi.fn();
    render(<ContentSubjectStep
      mode="brand_topic"
      topic="피부 관리"
      products={[product, { ...product, id: "archived", displayName: "보관 제품", status: "archived" }]}
      wikiItems={[wiki, { ...wiki, id: "draft-wiki", title: "초안 Wiki", status: "draft" }]}
      selectedWikiIds={[]}
      selectedProductId={null}
      loading={false}
      onModeChange={onModeChange}
      onTopicChange={vi.fn()}
      onWikiIdsChange={onWikiIdsChange}
      onProductChange={onProductChange}
      onStartNewAnalysis={onStartNewAnalysis}
      onComplete={vi.fn()}
    />);

    expect(screen.getByRole("checkbox", { name: /민감 피부 가이드/ })).toBeEnabled();
    expect(screen.queryByText("초안 Wiki")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /민감 피부 가이드/ }));
    expect(onWikiIdsChange).toHaveBeenCalledWith(["wiki-1"]);

    await user.click(screen.getByRole("button", { name: "저장 제품·서비스" }));
    expect(onModeChange).toHaveBeenCalledWith("product_service");

    await user.click(screen.getByRole("button", { name: "새 제품·서비스 분석" }));
    expect(onStartNewAnalysis).toHaveBeenCalledTimes(1);
  });
});
