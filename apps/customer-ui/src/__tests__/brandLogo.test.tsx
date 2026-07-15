import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BrandLogo } from "../components/brand/BrandLogo";
import { BrandLogoEditor } from "../components/brand/BrandLogoEditor";
import { SidebarBrandProfile } from "../components/layout/SidebarBrandProfile";
import type { BrandProfile } from "../types";

const profile: BrandProfile = {
  name: "그로스라인",
  industry: "서비스",
  primaryCustomer: "사업자",
  description: "설명",
  tone: "담백한 톤",
  defaultCta: "문의하기",
  mainLink: "https://example.com",
  autoApprovalEnabled: true,
  logoUrl: "https://cdn.example.com/logo.png"
};

describe("BrandLogo", () => {
  it("shows one or two brand letters when no logo exists", () => {
    render(<BrandLogo brandName="그로스라인" logoUrl={null} />);
    expect(screen.getByRole("img", { name: "그로스라인 대체 로고" })).toHaveTextContent("그로");
  });

  it("falls back to brand letters when the image cannot load", () => {
    render(<BrandLogo brandName="그로스라인" logoUrl="https://cdn.example.com/broken.png" />);
    fireEvent.error(screen.getByRole("img", { name: "그로스라인 로고" }));
    expect(screen.getByRole("img", { name: "그로스라인 대체 로고" })).toBeVisible();
  });
});

describe("SidebarBrandProfile", () => {
  it("links the compact profile directly to brand settings", () => {
    render(
      <MemoryRouter>
        <SidebarBrandProfile brandName="그로스라인" logoUrl="https://cdn.example.com/logo.png" />
      </MemoryRouter>
    );
    const link = screen.getByRole("link", { name: "그로스라인 브랜드 설정 열기" });
    expect(link).toHaveAttribute("href", "/brand-settings");
    expect(screen.getByText("브랜드 설정")).toBeVisible();
  });
});

describe("BrandLogoEditor", () => {
  it("uploads a supported image immediately and returns the updated profile", async () => {
    const updated = { ...profile, logoUrl: "https://cdn.example.com/new.png" };
    const client = {
      uploadBrandLogo: vi.fn(async () => updated),
      deleteBrandLogo: vi.fn()
    };
    const onProfileChange = vi.fn();
    render(<BrandLogoEditor profile={profile} onProfileChange={onProfileChange} client={client} />);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "new.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("로고 이미지 선택"), file);

    await waitFor(() => expect(client.uploadBrandLogo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      fileName: "new.png",
      mimeType: "image/png"
    })));
    expect(onProfileChange).toHaveBeenCalledWith(updated);
  });

  it("keeps the existing logo visible when upload fails", async () => {
    const client = {
      uploadBrandLogo: vi.fn(async () => { throw new Error("upload_failed"); }),
      deleteBrandLogo: vi.fn()
    };
    const onProfileChange = vi.fn();
    render(<BrandLogoEditor profile={profile} onProfileChange={onProfileChange} client={client} />);
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "new.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("로고 이미지 선택"), file);

    expect(await screen.findByText("로고를 저장하지 못했습니다. 기존 로고는 유지됩니다.")).toBeVisible();
    expect(onProfileChange).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "그로스라인 로고" })).toHaveAttribute("src", profile.logoUrl);
  });

  it("rejects unsupported files before calling the API", async () => {
    const client = { uploadBrandLogo: vi.fn(), deleteBrandLogo: vi.fn() };
    render(<BrandLogoEditor profile={profile} onProfileChange={vi.fn()} client={client} />);

    await userEvent.upload(
      screen.getByLabelText("로고 이미지 선택"),
      new File(["svg"], "logo.svg", { type: "image/svg+xml" }),
      { applyAccept: false }
    );

    expect(await screen.findByText("PNG, JPEG, WebP 이미지만 등록할 수 있습니다.")).toBeVisible();
    expect(client.uploadBrandLogo).not.toHaveBeenCalled();
  });

  it("deletes an existing logo immediately", async () => {
    const updated = { ...profile, logoUrl: null };
    const client = {
      uploadBrandLogo: vi.fn(),
      deleteBrandLogo: vi.fn(async () => updated)
    };
    const onProfileChange = vi.fn();
    render(<BrandLogoEditor profile={profile} onProfileChange={onProfileChange} client={client} />);

    await userEvent.click(screen.getByRole("button", { name: "로고 삭제" }));

    expect(client.deleteBrandLogo).toHaveBeenCalled();
    expect(onProfileChange).toHaveBeenCalledWith(updated);
  });
});
