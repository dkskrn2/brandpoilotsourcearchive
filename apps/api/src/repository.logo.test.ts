import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

describe("brand logo repository mappings", () => {
  it("maps logoUrl in the brand profile response", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rowCount: 1,
      rows: [{
        profile_id: "profile-1", brand_id: "brand-1", brand_name: "그로스라인",
        industry: "서비스", primary_customer: "사업자", description: "설명", tone: "",
        default_cta: "", main_link: "", auto_approval_enabled: true,
        logo_url: "https://cdn.example.com/logo.png"
      }]
    }));
    const repository = createRepository({ query, connect: vi.fn() } as never);

    await expect(repository.getBrandProfile("brand-1")).resolves.toMatchObject({
      name: "그로스라인",
      logoUrl: "https://cdn.example.com/logo.png"
    });
    expect(query.mock.calls[0]?.[0]).toContain("bp.logo_url");
  });

  it("maps logoUrl in UI status without another profile request", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({
      rowCount: 1,
      rows: [{ brand_id: "brand-1", brand_name: "그로스라인", logo_url: "https://cdn.example.com/logo.png" }]
    }));
    const repository = createRepository({ query, connect: vi.fn() } as never);

    await expect(repository.getBrandUiStatus("brand-1")).resolves.toMatchObject({
      brandName: "그로스라인",
      logoUrl: "https://cdn.example.com/logo.png"
    });
    expect(query.mock.calls[0]?.[0]).toContain("bp.logo_url");
  });
});
