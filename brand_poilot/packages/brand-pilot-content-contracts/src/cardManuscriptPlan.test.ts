import { describe, expect, it } from "vitest";
import type { ContentGenerationInputV3 } from "./generation.js";
import {
  CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
  compileCardManuscriptPlanDraftV1,
  parseCardManuscriptPlanV1,
} from "./cardManuscriptPlan.js";
import { cardManuscriptPlanSha256 } from "./cardManuscriptPlanNode.js";

const evidenceA = "10000000-0000-4000-8000-000000000001";
const evidenceB = "10000000-0000-4000-8000-000000000002";

function frozenInput(): ContentGenerationInputV3 {
  const item = (id: string, claimSummary: string) => ({
    id,
    title: claimSummary,
    url: `https://source.example/${id}`,
    publisher: "Source",
    publishedAt: null,
    capturedAt: "2026-08-18T00:00:00.000Z",
    claimSummary,
    contentHash: id === evidenceA ? "a".repeat(64) : "b".repeat(64),
  });
  return {
    contractVersion: "content-generation-input.v3",
    generationId: "20000000-0000-4000-8000-000000000001",
    brandCore: {
      versionId: "30000000-0000-4000-8000-000000000001",
      companyOverview: "브랜드",
      businessDescription: "설명",
      primaryCategory: "교육",
      detailedCategory: "AI",
      primaryTarget: "실무자",
      differentiator: "정확성",
      coreAppeal: "실행 가능성",
    },
    brandRules: {
      versionId: "30000000-0000-4000-8000-000000000002",
      version: 1,
      content: {
        contractVersion: "brand-rules.v1",
        requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
        ctaRules: { defaultCta: "확인", allowed: ["확인"] },
        channelRules: { instagram: [] },
        designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
      contentSha256: "c".repeat(64),
    },
    subject: { kind: "topic_text", title: "AI 활용" },
    contentInstruction: null,
    product: null,
    researchEvidence: {
      contractVersion: "research-evidence.v1",
      decision: "searched",
      reason: "근거",
      queries: ["AI 활용"],
      capturedAt: "2026-08-18T00:00:00.000Z",
      items: [item(evidenceA, "도입률 80%"), item(evidenceB, "격차 3.2%p")],
    },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: "40000000-0000-4000-8000-000000000001",
      conceptKey: "evidence-led",
      title: "근거 중심",
      informationalType: "trend_insight",
      oneLineIntent: "핵심 사실을 설명",
      differentiator: "구체적 수치",
      differentiationAxes: ["narrative"],
      target: "실무자",
      customerContext: "도입 검토",
      keyMessage: "근거로 판단",
      hook: "무엇이 달라졌나",
      selectionReason: "정보 가치",
      evidenceIds: [evidenceA],
      referenceIds: [],
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      assetCount: 1,
      outline: [{ index: 1, role: "hook", headline: "도입 현황", purpose: "핵심 사실" }],
      purposeDetails: {
        kind: "informational",
        question: "어떤 변화인가",
        value: "판단 근거",
        whyNow: "지금",
        learningPoints: ["도입률"],
      },
    },
    userImageInstruction: null,
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
      purpose: "informational",
    },
    capturedAt: "2026-08-18T00:00:00.000Z",
  };
}

function manuscript(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "card-manuscript-plan.v1",
    content: { caption: "캡션", hashtags: ["#AI"], cta: "확인하세요" },
    deckNarrative: "핵심 사실에서 의미로 전진한다.",
    evidenceSelection: {
      selectedEvidenceIds: [evidenceA],
      excludedEvidenceIds: [evidenceB],
    },
    scenes: [{
      index: 1,
      editorialRole: "hook",
      purpose: "핵심 발견을 소개한다.",
      coreMessage: "도입과 격차를 함께 봐야 한다.",
      headline: "AI 도입, 숫자로 확인하세요",
      informationRelation: {
        type: "related_facts",
        entries: [
          { role: "adoption", label: "도입", value: "80%" },
          { role: "gap", label: "격차", value: "3.2%p" },
        ],
      },
      supportingTexts: ["서로 다른 독립 지표입니다."],
      footnote: "동일 분모의 직접 비교가 아닙니다.",
      evidenceIds: [evidenceA],
      productImageAssetIds: [],
      avatarImageAssetIds: [],
    }],
    ...overrides,
  };
}

describe("Card Manuscript Plan v1", () => {
  it("requires selected/excluded to partition the full pool and selected to equal the scene union", () => {
    const input = frozenInput();
    expect(() => parseCardManuscriptPlanV1(manuscript({
      evidenceSelection: { selectedEvidenceIds: [evidenceA], excludedEvidenceIds: [] },
    }), input)).toThrow("card_manuscript_evidence_partition_invalid");
    expect(() => parseCardManuscriptPlanV1(manuscript({
      scenes: [{ ...manuscript().scenes[0], evidenceIds: [] }],
    }), input)).toThrow("card_manuscript_evidence_partition_invalid");
  });

  it("requires factual informational scenes to carry evidence but permits transition and cta", () => {
    const input = frozenInput();
    const noEvidence = manuscript({
      evidenceSelection: { selectedEvidenceIds: [], excludedEvidenceIds: [evidenceA, evidenceB] },
      scenes: [{ ...manuscript().scenes[0], editorialRole: "analysis", evidenceIds: [] }],
    });
    expect(() => parseCardManuscriptPlanV1(noEvidence, input))
      .toThrow("card_manuscript_scene_evidence_required");
    expect(parseCardManuscriptPlanV1({
      ...noEvidence,
      scenes: [{ ...noEvidence.scenes[0], editorialRole: "transition" }],
    }, input).scenes[0]!.evidenceIds).toEqual([]);
  });

  it("validates semantic relation shapes without treating related facts as a comparison", () => {
    const input = frozenInput();
    expect(parseCardManuscriptPlanV1(manuscript(), input).scenes[0]!.informationRelation.type)
      .toBe("related_facts");
    expect(() => parseCardManuscriptPlanV1(manuscript({
      scenes: [{
        ...manuscript().scenes[0],
        informationRelation: {
          type: "before_after",
          entries: [{ role: "left", label: null, value: "80%" }, { role: "right", label: null, value: "83%" }],
        },
      }],
    }), input)).toThrow("card_manuscript_information_relation_invalid");
  });

  it("projects deterministically without rewriting evidence or relation semantics", () => {
    const input = frozenInput();
    const source = parseCardManuscriptPlanV1(manuscript(), input);
    const result = compileCardManuscriptPlanDraftV1(source, input.selectedProposal.outline);

    expect(source.scenes[0]!.informationRelation.type).toBe("related_facts");
    expect(result.assets[0]).toMatchObject({
      index: 1,
      role: "hook",
      evidenceIds: [evidenceA],
      productImageAssetIds: [],
      visualDirection: CARD_MANUSCRIPT_COMPATIBILITY_VISUAL_DIRECTION,
    });
    expect(result.assets[0]!.copy).toContain("도입\n80%\n격차\n3.2%p");
  });

  it("hashes the parsed manuscript canonically", () => {
    const parsed = parseCardManuscriptPlanV1(manuscript(), frozenInput());
    expect(cardManuscriptPlanSha256(parsed)).toMatch(/^[0-9a-f]{64}$/);
    expect(cardManuscriptPlanSha256(parsed)).toBe(cardManuscriptPlanSha256(structuredClone(parsed)));
  });
});
