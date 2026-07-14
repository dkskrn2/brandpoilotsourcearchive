import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { curateKnowledge, validateCuratedKnowledge } from "./knowledgeCurator.js";

const source = "# 머그컵 안내\n\n머그컵은 매일 사용하기 좋은 도자기 제품입니다. 현재 가격은 29,000원이며 통화는 KRW입니다. 상품 주소는 https://example.com/mug 이고 SKU는 MUG-1입니다.";
const structuredData = {
  price: "29000",
  currency: "KRW",
  productUrl: "https://example.com/mug",
  sku: "MUG-1",
};

function productUnit(overrides: Record<string, unknown> = {}) {
  return {
    unitType: "product",
    title: "머그컵",
    content: "매일 사용하기 좋은 도자기 머그컵입니다.",
    keywords: ["머그컵", "도자기"],
    aliases: ["MUG-1"],
    sourceQuote: "현재 가격은 29,000원이며 통화는 KRW입니다.",
    validFrom: null,
    validUntil: null,
    structuredData,
    ...overrides,
  };
}

describe("knowledge curator", () => {
  it("uses a Korean strict-JSON prompt and a configurable 30 second default timeout", async () => {
    const runCodex = vi.fn(async () => ({ units: [productUnit()] }));

    await expect(curateKnowledge({
      normalizedSource: source,
      sourceTitle: "머그컵 안내",
      sourceStructuredData: structuredData,
      runtimeDirectory: "runtime",
      runCodex,
    })).resolves.toEqual([productUnit()]);

    expect(runCodex).toHaveBeenCalledWith(expect.objectContaining({
      runtimeDirectory: "runtime",
      timeoutMs: 30_000,
      prompt: expect.stringMatching(/\$knowledge-curator[\s\S]*JSON만 출력/),
    }));
  });

  it("accepts a source quote only when it exists after whitespace normalization", () => {
    expect(validateCuratedKnowledge({
      units: [productUnit({ sourceQuote: "현재   가격은 29,000원이며\n통화는 KRW입니다." })],
    }, source, structuredData)).toHaveLength(1);

    expect(() => validateCuratedKnowledge({
      units: [productUnit({ sourceQuote: "지금 주문하면 무료 배송됩니다." })],
    }, source, structuredData)).toThrow("curator_source_quote_missing");
  });

  it.each([
    ["price", "25000"],
    ["currency", "USD"],
    ["productUrl", "https://shop.example.com/mug"],
    ["sku", "NEW-MUG"],
  ])("rejects a changed protected product field: %s", (field, changedValue) => {
    expect(() => validateCuratedKnowledge({
      units: [productUnit({ structuredData: { ...structuredData, [field]: changedValue } })],
    }, source, structuredData)).toThrow(`curator_product_field_changed:${field}`);
  });

  it("rejects output that is not the exact strict JSON contract", () => {
    expect(() => validateCuratedKnowledge({
      units: [productUnit({ explanation: "helpful note" })],
    }, source, structuredData)).toThrow("curator_unit_shape_invalid");
  });

  it("ships guardrails for quote fidelity and protected product fields", async () => {
    const skill = await readFile(
      path.resolve("runtime/.agents/skills/knowledge-curator/SKILL.md"),
      "utf8",
    );

    expect(skill).toContain("name: knowledge-curator");
    expect(skill).toContain("sourceQuote");
    expect(skill).toContain("price");
    expect(skill).toContain("currency");
    expect(skill).toContain("productUrl");
    expect(skill).toContain("sku");
    expect(skill).toContain("JSON");
  });
});
