import { describe, expect, it } from "vitest";

const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function input() {
  return {
    selectedProposal: {
      assetCount: 1,
      outline: [{ index: 1, role: "comparison", headline: "Planning headline", purpose: "Explain the change" }],
    },
    researchEvidence: { items: [{ id: uid(1) }] },
    product: { images: [{ assetId: uid(2) }] },
  } as never;
}

function draft() {
  return {
    contractVersion: "card-news-plan-draft.v2",
    content: { caption: "변화를 설명합니다.", hashtags: ["#가이드"], cta: "저장해 두세요." },
    assets: [{
      index: 1,
      role: "comparison",
      coreMessage: "롱폼 시청시간 기준이 두 배가 된다.",
      headline: "롱폼은 2배",
      keyVisual: { type: "before_after", texts: ["4,000시간", "8,000시간"] },
      supportingTexts: ["최근 12개월"],
      footnote: "신규 YPP 기준",
      visualDirection: "두 수치를 좌우로 명확하게 비교",
      evidenceIds: [uid(1)],
      productImageAssetIds: [uid(2)],
    }],
  };
}

type EditorialModule = {
  parseStructuredCardNewsPlanDraftForInput(value: unknown, input: unknown): {
    contractVersion: string;
    assets: Array<Record<string, unknown>>;
  };
};

async function editorial(): Promise<EditorialModule> {
  return import("./editorialPlan.js") as unknown as Promise<EditorialModule>;
}

describe("structured card-news scene draft", () => {
  it("compiles the display hierarchy to the existing v1 API draft", async () => {
    const module = await editorial();
    const compiled = module.parseStructuredCardNewsPlanDraftForInput(draft(), input());

    expect(compiled.contractVersion).toBe("card-news-plan-draft.v1");
    expect(compiled.assets[0]).toEqual({
      index: 1,
      role: "comparison",
      copy: "롱폼은 2배\n4,000시간\n8,000시간\n최근 12개월\n신규 YPP 기준",
      visualDirection: expect.stringMatching(/keyVisual=before_after:2.*supportingTexts=1.*footnote=1.*두 수치를 좌우로 명확하게 비교/s),
      evidenceIds: [uid(1)],
      productImageAssetIds: [uid(2)],
    });
    expect(compiled.assets[0]).not.toHaveProperty("coreMessage");
    expect(compiled.assets[0]).not.toHaveProperty("headline");
    expect(compiled.assets[0]).not.toHaveProperty("keyVisual");
  });

  it("keeps optional visual text empty without inventing filler", async () => {
    const module = await editorial();
    const value = draft();
    value.assets[0]!.keyVisual = { type: "none", texts: [] };
    value.assets[0]!.supportingTexts = [];
    value.assets[0]!.footnote = null as never;

    const compiled = module.parseStructuredCardNewsPlanDraftForInput(value, input());

    expect(compiled.assets[0]!.copy).toBe("롱폼은 2배");
    expect(compiled.assets[0]!.visualDirection).toMatch(/keyVisual=none:0.*supportingTexts=0.*footnote=0/s);
  });

  it.each([
    ["blank headline", (value: ReturnType<typeof draft>) => { value.assets[0]!.headline = "   "; }],
    ["too many key visual texts", (value: ReturnType<typeof draft>) => { value.assets[0]!.keyVisual.texts = ["1", "2", "3", "4", "5"]; }],
    ["too many supporting texts", (value: ReturnType<typeof draft>) => { value.assets[0]!.supportingTexts = ["1", "2", "3"]; }],
    ["unknown field", (value: ReturnType<typeof draft>) => { Object.assign(value.assets[0]!, { copy: "forbidden" }); }],
  ])("rejects %s before API completion", async (_name, mutate) => {
    const module = await editorial();
    const value = draft();
    mutate(value);
    expect(() => module.parseStructuredCardNewsPlanDraftForInput(value, input()))
      .toThrow("card_news_plan_invalid");
  });
});
