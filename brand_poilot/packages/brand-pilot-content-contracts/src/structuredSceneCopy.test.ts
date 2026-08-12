import { describe, expect, it } from "vitest";
import {
  compileStructuredScene,
  flattenStructuredScene,
  parseStructuredSceneCopyV1,
} from "./structuredSceneCopy.js";

const EVIDENCE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCT_IMAGE_ID = "00000000-0000-4000-8000-000000000002";

function scene(type: string, entries: unknown[]) {
  return {
    index: 1,
    role: "cover",
    coreMessage: "수익화 기준이 두 배로 바뀝니다",
    headline: "롱폼 수익화 기준, 2배로",
    keyVisual: { type, entries },
    supportingTexts: [],
    footnote: null,
    visualDirection: "숫자 변화를 가장 크게 보여 주세요.",
    evidenceIds: [EVIDENCE_ID],
    productImageAssetIds: [PRODUCT_IMAGE_ID],
  };
}

describe("structured-scene-copy.v1", () => {
  it("parses a closed scene and deterministically derives the legacy asset", () => {
    const parsed = parseStructuredSceneCopyV1(scene("before_after", [
      { role: "before", label: null, value: "4,000시간" },
      { role: "after", label: null, value: "8,000시간" },
    ]));

    expect(flattenStructuredScene(parsed)).toBe("롱폼 수익화 기준, 2배로\n4,000시간\n8,000시간");
    expect(compileStructuredScene(parsed)).toEqual({
      index: 1,
      role: "cover",
      copy: "롱폼 수익화 기준, 2배로\n4,000시간\n8,000시간",
      visualDirection: "숫자 변화를 가장 크게 보여 주세요.",
      evidenceIds: [EVIDENCE_ID],
      productImageAssetIds: [PRODUCT_IMAGE_ID],
    });
  });

  it("normalizes authored whitespace before flattening", () => {
    const parsed = parseStructuredSceneCopyV1({
      ...scene("number", [{ role: "value", label: " 기준 ", value: " 8,000시간 " }]),
      role: " cover ",
      headline: " 롱폼 수익화 기준, 2배로 ",
      coreMessage: " 수익화 기준이 두 배로 바뀝니다 ",
      supportingTexts: [" 최근 12개월 기준 "],
      footnote: " 공식 정책을 확인하세요 ",
      visualDirection: " 숫자를 크게 보여 주세요. ",
    });

    expect(parsed).toMatchObject({
      role: "cover",
      coreMessage: "수익화 기준이 두 배로 바뀝니다",
      headline: "롱폼 수익화 기준, 2배로",
      keyVisual: { entries: [{ role: "value", label: "기준", value: "8,000시간" }] },
      supportingTexts: ["최근 12개월 기준"],
      footnote: "공식 정책을 확인하세요",
      visualDirection: "숫자를 크게 보여 주세요.",
    });
    expect(flattenStructuredScene(parsed)).toBe(
      "롱폼 수익화 기준, 2배로\n기준\n8,000시간\n최근 12개월 기준\n공식 정책을 확인하세요",
    );
  });

  it.each([
    ["none", []],
    ["number", [
      { role: "value", label: "롱폼", value: "8,000시간" },
      { role: "value", label: "Shorts", value: "2,000만 조회" },
    ]],
    ["comparison", [
      { role: "left", label: "롱폼", value: "8,000시간" },
      { role: "right", label: "Shorts", value: "2,000만 조회" },
    ]],
    ["steps", [
      { role: "step", label: null, value: "주력 포맷 확인" },
      { role: "step", label: null, value: "측정 기간 확인" },
    ]],
    ["quote", [
      { role: "quote", label: null, value: "신뢰는 반복에서 만들어집니다" },
      { role: "attribution", label: null, value: "브랜드 가이드" },
    ]],
  ])("accepts the locked %s relation", (type, entries) => {
    expect(parseStructuredSceneCopyV1(scene(type, entries))).toMatchObject({ keyVisual: { type, entries } });
  });

  it.each([
    ["none with an entry", "none", [{ role: "value", label: null, value: "불필요" }]],
    ["before without after", "before_after", [{ role: "before", label: null, value: "4,000시간" }]],
    ["reversed before/after", "before_after", [
      { role: "after", label: null, value: "8,000시간" },
      { role: "before", label: null, value: "4,000시간" },
    ]],
    ["comparison without labels", "comparison", [
      { role: "left", label: null, value: "8,000시간" },
      { role: "right", label: null, value: "2,000만 조회" },
    ]],
    ["one step", "steps", [{ role: "step", label: null, value: "한 단계" }]],
    ["attribution before quote", "quote", [
      { role: "attribution", label: null, value: "브랜드 가이드" },
      { role: "quote", label: null, value: "신뢰를 만듭니다" },
    ]],
  ])("rejects %s", (_name, type, entries) => {
    expect(() => parseStructuredSceneCopyV1(scene(type, entries))).toThrow("structured_scene_relation_invalid");
  });

  it("rejects unknown keys and invalid text limits", () => {
    expect(() => parseStructuredSceneCopyV1({ ...scene("none", []), copy: "second source" }))
      .toThrow("structured_scene_copy_v1_invalid");
    expect(() => parseStructuredSceneCopyV1({ ...scene("none", []), supportingTexts: ["a", "b", "c"] }))
      .toThrow("structured_scene_copy_v1_invalid");
    expect(() => parseStructuredSceneCopyV1({
      ...scene("number", [{ role: "value", label: null, value: "x".repeat(301) }]),
    })).toThrow("structured_scene_copy_v1_invalid");
  });

  it("keeps the maximum valid structured fields within the 4,000-character legacy limit", () => {
    expect(() => parseStructuredSceneCopyV1({
      ...scene("number", Array.from({ length: 4 }, () => ({
        role: "value", label: "l".repeat(100), value: "v".repeat(300),
      }))),
      headline: "h".repeat(300),
      supportingTexts: ["s".repeat(300), "t".repeat(300)],
      footnote: "f".repeat(300),
    })).not.toThrow();

    const valid = parseStructuredSceneCopyV1({
      ...scene("number", Array.from({ length: 4 }, () => ({
        role: "value", label: "l".repeat(100), value: "v".repeat(300),
      }))),
      headline: "h".repeat(300),
      supportingTexts: ["s".repeat(300), "t".repeat(300)],
      footnote: "f".repeat(300),
    });
    expect(flattenStructuredScene(valid).length).toBeLessThanOrEqual(4_000);
  });
});
