import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductServiceImageManager } from "./ProductServiceImageManager";

afterEach(cleanup);

describe("ProductServiceImageManager", () => {
  it("shows onboarding URL image import progress and retries an explicit failure", async () => {
    const gateway = {
      listProductImages: vi.fn().mockResolvedValue([]),
      getProductImageImportStatus: vi.fn().mockResolvedValue({
        status: "failed", attemptCount: 3, errorCode: "fetch_failed", updatedAt: "2026-08-24T00:00:00.000Z",
      }),
      retryProductImageImport: vi.fn().mockResolvedValue({
        status: "pending", attemptCount: 0, errorCode: null, updatedAt: "2026-08-24T00:01:00.000Z",
      }),
      uploadProductImage: vi.fn(), deleteProductImage: vi.fn(),
    };
    const user = userEvent.setup();
    render(<ProductServiceImageManager
      brandId="brand-1" productId="product-1" versionId="version-1" gateway={gateway as never}
    />);
    expect(await screen.findByText("제품 페이지 이미지를 가져오지 못했습니다.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "제품 이미지 다시 가져오기" }));
    await waitFor(() => expect(gateway.retryProductImageImport).toHaveBeenCalledWith("brand-1", "product-1", "version-1"));
    expect(await screen.findByText("제품 페이지에서 이미지를 가져오는 중입니다.")).toBeVisible();
  });

  it("keeps product images optional and assigns the first image as the hero", async () => {
    const uploaded = {
      id: "image-1", productServiceId: "product-1", versionId: "version-1",
      role: "hero" as const, position: 1, storageUrl: "https://example.com/product.png",
      mimeType: "image/png", sizeBytes: 5,
    };
    const gateway = {
      listProductImages: vi.fn().mockResolvedValue([]),
      uploadProductImage: vi.fn().mockResolvedValue(uploaded),
      deleteProductImage: vi.fn().mockResolvedValue(undefined),
    };
    const user = userEvent.setup();

    render(<ProductServiceImageManager
      brandId="brand-1" productId="product-1" versionId="version-1" gateway={gateway as never}
    />);

    expect(await screen.findByText("이미지가 없어도 제품 설명은 콘텐츠에 사용됩니다.")).toBeVisible();
    await user.upload(screen.getByLabelText("제품 이미지 추가"), new File(["image"], "product.png", { type: "image/png" }));

    await waitFor(() => expect(gateway.uploadProductImage).toHaveBeenCalledWith(
      "brand-1", "product-1", "version-1", expect.any(File),
      expect.objectContaining({ role: "hero", position: 1 }),
    ));
    expect(await screen.findByRole("img", { name: "제품 대표 이미지" })).toHaveAttribute("src", uploaded.storageUrl);

    await user.click(screen.getByRole("button", { name: "제품 이미지 삭제" }));
    await waitFor(() => expect(gateway.deleteProductImage).toHaveBeenCalledWith("brand-1", "product-1", "image-1"));
    expect(screen.getByText("이미지가 없어도 제품 설명은 콘텐츠에 사용됩니다.")).toBeVisible();
  });

  it("uses the compacted position after deleting a middle image", async () => {
    const images = [1, 2, 3].map((position) => ({
      id: `image-${position}`, productServiceId: "product-1", versionId: "version-1",
      role: position === 1 ? "hero" as const : "detail" as const, position,
      storageUrl: `https://example.com/${position}.png`, mimeType: "image/png", sizeBytes: 5,
    }));
    const gateway = {
      listProductImages: vi.fn().mockResolvedValue(images),
      uploadProductImage: vi.fn().mockImplementation(async (_brand, _product, _version, _file, input) => ({
        ...images[2], id: "image-4", position: input.position,
      })),
      deleteProductImage: vi.fn().mockResolvedValue(undefined),
    };
    const user = userEvent.setup();
    render(<ProductServiceImageManager
      brandId="brand-1" productId="product-1" versionId="version-1" gateway={gateway as never}
    />);

    const deleteButtons = await screen.findAllByRole("button", { name: "제품 이미지 삭제" });
    await user.click(deleteButtons[1]!);
    await waitFor(() => expect(screen.getByText("상세 2")).toBeVisible());
    await user.upload(screen.getByLabelText("제품 이미지 추가"), new File(["image"], "next.png", { type: "image/png" }));
    await waitFor(() => expect(gateway.uploadProductImage).toHaveBeenCalledWith(
      "brand-1", "product-1", "version-1", expect.any(File),
      expect.objectContaining({ role: "detail", position: 3 }),
    ));
  });
});
