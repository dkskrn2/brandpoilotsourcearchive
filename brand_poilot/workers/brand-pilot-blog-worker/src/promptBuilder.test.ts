import { describe, expect, it } from "vitest";
import { buildBlogPlanPrompt } from "./promptBuilder.js";

const job = { id: "job", generationId: "generation", outputId: "output", workspaceId: "workspace", brandId: "brand", jobType: "generate", outputFormat: "blog", status: "processing", payload: {}, leaseToken: "lease" } as const;

describe("blog V3 prompt", () => {
  it.each(["informational", "marketing"] as const)("uses an explicit %s purpose branch", (purpose) => {
    const prompt = buildBlogPlanPrompt(job, { researchEvidence: { items: [] }, outputSettings: { purpose, outputFormat: "blog" } } as never, null);
    expect(prompt).toContain(purpose === "informational" ? "정보성 블로그" : "마케팅성 블로그");
    expect(prompt).toContain("blog-plan.v2");
    expect(prompt).not.toContain("content-generation-input.v2");
  });
});
