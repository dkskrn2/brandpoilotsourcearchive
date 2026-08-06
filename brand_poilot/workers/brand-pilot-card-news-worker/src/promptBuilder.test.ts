import { describe, expect, it } from "vitest";
import { buildCardNewsPlanPrompt } from "./promptBuilder.js";

const job = { id: "job", generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "card_news", status: "processing", payload: {}, leaseToken: "lease" } as const;

describe("card-news V3 prompt", () => {
  it.each(["informational", "marketing"] as const)("uses an explicit %s purpose branch", (purpose) => {
    const prompt = buildCardNewsPlanPrompt(job, {
      generationId: job.generationId,
      selectedProposal: { assetCount: 2, outline: [] },
      outputSettings: { purpose, outputFormat: "card_news" },
      researchEvidence: { items: [] },
      references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    } as never);
    expect(prompt).toContain(purpose === "informational" ? "정보성 카드뉴스" : "마케팅성 카드뉴스");
    expect(prompt).toContain("card-news-plan.v2");
    expect(prompt).not.toContain("content-generation-input.v2");
  });
});
