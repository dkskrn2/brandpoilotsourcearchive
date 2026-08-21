import { describe, expect, it } from "vitest";
import { compileStructuredScene, flattenStructuredScene } from "./structuredSceneCopy.js";
import {
  compileReelStoryboardDraftV1,
  compileReelStoryboardSceneV1,
  parseReelStoryboardV1,
  compileReelStoryboardDraftV2,
  parseReelStoryboardV2,
} from "./reelStoryboard.js";
import type { ContentGenerationInputV3 } from "./generation.js";
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

function v2Input(): ContentGenerationInputV3 {
  const source = structuredClone((awaitlessCardInput as unknown) as ContentGenerationInputV3);
  source.outputSettings = { ...source.outputSettings, outputFormat: "reel", aspectRatio: "9:16" };
  source.selectedProposal = { ...source.selectedProposal, outputFormat: "reel" };
  return source;
}

const awaitlessCardInput = {
  contractVersion: "content-generation-input.v3", generationId: uuid(100),
  brandCore: { versionId: uuid(101), companyOverview: "브랜드", businessDescription: "설명", primaryCategory: "교육", detailedCategory: "AI", primaryTarget: "실무자", differentiator: "정확성", coreAppeal: "실행" },
  brandRules: { versionId: uuid(102), version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "확인", allowed: ["확인"] }, channelRules: { instagram: [] }, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "c".repeat(64) },
  subject: { kind: "topic_text", title: "AI 활용" }, contentInstruction: null, product: null,
  researchEvidence: { contractVersion: "research-evidence.v1", decision: "searched", reason: "근거", queries: ["AI"], capturedAt: "2026-08-21T00:00:00.000Z", items: [
    { id: uuid(1), title: "도입", url: "https://source.example/1", publisher: "Source", publishedAt: null, capturedAt: "2026-08-21T00:00:00.000Z", claimSummary: "도입률 80%", contentHash: "a".repeat(64) },
    { id: uuid(2), title: "격차", url: "https://source.example/2", publisher: "Source", publishedAt: null, capturedAt: "2026-08-21T00:00:00.000Z", claimSummary: "격차 3.2%p", contentHash: "b".repeat(64) },
  ] },
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: { id: uuid(103), conceptKey: "evidence", title: "근거 중심", informationalType: "trend_insight", oneLineIntent: "핵심", differentiator: "수치", differentiationAxes: ["narrative"], target: "실무자", customerContext: "검토", keyMessage: "근거", hook: "변화", selectionReason: "정보", evidenceIds: [uuid(1)], referenceIds: [], outputFormat: "reel", channelTargets: ["instagram"], assetCount: 1, outline: [{ index: 1, role: "hook", headline: "현황", purpose: "핵심" }], purposeDetails: { kind: "informational", question: "무엇", value: "판단", whyNow: "지금", learningPoints: ["도입"] } },
  userImageInstruction: null, outputSettings: { outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1, purpose: "informational" }, capturedAt: "2026-08-21T00:00:00.000Z",
} as const;

function v2Storyboard() {
  return {
    contractVersion: "reel-storyboard.v2",
    content: { caption: "캡션", hashtags: ["#AI"], cta: "확인" },
    storyNarrative: "핵심 사실에서 의미로 전진한다.",
    evidenceSelection: { selectedEvidenceIds: [uuid(1)], excludedEvidenceIds: [uuid(2)] },
    scenes: [{ index: 1, editorialRole: "hook", purpose: "핵심 발견", coreMessage: "도입과 격차를 확인한다.", headline: "AI 도입, 숫자로 확인", informationRelation: { type: "related_facts", entries: [{ role: "adoption", label: "도입", value: "80%" }, { role: "gap", label: "격차", value: "3.2%p" }] }, supportingTexts: [], footnote: null, evidenceIds: [uuid(1)], productImageAssetIds: [], avatarImageAssetIds: [] }],
  };
}

describe("reel-storyboard.v2", () => {
  it("partitions the complete Evidence pool and binds selected Evidence to the scene union", () => {
    const input = v2Input();
    expect(parseReelStoryboardV2(v2Storyboard(), input).evidenceSelection.excludedEvidenceIds).toEqual([uuid(2)]);
    expect(() => parseReelStoryboardV2({ ...v2Storyboard(), evidenceSelection: { selectedEvidenceIds: [uuid(1)], excludedEvidenceIds: [] } }, input)).toThrow("reel_storyboard_evidence_partition_invalid");
    expect(() => parseReelStoryboardV2({ ...v2Storyboard(), scenes: [{ ...v2Storyboard().scenes[0], evidenceIds: [] }] }, input)).toThrow("reel_storyboard_evidence_partition_invalid");
  });

  it("requires Evidence for informational factual scenes and validates Card-equivalent relations", () => {
    const input = v2Input();
    const empty = { ...v2Storyboard(), evidenceSelection: { selectedEvidenceIds: [], excludedEvidenceIds: [uuid(1), uuid(2)] }, scenes: [{ ...v2Storyboard().scenes[0], editorialRole: "analysis", evidenceIds: [] }] };
    expect(() => parseReelStoryboardV2(empty, input)).toThrow("reel_storyboard_scene_evidence_required");
    expect(parseReelStoryboardV2({ ...empty, scenes: [{ ...empty.scenes[0], editorialRole: "cta" }] }, input).scenes[0]?.evidenceIds).toEqual([]);
    expect(() => parseReelStoryboardV2({ ...v2Storyboard(), scenes: [{ ...v2Storyboard().scenes[0], informationRelation: { type: "before_after", entries: [{ role: "left", label: null, value: "80%" }, { role: "right", label: null, value: "83%" }] } }] }, input)).toThrow("card_manuscript_information_relation_invalid");
  });

  it("rejects planner design fields and projects semantic copy deterministically", () => {
    const input = v2Input();
    expect(() => parseReelStoryboardV2({ ...v2Storyboard(), visualSystem: {} }, input)).toThrow("reel_storyboard_v2_invalid");
    const parsed = parseReelStoryboardV2(v2Storyboard(), input);
    const draft = compileReelStoryboardDraftV2(parsed, input.selectedProposal.outline);
    expect(draft.assets[0]?.copy).toContain("도입\n80%\n격차\n3.2%p");
    expect(draft.assets[0]?.visualDirection).toContain("image model owns composition");
  });

  it("rejects repeated scene headlines and core messages like the Card contract", () => {
    const input = v2Input();
    input.selectedProposal = {
      ...input.selectedProposal,
      assetCount: 2,
      outline: [
        input.selectedProposal.outline[0]!,
        { index: 2, role: "detail", headline: "격차", purpose: "격차 설명" },
      ],
    };
    const first = v2Storyboard().scenes[0]!;
    const second = {
      ...first,
      index: 2,
      editorialRole: "detail",
      purpose: "격차 설명",
      coreMessage: "격차를 설명한다.",
      headline: "격차는 3.2%p",
      evidenceIds: [uuid(2)],
    };
    const storyboard = {
      ...v2Storyboard(),
      evidenceSelection: { selectedEvidenceIds: [uuid(1), uuid(2)], excludedEvidenceIds: [] },
      scenes: [first, second],
    };

    expect(parseReelStoryboardV2(storyboard, input).scenes).toHaveLength(2);
    expect(() => parseReelStoryboardV2({
      ...storyboard,
      scenes: [first, { ...second, headline: first.headline }],
    }, input)).toThrow("reel_storyboard_v2_invalid");
    expect(() => parseReelStoryboardV2({
      ...storyboard,
      scenes: [first, { ...second, coreMessage: first.coreMessage }],
    }, input)).toThrow("reel_storyboard_v2_invalid");
  });
});
