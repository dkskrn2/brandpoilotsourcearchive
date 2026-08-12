import { describe, expect, it } from "vitest";
import { compileStructuredScene, flattenStructuredScene } from "./structuredSceneCopy.js";
import {
  compileReelStoryboardDraftV1,
  compileReelStoryboardSceneV1,
  parseReelStoryboardV1,
} from "./reelStoryboard.js";
import { reelStoryboardSha256 } from "./reelStoryboardNode.js";

const uuid = (suffix: number): string => `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

function storyboardFixture(): unknown {
  return {
    contractVersion: "reel-storyboard.v1",
    content: {
      caption: "새 기준의 핵심 수치를 확인하세요.",
      hashtags: ["#유튜브", "#수익화"],
      cta: "YouTube Studio에서 진행률을 확인하세요.",
    },
    storyNarrative: "변경 발표에서 수치 비교와 다음 행동으로 이어진다.",
    visualSystem: {
      paletteDirection: "흰색 바탕, 빨강 강조, 검정 본문",
      typographyDirection: "세로 화면에서 읽히는 굵은 제목과 큰 숫자",
      graphicLanguage: "편집형 인포그래픽과 얇은 구분선",
      imageryDirection: "수치 중심, 장식 최소화",
      invariants: ["모든 장면에 같은 여백 체계", "같은 아이콘 재질"],
    },
    scenes: [
      {
        index: 1,
        editorialRole: "hook",
        purpose: "변경 사실을 첫 화면에서 알린다.",
        coreMessage: "새 수익화 기준이 높아진다.",
        headline: "유튜브 수익화 문턱, 2배로",
        keyVisual: { type: "number", entries: [{ role: "value", label: "적용", value: "2027년" }] },
        supportingTexts: ["롱폼·Shorts 새 기준 정리"],
        footnote: "신규 신청자 기준",
        visualThesis: "2배 변화가 세로 화면에서 가장 먼저 보인다.",
        layoutArchetype: "vertical_hook",
        evidenceIds: [uuid(1)],
        productImageAssetIds: [],
      },
      {
        index: 2,
        editorialRole: "comparison",
        purpose: "롱폼 전후 기준을 비교한다.",
        coreMessage: "롱폼 기준이 두 배가 된다.",
        headline: "롱폼은 4,000시간에서 8,000시간으로",
        keyVisual: {
          type: "before_after",
          entries: [
            { role: "before", label: "기존", value: "4,000시간" },
            { role: "after", label: "변경", value: "8,000시간" },
          ],
        },
        supportingTexts: ["측정 기간은 최근 365일"],
        footnote: null,
        visualThesis: "4,000에서 8,000으로 오르는 관계를 지배적으로 표현한다.",
        layoutArchetype: "before_after",
        evidenceIds: [uuid(1)],
        productImageAssetIds: [],
      },
    ],
  };
}

describe("reel-storyboard.v1", () => {
  it("uses one storyboard as the authored source for the Reel", () => {
    const storyboard = parseReelStoryboardV1(storyboardFixture());

    expect(storyboard.contractVersion).toBe("reel-storyboard.v1");
    expect(storyboard.scenes.map(({ index }) => index)).toEqual([1, 2]);
    expect(storyboard.scenes[1]?.keyVisual.type).toBe("before_after");
  });

  it("derives the compatibility draft and exact visible copy from the storyboard only", () => {
    const storyboard = parseReelStoryboardV1(storyboardFixture());
    const outline = storyboard.scenes.map(({ index }) => ({ index, role: `compatibility-${index}` }));
    const scene = compileReelStoryboardSceneV1(storyboard, storyboard.scenes[0]!, outline[0]!.role);
    const draft = compileReelStoryboardDraftV1(storyboard, outline);

    expect(draft.assets[0]).toEqual(compileStructuredScene(scene));
    expect(draft.assets[0]?.copy).toBe(flattenStructuredScene(scene));
    expect(draft.assets[0]?.role).toBe("compatibility-1");
    expect(scene.visualDirection).toContain(storyboard.storyNarrative);
    expect(scene.visualDirection).toContain(storyboard.visualSystem.invariants[0]!);
  });

  it("hashes the canonical storyboard independent of object key order", () => {
    const first = parseReelStoryboardV1(storyboardFixture());
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()
        .map(([key, child]) => [key, reverseKeys(child)]));
    };

    expect(reelStoryboardSha256(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(reelStoryboardSha256(first))
      .toBe(reelStoryboardSha256(parseReelStoryboardV1(reverseKeys(storyboardFixture()))));
  });

  it.each([
    ["unknown key", (value: any) => { value.unknown = true; }],
    ["empty scenes", (value: any) => { value.scenes = []; }],
    ["discontinuous index", (value: any) => { value.scenes[1].index = 3; }],
    ["invalid layout", (value: any) => { value.scenes[0].layoutArchetype = "poster"; }],
    ["duplicate evidence", (value: any) => { value.scenes[0].evidenceIds = [uuid(1), uuid(1)]; }],
  ])("rejects %s", (_name, mutate) => {
    const value = structuredClone(storyboardFixture());
    mutate(value);

    expect(() => parseReelStoryboardV1(value)).toThrow("reel_storyboard_v1_invalid");
  });

  it("rejects an outline compatibility mismatch", () => {
    const storyboard = parseReelStoryboardV1(storyboardFixture());

    expect(() => compileReelStoryboardDraftV1(storyboard, [{ index: 1, role: "hook" }]))
      .toThrow("reel_storyboard_outline_mismatch");
  });
});
