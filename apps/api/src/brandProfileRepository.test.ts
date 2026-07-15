import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository";

function poolFor(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() }))
  };
}

const profileRow = {
  profile_id: "profile-1",
  workspace_id: "workspace-1",
  brand_id: "brand-1",
  brand_name: "Growthline",
  category_code: "business_professional",
  category_name: "비즈니스·전문 서비스",
  primary_customer: null,
  description: null,
  tone: null,
  default_cta: null,
  main_link: null,
  auto_approval_enabled: false,
  logo_url: null,
  subcategories: [
    { type: "system", code: "marketing_consulting", name: "마케팅 컨설팅", createdAt: "2026-01-01" },
    { type: "custom", code: null, name: "세일즈 메시지 설계", createdAt: "2026-01-02" }
  ]
};

describe("brand profile content categories", () => {
  it("maps the primary category and ordered subcategories", async () => {
    const repository = createRepository({ query: vi.fn(async () => ({ rowCount: 1, rows: [profileRow] })) } as any);

    await expect(repository.getBrandProfile("brand-1")).resolves.toMatchObject({
      primaryCategory: { code: "business_professional", name: "비즈니스·전문 서비스" },
      subcategories: [
        { type: "system", code: "marketing_consulting", name: "마케팅 컨설팅" },
        { type: "custom", code: null, name: "세일즈 메시지 설계" }
      ]
    });
  });

  it("locks the profile and atomically replaces category relationships without writing industry", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push(sql);
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("for update")) return { rowCount: 1, rows: [{ ...profileRow, primary_category_id: "old-category" }] };
      if (sql.includes("from content_categories") && sql.includes("where code")) {
        return { rowCount: 1, rows: [{ id: "category-1", code: "business_professional", name: "비즈니스·전문 서비스" }] };
      }
      if (sql.includes("from content_subcategories") && sql.includes("code = any")) {
        expect(values?.[0]).toEqual(["marketing_consulting"]);
        return { rowCount: 1, rows: [{ id: "subcategory-1", category_id: "category-1", code: "marketing_consulting", name: "마케팅 컨설팅" }] };
      }
      if (sql.includes("select bp.id as profile_id")) return { rowCount: 1, rows: [profileRow] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(poolFor(query) as any);

    await repository.updateBrandProfile("brand-1", {
      primaryCategoryCode: "business_professional",
      subcategories: [
        { type: "system", code: "marketing_consulting" },
        { type: "custom", name: "  세일즈 메시지 설계  " }
      ]
    });

    expect(statements[0].trim()).toBe("begin");
    expect(statements.some((sql) => sql.includes("for update"))).toBe(true);
    expect(statements.some((sql) => sql.includes("delete from brand_profile_subcategories"))).toBe(true);
    expect(statements.filter((sql) => sql.includes("insert into brand_profile_subcategories"))).toHaveLength(2);
    expect(statements.at(-2)?.trim()).toBe("commit");
    expect(statements.join("\n")).not.toMatch(/\bindustry\b/);
  });

  it("clears prior category relationships when only primaryCategoryCode is supplied", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values: values ?? [] });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("for update")) return { rowCount: 1, rows: [{ ...profileRow, primary_category_id: "old-category" }] };
      if (sql.includes("from content_categories")) return { rowCount: 1, rows: [{ id: "new-category" }] };
      if (sql.includes("select bp.id as profile_id")) return { rowCount: 1, rows: [profileRow] };
      return { rowCount: 1, rows: [] };
    });

    await createRepository(poolFor(query) as any).updateBrandProfile("brand-1", {
      primaryCategoryCode: "business_professional"
    });

    expect(statements.some(({ sql }) => sql.includes("delete from brand_profile_subcategories"))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes("insert into brand_profile_subcategories"))).toBe(false);
  });

  it("preserves category and selections when neither category field is supplied", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values: values ?? [] });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("for update")) return { rowCount: 1, rows: [{ ...profileRow, primary_category_id: "existing-category" }] };
      if (sql.includes("select bp.id as profile_id")) return { rowCount: 1, rows: [profileRow] };
      return { rowCount: 1, rows: [] };
    });

    await createRepository(poolFor(query) as any).updateBrandProfile("brand-1", { tone: "차분함" });

    expect(statements.some(({ sql }) => sql.includes("delete from brand_profile_subcategories"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("insert into brand_profile_subcategories"))).toBe(false);
    const update = statements.find(({ sql }) => sql.includes("update brand_profiles"));
    expect(update?.values[1]).toBe("existing-category");
  });

  it("clears the primary category and all selections when primaryCategoryCode is null", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const clearedProfileRow = { ...profileRow, category_code: null, category_name: null, subcategories: [] };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values: values ?? [] });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("for update")) return { rowCount: 1, rows: [{ ...profileRow, primary_category_id: "existing-category" }] };
      if (sql.includes("select bp.id as profile_id")) return { rowCount: 1, rows: [clearedProfileRow] };
      return { rowCount: 1, rows: [] };
    });

    const result = await createRepository(poolFor(query) as any).updateBrandProfile("brand-1", {
      primaryCategoryCode: null
    });

    expect(statements.some(({ sql }) => sql.includes("from content_categories") && sql.includes("where code"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes("delete from brand_profile_subcategories"))).toBe(true);
    const update = statements.find(({ sql }) => sql.includes("update brand_profiles"));
    expect(update?.values[1]).toBeNull();
    expect(result.primaryCategory).toBeNull();
    expect(result.subcategories).toEqual([]);
  });

  it.each([
    ["invalid_primary_category", { primaryCategoryCode: "missing" }],
    ["too_many_subcategories", { subcategories: Array.from({ length: 6 }, (_, index) => ({ type: "custom" as const, name: `custom-${index}` })) }],
    ["duplicate_subcategory", { subcategories: [{ type: "custom" as const, name: "Marketing" }, { type: "custom" as const, name: "ｍarketing" }] }],
    ["brand_subcategory_too_long", { subcategories: [{ type: "custom" as const, name: "가".repeat(31) }] }],
    ["invalid_subcategory", { subcategories: [{ type: "system" as const, code: "missing" }] }],
    ["subcategory_category_mismatch", { subcategories: [{ type: "system" as const, code: "wrong_category" }] }]
  ])("returns stable validation error %s", async (errorCode, input) => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("for update")) return { rowCount: 1, rows: [{ ...profileRow, primary_category_id: "category-1" }] };
      if (sql.includes("from content_categories")) return errorCode === "invalid_primary_category"
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ id: "category-1" }] };
      if (sql.includes("from content_subcategories")) {
        if (errorCode === "invalid_subcategory") return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: "subcategory-1", category_id: "other-category", code: "wrong_category", name: "다른 분야" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(poolFor(query) as any);

    await expect(repository.updateBrandProfile("brand-1", input)).rejects.toThrow(errorCode);
    expect(query).toHaveBeenCalledWith("rollback");
  });
});
