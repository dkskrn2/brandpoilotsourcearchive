import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ReelPlanV2 } from "@brand-pilot/content-contracts";
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
const plan: ReelPlanV2 = {
  contractVersion: "reel-plan.v2", outputFormat: "reel",
  content: { caption: "Useful caption", hashtags: ["guide"], cta: "Save" },
  imagePackage: {
    contractVersion: "image-generation-package.v1", generationId: uid(1), outputFormat: "reel",
    purpose: "informational", assetCount: 1, aspectRatio: "9:16", channelTargets: ["instagram"],
    assets: [{
      index: 1, role: "scene", copy: "Explain clearly.", visualDirection: "Vertical editorial scene.",
      evidenceIds: [uid(4)], productImageAssetIds: [], attachmentIds: [],
    }],
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [],
    userImageInstruction: null,
    logoPolicy: {
      allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  },
};
const planDraft = {
  contractVersion: "reel-plan-draft.v1" as const,
  content: plan.content,
  assets: plan.imagePackage.assets.map(({ attachmentIds: _attachmentIds, ...asset }) => asset),
};
const renderSemanticContract = {
  contractVersion: "structured-scene-copy.v1" as const,
  outputFormat: "reel" as const,
  scenes: [{
    index: 1,
    role: "scene",
    coreMessage: "Explain the verified process clearly.",
    headline: "Explain clearly.",
    keyVisual: { type: "none" as const, entries: [] },
    supportingTexts: [],
    footnote: null,
    visualDirection: "Vertical editorial scene.",
    evidenceIds: [uid(4)],
    productImageAssetIds: [],
  }],
};

function runtimeHarness(
  initialStatus: "queued" | "processing" | "succeeded",
  lineageOrigin: "manual" | "scheduled_crawl" | null = null,
  stored: { plan?: ReelPlanV2; renderSemanticContract?: typeof renderSemanticContract } = {},
) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let generationStatus = initialStatus === "queued" ? "queued" : initialStatus === "succeeded" ? "generating" : "planning";
  let operationStatus = "started";
  let jobStatus = initialStatus;
  const baseJob = {
    id: uid(6), generation_id: uid(1), output_id: uid(7), workspace_id: uid(8), brand_id: uid(9),
    job_type: "generate", output_format: "reel", status: jobStatus, payload_json: {
      generationId: uid(1), outputId: uid(7), contentGenerationInput: finalInput,
      planningMode: "selected_proposal", operationId: uid(10),
      ...(stored.renderSemanticContract ? { renderSemanticContract: stored.renderSemanticContract } : {}),
    },
    attempt_count: 1, max_attempts: 3, worker_id: initialStatus === "queued" ? null : "worker-1",
    lease_token: initialStatus === "queued" ? null : "lease-1",
    lease_expires_at: initialStatus === "queued" ? null : "2099-01-01T00:00:00.000Z",
    available_at: "2026-08-06T00:00:00.000Z", available: true, lease_expired: false,
  };
  const generationRow = () => ({
    id: uid(1), workspace_id: uid(8), brand_id: uid(9), output_format: "reel",
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
        return { rows: [{ input_json: finalInput, evidence_json: evidence }], rowCount: 1 };
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

  it("accepts only the V3 plan completion and queues render work without finalizing the output", async () => {
    const run = runtimeHarness("processing", "manual");
    await run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan, renderSemanticContract,
    } as never);
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).toMatch(/set plan_json=coalesce[\s\S]*insert into ai_content_generation_render_jobs[\s\S]*status = 'succeeded'/i);
    expect(sql).not.toMatch(/artifact_manifest_json\s*=|insert into ai_content_usage_ledger/i);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects a social completion without structured semantics before any write", async () => {
    const run = runtimeHarness("processing", "manual");
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan,
    })).rejects.toThrow("ai_content_render_semantic_contract_invalid");
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects changed structured meaning even when the submitted legacy plan remains valid", async () => {
    const run = runtimeHarness("processing", "manual");
    await expect(run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan,
      renderSemanticContract: {
        ...renderSemanticContract,
        scenes: [{ ...renderSemanticContract.scenes[0]!, headline: "Different conclusion" }],
      },
    } as never)).rejects.toThrow("ai_content_render_semantic_contract_mismatch");
    expect(run.statements.map(({ sql }) => sql).join("\n"))
      .not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);
  });

  it("persists the semantic envelope in the same successful completion transaction", async () => {
    const run = runtimeHarness("processing", "manual");
    await run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan, renderSemanticContract,
    } as never);
    const jobWrite = run.statements.find(({ sql }) => (
      sql.includes("update ai_content_generation_jobs") && sql.includes("status = 'succeeded'")
    ));
    expect(jobWrite?.sql).toContain("renderSemanticContract");
    expect(JSON.parse(String(jobWrite?.params[2]))).toEqual(renderSemanticContract);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it.each([
    ["manual", "ai-content-render-job.v2", "image-final-pixels.v2"],
    ["scheduled_crawl", "ai-content-render-job.v1", undefined],
  ] as const)("selects the private render transport from %s proposal lineage at planning completion", async (
    origin,
    contractVersion,
    rendererPromptVersion,
  ) => {
    const run = runtimeHarness("processing", origin);

    await run.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-draft.v1",
      jobType: "generate", planDraft,
      ...(origin === "manual" ? { renderSemanticContract } : {}),
    } as never);

    const lineageQuery = run.statements.find(({ sql }) => (
      sql.includes("from ai_content_generation_prompt_bindings binding")
      && sql.includes("join ai_content_proposal_batches batch")
    ));
    expect(lineageQuery?.params).toEqual([uid(1), uid(8), uid(9), uid(5)]);
    expect(lineageQuery?.sql).not.toContain("draft_json");
    const renderWrite = run.statements.find(({ sql }) => sql.includes("insert into ai_content_generation_render_jobs"));
    expect(JSON.parse(String(renderWrite?.params[5]))).toMatchObject({
      contractVersion,
      ...(rendererPromptVersion ? { rendererPromptVersion } : {}),
    });
  });

  it("assembles a draft into the same canonical plan and render payload as legacy completion", async () => {
    const legacy = runtimeHarness("processing", "manual");
    await legacy.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan, renderSemanticContract,
    } as never);
    const draft = runtimeHarness("processing", "manual");
    await draft.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel-draft.v1",
      jobType: "generate", planDraft, renderSemanticContract,
    } as never);

    const storedPlan = (statements: Array<{ sql: string; params: unknown[] }>) => {
      const write = statements.find(({ sql }) => sql.includes("set plan_json=coalesce"));
      return JSON.parse(String(write?.params[1]));
    };
    const renderPayloads = (statements: Array<{ sql: string; params: unknown[] }>) => statements
      .filter(({ sql }) => sql.includes("insert into ai_content_generation_render_jobs"))
      .map(({ params }) => JSON.parse(String(params[5] ?? params[4])));

    expect(storedPlan(draft.statements)).toEqual(plan);
    expect(storedPlan(draft.statements)).toEqual(storedPlan(legacy.statements));
    expect(renderPayloads(draft.statements)).toEqual(renderPayloads(legacy.statements));
    expect(draft.statements.at(-1)?.sql).toBe("COMMIT");
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
      renderSemanticContract,
    } as never)).rejects.toThrow("ai_content_plan_invalid");
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs|set status='generating'/i);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("replays an identical succeeded semantic completion and conflicts on changed structured meaning", async () => {
    const identical = runtimeHarness("succeeded", "manual", { plan, renderSemanticContract });
    await expect(identical.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan, renderSemanticContract,
    } as never)).resolves.toMatchObject({ id: uid(1) });
    expect(identical.statements.map(({ sql }) => sql).join("\n"))
      .not.toMatch(/set plan_json=coalesce|insert into ai_content_generation_render_jobs/i);

    const changed = runtimeHarness("succeeded", "manual", { plan, renderSemanticContract });
    await expect(changed.repository.completeAiContentJob({
      jobId: uid(6), workerId: "worker-1", leaseToken: "lease-1", skillVersion: "reel.v3",
      jobType: "generate", plan,
      renderSemanticContract: {
        ...renderSemanticContract,
        scenes: [{ ...renderSemanticContract.scenes[0]!, coreMessage: "Different structured meaning." }],
      },
    } as never)).rejects.toThrow("ai_content_plan_completion_conflict");
    expect(changed.statements.at(-1)?.sql).toBe("ROLLBACK");
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
