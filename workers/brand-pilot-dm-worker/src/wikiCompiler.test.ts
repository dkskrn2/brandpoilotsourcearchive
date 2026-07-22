import { describe, expect, it, vi } from "vitest";
import type { CompiledWikiSourceUnit } from "./compiledWikiTypes.js";
import {
  buildBrandCore,
  compileWikiGroup,
  createWikiCompilationGroups,
  validateWikiCompilerOutput,
} from "./wikiCompiler.js";

function sourceUnit(overrides: Partial<CompiledWikiSourceUnit> = {}): CompiledWikiSourceUnit {
  return {
    sourceKind: "product",
    sourceId: "11111111-1111-4111-8111-111111111111",
    unitType: "product",
    stableKey: "product:sku:bp-001",
    title: "Brand Pilot",
    content: "브랜드 콘텐츠 생성 서비스입니다.",
    contentHash: "hash",
    keywords: ["콘텐츠"],
    aliases: [],
    structuredData: { sku: "BP-001" },
    sourceUrl: "https://www.danbammsg.co.kr/product",
    destinationUrl: "https://www.danbammsg.co.kr/product",
    sourceQuote: "브랜드 콘텐츠 생성 서비스입니다.",
    validFrom: null,
    validUntil: null,
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    pageType: "product",
    stableKey: "product:sku:bp-001",
    title: "Brand Pilot",
    summary: "브랜드 콘텐츠 생성 서비스",
    sections: [{
      sectionKey: "overview",
      heading: "서비스 소개",
      body: "브랜드 콘텐츠를 생성합니다.",
      sourceUnitIds: ["unit-1"],
      destinationUrlId: "unit-1",
    }],
    links: [],
    ...overrides,
  };
}

describe("Wiki compiler", () => {
  it("rejects unknown source IDs and raw model URLs", () => {
    const group = {
      pageType: "product" as const,
      stableKey: "product:sku:bp-001",
      sourceUnits: [{ id: "unit-1", ...sourceUnit() }],
      requiredLinkedStableKeys: [],
    };

    expect(() => validateWikiCompilerOutput(
      output({ sections: [{ ...output().sections[0], sourceUnitIds: ["other-unit"] }] }),
      group,
    )).toThrow("wiki_compiler_source_unit_unknown");
    expect(() => validateWikiCompilerOutput(
      output({ summary: "https://invented.example.com 에서 확인" }),
      group,
    )).toThrow("wiki_compiler_raw_url_forbidden");
  });

  it("requires the catalog to link every product and service detail", () => {
    const groups = createWikiCompilationGroups([
      { id: "product-1", ...sourceUnit() },
      { id: "service-1", ...sourceUnit({
        sourceId: "22222222-2222-4222-8222-222222222222",
        unitType: "service",
        stableKey: "service:진단",
        title: "전환 진단",
        structuredData: {},
      }) },
    ]);
    const catalog = groups.find((group) => group.pageType === "catalog");
    expect(catalog?.requiredLinkedStableKeys).toEqual([
      "product:sku:bp-001",
      "service:진단",
    ]);

    expect(() => validateWikiCompilerOutput({
      ...output({
        pageType: "catalog",
        stableKey: "catalog",
        sections: [{
          ...output().sections[0],
          sourceUnitIds: ["product-1"],
          destinationUrlId: "product-1",
        }],
      }),
      links: [{ targetStableKey: "product:sku:bp-001", relation: "contains" }],
    }, catalog!)).toThrow("wiki_compiler_catalog_item_missing");
  });

  it("does not treat editorial article examples as brand offerings", () => {
    const groups = createWikiCompilationGroups([
      { id: "product-1", ...sourceUnit() },
      { id: "article-service", ...sourceUnit({
        sourceKind: "owned_snapshot",
        unitType: "service",
        stableKey: "service:example-program",
        sourceUrl: "https://example.com/content/case-study",
        destinationUrl: "https://example.com/content/case-study",
      }) },
    ]);

    expect(groups.some((group) => group.stableKey === "service:example-program")).toBe(false);
    expect(groups.find((group) => group.stableKey === "catalog")?.requiredLinkedStableKeys)
      .toEqual(["product:sku:bp-001"]);
  });

  it("calls Codex once with only the selected page group and renders validated Markdown", async () => {
    const group = {
      pageType: "product" as const,
      stableKey: "product:sku:bp-001",
      sourceUnits: [{ id: "unit-1", ...sourceUnit() }],
      requiredLinkedStableKeys: [],
    };
    const runCodex = vi.fn(async (_input: {
      prompt: string;
      runtimeDirectory: string;
      timeoutMs: number;
    }) => output());

    const page = await compileWikiGroup({
      group,
      runtimeDirectory: "runtime",
      timeoutMs: 120_000,
      runCodex,
    });

    expect(runCodex).toHaveBeenCalledTimes(1);
    expect(runCodex.mock.calls[0]?.[0].prompt).toContain("unit-1");
    expect(runCodex.mock.calls[0]?.[0].prompt).not.toContain("other-unit");
    expect(page.contentMarkdown).toContain("## 서비스 소개");
    expect(page.contentMarkdown).toContain("브랜드 콘텐츠를 생성합니다.");
  });

  it("builds brand core at item boundaries within 3000 characters", () => {
    const core = buildBrandCore({
      overviewSummary: "브랜드 소개",
      catalogItems: Array.from({ length: 100 }, (_, index) => `${index + 1}. ${"서비스 설명 ".repeat(10)}`),
    });

    expect(core.startsWith("브랜드 소개")).toBe(true);
    expect(core.length).toBeLessThanOrEqual(3000);
    expect(core.endsWith("\n")).toBe(false);
  });
});
