import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseExternalCandidateEnvelope,
  parseOwnedFactEnvelope,
} from "./stageContracts.js";

describe("brand intelligence stage contracts", () => {
  it("ships a discoverable v2-only runtime skill contract", async () => {
    const packageRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const skill = await readFile(
      path.join(packageRoot, ".agents", "skills", "brand-intelligence", "SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/^---\r?\nname: brand-intelligence\r?\ndescription: Use when /);
    expect(skill).toContain("brand-intelligence-result.v2");
    expect(skill).toContain("대표 상품·서비스는 최대 5개");
    expect(skill).toContain("외부 고유 URL은 최대 10개");
    expect(skill).not.toContain("brand-intelligence-result.v1");
  });

  it("accepts supported facts whose quote exists in the registered segment", () => {
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "콘텐츠 운영을 지원합니다.",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: "https://example.com/about",
        quotes: ["콘텐츠 운영을 지원합니다"],
        category: "business",
        support: "supported",
      }],
    }, new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: "https://example.com/about",
      normalizedText: "브랜드의 콘텐츠 운영을 지원합니다.",
    }]]));
    expect(parsed.output[0]?.id).toBe("fact-1");
  });

  it("rejects invented sources, absent quotes, and extra keys", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    expect(() => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "invented",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["등록된 본문"],
        category: "business",
        support: "supported",
      }],
    }, segments)).toThrow("owned_fact_source_registry_mismatch");
    expect(() => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments)).toThrow("owned_fact_quote_mismatch");
  });

  it("omits only quote-mismatched facts when explicitly requested", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문과 검증된 사실",
    }]]);
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-valid",
        claim: "검증된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["검증된 사실"],
        category: "business",
        support: "supported",
      }, {
        id: "fact-mismatch",
        claim: "재서술된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["원문에 없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output.map(({ id }) => id)).toEqual(["fact-valid"]);
    expect(parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-only-mismatch",
        claim: "재서술된 사실",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["원문에 없는 인용"],
        category: "business",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" }).output).toEqual([]);
  });

  it("does not let quote omission hide registry, shape, or duplicate-id errors", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    const fact = {
      id: "fact-1",
      claim: "주장",
      sourceId: "owned-1",
      segmentId: "segment-1",
      sourceUrl: null,
      quotes: ["원문에 없는 인용"],
      category: "business",
      support: "supported",
    };
    const parse = (output: unknown[]) => parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output,
    }, segments, { quoteMismatch: "drop-fact" });

    expect(() => parse([{ ...fact, sourceId: "invented" }]))
      .toThrow("owned_fact_source_registry_mismatch");
    expect(() => parse([{ ...fact, sourceUrl: "https://example.com/invented" }]))
      .toThrow("owned_fact_source_registry_mismatch");
    expect(() => parse([{ ...fact, claim: "" }]))
      .toThrow("owned_fact_invalid");
    expect(() => parse([{ ...fact, extra: true }]))
      .toThrow("owned_fact_invalid");
    expect(() => parse([fact, { ...fact, quotes: ["등록된 본문"] }]))
      .toThrow("owned_fact_id_duplicate");
  });

  it("drops the entire fact when any one of its quotes is mismatched", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "첫 번째 인용과 두 번째 인용",
    }]]);
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{
        id: "fact-1",
        claim: "주장",
        sourceId: "owned-1",
        segmentId: "segment-1",
        sourceUrl: null,
        quotes: ["첫 번째 인용", "원문에 없는 인용"],
        category: "business",
        support: "conflicting",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output).toEqual([]);
  });

  it("retains missing facts without quotes but omits supported facts without quotes", () => {
    const segments = new Map([["segment-1", {
      sourceId: "owned-1",
      sourceUrl: null,
      normalizedText: "등록된 본문",
    }]]);
    const base = {
      claim: "확인할 수 없음",
      sourceId: "owned-1",
      segmentId: "segment-1",
      sourceUrl: null,
      quotes: [],
      category: "business",
    };
    const parsed = parseOwnedFactEnvelope({
      stageVersion: "owned-facts.v1",
      output: [{ ...base, id: "fact-missing", support: "missing" }, {
        ...base,
        id: "fact-supported",
        support: "supported",
      }],
    }, segments, { quoteMismatch: "drop-fact" });

    expect(parsed.output.map(({ id }) => id)).toEqual(["fact-missing"]);
  });

  it("bounds and normalizes external search candidates", () => {
    const parsed = parseExternalCandidateEnvelope({
      stageVersion: "external-candidates.v1",
      output: [{ url: "https://example.com/a#fragment", reason: "경쟁 대안" }],
    });
    expect(parsed.output).toEqual([{
      url: "https://example.com/a",
      reason: "경쟁 대안",
    }]);
  });
});
