import { describe, expect, it } from "vitest";
import type { CuratedKnowledgeUnit } from "./knowledgeCurator.js";
import { buildCompiledSourceUnits, stableWikiKey } from "./compiledWikiTypes.js";

const baseUnit: CuratedKnowledgeUnit = {
  unitType: "product",
  title: "Brand Pilot 콘텐츠 자동화",
  content: "브랜드 콘텐츠를 생성하고 게시합니다.",
  keywords: ["콘텐츠"],
  aliases: ["브랜드 파일럿"],
  sourceQuote: "브랜드 콘텐츠를 생성하고 게시합니다.",
  validFrom: null,
  validUntil: null,
  structuredData: {
    sku: "BP-001",
    productUrl: "https://www.danbammsg.co.kr/product",
  },
};

describe("compiled Wiki source units", () => {
  it("creates a deterministic Korean-safe stable key and preserves verified product URL data", () => {
    const [unit] = buildCompiledSourceUnits({
      sourceKind: "product",
      sourceId: "11111111-1111-4111-8111-111111111111",
      sourceUrl: null,
      units: [baseUnit],
    });

    expect(unit).toMatchObject({
      unitType: "product",
      stableKey: "product:sku:bp-001",
      sourceUrl: null,
      destinationUrl: "https://www.danbammsg.co.kr/product",
      title: baseUnit.title,
      sourceQuote: baseUnit.sourceQuote,
    });
    expect(unit.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses an owned canonical URL as the source and destination fallback", () => {
    const [unit] = buildCompiledSourceUnits({
      sourceKind: "owned_snapshot",
      sourceId: "22222222-2222-4222-8222-222222222222",
      sourceUrl: "https://example.com/services/consulting#overview",
      units: [{ ...baseUnit, unitType: "service", title: "전환 진단", structuredData: {} }],
    });

    expect(unit.stableKey).toBe("service:전환-진단");
    expect(unit.sourceUrl).toBe("https://example.com/services/consulting");
    expect(unit.destinationUrl).toBe("https://example.com/services/consulting");
  });

  it("rejects model-provided or malformed destination URLs", () => {
    expect(() => buildCompiledSourceUnits({
      sourceKind: "product",
      sourceId: "33333333-3333-4333-8333-333333333333",
      sourceUrl: null,
      units: [{ ...baseUnit, structuredData: { productUrl: "javascript:alert(1)" } }],
    })).toThrow("compiled_wiki_destination_url_invalid");
  });

  it("normalizes equivalent titles to the same stable key", () => {
    expect(stableWikiKey("service", "  전환   진단  ", {}))
      .toBe(stableWikiKey("service", "전환 진단", {}));
  });
});
