import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ReferenceItem } from "../../types";
import { ReferenceCard } from "./ReferenceCard";

const item: ReferenceItem = {
  id: "reference-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  kind: "trend",
  contentPurpose: "marketing",
  origin: "Instagram",
  title: "저장한 공개 콘텐츠",
  previewUrl: "https://cdn.example/expired.jpg",
  sourceUrl: "https://www.instagram.com/p/example/",
  format: "image",
  metadata: {},
  favorite: false,
  archivedAt: null,
  referenceBrandId: null,
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("ReferenceCard", () => {
  it("replaces an expired preview image with an explicit fallback", () => {
    render(<ReferenceCard item={item} onSelect={vi.fn()} />);

    fireEvent.error(screen.getByRole("img", { name: "저장한 공개 콘텐츠 미리보기" }));

    expect(screen.queryByRole("img", { name: "저장한 공개 콘텐츠 미리보기" })).not.toBeInTheDocument();
    expect(screen.getByText("미리보기를 불러오지 못했습니다.")).toBeVisible();
  });

  it("renders saved Meta ads as text-first cards with explicit provenance", () => {
    render(<ReferenceCard item={{
      ...item,
      id: "meta-ad-1",
      kind: "meta_ad",
      origin: "Meta 광고 라이브러리",
      title: "라라스윗",
      previewUrl: null,
      sourcePlatform: "meta_ad_library",
      metadata: { creativeBody: "여름 신제품 광고", pageName: "라라스윗" },
    }} onSelect={vi.fn()} />);

    expect(screen.getByText("Meta 광고 라이브러리")).toBeVisible();
    expect(screen.getByText("여름 신제품 광고")).toBeVisible();
    expect(screen.queryByText("미리보기 없음")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("marks a saved Meta ad when the source no longer appears active", () => {
    render(<ReferenceCard item={{
      ...item,
      id: "ended-meta-ad-1",
      kind: "meta_ad",
      origin: "Meta 광고 라이브러리",
      title: "종료된 광고",
      previewUrl: null,
      sourcePlatform: "meta_ad_library",
      sourceState: "unavailable",
      metadata: { creativeBody: "보관된 광고 문구" },
    }} onSelect={vi.fn()} />);

    expect(screen.getByText("현재 광고 라이브러리에서 확인되지 않음")).toBeVisible();
    expect(screen.getByText("보관된 광고 문구")).toBeVisible();
  });
});
