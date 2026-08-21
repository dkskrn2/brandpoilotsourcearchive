import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildProvisionalBrandContext,
  parseOnboardingContentStart,
  parseOnboardingContentSnapshot,
  parseOnboardingProposalAuthority,
  createOnboardingContentService,
} from "./onboardingContent.js";

const analysisId = "10000000-0000-4000-8000-000000000001";
const suggestionId = "20000000-0000-4000-8000-000000000001";
const suggestion = {
  id: suggestionId,
  subcategoryCode: "content_marketing",
  subcategoryName: "콘텐츠 마케팅",
  intent: "trend" as const,
  title: "고객이 저장하는 브랜드 콘텐츠",
  whyNow: "저장형 콘텐츠 반응이 높아지고 있습니다.",
  contentBrief: "실행 가능한 체크리스트로 구성합니다.",
  sources: [{
    url: "https://source.example/article",
    title: "콘텐츠 자료",
    publisher: "Source",
    publishedAt: null,
  }],
};

describe("parseOnboardingContentStart", () => {
  it("keeps an omitted user instruction as null", () => {
    expect(parseOnboardingContentStart({
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-request-1",
    })).toMatchObject({ contentInstruction: null });
  });

  it("rejects unknown fields and an empty subcategory selection", () => {
    expect(() => parseOnboardingContentStart({
      categoryCode: "marketing_advertising",
      subcategoryCodes: [],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-request-1",
    })).toThrow("onboarding_content_subcategories_invalid");
    expect(() => parseOnboardingContentStart({
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-request-1",
      extra: true,
    })).toThrow("onboarding_content_unknown_field");
  });
});

describe("buildProvisionalBrandContext", () => {
  it("builds conservative non-approved Core and Rules snapshots", () => {
    const prepared = buildProvisionalBrandContext({
      analysisId,
      brandName: "모종",
      ownedUrl: "https://brand.example/",
      ownedExcerpt: "모종은 작은 브랜드가 꾸준히 콘텐츠를 운영하도록 돕습니다.",
      category: { code: "marketing_advertising", name: "마케팅·광고" },
      subcategories: [{ code: "content_marketing", name: "콘텐츠 마케팅" }],
      suggestion,
    });

    expect(prepared.brandCore).toMatchObject({
      versionId: analysisId,
      primaryCategory: "마케팅·광고",
      detailedCategory: "콘텐츠 마케팅",
    });
    expect(prepared.brandRules.content.autoApprovalRules.enabled).toBe(false);
    expect(prepared.brandRules.content.designRules.referenceImages).toEqual([]);
    expect(prepared.authority).toEqual({
      kind: "onboarding_provisional",
      analysisId,
      ownedUrl: "https://brand.example/",
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      sourceUrls: ["https://source.example/article"],
    });
  });
});

describe("parseOnboardingContentSnapshot", () => {
  it("rejects a linked state with an invalid request fingerprint", () => {
    expect(() => parseOnboardingContentSnapshot({
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestion,
      contentInstruction: null,
      requestFingerprint: "not-a-hash",
      proposalBatchId: null,
      generationId: null,
      requestedAt: "2026-08-14T00:00:00.000Z",
    })).toThrow("onboarding_content_snapshot_invalid");
  });
});

describe("parseOnboardingProposalAuthority", () => {
  it("rejects provisional rules whose canonical hash does not match", () => {
    const prepared = buildProvisionalBrandContext({
      analysisId,
      brandName: "모종",
      ownedUrl: "https://brand.example/",
      ownedExcerpt: null,
      category: { code: "marketing_advertising", name: "마케팅·광고" },
      subcategories: [{ code: "content_marketing", name: "콘텐츠 마케팅" }],
      suggestion,
    });
    expect(() => parseOnboardingProposalAuthority({
      ...prepared.authority,
      brandRules: { ...prepared.brandRules, contentSha256: "f".repeat(64) },
    })).toThrow("onboarding_content_authority_invalid");
  });
});

describe("createOnboardingContentService", () => {
  function fixture() {
    let stored: any = null;
    const generation = {
      id: "50000000-0000-4000-8000-000000000001",
      status: "generating",
      title: suggestion.title,
      currentStage: "generation",
      outputs: [],
      errorCode: null,
      errorMessage: null,
    };
    const dependencies: any = {
      brandIntelligence: {
        getBrandAnalysis: vi.fn(async () => ({
          id: analysisId,
          status: "analyzing",
          input: { companyName: "모종", ownedUrl: "https://brand.example/", uploadIds: [] },
          evidence: [],
        })),
        getBrandCompanyName: vi.fn(async () => ({ name: "모종", state: "provisional" })),
        getOnboardingContent: vi.fn(async () => stored),
        saveOnboardingContentSelection: vi.fn(async ({ snapshot }: any) => (stored = snapshot)),
        linkOnboardingProposalBatch: vi.fn(async ({ proposalBatchId }: any) => (
          stored = { ...stored, proposalBatchId }
        )),
        linkOnboardingGeneration: vi.fn(async ({ generationId }: any) => (
          stored = { ...stored, generationId }
        )),
      },
      suggestions: {
        listForSelection: vi.fn(async () => ({
          category: { code: "marketing_advertising", name: "마케팅·광고" },
          personal: [suggestion],
          general: [],
        })),
      },
      categories: {
        list: vi.fn(async () => [{
          code: "marketing_advertising",
          name: "마케팅·광고",
          subcategories: [
            { code: "content_marketing", name: "콘텐츠 마케팅" },
            { code: "social_media_marketing", name: "소셜 미디어 마케팅" },
          ],
        }]),
      },
      proposals: {
        create: vi.fn(async () => ({
          disposition: "created",
          proposalRunId: null,
          proposalBatchId: "40000000-0000-4000-8000-000000000001",
          status: "proposal_pending",
        })),
      },
      content: {
        getAiContentProposalBatch: vi.fn(async () => ({
          id: "40000000-0000-4000-8000-000000000001",
          status: "ready",
          proposals: [{ id: "60000000-0000-4000-8000-000000000001" }],
        })),
        selectAiContentProposal: vi.fn(async () => generation),
        startAiContentGenerationV3: vi.fn(async () => generation),
        getAiContentGeneration: vi.fn(async () => generation),
      },
      snapshots: {},
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      usageDate: () => "2026-08-14",
      dailyGenerationLimit: 10,
    };
    return { dependencies, getStored: () => stored, generation };
  }

  it.each([
    "cancel_requested",
    "purging",
    "cancelled",
    "failed",
    "purged",
  ])("rejects a first content start when analysis status is %s", async (status) => {
    const { dependencies } = fixture();
    dependencies.brandIntelligence.getBrandAnalysis.mockResolvedValueOnce({
      id: analysisId,
      status,
      input: { companyName: "모종", ownedUrl: "https://brand.example/", uploadIds: [] },
      evidence: [],
    });
    const service = createOnboardingContentService(dependencies);

    await expect(service.start({
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
      body: {
        categoryCode: "marketing_advertising",
        subcategoryCodes: ["content_marketing"],
        suggestionId,
        contentInstruction: null,
        idempotencyKey: `onboarding-${status}`,
      },
    })).rejects.toThrow("brand_analysis_not_available");
    expect(dependencies.brandIntelligence.saveOnboardingContentSelection).not.toHaveBeenCalled();
  });

  it("replays a saved identical request after the analysis is cancelled", async () => {
    const { dependencies, generation } = fixture();
    const service = createOnboardingContentService(dependencies);
    const request = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
      body: {
        categoryCode: "marketing_advertising",
        subcategoryCodes: ["content_marketing"],
        suggestionId,
        contentInstruction: null,
        idempotencyKey: "onboarding-request-1",
      },
    };

    await service.start(request);
    dependencies.brandIntelligence.getBrandAnalysis.mockResolvedValueOnce({
      id: analysisId,
      status: "cancelled",
      input: { companyName: "모종", ownedUrl: "https://brand.example/", uploadIds: [] },
      evidence: [],
    });

    await expect(service.start(request)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
    expect(dependencies.brandIntelligence.saveOnboardingContentSelection).toHaveBeenCalledTimes(1);
  });

  it("starts one proposal immediately from the selected onboarding topic", async () => {
    const { dependencies, getStored } = fixture();
    const service = createOnboardingContentService(dependencies);

    const result = await service.start({
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
      body: {
        categoryCode: "marketing_advertising",
        subcategoryCodes: ["content_marketing"],
        suggestionId,
        contentInstruction: null,
        idempotencyKey: "onboarding-request-1",
      },
    });

    expect(result).toMatchObject({ state: "preparing", proposalBatchId: expect.any(String) });
    expect(dependencies.proposals.create).toHaveBeenCalledWith(expect.objectContaining({
      source: "onboarding",
      request: expect.objectContaining({
        seed: { kind: "topic_text", title: suggestion.title },
        contentInstruction: null,
      }),
      authority: expect.objectContaining({ sourceUrls: [suggestion.sources[0].url] }),
    }));
    expect(getStored()).toMatchObject({
      proposalBatchId: "40000000-0000-4000-8000-000000000001",
      generationId: null,
    });
  });

  it("replays the saved first selection after the suggestion batch changes", async () => {
    const { dependencies, generation } = fixture();
    const service = createOnboardingContentService(dependencies);
    const request = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
      body: {
        categoryCode: "marketing_advertising",
        subcategoryCodes: ["content_marketing"],
        suggestionId,
        contentInstruction: null,
        idempotencyKey: "onboarding-request-1",
      },
    };

    await service.start(request);
    dependencies.suggestions.listForSelection.mockResolvedValueOnce({
      category: { code: "marketing_advertising", name: "마케팅·광고" },
      personal: [],
      general: [],
    });

    await expect(service.start(request)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
    expect(dependencies.suggestions.listForSelection).toHaveBeenCalledTimes(1);
    expect(dependencies.brandIntelligence.saveOnboardingContentSelection).toHaveBeenCalledTimes(1);
  });

  it("selects the first ready proposal and starts generation only once", async () => {
    const { dependencies, generation } = fixture();
    const service = createOnboardingContentService(dependencies);
    const scope = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
    };
    await service.start({ ...scope, body: {
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-request-1",
    } });

    await expect(service.reconcile(scope)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
    await expect(service.reconcile(scope)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
    expect(dependencies.content.selectAiContentProposal).toHaveBeenCalledTimes(1);
    expect(dependencies.content.startAiContentGenerationV3).toHaveBeenCalledTimes(1);
  });

  it("links the selected draft before starting generation", async () => {
    const { dependencies, getStored, generation } = fixture();
    dependencies.content.startAiContentGenerationV3.mockImplementationOnce(async () => {
      expect(getStored()).toMatchObject({ generationId: generation.id });
      return generation;
    });
    const service = createOnboardingContentService(dependencies);
    const scope = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
    };
    await service.start({ ...scope, body: {
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-link-before-start",
    } });

    await expect(service.reconcile(scope)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
  });

  it("retries an idempotent generation start after the draft was linked", async () => {
    const { dependencies, getStored, generation } = fixture();
    const draft = { ...generation, status: "draft" };
    dependencies.content.selectAiContentProposal.mockResolvedValueOnce(draft);
    dependencies.content.startAiContentGenerationV3
      .mockRejectedValueOnce(new Error("temporary_generation_start_failure"))
      .mockResolvedValueOnce(generation);
    dependencies.content.getAiContentGeneration.mockResolvedValueOnce(draft);
    const service = createOnboardingContentService(dependencies);
    const scope = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
    };
    await service.start({ ...scope, body: {
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-retry-linked-draft",
    } });

    await expect(service.reconcile(scope)).rejects.toThrow("temporary_generation_start_failure");
    expect(getStored()).toMatchObject({ generationId: draft.id });
    await expect(service.reconcile(scope)).resolves.toMatchObject({
      state: "generating",
      generationId: generation.id,
    });
    expect(dependencies.content.startAiContentGenerationV3).toHaveBeenCalledTimes(2);
  });

  it("retries proposal creation from the saved immutable selection during reconciliation", async () => {
    const { dependencies, getStored } = fixture();
    dependencies.proposals.create
      .mockRejectedValueOnce(new Error("temporary_proposal_failure"))
      .mockResolvedValueOnce({
        proposalBatchId: "40000000-0000-4000-8000-000000000001",
      });
    const service = createOnboardingContentService(dependencies);
    const scope = {
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
    };

    await expect(service.start({ ...scope, body: {
      categoryCode: "marketing_advertising",
      subcategoryCodes: ["content_marketing"],
      suggestionId,
      contentInstruction: null,
      idempotencyKey: "onboarding-request-1",
    } })).rejects.toThrow("temporary_proposal_failure");
    expect(getStored()).toMatchObject({ proposalBatchId: null });

    await expect(service.reconcile(scope)).resolves.toMatchObject({
      state: "preparing",
      proposalBatchId: "40000000-0000-4000-8000-000000000001",
    });
    expect(dependencies.proposals.create).toHaveBeenCalledTimes(2);
  });

  it("uses catalog labels for every selected subcategory", async () => {
    const { dependencies } = fixture();
    const service = createOnboardingContentService(dependencies);

    await service.start({
      workspaceId: "70000000-0000-4000-8000-000000000001",
      brandId: "80000000-0000-4000-8000-000000000001",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      analysisId,
      body: {
        categoryCode: "marketing_advertising",
        subcategoryCodes: ["content_marketing", "social_media_marketing"],
        suggestionId,
        contentInstruction: null,
        idempotencyKey: "onboarding-request-2",
      },
    });

    expect(dependencies.proposals.create).toHaveBeenCalledWith(expect.objectContaining({
      baseInput: expect.objectContaining({
        brandCore: expect.objectContaining({
          detailedCategory: "콘텐츠 마케팅, 소셜 미디어 마케팅",
        }),
      }),
    }));
  });
});
