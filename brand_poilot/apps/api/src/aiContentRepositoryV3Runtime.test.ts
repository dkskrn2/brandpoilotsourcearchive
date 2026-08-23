import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ReelPlanV2 } from "@brand-pilot/content-contracts";
import { compileCardManuscriptPlanDraftV1, parseCardManuscriptPlanV1 } from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import {
  compileReelStoryboardDraftV2,
  parseReelStoryboardV2,
} from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardV2Sha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import { createAiContentRepository } from "./aiContentRepository.js";

const repositorySource = readFileSync(new URL("./aiContentRepository.ts", import.meta.url), "utf8");
const uid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const evidence = {
  contractVersion: "research-evidence.v1", decision: "searched", reason: "fresh",
  queries: ["query"], capturedAt: "2026-08-06T00:00:00.000Z",
  items: [{
    id: uid(4), title: "Source", url: "https://example.com/source", publisher: null,
    publishedAt: null, capturedAt: "2026-08-06T00:00:00.000Z", claimSummary: "Claim",
    contentHash: "b".repeat(64),
  }],
};
const finalInput = {
  contractVersion: "content-generation-input.v3", generationId: uid(1),
  brandCore: {
    versionId: uid(2), companyOverview: "Overview", businessDescription: "Business",
    primaryCategory: "Category", detailedCategory: "Detail", primaryTarget: "Reader",
    differentiator: "Clear", coreAppeal: "Useful",
  },
  brandRules: {
    versionId: uid(3), version: 1,
    content: {
      contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
      ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
      designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
      autoApprovalRules: { enabled: false, conditions: [] },
    },
    contentSha256: "c".repeat(64),
  },
  subject: { kind: "topic_text", title: "Reel guide" }, contentInstruction: null, product: null,
  researchEvidence: evidence,
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: {
    id: uid(5), conceptKey: "guide", title: "Guide", informationalType: "how_to",
    oneLineIntent: "Explain", differentiator: "Direct", differentiationAxes: ["question"],
    target: "Reader", customerContext: "Need answer", keyMessage: "Answer", hook: "Question",
    selectionReason: "Useful", evidenceIds: [uid(4)], referenceIds: [], outputFormat: "reel",
    channelTargets: ["instagram"], assetCount: 1,
    outline: [{ index: 1, role: "scene", headline: "Open", purpose: "Explain" }],
    purposeDetails: {
      kind: "informational", question: "What?", value: "Answer", whyNow: "Now",
      learningPoints: ["Point"],
    },
  },
  userImageInstruction: null,
  outputSettings: {
    purpose: "informational", outputFormat: "reel", channelTargets: ["instagram"],
    aspectRatio: "9:16", outputCount: 1,
  },
  capturedAt: "2026-08-06T00:00:00.000Z",
} as const;
const reelStoryboard = parseReelStoryboardV2({
  contractVersion: "reel-storyboard.v2",
  content: { caption: "Useful caption", hashtags: ["guide"], cta: "Save" },
  storyNarrative: "Verified explanation from hook to conclusion.",
  evidenceSelection: { selectedEvidenceIds: [uid(4)], excludedEvidenceIds: [] },
  scenes: [{
    index: 1, editorialRole: "hook", purpose: "Explain", coreMessage: "Explain the verified process clearly.",
    headline: "Explain clearly.", informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null,
    evidenceIds: [uid(4)], productImageAssetIds: [], avatarImageAssetIds: [],
  }],
}, finalInput as never);
const planDraft = compileReelStoryboardDraftV2(reelStoryboard, finalInput.selectedProposal.outline);
const plan: ReelPlanV2 = {
  contractVersion: "reel-plan.v2", outputFormat: "reel", content: reelStoryboard.content,
  imagePackage: {
    contractVersion: "image-generation-package.v1", generationId: uid(1), outputFormat: "reel",
    purpose: "informational", assetCount: 1, aspectRatio: "9:16", channelTargets: ["instagram"],
    assets: planDraft.assets.map((asset) => ({ ...asset, attachmentIds: [] })),
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [],
    userImageInstruction: null,
    logoPolicy: {
      allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  },
};
const reelStoryboardContract = {
  contractVersion: "reel-storyboard.v2" as const,
  storyboardSha256: reelStoryboardV2Sha256(reelStoryboard),
  storyboard: reelStoryboard,
};

const cardInput = {
  ...structuredClone(finalInput),
  subject: { kind: "topic_text", title: "YPP changes" },
  selectedProposal: {
    ...structuredClone(finalInput.selectedProposal),
    outputFormat: "card_news",
    assetCount: 3,
    outline: [1, 2, 3].map((index) => ({ index, role: index === 1 ? "hook" : "detail", headline: `Reference ${index}`, purpose: `Purpose ${index}` })),
  },
  outputSettings: { ...structuredClone(finalInput.outputSettings), outputFormat: "card_news", aspectRatio: "1:1" },
} as const;
const cardManuscript = parseCardManuscriptPlanV1({
  contractVersion: "card-manuscript-plan.v1",
  content: { caption: "새 기준", hashtags: ["youtube"], cta: "저장하세요" },
  deckNarrative: "발표에서 비교와 행동으로 이어진다.",
  evidenceSelection: { selectedEvidenceIds: [uid(4)], excludedEvidenceIds: [] },
  scenes: [1, 2, 3].map((index) => ({
    index, editorialRole: index === 1 ? "cover" : "detail", purpose: `목적 ${index}`,
    coreMessage: `핵심 ${index}`, headline: `결론 ${index}`,
    informationRelation: { type: "none", entries: [] }, supportingTexts: [], footnote: null,
    evidenceIds: [uid(4)], productImageAssetIds: [], avatarImageAssetIds: [],
  })),
}, cardInput as never);
const cardPlanDraft = compileCardManuscriptPlanDraftV1(cardManuscript, cardInput.selectedProposal.outline);
const cardManuscriptContract = {
  contractVersion: "card-manuscript-plan.v1" as const,
  manuscriptSha256: cardManuscriptPlanSha256(cardManuscript),
  plan: cardManuscript,
};

function runtimeHarness(
  initialStatus: "queued" | "processing" | "succeeded",
  lineageOrigin: "manual" | "scheduled_crawl" | null = null,
  stored: { plan?: unknown; reelStoryboardContract?: typeof reelStoryboardContract; cardManuscriptContract?: typeof cardManuscriptContract } = {},
  fault: { renderInsert?: boolean } = {},
  fixture: { input: unknown; outputFormat: "reel" | "card_news" } = { input: finalInput, outputFormat: "reel" },
) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let generationStatus = initialStatus === "queued" ? "queued" : initialStatus === "succeeded" ? "generating" : "planning";
  let operationStatus = "started";
  let jobStatus = initialStatus;
  const baseJob = {
    id: uid(6), generation_id: uid(1), output_id: uid(7), workspace_id: uid(8), brand_id: uid(9),
    job_type: "generate", output_format: fixture.outputFormat, status: jobStatus, payload_json: {
      generationId: uid(1), outputId: uid(7), contentGenerationInput: fixture.input,
      planningMode: "selected_proposal", operationId: uid(10),
      ...(stored.reelStoryboardContract ? { reelStoryboardContract: stored.reelStoryboardContract } : {}),
      ...(stored.cardManuscriptContract ? { cardManuscriptContract: stored.cardManuscriptContract } : {}),
    },
    attempt_count: 1, max_attempts: 3, worker_id: initialStatus === "queued" ? null : "worker-1",
    lease_token: initialStatus === "queued" ? null : "lease-1",
    lease_expires_at: initialStatus === "queued" ? null : "2099-01-01T00:00:00.000Z",
    available_at: "2026-08-06T00:00:00.000Z", available: true, lease_expired: false,
  };
  const generationRow = () => ({
    id: uid(1), workspace_id: uid(8), brand_id: uid(9), output_format: fixture.outputFormat,
    purpose: "informational", title: "Reel", status: generationStatus, current_stage: "generation",
    draft_json: {}, analysis_json: {}, attachments_locked_at: "2026-08-06T00:00:00.000Z",
    terminal_at: null, retryable_until: null, error_code: null, error_message: null,
    created_at: "2026-08-06T00:00:00.000Z", updated_at: "2026-08-06T00:00:00.000Z",
    completed_at: null,
  });
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (fault.renderInsert && sql.includes("insert into ai_content_generation_render_jobs")) {
        throw new Error("render_insert_fault");
      }
      if (sql === "select assert_ai_content_writable()") return { rows: [{}], rowCount: 1 };
      if (sql.includes("from ai_content_generation_jobs") && (
        sql.includes("attempt_count >= max_attempts")
        || sql.includes("attempt_count < max_attempts") && sql.includes("status = 'processing'")
      )) return { rows: [], rowCount: 0 };
      if (sql.includes("select job.id") && sql.includes("status = 'queued'")) {
        return { rows: [{ id: uid(6) }], rowCount: 1 };
      }
      if (sql.includes("select generation_id, output_id") && sql.includes("ai_content_generation_jobs")) {
        return { rows: [{ generation_id: uid(1), output_id: uid(7) }], rowCount: 1 };
      }
      if (sql.includes("select id, generation_id") && sql.includes("ai_content_generation_outputs")) {
        return { rows: [{ id: uid(7), generation_id: uid(1) }], rowCount: 1 };
      }
      if (sql.includes("select *,") && sql.includes("from ai_content_generation_jobs")) {
        return { rows: [{ ...baseJob, status: jobStatus }], rowCount: 1 };
      }
      if (sql.includes("update ai_content_generation_jobs") && sql.includes("returning *")) {
        jobStatus = "processing";
        return { rows: [{
          ...baseJob, status: jobStatus, worker_id: "worker-1", lease_token: "claimed-lease",
          attempt_count: 2, lease_expires_at: "2099-01-01T00:00:00.000Z",
        }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_output_research_snapshots") && !sql.includes("left join")) {
        return { rows: [{ evidence_json: evidence }], rowCount: 1 };
      }
      if (sql.includes("select input.input_json,research.evidence_json")) {
        return { rows: [{ input_json: fixture.input, evidence_json: evidence }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_generation_prompt_bindings binding") && sql.includes("join ai_content_proposal_batches batch")) {
        return lineageOrigin === null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ selected_proposal_id: uid(5), origin: lineageOrigin }], rowCount: 1 };
      }
      if (sql.includes("select plan_json from ai_content_generation_outputs")) {
        return { rows: [{ plan_json: stored.plan ?? null }], rowCount: 1 };
      }
      if (sql.includes("count(*)::integer as total")) {
        return { rows: [{ total: 1, completed: 0, failed: 1 }], rowCount: 1 };
      }
      if (sql.startsWith("update ai_content_generations") && sql.includes("set status = $2")) {
        generationStatus = String(params[1]);
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("select status,operation_id from ai_content_generations")) {
        return { rows: [{ status: generationStatus, operation_id: uid(10) }], rowCount: 1 };
      }
      if (sql.includes("for update of operation")) {
        return { rows: [{
          operation_id: uid(10), operation_status: operationStatus, reservation_id: uid(11),
          workspace_id: uid(8), brand_id: uid(9), quantity: 1, usage_date: "2026-08-06",
        }], rowCount: 1 };
      }
      if (sql.includes("left join ai_content_usage_ledger reversal")) {
        return { rows: [{ operation_status: operationStatus, reversal_id: null, reversal_quantity: null }], rowCount: 1 };
      }
      if (sql.includes("transition_ai_content_generation_operation")) {
        operationStatus = String(params[2] ?? "reversed");
        return { rows: [{ status: operationStatus }], rowCount: 1 };
      }
      if (sql.includes("select id") && sql.includes("from ai_content_generations") && sql.includes("for update")) {
        return { rows: [{ id: uid(1) }], rowCount: 1 };
      }
      if (sql.includes("select id, workspace_id, brand_id, output_format")) {
        return { rows: [generationRow()], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  return {
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
    client,
    statements,
  };
}

describe("V3 generation runtime contract", () => {
  it("does not advertise or enqueue the retired in-place revision protocol", () => {
    expect(repositorySource).not.toMatch(/async reviseAiContentOutput|ai-content-revision\.v1|mergeRevisionManifest/);
    expect(repositorySource).not.toMatch(/"regenerate_(?:hook|copy|card)"/);
    expect(repositorySource).toMatch(/revisionCapabilities:\s*\[\]/);
  });

  it("does not accept the retired copy-edit protocol until a strict V3 edit contract exists", () => {
    expect(repositorySource).not.toMatch(/saveAiContentOutputCopy|AiContentCopyField|copy_edit_receipts/);
  });

  it("claims only an exact V3 generate job for the requested output format", async () => {
    const run = runtimeHarness("queued");
    const claimed = await run.repository.claimAiContentJob({
      outputFormat: "reel", workerId: "worker-1", leaseSeconds: 180,
    });
    expect(claimed, JSON.stringify(run.statements.map(({ sql }) => sql))).not.toBeNull();
    expect(claimed).toMatchObject({
      jobType: "generate", outputFormat: "reel", status: "processing", workerId: "worker-1",
    });
    expect(claimed?.payload.contentGenerationInput).toMatchObject({
      contractVersion: "content-generation-input.v3", generationId: uid(1),
    });
    expect(run.statements.map(({ sql }) => sql).join("\n")).not.toMatch(/content_type|job_type\s*=\s*'analyze'/i);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("validates, persists, and atomically renders the Reel Storyboard source", async () => {
    const run = runtimeHarness("processing", "manual");
    await run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft, reelStoryboardContract,
    } as never);
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).toMatch(/set plan_json=coalesce[\s\S]*insert into ai_content_generation_render_jobs[\s\S]*status = 'succeeded'/i);
    const jobWrite = run.statements.find(({ sql: statement }) => statement.includes("update ai_content_generation_jobs") && statement.includes("status = 'succeeded'"));
    expect(jobWrite?.sql).toContain("reelStoryboardContract");
    expect(JSON.parse(String(jobWrite?.params[3]))).toEqual(reelStoryboardContract);
    const renderWrite = run.statements.find(({ sql: statement }) => statement.includes("insert into ai_content_generation_render_jobs"));
    expect(JSON.parse(String(renderWrite?.params[5]))).toMatchObject({
      contractVersion: "ai-content-visual-session-render-job.v1",
      rendererPromptVersion: "image-visual-session.v1",
    });
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects a Reel completion without its Storyboard before any write", async () => {
    const run = runtimeHarness("processing", "manual");
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft,
    })).rejects.toThrow("ai_content_reel_storyboard_contract_invalid");
    expect(run.statements.map(({ sql }) => sql).join("\n")).not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);
  });

  it("rejects a changed Reel Storyboard even when the flattened draft remains valid", async () => {
    const changedStoryboard = structuredClone(reelStoryboard);
    changedStoryboard.scenes[0]!.headline = "Different displayed conclusion";
    const run = runtimeHarness("processing", "manual");
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft,
      reelStoryboardContract: {
        contractVersion: "reel-storyboard.v2",
        storyboardSha256: reelStoryboardV2Sha256(changedStoryboard),
        storyboard: changedStoryboard,
      },
    } as never)).rejects.toThrow("ai_content_reel_storyboard_compilation_mismatch");
  });

  it("rolls back the plan and Storyboard write when render enqueue faults", async () => {
    const run = runtimeHarness("processing", "manual", {}, { renderInsert: true });
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft, reelStoryboardContract,
    } as never)).rejects.toThrow("render_insert_fault");
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rolls back an invalid draft before writing a plan, transition, or render job", async () => {
    const run = runtimeHarness("processing", "manual");
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-draft.v1",
      jobType: "generate",
      planDraft: {
        ...planDraft,
        assets: [{ ...planDraft.assets[0]!, evidenceIds: [uid(99)] }],
      },
      reelStoryboardContract,
    } as never)).rejects.toThrow("ai_content_reel_storyboard_compilation_mismatch");
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs|set status='generating'/i);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("replays only an identical succeeded Reel Storyboard", async () => {
    const identical = runtimeHarness("succeeded", "manual", { plan, reelStoryboardContract });
    await expect(identical.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft, reelStoryboardContract,
    } as never)).resolves.toMatchObject({ id: uid(1) });
    expect(identical.statements.map(({ sql }) => sql).join("\n"))
      .not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);

    const changedStoryboard = structuredClone(reelStoryboard);
    changedStoryboard.scenes[0]!.coreMessage = "Different structured meaning.";
    const changed = runtimeHarness("succeeded", "manual", { plan, reelStoryboardContract });
    await expect(changed.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-storyboard-skill.v5",
      jobType: "generate", planDraft,
      reelStoryboardContract: {
        contractVersion: "reel-storyboard.v2",
        storyboardSha256: reelStoryboardV2Sha256(changedStoryboard),
        storyboard: changedStoryboard,
      },
    } as never)).rejects.toThrow("ai_content_plan_completion_conflict");
    expect(changed.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("validates, persists, and atomically renders the card deck source with its compiled draft", async () => {
    const run = runtimeHarness("processing", "manual", {}, {}, { input: cardInput, outputFormat: "card_news" });

    await run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "card-news-plan-skill.v6",
      jobType: "generate", planDraft: cardPlanDraft, cardManuscriptContract,
    } as never);

    const jobWrite = run.statements.find(({ sql }) => sql.includes("update ai_content_generation_jobs") && sql.includes("status = 'succeeded'"));
    expect(jobWrite?.sql).toContain("cardManuscriptContract");
    expect(JSON.parse(String(jobWrite?.params[2]))).toEqual(cardManuscriptContract);
    expect(run.statements.map(({ sql }) => sql).join("\n"))
      .toMatch(/set plan_json=coalesce[\s\S]*insert into ai_content_generation_render_jobs[\s\S]*cardManuscriptContract/i);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it.each([
    ["hash", { ...cardManuscriptContract, manuscriptSha256: "f".repeat(64) }, cardPlanDraft, "ai_content_card_manuscript_hash_mismatch"],
    ["compiled draft", cardManuscriptContract, { ...cardPlanDraft, content: { ...cardPlanDraft.content, caption: "Changed" } }, "ai_content_card_manuscript_projection_mismatch"],
  ])("rejects a card manuscript %s mismatch before any write", async (_name, submittedManuscript, submittedDraft, code) => {
    const run = runtimeHarness("processing", "manual", {}, {}, { input: cardInput, outputFormat: "card_news" });
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "card-news-plan-skill.v6",
      jobType: "generate", planDraft: submittedDraft, cardManuscriptContract: submittedManuscript,
    } as never)).rejects.toThrow(code);
    expect(run.statements.map(({ sql }) => sql).join("\n"))
      .not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("replays only the identical stored card manuscript even when the flattened plan stays equal", async () => {
    const storedPlan = await import("./aiContentPlanContracts.js").then(({ assembleContentPlanResultV2 }) =>
      assembleContentPlanResultV2(cardPlanDraft, cardInput as never, evidence));
    const identical = runtimeHarness(
      "succeeded", "manual", { plan: storedPlan, cardManuscriptContract }, {},
      { input: cardInput, outputFormat: "card_news" },
    );
    await expect(identical.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "card-news-plan-skill.v6",
      jobType: "generate", planDraft: cardPlanDraft, cardManuscriptContract,
    } as never)).resolves.toMatchObject({ id: uid(1) });

    const changedPlan = structuredClone(cardManuscript);
    changedPlan.scenes[0]!.coreMessage = "같은 출력 문구지만 다른 내부 원고 판단";
    const changedContract = {
      ...cardManuscriptContract,
      manuscriptSha256: cardManuscriptPlanSha256(changedPlan),
      plan: changedPlan,
    };
    const changed = runtimeHarness(
      "succeeded", "manual", { plan: storedPlan, cardManuscriptContract }, {},
      { input: cardInput, outputFormat: "card_news" },
    );
    await expect(changed.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "card-news-plan-skill.v6",
      jobType: "generate", planDraft: cardPlanDraft, cardManuscriptContract: changedContract,
    } as never)).rejects.toThrow("ai_content_plan_completion_conflict");
  });

  it("returns the reserved quota exactly once after a permanent planner failure", async () => {
    const run = runtimeHarness("processing");
    await run.repository.failAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1",
      errorCode: "reel_plan_invalid", errorMessage: "invalid", retryable: false,
    });
    const reversal = run.statements.filter(({ sql }) => sql.startsWith("insert into ai_content_usage_ledger"));
    expect(reversal).toHaveLength(1);
    expect(reversal[0]?.params[4]).toBe(-1);
    expect(run.statements.map(({ sql }) => sql).join("\n"))
      .toMatch(/update ai_content_generations[\s\S]*insert into ai_content_usage_ledger[\s\S]*transition_ai_content_generation_operation/i);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("reports net generation usage after permanent-failure reversals", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toMatch(/usage_type\s+in\s*\('generation','reversal'\)/i);
      return { rows: [{ generation_count: 1, download_count: 0 }], rowCount: 1 };
    });
    const repository = createAiContentRepository({ query } as never);

    await expect(repository.listAiContentUsage({
      workspaceId: uid(8),
      brandId: uid(9),
      usageDate: "2026-08-06",
    })).resolves.toEqual({
      usageDate: "2026-08-06",
      generationCount: 1,
      downloadCount: 0,
    });
  });
});
