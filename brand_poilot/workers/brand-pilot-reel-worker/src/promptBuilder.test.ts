import { describe, expect, it } from "vitest";
import { buildReelPlanPrompt } from "./promptBuilder.js";

describe("reel purpose prompt", () => {
  it.each(["informational", "marketing"] as const)("uses an explicit %s branch", (purpose) => {
    const prompt = buildReelPlanPrompt({
      generationId: "generation-1",
      outputSettings: { outputFormat: "reel", purpose },
      selectedProposal: { assetCount: 2 },
    } as never);
    expect(prompt).toContain(purpose === "informational" ? "정보성 릴스" : "마케팅성 릴스");
    expect(prompt).toContain("reel-plan.v2");
    expect(prompt).not.toContain("marketing-plan.v2");
  });
});
