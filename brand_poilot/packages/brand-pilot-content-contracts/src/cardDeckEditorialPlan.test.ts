import { describe, expect, it } from "vitest";
import { compileStructuredScene, flattenStructuredScene } from "./structuredSceneCopy.js";
import {
  compileCardDeckPlanDraftV1,
  compileCardDeckSceneV1,
  parseCardDeckEditorialPlanV1,
} from "./cardDeckEditorialPlan.js";
import { cardDeckEditorialPlanSha256 } from "./cardDeckEditorialPlanNode.js";

const uuid = (suffix: number): string => `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

function deckFixture(): unknown {
  return {
    contractVersion: "card-deck-editorial-plan.v1",
    content: {
      caption: "새 기준의 핵심 수치를 확인하세요.",
      hashtags: ["#유튜브", "#수익화"],
      cta: "YouTube Studio에서 진행률을 확인하세요.",
    },
    deckNarrative: "변경 발표 → 핵심 비교 → 준비 행동",
    visualSystem: {
      paletteDirection: "흰색 바탕, 빨강 강조, 검정 본문",
      typographyDirection: "굵은 제목과 큰 숫자",
      graphicLanguage: "편집형 인포그래픽과 얇은 구분선",
      imageryDirection: "수치 중심, 장식 최소화",
      invariants: ["모든 카드에 같은 여백 체계", "좌측 상단 장면 번호"],
    },
    scenes: [
      {
        index: 1,
        editorialRole: "cover",
        purpose: "변경 사실을 발표한다.",
        coreMessage: "새 수익화 기준이 높아진다.",
        headline: "유튜브 수익화 문턱, 2배로",
        keyVisual: { type: "number", entries: [{ role: "value", label: "적용", value: "2027년" }] },
        supportingTexts: ["롱폼·Shorts 새 기준 정리"],
        footnote: "신규 신청자 기준",
        visualThesis: "2배 변화가 가장 먼저 보인다.",
        layoutArchetype: "cover_editorial",
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
        evidenceIds: [uuid(1), uuid(2)],
        productImageAssetIds: [],
      },
      {
        index: 3,
        editorialRole: "detail",
        purpose: "Shorts 기준을 설명한다.",
        coreMessage: "Shorts 기준도 두 배가 된다.",
        headline: "Shorts는 2,000만 조회로",
        keyVisual: { type: "number", entries: [{ role: "value", label: "최근 90일", value: "2,000만 조회" }] },
        supportingTexts: [],
        footnote: "유효 공개 조회수 기준",
        visualThesis: "2,000만을 가장 크게 표현한다.",
        layoutArchetype: "stat_focus",
        evidenceIds: [uuid(2)],
        productImageAssetIds: [],
      },
      {
        index: 4,
        editorialRole: "action",
        purpose: "준비 순서를 정리한다.",
        coreMessage: "신청 전에 진행률과 주력 포맷을 점검한다.",
        headline: "신청 전 세 가지를 확인하세요",
        keyVisual: {
          type: "steps",
          entries: [
            { role: "step", label: "01", value: "진행률 확인" },
            { role: "step", label: "02", value: "주력 포맷 선택" },
            { role: "step", label: "03", value: "공개 성과 집중" },
          ],
        },
        supportingTexts: ["기존 참여자는 새 진입 기준 대상 아님"],
        footnote: "공식 안내에서 적용 범위 재확인",
        visualThesis: "세 행동을 순서대로 읽게 한다.",
        layoutArchetype: "checklist",
        evidenceIds: [uuid(1)],
        productImageAssetIds: [],
      },
    ],
  };
}

describe("card-deck-editorial-plan.v1", () => {
  it("parses one deck source with typed visual relations", () => {
    const deck = parseCardDeckEditorialPlanV1(deckFixture());

    expect(deck.contractVersion).toBe("card-deck-editorial-plan.v1");
    expect(deck.scenes.map(({ index }) => index)).toEqual([1, 2, 3, 4]);
    expect(deck.scenes[1]?.keyVisual).toEqual({
      type: "before_after",
      entries: [
        { role: "before", label: "기존", value: "4,000시간" },
        { role: "after", label: "변경", value: "8,000시간" },
      ],
    });
  });

  it("derives compatibility scenes and legacy copy from the deck only", () => {
    const deck = parseCardDeckEditorialPlanV1(deckFixture());
    const outline = deck.scenes.map(({ index }) => ({ index, role: `compatibility-${index}` }));
    const scene = compileCardDeckSceneV1(deck, deck.scenes[0]!, outline[0]!.role);
    const draft = compileCardDeckPlanDraftV1(deck, outline);

    expect(draft.assets[0]).toEqual(compileStructuredScene(scene));
    expect(draft.assets[0]?.copy).toBe(flattenStructuredScene(scene));
    expect(draft.assets[0]?.role).toBe("compatibility-1");
    expect(draft.assets[0]).not.toHaveProperty("editorialRole");
    expect(scene.visualDirection).toContain(deck.visualSystem.invariants[0]!);
    expect(scene.visualDirection).toContain(deck.scenes[0]!.visualThesis);
  });

  it("hashes canonical deck values deterministically", () => {
    const first = parseCardDeckEditorialPlanV1(deckFixture());
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse()
        .map(([key, child]) => [key, reverseKeys(child)]));
    };
    const reordered = reverseKeys(deckFixture());

    expect(cardDeckEditorialPlanSha256(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(cardDeckEditorialPlanSha256(first)).toBe(cardDeckEditorialPlanSha256(parseCardDeckEditorialPlanV1(reordered)));
  });

  it.each([1, 2])("accepts a valid %i-scene deck", (sceneCount) => {
    const value = structuredClone(deckFixture()) as any;
    value.scenes = value.scenes.slice(0, sceneCount);

    const deck = parseCardDeckEditorialPlanV1(value);
    const outline = deck.scenes.map(({ index }) => ({ index, role: `scene-${index}` }));

    expect(deck.scenes).toHaveLength(sceneCount);
    expect(compileCardDeckPlanDraftV1(deck, outline).assets).toHaveLength(sceneCount);
  });

  it.each([
    ["unknown key", (value: any) => { value.unknown = true; }],
    ["invalid scene count", (value: any) => { value.scenes = []; }],
    ["discontinuous index", (value: any) => { value.scenes[2].index = 4; }],
    ["empty invariants", (value: any) => { value.visualSystem.invariants = []; }],
    ["invalid layout", (value: any) => { value.scenes[0].layoutArchetype = "poster"; }],
    ["invalid relation", (value: any) => { value.scenes[1].keyVisual.entries.reverse(); }],
    ["duplicate evidence", (value: any) => { value.scenes[1].evidenceIds = [uuid(1), uuid(1)]; }],
    ["duplicate hashtag", (value: any) => { value.content.hashtags = ["#유튜브", "#유튜브"]; }],
    ["duplicate product image", (value: any) => { value.scenes[0].productImageAssetIds = [uuid(9), uuid(9)]; }],
    ["over-limit headline", (value: any) => { value.scenes[0].headline = "가".repeat(301); }],
  ])("rejects %s", (_name, mutate) => {
    const value = structuredClone(deckFixture());
    mutate(value);

    expect(() => parseCardDeckEditorialPlanV1(value)).toThrow("card_deck_editorial_plan_v1_invalid");
  });

  it("rejects outline count, index, and role mismatches", () => {
    const deck = parseCardDeckEditorialPlanV1(deckFixture());

    expect(() => compileCardDeckPlanDraftV1(deck, deck.scenes.slice(1).map(({ index }) => ({ index, role: "detail" }))))
      .toThrow("card_deck_outline_mismatch");
    expect(() => compileCardDeckPlanDraftV1(deck, deck.scenes.map(({ index }) => ({ index: index + 1, role: "detail" }))))
      .toThrow("card_deck_outline_mismatch");
    expect(() => compileCardDeckPlanDraftV1(deck, deck.scenes.map(({ index }) => ({ index, role: " " }))))
      .toThrow("card_deck_outline_mismatch");
  });
});
