import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseGeneratedContentCatalog, promptBindingFor } from "@brand-pilot/content-contracts";
import { proposalSha256 } from "./aiContentProposalV2Service.js";

const assembler = vi.hoisted(() => ({ assemble: vi.fn() }));
vi.mock("./aiContentFixedInputAssembler.js", () => ({ assembleAiContentFixedInput: assembler.assemble }));

import { createAiContentRepository } from "./aiContentRepository.js";

const id = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  generation: "10000000-0000-4000-8000-000000000004",
  batch: "10000000-0000-4000-8000-000000000005",
  proposal: "10000000-0000-4000-8000-000000000006",
  job: "10000000-0000-4000-8000-000000000007",
  attempt: "10000000-0000-4000-8000-000000000008",
  contract: "10000000-0000-4000-8000-000000000009",
  composition: "10000000-0000-4000-8000-00000000000a",
  core: "10000000-0000-4000-8000-00000000000b",
  rules: "10000000-0000-4000-8000-00000000000c",
  operation: "10000000-0000-4000-8000-00000000000d",
  style: "10000000-0000-4000-8000-00000000000e",
  attachment: "10000000-0000-4000-8000-00000000000f",
} as const;
const HASH = "a".repeat(64);
const NOW = "2026-08-06T00:00:00.000Z";
const researchSourceAcquisition = {
  contractVersion: "research-source-acquisition.v1",
  status: "not_applicable",
  requestedUrl: null,
  canonicalUrl: null,
  contentHash: null,
  capturedAt: NOW,
};

const brandCore = {
  versionId: id.core, companyOverview: "개요", businessDescription: "설명",
  primaryCategory: "테크", detailedCategory: "생산성", primaryTarget: "실무자",
  differentiator: "검증", coreAppeal: "정확성",
};
const brandRules = {
  versionId: id.rules, version: 1,
  content: {
    contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
    ctaRules: { defaultCta: "확인", allowed: ["확인"] }, channelRules: { instagram: [] },
    designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
    autoApprovalRules: { enabled: false, conditions: [] },
  },
  contentSha256: HASH,
};
const onboardingBrandRules = {
  ...brandRules,
  contentSha256: proposalSha256(brandRules.content),
};
const onboardingAuthority = {
  kind: "onboarding_provisional" as const,
  analysisId: id.core,
  ownedUrl: "https://brand.example/",
  categoryCode: "technology_software",
  subcategoryCodes: ["productivity_software"],
  suggestionId: id.rules,
  sourceUrls: ["https://source.example/report"],
  brandRules: onboardingBrandRules,
};
const onboardingSnapshot = {
  categoryCode: onboardingAuthority.categoryCode,
  subcategoryCodes: onboardingAuthority.subcategoryCodes,
  suggestion: {
    id: onboardingAuthority.suggestionId,
    subcategoryCode: "productivity_software",
    subcategoryName: "생산성 소프트웨어",
    intent: "informational" as const,
    title: "생산성 업무 가이드",
    whyNow: "업무 자동화 수요가 늘었습니다.",
    contentBrief: "실무 체크리스트를 제공합니다.",
    sources: [{
      url: onboardingAuthority.sourceUrls[0],
      title: "생산성 보고서",
      publisher: "Example",
      publishedAt: null,
    }],
  },
  contentInstruction: null,
  requestFingerprint: "b".repeat(64),
  proposalBatchId: id.batch,
  generationId: null,
  requestedAt: NOW,
};
const evidence = {
  contractVersion: "research-evidence.v1", decision: "not_needed", reason: "evergreen",
  queries: [], capturedAt: NOW, items: [],
};
const selectedProposal = {
  id: id.proposal, conceptKey: "reel-guide", title: "릴스 안내", informationalType: "how_to",
  oneLineIntent: "안내", differentiator: "명확함", differentiationAxes: ["narrative"], target: "실무자",
  customerContext: "업무", keyMessage: "확인", hook: "시작", selectionReason: "유용함",
  evidenceIds: [], referenceIds: [], outputFormat: "reel", channelTargets: ["instagram"], assetCount: 1,
  outline: [{ index: 1, role: "scene", headline: "핵심", purpose: "설명" }],
  purposeDetails: { kind: "informational", question: "무엇?", value: "학습", whyNow: "지금", learningPoints: ["핵심"] },
};
const frozenInput = {
  contractVersion: "content-generation-input.v3", generationId: id.generation, brandCore, brandRules,
  subject: { kind: "topic_text", title: "주제" }, contentInstruction: null, product: null, researchEvidence: evidence,
  references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
  selectedProposal, userImageInstruction: null,
  outputSettings: { outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1, purpose: "informational" },
  capturedAt: NOW,
};
const baseInput = {
  contractVersion: "proposal-base-input.v2", brandCore, subject: frozenInput.subject,
  contentInstruction: null, product: null, references: [], outputSettings: frozenInput.outputSettings, capturedAt: NOW,
};
const finalization = {
  contractVersion: "content-finalization-draft.v2", avatarStyleImageId: null,
  userImageInstruction: null, attachmentIds: [],
};
const manualVisualSelection = {
  contractVersion: "manual-visual-selection.v1",
  product: null, stylePreset: null, avatar: null,
} as const;
const frozenManualVisualSelection = {
  contractVersion: "manual-visual-selection-frozen.v1",
  product: null, stylePreset: null, avatar: null,
} as const;

async function binding() {
  const catalogPath = new URL(import.meta.resolve("@brand-pilot/content-contracts/generated/content-catalog.json"));
  const bytes = readFileSync(catalogPath);
  const raw = JSON.parse(bytes.toString("utf8"));
  const generatedDirectory = dirname(catalogPath.pathname.replace(/^\/(.:)/, "$1"));
  const schemaArtifacts = Object.fromEntries(readdirSync(generatedDirectory)
    .filter((filename) => filename.endsWith(".schema.json"))
    .map((filename) => [filename, readFileSync(join(generatedDirectory, filename), "utf8")]));
  const catalog = await parseGeneratedContentCatalog(raw, { contractSourceHash: raw.contractSourceHash, schemaArtifacts });
  return promptBindingFor("reel", "informational", catalog);
}

function harness(options: {
  replay?: boolean;
  corruptBinding?: boolean;
  bindingFailure?: boolean;
  quotaUsage?: number;
  operationFingerprint?: string;
  operationGenerationId?: string;
  startedWithoutOperationMatch?: boolean;
  coreMissing?: boolean;
  rulesMissing?: boolean;
  malformedFinalization?: boolean;
  unavailableAttachment?: boolean;
  styleReference?: boolean;
  onboarding?: boolean;
} = {}) {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  let replayBinding: Awaited<ReturnType<typeof binding>>;
  let frozenVisualSelection: typeof frozenManualVisualSelection | null = options.replay
    ? frozenManualVisualSelection : null;
  const generation = {
    id: id.generation, workspace_id: id.workspace, brand_id: id.brand, output_format: "reel", purpose: "informational",
    title: "릴스", status: options.replay || options.startedWithoutOperationMatch ? "queued" : "draft",
    current_stage: options.replay || options.startedWithoutOperationMatch ? "generation" : null,
    draft_json: { origin: "proposal-v2", proposalBatchId: id.batch, proposalId: id.proposal, finalization: options.malformedFinalization
      ? { ...finalization, attachmentIds: "bad" }
      : options.unavailableAttachment ? { ...finalization, attachmentIds: [id.attachment] } : finalization },
    analysis_json: {}, generation_idempotency_key: options.replay || options.startedWithoutOperationMatch ? "prior-key" : null,
    operation_id: options.replay || options.startedWithoutOperationMatch ? id.operation : null,
    generation_input_snapshot: options.replay || options.startedWithoutOperationMatch ? frozenInput : null,
    attachments_locked_at: options.replay || options.startedWithoutOperationMatch ? NOW : null,
    terminal_at: null, retryable_until: null, error_code: null, error_message: null,
    created_at: NOW, updated_at: NOW, completed_at: null,
  };
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql === "select assert_ai_content_writable()") return { rows: [{ ok: true }], rowCount: 1 };
      if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("from manual_ai_content_visual_selections") && sql.includes("for update")) return { rows: [{
        selection_json: manualVisualSelection,
        selection_sha256: proposalSha256(manualVisualSelection),
        frozen_json: frozenVisualSelection,
        frozen_sha256: frozenVisualSelection ? proposalSha256(frozenVisualSelection) : null,
      }], rowCount: 1 };
      if (sql.startsWith("update manual_ai_content_visual_selections")) {
        frozenVisualSelection = JSON.parse(String(params[3]));
        return { rows: [{
          selection_json: manualVisualSelection,
          selection_sha256: proposalSha256(manualVisualSelection),
          frozen_json: frozenVisualSelection,
          frozen_sha256: proposalSha256(frozenVisualSelection),
        }], rowCount: 1 };
      }
      if (sql.startsWith("update ai_content_generations")) return { rows: [{ ...generation, status: "queued", operation_id: id.operation, generation_input_snapshot: frozenInput, attachments_locked_at: NOW }], rowCount: 1 };
      if (sql.includes("from ai_content_generations")) return { rows: [generation], rowCount: 1 };
      if (sql.includes("from ai_content_proposal_batches")) return { rows: [{ id: id.batch, workspace_id: id.workspace, brand_id: id.brand, status: "ready", origin: "manual", performance_audit_id: null, purpose: "informational", input_snapshot_json: { baseInput, ...(options.onboarding ? { brandContextAuthority: onboardingAuthority } : {}), replayFingerprint: HASH, researchSourceAcquisition, resumeInput: { contractVersion: "content-orchestration.v2", brandId: id.brand, purpose: "informational", seed: { kind: "topic_text", title: "주제" }, contentInstruction: null, productId: null, outputSettings: { outputFormat: "reel", channelTargets: ["instagram"], aspectRatio: "9:16", outputCount: 1 } } }, request_json: {} }], rowCount: 1 };
      if (sql.includes("from ai_content_proposals") && sql.includes("for update")) return { rows: [{ id: id.proposal, batch_id: id.batch, workspace_id: id.workspace, brand_id: id.brand, status: "selected", generation_id: id.generation, proposal_json: selectedProposal, successful_model_attempt_id: id.attempt, successful_proposal_job_id: id.job, final_invocation_ordinal: 1 }], rowCount: 1 };
      if (sql.includes("from ai_content_generation_operations")) {
        return options.replay ? { rows: [{ id: id.operation, workspace_id: id.workspace, brand_id: id.brand, generation_id: options.operationGenerationId ?? id.generation, request_fingerprint_sha256: options.operationFingerprint ?? proposalSha256({ generationId: id.generation, contractVersion: "content-generation-start.v2", workspaceId: id.workspace, brandId: id.brand, proposalBatchId: id.batch, proposalId: id.proposal, outputFormat: "reel", purpose: "informational", finalization, manualVisualSelection: frozenManualVisualSelection }), status: "started" }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("from ai_content_generation_input_snapshots snapshot")) {
        replayBinding = await binding();
        const value = options.corruptBinding ? { ...replayBinding, purpose: "marketing" } : replayBinding;
        return { rows: [{ input_json: frozenInput, content_hash: proposalSha256(frozenInput), binding_json: value, binding_sha256: proposalSha256(value), binding_hash_matches: true, selected_proposal_id: id.proposal, proposal_job_id: id.job, successful_model_attempt_id: id.attempt, final_invocation_ordinal: 1, output_format: "reel", purpose: "informational", generation_input_version: "content-generation-input.v3", reservation_id: "10000000-0000-4000-8000-00000000000e", quantity: 1, output_count: 1, job_count: 1 }], rowCount: 1 };
      }
      if (sql.includes("from ai_content_proposal_jobs job")) return { rows: [{ job_id: id.job, batch_id: id.batch, job_status: "completed", request_json: {}, contract_id: id.contract, request_contract_version: "content-proposal-request.v2", base_input_contract_version: "proposal-base-input.v2", research_contract_version: "research-evidence.v1", proposal_contract_version: "content-proposal.v2", proposal_prompt_version: "proposal.writer.v2", proposal_output_schema_sha256: HASH, proposal_model_id: "gpt-5.6-terra", command_descriptor_sha256: HASH, request_sha256: HASH, base_input_sha256: HASH, contract_source_sha256: HASH, catalog_sha256: HASH, enqueue_contract_sha256: HASH, composition_id: id.composition, composed_input_json: { researchEvidence: evidence }, research_evidence_set_sha256: HASH, composed_input_sha256: HASH, final_invocation_aggregate_sha256: HASH, attempt_id: id.attempt, aggregate_contract_sha256: HASH, model_id: "gpt-5.6-terra", model_sha256: HASH, attempt_command_sha256: HASH, attempt_schema_sha256: HASH, attempt_composed_sha256: HASH, event_type: "attempt_succeeded", invocation_ordinal: 1, event_aggregate_sha256: HASH, event_model_sha256: HASH, event_command_sha256: HASH, event_schema_sha256: HASH, event_composed_sha256: HASH, output_sha256: HASH, parser_sha256: HASH, parser_valid: true, evidence_json: evidence }], rowCount: 1 };
      if (sql.includes("from brand_analysis_runs")) throw new Error("ai_content_role_cannot_read_brand_analysis_runs");
      if (sql.includes("lock_ai_content_fixed_input_sources")) return { rows: [{ locked: true }], rowCount: 1 };
      if (sql.includes("from brand_core_versions")) return options.coreMissing ? { rows: [], rowCount: 0 } : { rows: [{ id: id.core, status: "approved" }], rowCount: 1 };
      if (sql.includes("from brand_profiles profile")) return options.rulesMissing ? { rows: [], rowCount: 0 } : { rows: [{
        id: id.rules,
        version: 1,
        status: "approved",
        rules_json: options.styleReference ? {
          ...brandRules.content,
          designRules: {
            ...brandRules.content.designRules,
            referenceImages: [{ referenceItemId: id.style, description: "Editorial", tags: ["soft"] }],
          },
        } : brandRules.content,
      }], rowCount: 1 };
      if (sql.includes("jsonb_array_elements")) return options.styleReference ? { rows: [{
        reference_item_id: id.style,
        description: "Editorial",
        tags: ["soft"],
        storage_url: "https://blob.example/original.webp",
        storage_path: "brand/original.webp",
        mime_type: "image/webp",
        checksum: "7".repeat(64),
      }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (sql.includes("from ai_content_usage_ledger")) return { rows: [{ generation_count: options.quotaUsage ?? 0 }], rowCount: 1 };
      if (sql.includes("create_ai_content_generation_prompt_binding") && options.bindingFailure) throw new Error("binding_write_failed");
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  };
  const getOnboardingContent = vi.fn(async () => onboardingSnapshot);
  const repository = createAiContentRepository(
    { connect: async () => client, query: client.query } as never,
    options.onboarding ? { brandIntelligenceProvider: { getConfirmed: vi.fn(), getOnboardingContent } } as never : {},
  );
  const command = { workspaceId: id.workspace, brandId: id.brand, generationId: id.generation, actorUserId: id.actor, contractVersion: "content-generation-start.v2", idempotencyKey: "start-key", usageDate: "2026-08-06", dailyGenerationLimit: 10 };
  return { client, statements, repository, command, getOnboardingContent };
}

describe("V3 generation start transaction", () => {
  it("serializes the operation key and commits reservation, snapshot, binding, output, and job atomically", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness();
    await run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW));
    const sql = run.statements.map(({ sql }) => sql);
    expect(sql.indexOf("BEGIN")).toBe(0);
    expect(sql.findIndex((value) => value.includes("ai-content-operation:"))).toBeLessThan(sql.findIndex((value) => value.includes("from ai_content_generation_operations")));
    expect(sql.join("\n")).toMatch(/insert into ai_content_generation_operations[\s\S]*insert into ai_content_usage_ledger[\s\S]*insert into ai_content_generation_input_snapshots[\s\S]*create_ai_content_generation_prompt_binding[\s\S]*insert into ai_content_generation_outputs[\s\S]*insert into ai_content_generation_jobs/);
    expect(sql.join("\n")).not.toMatch(/content_type|generation\.type|content_family/);
    expect(sql.filter((value) => value.includes("insert into ai_content_generation_outputs"))).toHaveLength(1);
    expect(sql.filter((value) => value.includes("insert into ai_content_generation_jobs"))).toHaveLength(1);
    const reservation = run.statements.find(({ sql: value }) => value.includes("insert into ai_content_usage_ledger"));
    expect(reservation?.params[4]).toBe(1);
    expect(sql.find((value) => value.includes("insert into ai_content_generation_operations"))).toContain("'reserved'");
    expect(run.statements.find(({ sql: value }) => value.includes("transition_ai_content_generation_operation"))?.params)
      .toEqual([expect.any(String)]);
    expect(sql.find((value) => value.includes("lock_ai_content_fixed_input_sources"))).toBeDefined();
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("returns an exact replay without writes and rejects a drifted binding", async () => {
    const replay = harness({ replay: true });
    await replay.repository.startAiContentGenerationV3({
      ...replay.command,
      expectedFinalization: finalization,
    } as never, {} as never, () => new Date(NOW));
    expect(replay.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim()))).toEqual([]);
    expect(replay.statements.at(-1)?.sql).toBe("COMMIT");

    const corrupt = harness({ replay: true, corruptBinding: true });
    await expect(corrupt.repository.startAiContentGenerationV3(corrupt.command as never, {} as never, () => new Date(NOW)))
      .rejects.toThrow("ai_content_generation_start_conflict");
    expect(corrupt.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects a changed expected finalization under the generation row lock before writes", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness();

    await expect(run.repository.startAiContentGenerationV3({
      ...run.command,
      expectedFinalization: {
        ...finalization,
        userImageInstruction: "changed in another tab",
      },
    } as never, {} as never, () => new Date(NOW)))
      .rejects.toThrow("ai_content_finalization_changed");

    expect(run.statements.find(({ sql }) => sql.includes("from ai_content_generations") && sql.includes("for update")))
      .toBeDefined();
    expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
      .toEqual([]);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rolls back every start write when binding persistence fails", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness({ bindingFailure: true });
    await expect(run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW)))
      .rejects.toThrow("binding_write_failed");
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(run.client.release).toHaveBeenCalledOnce();
  });

  it("performs zero writes when the reserved daily quota would be exceeded", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness({ quotaUsage: 10 });
    await expect(run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW)))
      .rejects.toThrow("ai_content_limit_reached");
    expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim()))).toEqual([]);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects same-key fingerprint/generation drift and a different key on an already-started generation", async () => {
    for (const options of [
      { replay: true, operationFingerprint: "f".repeat(64) },
      { replay: true, operationGenerationId: "20000000-0000-4000-8000-000000000001" },
      { startedWithoutOperationMatch: true },
    ]) {
      const run = harness(options);
      await expect(run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW)))
        .rejects.toThrow("ai_content_generation_start_conflict");
      expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("rolls back malformed finalization and unavailable frozen resources before writes", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    for (const options of [{ malformedFinalization: true }, { coreMissing: true }, { unavailableAttachment: true }]) {
      const run = harness(options);
      await expect(run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW)))
        .rejects.toThrow();
      expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim()))).toEqual([]);
      expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
    }
  });

  it("returns an actionable public code when active approved Brand Rules are missing", async () => {
    const run = harness({ rulesMissing: true });

    await expect(run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW)))
      .rejects.toThrow(/^ai_content_brand_rules_required$/);
    expect(run.statements.map(({ sql }) => sql).filter((sql) => /^(?:insert|update|delete)\b/i.test(sql.trim())))
      .toEqual([]);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("holds every mutable frozen-resource row through the start transaction", () => {
    const repository = readFileSync(new URL("./aiContentRepository.ts", import.meta.url), "utf8");
    const migration = readFileSync(new URL(
      "../../../db/migrations/075_ai_content_three_format_cutover.sql",
      import.meta.url,
    ), "utf8");
    expect(repository).toMatch(/select lock_ai_content_fixed_input_sources\(/i);
    expect(migration).toMatch(/create function lock_ai_content_fixed_input_sources\([\s\S]*from public\.brand_core_versions core[\s\S]*for update;/i);
    expect(migration).toMatch(/from public\.product_services item[\s\S]*?for update of item,version;/i);
    expect(migration).toMatch(/join public\.reference_snapshots snapshot[\s\S]*?for update of item,snapshot;/i);
    expect(migration).toMatch(/from public\.brand_profiles profile[\s\S]*?for update of profile,rules;/i);
    expect(migration).toMatch(/join public\.storage_artifacts artifact[\s\S]*?for update of item,artifact;/i);
    const source = repository;
    expect(source).toMatch(/join ai_content_attachment_upload_sessions upload[\s\S]*?for update of attachment,upload`/i);
    expect(source).toMatch(/attachment\.deleted_at is null[\s\S]*upload\.status='confirmed'[\s\S]*upload\.confirmed_attachment_id=attachment\.id/i);
    expect(source).toMatch(/generation_input_snapshot=\$6::jsonb,[\s\S]*attachments_locked_at=statement_timestamp\(\)/i);
  });

  it("revalidates and assembles the canonical snapshot before quota accounting", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness();
    await run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW));
    const sql = run.statements.map(({ sql }) => sql);
    expect(sql.findIndex((value) => value.includes("from brand_core_versions")))
      .toBeLessThan(sql.findIndex((value) => value.includes("from ai_content_usage_ledger")));
    expect(assembler.assemble).toHaveBeenCalled();
  });

  it("loads provisional onboarding authority through the owning repository instead of the AI-content role", async () => {
    const promptBinding = await binding();
    assembler.assemble.mockReturnValue({ input: frozenInput, canonicalJson: JSON.stringify(frozenInput), contentHash: proposalSha256(frozenInput), binding: promptBinding, provenance: { selectedProposalId: id.proposal, proposalJobId: id.job, proposalContractId: id.contract, successfulModelAttemptId: id.attempt } });
    const run = harness({ onboarding: true });

    await run.repository.startAiContentGenerationV3(run.command as never, {} as never, () => new Date(NOW));

    expect(run.getOnboardingContent).toHaveBeenCalledWith({
      workspaceId: id.workspace,
      brandId: id.brand,
      analysisId: id.core,
    });
    expect(run.statements.map(({ sql }) => sql).join("\n")).not.toContain("brand_analysis_runs");
  });

  it("freezes approved style image bytes through the snapshot repository before sealing V3 input", async () => {
    const frozenStyle = {
      referenceItemId: id.style,
      description: "Editorial",
      tags: ["soft"],
      storageUrl: "https://blob.example/ai-content/snapshots/frozen.webp",
      storagePath: `ai-content/snapshots/${"7".repeat(64)}.webp`,
      mimeType: "image/webp" as const,
      checksum: "7".repeat(64),
    };
    const promptBinding = await binding();
    assembler.assemble.mockImplementationOnce((source) => {
      expect(source.brandStyleImages).toEqual([expect.objectContaining({ snapshot: frozenStyle })]);
      return {
        input: frozenInput,
        canonicalJson: JSON.stringify(frozenInput),
        contentHash: proposalSha256(frozenInput),
        binding: promptBinding,
        provenance: {
          selectedProposalId: id.proposal,
          proposalJobId: id.job,
          proposalContractId: id.contract,
          successfulModelAttemptId: id.attempt,
        },
      };
    });
    const run = harness({ styleReference: true });
    const loadApprovedStyleImages = vi.fn().mockResolvedValue([frozenStyle]);

    await run.repository.startAiContentGenerationV3(run.command as never, {
      loadApprovedStyleImages,
    } as never, () => new Date(NOW));

    expect(loadApprovedStyleImages).toHaveBeenCalledWith({
      workspaceId: id.workspace,
      brandId: id.brand,
    }, run.client);
  });
});
