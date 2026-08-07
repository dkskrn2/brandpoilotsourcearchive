import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";
import { proposalSha256 } from "./aiContentProposalV2Service.js";

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

function harness(options: {
  replay?: boolean;
  replayGraphDrift?: boolean;
  quota?: number;
  retryable?: boolean;
  reversed?: boolean;
  corruptParentBinding?: boolean;
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
      if (sql.includes("select * from ai_content_generation_outputs")) return { rows: [{ id: UUID.output, status: "failed" }], rowCount: 1 };
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
    expect(sql.join("\n")).toMatch(/insert into ai_content_generations[\s\S]*insert into ai_content_generation_operations[\s\S]*insert into ai_content_usage_ledger[\s\S]*insert into ai_content_generation_input_snapshots[\s\S]*create_ai_content_generation_prompt_binding[\s\S]*insert into ai_content_generation_outputs[\s\S]*insert into ai_content_generation_jobs/);
    expect(sql.join("\n")).not.toMatch(/update ai_content_generation_(?:outputs|render_jobs)/i);
    const childGeneration = run.statements.find(({ sql: value }) => value.startsWith("insert into ai_content_generations"));
    expect(childGeneration?.params).toContain(UUID.parent);
    const childOperation = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_generation_operations"));
    expect(childOperation?.params).toContain(UUID.operation);
    expect(sql.at(-1)).toBe("COMMIT");
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
