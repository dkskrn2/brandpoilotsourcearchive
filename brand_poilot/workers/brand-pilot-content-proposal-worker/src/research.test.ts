import { describe, expect, it, vi } from "vitest";
import { createContentProposalResearch } from "./research.js";
import { evidence, researchJob, researchJobWithBase } from "./testFixtures.js";

describe("Proposal V2 research", () => {
  it("searches only from the research arm base input and a public allowlist", async () => {
    const search = vi.fn(async () => evidence);
    const job = researchJob();
    const controller = new AbortController();
    await expect(createContentProposalResearch(search).run(job, controller.signal)).resolves.toEqual(evidence);
    expect(search).toHaveBeenCalledWith({
      purpose: "informational",
      mode: "required",
      evidenceGranularity: "independent_claim",
      publicResearchContext: {
        purpose: "informational",
        subjectKind: "topic_text",
        subjectTitle: "브랜드 운영",
        sourceUrls: null,
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

  it("passes only the exact requested and canonical URLs for a topic URL", async () => {
    const search = vi.fn(async () => evidence);
    const job = researchJob();
    job.baseInput.subject = {
      kind: "topic_url",
      requestedUrl: "http://publisher.example/original",
      canonicalUrl: "http://publisher.example/canonical",
      title: "동결 제목",
      text: "RAW_FROZEN_BODY_MUST_NOT_LEAVE_THE_SNAPSHOT",
      contentHash: "a".repeat(64),
      capturedAt: "2026-08-01T03:00:00.000Z",
    };

    await createContentProposalResearch(search).run(job);

    expect(search).toHaveBeenCalledWith(expect.objectContaining({
      publicResearchContext: expect.objectContaining({
        subjectKind: "topic_url",
        subjectTitle: "동결 제목",
        sourceUrls: {
          requestedUrl: "http://publisher.example/original",
          canonicalUrl: "http://publisher.example/canonical",
        },
      }),
    }));
    expect(JSON.stringify(search.mock.calls[0]![0])).not.toContain(
      "RAW_FROZEN_BODY_MUST_NOT_LEAVE_THE_SNAPSHOT",
    );
  });

  it.each(["complete_body", "partial_body", "metadata_only", "access_failed", "indeterminate"] as const)(
    "ignores the server %s acquisition judgment when researching a topic URL",
    async (status) => {
      const search = vi.fn(async () => evidence);
      const job = researchJob();
      job.baseInput.subject = {
        kind: "topic_url",
        requestedUrl: "https://publisher.example/original",
        canonicalUrl: "https://publisher.example/canonical",
        title: "직접 조사 제목",
        text: "SERVER_COLLECTED_BODY_MUST_NOT_REACH_RESEARCH",
        contentHash: "b".repeat(64),
        capturedAt: "2026-08-01T03:00:00.000Z",
      };
      job.researchSourceAcquisition = {
        contractVersion: "research-source-acquisition.v1",
        status,
        requestedUrl: "https://publisher.example/original",
        canonicalUrl: "https://publisher.example/canonical",
        contentHash: "b".repeat(64),
        capturedAt: "2026-08-01T03:00:00.000Z",
      };

      await createContentProposalResearch(search).run(job);

      const searchInput = search.mock.calls[0]![0];
      expect(searchInput.evidenceGranularity).toBe("independent_claim");
      expect(searchInput).not.toHaveProperty("sourceAcquisition");
      expect(searchInput).not.toHaveProperty("frozenSourceDocument");
      expect(searchInput.publicResearchContext.sourceUrls).toEqual({
        requestedUrl: "https://publisher.example/original",
        canonicalUrl: "https://publisher.example/canonical",
      });
      expect(JSON.stringify(searchInput)).not.toContain("SERVER_COLLECTED_BODY_MUST_NOT_REACH_RESEARCH");
    },
  );

  it.each(["topic_text", "reference"] as const)(
    "sets sourceUrls to null for %s research",
    async (subjectKind) => {
      const search = vi.fn(async () => evidence);
      const input = structuredClone(researchJob().baseInput);
      input.subject = subjectKind === "topic_text"
        ? { kind: "topic_text", title: "주제" }
        : { kind: "reference", referenceIds: ["70000000-0000-4000-8000-000000000007"] };
      const job = researchJobWithBase(input);

      await createContentProposalResearch(search).run(job);

      expect(search.mock.calls[0]![0].publicResearchContext.sourceUrls).toBeNull();
    },
  );
});
