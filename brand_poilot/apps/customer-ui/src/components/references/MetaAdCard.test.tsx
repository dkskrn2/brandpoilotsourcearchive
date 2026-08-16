import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MetaAdCard } from "./MetaAdCard";
import type { MetaAdLibraryItem } from "../../types";

const ad: MetaAdLibraryItem = {
  id: "ad-1", providerAdId: "provider-ad-1", sourcePlatform: "meta_ad_library",
  pageId: "123", pageName: "라라스윗", creativeBody: "여름 신제품 광고",
  creativeTitle: "신제품", creativeCaption: null, creativeDescription: null,
  snapshotUrl: "https://www.facebook.com/ads/archive/render_ad/?id=provider-ad-1",
  publisherPlatforms: ["instagram", "facebook"], deliveryStartedAt: "2026-08-01T00:00:00.000Z",
  deliveryStoppedAt: null, activeStatus: "ACTIVE", reachedCountries: ["KR"], isSaved: false,
};

describe("MetaAdCard", () => {
  it("renders a text-first official-source card without pretending the snapshot is an image", () => {
    render(<MetaAdCard ad={ad} onSave={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Meta 광고 라이브러리")).toBeVisible();
    expect(screen.getByText("라라스윗")).toBeVisible();
    expect(screen.getByText("여름 신제품 광고")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meta 원본 보기" })).toHaveAttribute("href", ad.snapshotUrl);
  });

  it("toggles library storage and rolls back on a failed action", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    const onRemove = vi.fn(async () => { throw new Error("failed"); });
    render(<MetaAdCard ad={ad} onSave={onSave} onRemove={onRemove} />);
    await user.click(screen.getByRole("button", { name: "라라스윗 라이브러리에 저장" }));
    expect(screen.getByRole("button", { name: "라라스윗 저장 해제" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "라라스윗 저장 해제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장 상태를 변경하지 못했습니다.");
    expect(screen.getByRole("button", { name: "라라스윗 저장 해제" })).toBeVisible();
  });

  it("shows when a cached ad is no longer returned as active", () => {
    render(<MetaAdCard ad={{ ...ad, activeStatus: "INACTIVE", isSaved: true }} onSave={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText("현재 광고 라이브러리에서 확인되지 않음")).toBeVisible();
    expect(screen.getByText("여름 신제품 광고")).toBeVisible();
  });
});
