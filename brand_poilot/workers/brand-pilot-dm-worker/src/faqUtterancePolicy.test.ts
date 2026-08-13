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

describe("FAQ worker utterance policy", () => {
  it.each(fixture.normalization)("normalizes $input", ({ input, expected }) => {
    expect(normalizeFaqUtterance(input)).toBe(expected);
  });

  it.each(fixture.parse)("parses and deduplicates display values", ({ input, expected }) => {
    expect(parseFaqUtterances(input)).toEqual(expected);
  });

  it.each(fixture.effective)("merges source and manual aliases", ({ source, manual, expected }) => {
    expect(effectiveFaqAliases(source, manual)).toEqual(expected);
  });
});
