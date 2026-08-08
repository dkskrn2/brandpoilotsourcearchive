import { describe, expect, it, vi } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  actor: "10000000-0000-4000-8000-000000000003",
  generation: "10000000-0000-4000-8000-000000000004",
  batch: "10000000-0000-4000-8000-000000000005",
  proposal: "10000000-0000-4000-8000-000000000006",
  attachment: "10000000-0000-4000-8000-000000000007",
  core: "10000000-0000-4000-8000-000000000008",
  reference: "10000000-0000-4000-8000-000000000009",
} as const;

const NOW = "2026-08-06T00:00:00.000Z";
const scope = { workspaceId: ids.workspace, brandId: ids.brand };

function generationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.generation,
    workspace_id: ids.workspace,
    brand_id: ids.brand,
    output_format: "reel",
    purpose: "informational",
    title: "릴스 안내",
    status: "draft",
    current_stage: "draft",
    draft_json: {},
    analysis_json: {},
    generation_idempotency_key: null,
    operation_id: null,
    generation_input_snapshot: null,
    subject_analysis_snapshot: null,
    orchestration_snapshot: null,
    avatar_snapshot: null,
    attachments_locked_at: null,
    terminal_at: null,
    retryable_until: null,
    error_code: null,
    error_message: null,
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
    ...overrides,
  };
}

describe("AI content repository V3 read privacy", () => {
  it("returns public lifecycle fields without immutable input or internal operation state", async () => {
    const privatePath = "private/generation/input.png";
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from ai_content_generation_outputs")) {
        expect(params).toEqual([[ids.generation]]);
        return { rows: [], rowCount: 0 };
      }
      expect(params).toEqual([ids.workspace, ids.brand]);
      return {
        rows: [generationRow({
          status: "failed",
          current_stage: "generation",
          attachments_locked_at: "2026-08-06T01:00:00.000Z",
          terminal_at: "2026-08-06T02:00:00.000Z",
          retryable_until: "2026-08-21T02:00:00.000Z",
          operation_id: "internal-operation-id",
          generation_input_snapshot: {
            brandRules: { forbiddenPhrases: ["internal-secret"] },
            references: { attachments: [{ storagePath: privatePath }] },
          },
          subject_analysis_snapshot: { internal: "subject-secret" },
        })],
        rowCount: 1,
      };
    });

    const [generation] = await createAiContentRepository({ query } as never)
      .listAiContentGenerations(scope);

    expect(generation).toMatchObject({
      id: ids.generation,
      outputFormat: "reel",
      purpose: "informational",
      status: "failed",
      attachmentsLockedAt: "2026-08-06T01:00:00.000Z",
      terminalAt: "2026-08-06T02:00:00.000Z",
      retryableUntil: "2026-08-21T02:00:00.000Z",
      outputs: [],
    });
    expect(generation).not.toHaveProperty("operationId");
    expect(generation).not.toHaveProperty("generationInputSnapshot");
    expect(generation).not.toHaveProperty("subjectAnalysisSnapshot");
    expect(JSON.stringify(generation)).not.toContain(privatePath);
    expect(JSON.stringify(generation)).not.toContain("internal-secret");
  });

  it("reads tenant-scoped V3 evidence while redacting private resource data", async () => {
    const privatePath = "private/attachments/reference.png";
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from ai_content_generation_outputs")) {
        expect(params).toEqual([[ids.generation]]);
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from ai_content_generation_input_snapshots")) {
        expect(params).toEqual([ids.generation, ids.workspace, ids.brand]);
        return {
          rows: [{
            input_json: {
              contractVersion: "content-generation-input.v3",
              generationId: ids.generation,
              brandCore: { versionId: ids.core, companyOverview: "브랜드 소개" },
              brandRules: { versionId: "private-rules", forbiddenPhrases: ["private-rule"] },
              subject: { kind: "topic_text", title: "동결된 주제" },
              contentInstruction: "간결하게",
              product: {
                id: "product-1",
                name: "제품",
                images: [{ storagePath: "private/products/original.png", checksum: "secret-checksum" }],
              },
              researchEvidence: { contractVersion: "research-evidence.v1", items: [] },
              references: {
                selected: [{
                  referenceItemId: ids.reference,
                  title: "동결 레퍼런스",
                  sourceUrl: "https://example.com/reference",
                  storagePath: "private/references/original.png",
                  storageUrl: "https://blob.example/references/original.png",
                }],
                brandStyleImages: [{ storagePath: "private/style.png" }],
                avatarStyleImageId: null,
                attachments: [{ id: ids.attachment, storagePath: privatePath, storageUrl: "https://blob.example/private.png" }],
              },
              selectedProposal: { id: ids.proposal, title: "동결된 구성안" },
              userImageInstruction: "로고 금지",
              outputSettings: {
                purpose: "informational",
                outputFormat: "reel",
                channelTargets: ["instagram"],
                aspectRatio: "9:16",
                outputCount: 1,
              },
              capturedAt: NOW,
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("from ai_content_generation_references")) {
        expect(params).toEqual([ids.generation, ids.workspace, ids.brand]);
        return { rows: [], rowCount: 0 };
      }
      expect(sql).toContain("from ai_content_generations");
      expect(params).toEqual([ids.generation, ids.workspace, ids.brand]);
      return {
        rows: [generationRow({ status: "completed", current_stage: "completed" })],
        rowCount: 1,
      };
    });

    const generation = await createAiContentRepository({ query } as never)
      .getAiContentGeneration({ ...scope, generationId: ids.generation });

    expect(generation).toMatchObject({
      evidenceSnapshot: {
        generationInput: {
          contractVersion: "content-generation-input.v3",
          generationId: ids.generation,
          subject: { kind: "topic_text", title: "동결된 주제" },
          product: { id: "product-1", name: "제품" },
          selectedProposal: { id: ids.proposal, title: "동결된 구성안" },
          outputSettings: { outputFormat: "reel", aspectRatio: "9:16" },
        },
        references: [{
          id: ids.reference,
          title: "동결 레퍼런스",
          url: "https://example.com/reference",
          previewUrl: null,
          roles: [],
        }],
        avatar: null,
        proposal: { id: ids.proposal, title: "동결된 구성안" },
      },
      outputs: [],
    });
    expect(generation?.evidenceSnapshot?.generationInput).not.toHaveProperty("brandRules");
    expect(generation?.evidenceSnapshot?.generationInput).not.toHaveProperty("references");
    expect((generation?.evidenceSnapshot?.generationInput.product as Record<string, unknown>)).not.toHaveProperty("images");
    const serialized = JSON.stringify(generation);
    expect(serialized).not.toContain("private/references/original.png");
    expect(serialized).not.toContain("https://blob.example/references/original.png");
    for (const secret of [privatePath, "private-rule", "private/products", "private/style", "private/references", "secret-checksum"]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

function finalizationHarness(attachmentAvailable: boolean) {
  const initialDraft = {
    origin: "proposal-v2",
    proposalBatchId: ids.batch,
    proposalId: ids.proposal,
    finalization: {
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: null,
      userImageInstruction: null,
      attachmentIds: [],
    },
  };
  const row = generationRow({ draft_json: initialDraft });
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql === "select assert_ai_content_writable()") return { rows: [{ ok: true }], rowCount: 1 };
      if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("from ai_content_generations") && sql.includes("for update")) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("from ai_content_generation_attachments")) {
        return attachmentAvailable
          ? { rows: [{ id: ids.attachment }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("update ai_content_generations")) {
        return {
          rows: [generationRow({ draft_json: JSON.parse(String(params[3])) })],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    statements,
    client,
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
  };
}

const finalizationDraft = {
  contractVersion: "content-finalization-draft.v2" as const,
  avatarStyleImageId: null,
  userImageInstruction: "에디토리얼 조명",
  attachmentIds: [ids.attachment],
};

describe("AI content repository V3 finalization resources", () => {
  it("locks the draft and current-generation image resources before updating finalization", async () => {
    const run = finalizationHarness(true);

    const result = await run.repository.updateAiContentFinalizationDraft({
      ...scope,
      generationId: ids.generation,
      actorUserId: ids.actor,
      draft: finalizationDraft,
    });

    expect(result.draft.finalization).toEqual(finalizationDraft);
    const sql = run.statements.map((statement) => statement.sql);
    const generationLock = sql.findIndex((statement) => statement.includes("from ai_content_generations") && statement.includes("for update"));
    const resourceLock = sql.findIndex((statement) => statement.includes("from ai_content_generation_attachments"));
    const update = sql.findIndex((statement) => statement.includes("update ai_content_generations"));
    expect(generationLock).toBeGreaterThan(sql.indexOf("BEGIN"));
    expect(resourceLock).toBeGreaterThan(generationLock);
    expect(update).toBeGreaterThan(resourceLock);
    expect(sql[resourceLock]).toContain("for share");
    expect(sql[resourceLock]).toContain("generation_id=$1");
    expect(sql[resourceLock]).toContain("deleted_at is null");
    expect(sql[resourceLock]).toContain("role in ('product_image','visual_reference','supporting_image')");
    expect(sql[resourceLock]).toContain("lower(mime_type) in ('image/png','image/jpeg','image/webp')");
    expect(run.statements[resourceLock]?.params).toEqual([
      ids.generation,
      ids.workspace,
      ids.brand,
      [ids.attachment],
    ]);
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it("maps a missing or ineligible attachment to the public unavailable error without updating", async () => {
    const run = finalizationHarness(false);

    await expect(run.repository.updateAiContentFinalizationDraft({
      ...scope,
      generationId: ids.generation,
      actorUserId: ids.actor,
      draft: finalizationDraft,
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);

    expect(run.statements.some(({ sql }) => sql.includes("update ai_content_generations"))).toBe(false);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });
});

const brandCore = {
  versionId: ids.core,
  companyOverview: "브랜드 개요",
  businessDescription: "사업 설명",
  primaryCategory: "패션",
  detailedCategory: "지속가능 패션",
  primaryTarget: "의식 있는 소비자",
  differentiator: "검증된 공급망",
  coreAppeal: "투명성",
};

const proposalBaseInput = {
  contractVersion: "proposal-base-input.v2",
  brandCore,
  subject: { kind: "topic_text", title: "선택 계약" },
  contentInstruction: null,
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "reel",
    channelTargets: ["instagram"],
    aspectRatio: "9:16",
    outputCount: 1,
    purpose: "informational",
  },
  capturedAt: NOW,
};

const resumeInput = {
  contractVersion: "content-orchestration.v2",
  brandId: ids.brand,
  purpose: "informational",
  seed: { kind: "topic_text", title: "선택 계약" },
  contentInstruction: null,
  productId: null,
  outputSettings: {
    outputFormat: "reel",
    channelTargets: ["instagram"],
    aspectRatio: "9:16",
    outputCount: 1,
  },
};

const expectedSelectionDraft = {
  origin: "proposal-v2",
  proposalBatchId: ids.batch,
  proposalId: ids.proposal,
  finalization: {
    contractVersion: "content-finalization-draft.v2",
    avatarStyleImageId: null,
    userImageInstruction: null,
    attachmentIds: [],
  },
};

function selectionHarness(options: {
  status?: string;
  identity?: string;
  draftProposalId?: string;
} = {}) {
  const selectionIdentity = `proposal-v2:${ids.batch}:${ids.proposal}:select-1`;
  const linked = generationRow({
    status: options.status ?? "draft",
    analysis_idempotency_key: options.identity ?? selectionIdentity,
    draft_json: {
      ...expectedSelectionDraft,
      proposalId: options.draftProposalId ?? ids.proposal,
    },
  });
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql === "select assert_ai_content_writable()") return { rows: [{ ok: true }], rowCount: 1 };
      if (sql.includes("from workspace_members member")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (sql.includes("select select_ai_content_proposal")) return { rows: [{ selected: ids.proposal }], rowCount: 1 };
      if (sql.includes("from ai_content_proposals proposal") && sql.includes("join ai_content_proposal_batches")) {
        return {
          rows: [{
            id: ids.proposal,
            batch_id: ids.batch,
            proposal_json: {
              title: "선택 제안",
              outputFormat: "reel",
              purposeDetails: { kind: "informational" },
            },
            generation_id: ids.generation,
            purpose: "informational",
            input_snapshot_json: {
              baseInput: proposalBaseInput,
              replayFingerprint: "a".repeat(64),
              resumeInput,
            },
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("from ai_content_generations")) return { rows: [linked], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    statements,
    repository: createAiContentRepository({ connect: async () => client, query: client.query } as never),
  };
}

describe("AI content repository V3 proposal selection", () => {
  it("replays only the same locked draft for the same idempotency key", async () => {
    const run = selectionHarness();

    await expect(run.repository.selectAiContentProposal({
      ...scope,
      actorUserId: ids.actor,
      proposalId: ids.proposal,
      idempotencyKey: "select-1",
    })).resolves.toMatchObject({ id: ids.generation, status: "draft", outputFormat: "reel" });

    const sql = run.statements.map((statement) => statement.sql);
    expect(sql.some((statement) => statement.includes("from ai_content_generations") && statement.includes("for update"))).toBe(true);
    expect(sql.some((statement) => statement.includes("insert into ai_content_generations"))).toBe(false);
    expect(sql.at(-1)).toBe("COMMIT");
  });

  it.each([
    ["different selection key", { identity: `proposal-v2:${ids.batch}:${ids.proposal}:other-key` }],
    ["different proposal draft", { identity: `proposal-v2:${ids.batch}:20000000-0000-4000-8000-000000000001:select-1`, draftProposalId: "20000000-0000-4000-8000-000000000001" }],
    ["non-draft generation", { status: "failed" }],
  ])("rejects a linked generation with %s", async (_label, options) => {
    const run = selectionHarness(options);

    await expect(run.repository.selectAiContentProposal({
      ...scope,
      actorUserId: ids.actor,
      proposalId: ids.proposal,
      idempotencyKey: "select-1",
    })).rejects.toThrow(/^ai_content_proposal_selection_conflict$/);

    expect(run.statements.some(({ sql }) => sql.includes("insert into ai_content_generations"))).toBe(false);
    expect(run.statements.at(-1)?.sql).toBe("ROLLBACK");
  });
});
