import { describe, expect, it, vi } from "vitest";
import { createContentProposalResearch } from "./research.js";
import { evidence, researchJob } from "./testFixtures.js";

describe("Proposal V2 research", () => {
  it("searches only from the research arm base input and a public allowlist", async () => {
    const search = vi.fn(async () => evidence);
    const job = researchJob();
    const controller = new AbortController();
    await expect(createContentProposalResearch(search).run(job, controller.signal)).resolves.toEqual(evidence);
    expect(search).toHaveBeenCalledWith({
      purpose: "informational",
      mode: "required",
      publicResearchContext: {
        purpose: "informational",
        subjectKind: "topic_text",
        subjectTitle: "브랜드 운영",
        contentInstruction: "실무 중심",
        primaryCategory: "교육",
        detailedCategory: "온라인 교육",
        selectedProduct: null,
      },
      signal: controller.signal,
    });
    const serialized = JSON.stringify(search.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(job.leaseToken);
    expect(serialized).not.toContain(job.contract.enqueueContractSha256);
  });
});
