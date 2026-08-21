import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";
import { proposalSha256 } from "./aiContentProposalV2Service.js";
import { assembleContentPlanResultV2 } from "./aiContentPlanContracts.js";
import { compileReelStoryboardDraftV2, type ReelStoryboardV2 } from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardV2Sha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";

const UUID = {
  workspace: "10000000-0000-4000-8000-000000000001", brand: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003", parent: "10000000-0000-4000-8000-000000000004",
  output: "10000000-0000-4000-8000-000000000005", operation: "10000000-0000-4000-8000-000000000006",
  reservation: "10000000-0000-4000-8000-000000000007", proposal: "10000000-0000-4000-8000-000000000008",
  core: "10000000-0000-4000-8000-000000000009", rules: "10000000-0000-4000-8000-00000000000a",
} as const;
const frozenInput = {
  contractVersion: "content-generation-input.v3", generationId: UUID.parent,
  brandCore: { versionId: UUID.core, companyOverview: "개요", businessDescription: "설명", primaryCategory: "테크", detailedCategory: "생산성", primaryTarget: "실무자", differentiator: "검증", coreAppeal: "정확성" },
  brandRules: { versionId: UUID.rules, version: 1, content: { contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "확인", allowed: ["확인"] }, channelRules: { instagram: [] }, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "a".repeat(64) },
  subject: { kind: "topic_text", title: "주제" }, contentInstruction: null, product: null,
  researchEvidence: { contractVersion: "research-evidence.v1", decision: "not_needed", reason: "evergreen", queries: [], capturedAt: "2026-08-06T00:00:00.000Z", items: [] },
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal: { id: UUID.proposal, conceptKey: "retry", title: "재시도", informationalType: "how_to", oneLineIntent: "안내", differentiator: "명확", differentiationAxes: ["narrative"], target: "실무자", customerContext: "업무", keyMessage: "확인", hook: "시작", selectionReason: "유용", evidenceIds: [], referenceIds: [], outputFormat: "reel", channelTargets: ["instagram"], assetCount: 1, outline: [{ index: 1, role: "scene", headline: "핵심", purpose: "설명" }], purposeDetails: { kind: "informational", question: "무엇?", value: "학습", whyNow: "지금", learningPoints: ["핵심"] } },
  userImageInstruction: null,
  outputSettings: { outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1, purpose: "informational" },
  capturedAt: "2026-08-06T00:00:00.000Z",
};

const frozenManualVisualSelection = {
  contractVersion: "manual-visual-selection-frozen.v1",
  product: null,
  stylePreset: null,
  avatar: null,
} as const;

const promptBinding = {
  contractVersion: "content-prompt-binding.v1",
  outputFormat: "reel",
  purpose: "informational",
  proposalRequestVersion: "content-proposal-request.v2",
  proposalBaseInputVersion: "proposal-base-input.v2",
  proposalComposedInputVersion: "proposal-input.v2",
  proposalOutputVersion: "content-proposal.v2",
  proposalPromptVersion: "proposal.writer.v2",
  proposalSchemaSha256: "1".repeat(64),
  generationInputVersion: "content-generation-input.v3",
  generationSchemaSha256: "2".repeat(64),
  planContractVersion: "reel-plan.v2",
  planSchemaSha256: "3".repeat(64),
  plannerPromptVersion: "planner.reel.informational.v1",
  imagePackageVersion: "image-generation-package.v1",
  imagePromptVersion: "image.reel.informational.v1",
  manifestVersion: "ai-content.v3",
  contractSourceHash: "4".repeat(64),
  model: "gpt-5.6-terra",
} as const;

const frozenStoryboard: ReelStoryboardV2 = {
  contractVersion: "reel-storyboard.v2",
  content: { caption: "핵심을 설명합니다.", hashtags: ["#가이드"], cta: "저장해 두세요." },
  storyNarrative: "검증된 핵심을 한 장면에 전달한다.",
  evidenceSelection: { selectedEvidenceIds: [], excludedEvidenceIds: [] },
  scenes: [{
    index: 1,
    editorialRole: "transition",
    purpose: "검증된 핵심을 설명한다.",
    coreMessage: "핵심을 명확히 전달합니다.",
    headline: "핵심을 확인하세요",
    informationRelation: { type: "none", entries: [] },
    supportingTexts: ["검증된 내용을 그대로 사용합니다."],
    footnote: null,
    evidenceIds: [],
    productImageAssetIds: [],
    avatarImageAssetIds: [],
  }],
};
const frozenStoryboardContract = {
  contractVersion: "reel-storyboard.v2",
  storyboardSha256: reelStoryboardV2Sha256(frozenStoryboard),
  storyboard: frozenStoryboard,
} as const;
const frozenPlan = assembleContentPlanResultV2(
  compileReelStoryboardDraftV2(frozenStoryboard, frozenInput.selectedProposal.outline),
  frozenInput,
);

function harness(options: {
  replay?: boolean;
  replayGraphDrift?: boolean;
  quota?: number;
  retryable?: boolean;
  reversed?: boolean;
  corruptParentBinding?: boolean;
  missingManualVisualSelection?: boolean;
  renderReady?: boolean;
  invalidStoredContract?: boolean;
  missingParentSkill?: boolean;
} = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let childId = "";
  const replayChildId = "10000000-0000-4000-8000-000000000010";
  const replayOperationId = "10000000-0000-4000-8000-000000000011";
  const retryFingerprint = proposalSha256({
    contractVersion: "content-generation-retry.v1",
    workspaceId: UUID.workspace,
    brandId: UUID.brand,
    parentGenerationId: UUID.parent,
    parentOperationId: UUID.operation,
    parentOutputId: UUID.output,
    reason: "다시 생성",
  });
  const childInput = { ...frozenInput, generationId: replayChildId };
  const binding = options.corruptParentBinding
    ? { ...promptBinding, purpose: "marketing" }
    : promptBinding;
  const parent = {
    id: UUID.parent, workspace_id: UUID.workspace, brand_id: UUID.brand, output_format: "reel", purpose: "informational",
    title: "릴스", status: "failed", current_stage: "completed", draft_json: { origin: "proposal-v2" }, analysis_json: {},
    operation_id: UUID.operation, operation_status: options.reversed === false ? "started" : "reversed",
    retryable_until: "2026-08-20T00:00:00.000Z", retryable: options.retryable !== false,
    reservation_id: UUID.reservation, reservation_quantity: 1, reversal_id: "10000000-0000-4000-8000-00000000000b", reversal_quantity: -1,
    input_json: frozenInput, content_hash: proposalSha256(frozenInput), binding_id: "10000000-0000-4000-8000-000000000012", binding_json: binding,
    binding_sha256: proposalSha256(binding), binding_hash_matches: true, selected_proposal_id: UUID.proposal,
    proposal_job_id: "10000000-0000-4000-8000-00000000000c", proposal_contract_id: "10000000-0000-4000-8000-00000000000d",
    successful_model_attempt_id: "10000000-0000-4000-8000-00000000000e",
    manual_visual_selection: options.missingManualVisualSelection ? null : frozenManualVisualSelection,
    parent_job_payload: options.renderReady ? {
      generationId: UUID.parent,
      manualVisualSelection: frozenManualVisualSelection,
      reelStoryboardContract: options.invalidStoredContract
        ? { ...frozenStoryboardContract, storyboardSha256: "0".repeat(64) }
        : frozenStoryboardContract,
    } : { generationId: UUID.parent, manualVisualSelection: frozenManualVisualSelection },
    parent_skill_version: options.renderReady && !options.missingParentSkill ? "reel-storyboard-skill.v4" : null,
    attachments_locked_at: "2026-08-06T00:00:00.000Z", terminal_at: "2026-08-06T00:00:00.000Z",
    error_code: "failed", error_message: "failed", created_at: "2026-08-06T00:00:00.000Z", updated_at: "2026-08-06T00:00:00.000Z", completed_at: "2026-08-06T00:00:00.000Z",
  };
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql === "select assert_ai_content_writable()") return { rows: [{}], rowCount: 1 };
      if (sql.includes("from workspace_members member")) return { rows: [{}], rowCount: 1 };
      if (sql.includes("select generation_id from ai_content_generation_outputs")) return { rows: [{ generation_id: UUID.parent }], rowCount: 1 };
      if (sql.includes("select generation.*,")) return { rows: [parent], rowCount: 1 };
      if (sql.includes("from ai_content_generation_outputs output") && sql.includes("for update of output")) return { rows: [{
        id: UUID.output,
        status: "failed",
        plan_json: options.renderReady ? frozenPlan : null,
      }], rowCount: 1 };
      if (sql.includes("select operation.*,generation.generation_input_snapshot")) return options.replay
        ? { rows: [{
          id: replayOperationId,
          status: "started",
          generation_id: replayChildId,
          workspace_id: UUID.workspace,
          parent_operation_id: UUID.operation,
          parent_generation_id: UUID.parent,
          request_fingerprint_sha256: retryFingerprint,
          generation_input_snapshot: childInput,
          input_json: childInput,
          content_hash: proposalSha256(childInput),
          binding_json: promptBinding,
          binding_sha256: proposalSha256(promptBinding),
          binding_hash_matches: true,
          parent_binding_id: "10000000-0000-4000-8000-000000000012",
          selected_proposal_id: UUID.proposal,
          proposal_job_id: "10000000-0000-4000-8000-00000000000c",
          proposal_contract_id: "10000000-0000-4000-8000-00000000000d",
          successful_model_attempt_id: "10000000-0000-4000-8000-00000000000e",
          manual_visual_selection: frozenManualVisualSelection,
          reservation_quantity: 1,
          output_count: options.replayGraphDrift ? 0 : 1,
          job_count: 1,
          output_format: "reel",
          purpose: "informational",
        }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_usage_ledger") && sql.includes("sum(quantity)")) return { rows: [{ generation_count: options.quota ?? 0 }], rowCount: 1 };
      if (sql.startsWith("insert into ai_content_generations")) { childId = String(params[0]); return { rows: [], rowCount: 1 }; }
      if (sql.includes("from ai_content_generations where id = $1")) return { rows: [{ ...parent, id: childId || String(params[0]), status: "queued", operation_id: "child-operation", generation_input_snapshot: { ...frozenInput, generationId: childId || String(params[0]) } }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const repository = createAiContentRepository({ connect: async () => client, query: client.query } as never);
  const command = { workspaceId: UUID.workspace, brandId: UUID.brand, actorUserId: UUID.actor, outputId: UUID.output, contractVersion: "content-generation-retry.v1", idempotencyKey: "retry-key", reason: "다시 생성", usageDate: "2026-08-06", dailyGenerationLimit: 10 } as const;
  return { repository, command, statements };
}

describe("V3 permanent-failure retry lineage", () => {
  it("creates a new child generation/operation/reservation/output/job and never resets the parent", async () => {
    const run = harness();
    const result = await run.repository.retryAiContentOutput(run.command);
    expect(result.id).not.toBe(UUID.parent);
    const sql = run.statements.map(({ sql }) => sql);
    const parentLock = sql.find((statement) => statement.includes("select generation.*,")) ?? "";
    expect(parentLock).toContain("for update of generation,operation");
    expect(parentLock).not.toContain("for update of generation,operation,reservation,reversal");
    expect(sql.join("\n")).toMatch(/insert into ai_content_generations[\s\S]*insert into ai_content_generation_operations[\s\S]*insert into ai_content_usage_ledger[\s\S]*insert into ai_content_generation_input_snapshots[\s\S]*create_ai_content_generation_prompt_binding[\s\S]*insert into ai_content_generation_outputs[\s\S]*insert into ai_content_generation_jobs/);
    expect(sql.join("\n")).not.toMatch(/update ai_content_generation_(?:outputs|render_jobs)/i);
    const childGeneration = run.statements.find(({ sql: value }) => value.startsWith("insert into ai_content_generations"));
    expect(childGeneration?.params).toContain(UUID.parent);
    const childOperation = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_generation_operations"));
    expect(childOperation?.params).toContain(UUID.operation);
    const childJob = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_generation_jobs"));
    expect(JSON.parse(String(childJob?.params.at(-1)))).toMatchObject({
      manualVisualSelection: frozenManualVisualSelection,
    });
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("reuses a validated stored storyboard and queues only rendering after a render failure", async () => {
    const run = harness({ renderReady: true });
    const result = await run.repository.retryAiContentOutput(run.command);

    expect(result.id).not.toBe(UUID.parent);
    const sql = run.statements.map(({ sql }) => sql).join("\n");
    expect(sql).toContain("insert into ai_content_generation_render_jobs");
    const childOutput = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_generation_outputs"));
    expect(childOutput?.params[4]).toBe("generating");
    expect(JSON.parse(String(childOutput?.params[5]))).toMatchObject({ contractVersion: "reel-plan.v2" });
    const childJob = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_generation_jobs"));
    expect(childJob?.sql).toContain("'succeeded'");
    expect(childJob?.sql).not.toContain("'queued'");
    expect(JSON.parse(String(childJob?.params[6]))).toMatchObject({
      reelStoryboardContract: frozenStoryboardContract,
    });
  });

  it("fails closed instead of replanning when a stored render graph has invalid planning evidence", async () => {
    for (const options of [
      { renderReady: true, invalidStoredContract: true },
      { renderReady: true, missingParentSkill: true },
    ]) {
      const run = harness(options);
      await expect(run.repository.retryAiContentOutput(run.command))
        .rejects.toThrow("ai_content_generation_retry_parent_invalid");
      expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
        .toEqual([]);
      expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("fails closed before creating a child when the parent job has no frozen manual visual selection", async () => {
    const run = harness({ missingManualVisualSelection: true });
    await expect(run.repository.retryAiContentOutput(run.command))
      .rejects.toThrow("ai_content_generation_retry_parent_invalid");
    expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
      .toEqual([]);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("returns an exact idempotent child replay without new writes", async () => {
    const run = harness({ replay: true });
    const result = await run.repository.retryAiContentOutput(run.command);
    expect(result.id).toBe("10000000-0000-4000-8000-000000000010");
    expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
      .toEqual([]);
    expect(run.statements.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects a drifted idempotent child graph and a prompt binding that no longer matches the parent input", async () => {
    for (const options of [{ replay: true, replayGraphDrift: true }, { corruptParentBinding: true }]) {
      const run = harness(options);
      await expect(run.repository.retryAiContentOutput(run.command))
        .rejects.toThrow(/ai_content_generation_retry_(?:conflict|parent_invalid)/);
      expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
        .toEqual([]);
      expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("rejects missing reversal/expired retention and quota exhaustion without writes", async () => {
    for (const options of [{ reversed: false }, { retryable: false }, { quota: 10 }]) {
      const run = harness(options);
      await expect(run.repository.retryAiContentOutput(run.command)).rejects.toThrow();
      expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim()))).toEqual([]);
      expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    }
  });
});
