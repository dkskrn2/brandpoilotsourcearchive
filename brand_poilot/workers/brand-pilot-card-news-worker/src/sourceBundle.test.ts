import { describe, expect, it } from "vitest";
import { buildCardDeckSourceBundle } from "./sourceBundle.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const selection = {
  contractVersion: "manual-visual-selection-frozen.v1",
  product: null,
  stylePreset: null,
  avatar: null,
} as const;

function input(subject: unknown) {
  return {
    generationId: id(1),
    subject,
    contentInstruction: "숫자 변화를 가장 먼저 보여 주세요.",
    brandCore: { versionId: id(2), companyOverview: "Brand", primaryTarget: "Creators" },
    brandRules: { versionId: id(3), content: { designRules: { colors: ["red"] } } },
    product: null,
    researchEvidence: {
      contractVersion: "research-evidence.v1", decision: "searched", reason: "최신 기사", queries: ["YPP changes"],
      capturedAt: "2026-08-12T00:00:00.000Z",
      items: [{ id: id(4), title: "New requirements", url: "https://source.example/ypp", claimSummary: "4,000→8,000" }],
    },
    references: {
      selected: [{ referenceItemId: id(5), roles: ["content_reference"], title: "Editorial", sourceUrl: "https://reference.example/one", text: "비교 중심" }],
      brandStyleImages: [{ referenceItemId: id(6), description: "Red editorial", tags: ["red"], storageUrl: "https://cdn.example/style.png" }],
      avatarStyleImageId: id(6),
      attachments: [{ id: id(7), role: "supporting_image", fileName: "youtube.png", storageUrl: "https://cdn.example/youtube.png" }],
    },
    selectedProposal: {
      id: id(8), conceptKey: "change", title: "무엇이 바뀌었나", informationalType: "trend_insight",
      oneLineIntent: "변화를 설명", differentiator: "수치 중심", target: "Creators",
      customerContext: "수익화 준비", keyMessage: "기준이 높아진다", hook: "2배", selectionReason: "핵심 변화",
      evidenceIds: [id(4)], referenceIds: [id(5)], assetCount: 3,
      outline: [1, 2, 3].map((index) => ({ index, role: index === 1 ? "hook" : "detail", headline: `참고 ${index}`, purpose: `참고 목적 ${index}` })),
      purposeDetails: { kind: "informational", question: "무엇이 바뀌나", value: "변화 이해", whyNow: "발표", learningPoints: ["기준"] },
    },
    userImageInstruction: "YouTube red를 활용",
    outputSettings: { purpose: "informational", outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1 },
  } as never;
}

describe("card deck source bundle", () => {
  it.each([
    { kind: "topic_url", requestedUrl: "https://source.example/ypp", canonicalUrl: "https://source.example/ypp", title: "YPP", text: "Full frozen article" },
    { kind: "topic_text", title: "유튜브 수익화 기준" },
    { kind: "reference", referenceIds: [id(5)] },
  ])("preserves complete frozen $kind input in role-specific exact sections", (subject) => {
    const source = input(subject);
    const bundle = buildCardDeckSourceBundle(source, selection);

    expect(Object.keys(bundle)).toEqual([
      "intent", "subject", "subjectReferences", "factualSources", "editorialReferences", "visualReferences", "brandContext",
    ]);
    expect(bundle.subject).toEqual(source.subject);
    expect(bundle.subjectReferences).toEqual(subject.kind === "reference"
      ? [{ title: "Editorial", sourceUrl: "https://reference.example/one", text: "비교 중심" }]
      : []);
    expect(bundle.factualSources.researchEvidence).toEqual(source.researchEvidence);
    expect(bundle.editorialReferences).toEqual(source.references.selected.map(({ roles, title, sourceUrl, text }) => ({
      roles, title, sourceUrl, text,
    })));
    expect(bundle.visualReferences).toEqual({
      explicitUserDirection: source.userImageInstruction,
      stylePreset: null,
      avatar: null,
      attachments: source.references.attachments.map(({ id, role, fileName }) => ({ id, role, fileName })),
    });
    expect(JSON.stringify(bundle)).not.toContain("storageUrl");
    expect(JSON.stringify(bundle)).not.toContain("storagePath");
    expect(JSON.stringify(bundle)).not.toContain("checksum");
    expect(bundle.intent.proposalLens).toEqual({
      angle: source.selectedProposal.title,
      target: source.selectedProposal.target,
      customerContext: source.selectedProposal.customerContext,
      purposeDetails: source.selectedProposal.purposeDetails,
      question: "무엇이 바뀌나",
      whyNow: "발표",
      oneLineIntent: source.selectedProposal.oneLineIntent,
      keyMessage: source.selectedProposal.keyMessage,
      differentiator: source.selectedProposal.differentiator,
      hook: source.selectedProposal.hook,
      informationalType: source.selectedProposal.informationalType,
      assetCount: source.selectedProposal.assetCount,
    });
    expect(bundle.intent).not.toHaveProperty("selectedProposal");
    expect(JSON.stringify(bundle)).not.toContain("참고 목적");
    expect(JSON.stringify(bundle.intent)).not.toContain(`\"evidenceIds\"`);
  });

  it("projects only references selected by a reference subject", () => {
    const source = input({ kind: "reference", referenceIds: [id(5)] });
    source.references.selected.push({
      referenceItemId: id(9), roles: ["content_reference"], title: "Other",
      sourceUrl: "https://reference.example/two", text: "다른 참고 본문",
    });

    expect(buildCardDeckSourceBundle(source, selection).subjectReferences).toEqual([{
      title: "Editorial", sourceUrl: "https://reference.example/one", text: "비교 중심",
    }]);
  });
});
