import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  effectiveFaqAliases,
  normalizeFaqUtterance,
  parseFaqUtterances,
} from "./faqUtterancePolicy.js";

const fixture = JSON.parse(readFileSync(
  new URL("../../../scripts/fixtures/faq-utterance-policy.json", import.meta.url),
  "utf8",
)) as {
  normalization: Array<{ input: string; expected: string }>;
  parse: Array<{ input: string[]; expected: string[] }>;
  effective: Array<{ source: string[]; manual: string[]; expected: string[] }>;
};

describe("FAQ utterance policy", () => {
  it.each(fixture.normalization)("normalizes $input", ({ input, expected }) => {
    expect(normalizeFaqUtterance(input)).toBe(expected);
  });

  it.each(fixture.parse)("parses and deduplicates display values", ({ input, expected }) => {
    expect(parseFaqUtterances(input)).toEqual(expected);
  });

  it.each(fixture.effective)("merges source and manual aliases", ({ source, manual, expected }) => {
    expect(effectiveFaqAliases(source, manual)).toEqual(expected);
  });

  it("rejects non-arrays, empty values, overlong values, and more than eight entries", () => {
    expect(() => parseFaqUtterances("배송 문의")).toThrow("faq_utterance_validation_failed:root");
    expect(() => parseFaqUtterances(["   "])).toThrow("faq_utterance_validation_failed:item");
    expect(() => parseFaqUtterances(["가".repeat(81)]))
      .toThrow("faq_utterance_validation_failed:item");
    expect(() => parseFaqUtterances(Array.from({ length: 9 }, (_, index) => `문의 ${index}`)))
      .toThrow("faq_utterance_validation_failed:limit");
  });

  it("bounds legacy source aliases before they reach the webhook matcher", () => {
    const aliases = effectiveFaqAliases(
      ["가".repeat(81), ...Array.from({ length: 20 }, (_, index) => `원본 표현 ${index}`)],
      ["수동 표현"],
    );
    expect(aliases).toHaveLength(8);
    expect(aliases).not.toContain("가".repeat(81));
  });
});
