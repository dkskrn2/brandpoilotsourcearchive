import { describe, expect, it, vi } from "vitest";
import { createPerformanceProposalAdapter, selectPerformanceResearchEvidence } from "./performanceProposalAdapter.js";
import { buildPerformanceInsights, PERFORMANCE_EXPERIMENT_DEFINITION, type PerformanceInsightSnapshot } from "./performanceInsights.js";
import type { ProposalBaseInputSnapshotV2 } from "@brand-pilot/content-contracts";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";

function evidenceSnapshot(index: number, overrides: Partial<PerformanceInsightSnapshot> = {}): PerformanceInsightSnapshot {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `40000000-0000-4000-8000-${suffix}`,
    workspaceId,
    brandId,
    publishQueueId: `50000000-0000-4000-8000-${suffix}`,
    title: `성과 콘텐츠 ${index}`,
    channel: "instagram",
    deliveryFormat: "instagram_feed_carousel",
    measurementWindow: "7d",
    exposureCount: index * 100,
    rawMetrics: { likes: index },
    contentFeatures: { format: "card_news" },
    collectedAt: `2026-08-${String(index).padStart(2, "0")}T03:00:00.000Z`,
    updatedAt: `2026-08-${String(index).padStart(2, "0")}T03:05:00.000Z`,
    publishedAt: `2026-07-${String(index).padStart(2, "0")}T03:00:00.000Z`,
    contentHash: index.toString(16).padStart(64, "0"),
    externalUrl: `https://instagram.example/p/${index}`,
    ...overrides,
  };
}

const baseInput = {
  contractVersion: "proposal-base-input.v2" as const,
  brandCore: {
    versionId: "60000000-0000-4000-8000-000000000001",
    companyOverview: "브랜드 개요",
    businessDescription: "사업 설명",
    primaryCategory: "교육",
    detailedCategory: "온라인 교육",
    primaryTarget: "창업자",
    differentiator: "실전형",
    coreAppeal: "바로 적용",
  },
  subject: { kind: "topic_text" as const, title: PERFORMANCE_EXPERIMENT_DEFINITION.title },
  contentInstruction: PERFORMANCE_EXPERIMENT_DEFINITION.hypothesis,
  product: null,
  references: [],
  outputSettings: {
    outputFormat: "card_news" as const,
    channelTargets: ["instagram" as const],
    aspectRatio: "1:1" as const,
    outputCount: 1,
    purpose: "informational" as const,
  },
  capturedAt: "2026-08-05T00:00:00.000Z",
} satisfies ProposalBaseInputSnapshotV2;

describe("performance proposal V2 adapter", () => {
  it("reloads authoritative evidence, builds the fixed V2 request, and seals audit plus composition", async () => {
    const snapshots = [evidenceSnapshot(1), evidenceSnapshot(2), evidenceSnapshot(3)];
    const experiment = buildPerformanceInsights({ brandId, period: "30d", snapshots }).experiments[0]!;
    const resolveBaseInput = vi.fn(async () => baseInput);
    const adapter = createPerformanceProposalAdapter({
      loadSnapshots: vi.fn(async () => snapshots),
      resolveBaseInput,
    });

    const result = await adapter.resolve({
      source: "performance_experiment",
      workspaceId,
      brandId,
      actorUserId,
      experimentId: experiment.id,
      evidenceVersion: experiment.evidenceVersion,
    }, { query: vi.fn() } as never);

    expect(result.request).toMatchObject({
      contractVersion: "content-orchestration.v2",
      purpose: "informational",
      contentInstruction: PERFORMANCE_EXPERIMENT_DEFINITION.hypothesis,
      outputSettings: { outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1" },
    });
    expect(result.sourceSnapshots).toEqual([]);
    expect(result.performanceAudit).toMatchObject({
      experimentId: experiment.id,
      evidenceVersion: experiment.evidenceVersion,
      snapshotAudit: { snapshots: expect.arrayContaining([expect.objectContaining({ rawMetrics: { likes: 1 } })]) },
      researchEvidence: { decision: "searched", items: expect.any(Array) },
      composedInput: { contractVersion: "proposal-input.v2" },
    });
    expect(resolveBaseInput).toHaveBeenCalledTimes(1);
  });

  it("rejects stale evidence before freezing mutable base input", async () => {
    const resolveBaseInput = vi.fn(async () => baseInput);
    const adapter = createPerformanceProposalAdapter({
      loadSnapshots: vi.fn(async () => [evidenceSnapshot(1), evidenceSnapshot(2), evidenceSnapshot(3)]),
      resolveBaseInput,
    });

    await expect(adapter.resolve({
      source: "performance_experiment",
      workspaceId,
      brandId,
      actorUserId,
      experimentId: PERFORMANCE_EXPERIMENT_DEFINITION.id,
      evidenceVersion: "f".repeat(64),
    }, { query: vi.fn() } as never)).rejects.toThrow("performance_evidence_stale");
    expect(resolveBaseInput).not.toHaveBeenCalled();
  });

  it("keeps the latest snapshot per content, deduplicates URL or content hash, and caps worker evidence at eight", () => {
    const rows = Array.from({ length: 10 }, (_, index) => evidenceSnapshot(index + 1));
    rows.push(evidenceSnapshot(11, {
      publishQueueId: rows[0]!.publishQueueId,
      exposureCount: 9999,
      collectedAt: "2026-08-11T04:00:00.000Z",
    }));
    rows.push(evidenceSnapshot(12, { externalUrl: rows[1]!.externalUrl }));
    rows.push(evidenceSnapshot(13, { contentHash: rows[2]!.contentHash }));

    const evidence = selectPerformanceResearchEvidence(rows)!;

    expect(evidence.items).toHaveLength(8);
    expect(evidence.items[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(evidence.items[0]?.id).not.toBe("40000000-0000-4000-8000-000000000011");
    expect(new Set(evidence.items.map((item) => item.url)).size).toBe(8);
  });

  it("leaves research and composition absent when no real public HTTPS evidence exists", async () => {
    const snapshots = [1, 2, 3].map((index) => evidenceSnapshot(index, { externalUrl: null }));
    const experiment = buildPerformanceInsights({ brandId, period: "30d", snapshots }).experiments[0]!;
    const adapter = createPerformanceProposalAdapter({
      loadSnapshots: vi.fn(async () => snapshots),
      resolveBaseInput: vi.fn(async () => baseInput),
    });

    const result = await adapter.resolve({
      source: "performance_experiment",
      workspaceId,
      brandId,
      actorUserId,
      experimentId: experiment.id,
      evidenceVersion: experiment.evidenceVersion,
    }, { query: vi.fn() } as never);

    expect(result.performanceAudit?.researchEvidence).toBeNull();
    expect(result.performanceAudit?.composedInput).toBeNull();
  });

  it.each([
    ["tenant mismatch", (rows: PerformanceInsightSnapshot[]) => rows.map((row, index) => index === 0
      ? { ...row, workspaceId: "99999999-9999-4999-8999-999999999999" }
      : row), "performance_snapshot_tenant_mismatch"],
    ["duplicate ID", (rows: PerformanceInsightSnapshot[]) => [...rows, { ...rows[0]! }], "performance_snapshot_duplicate"],
    ["incomplete row", (rows: PerformanceInsightSnapshot[]) => rows.map((row, index) => index === 0
      ? { ...row, contentHash: undefined }
      : row), "performance_snapshot_incomplete"],
  ])("rejects %s before base-input resolution", async (_label, mutate, expected) => {
    const original = [evidenceSnapshot(1), evidenceSnapshot(2), evidenceSnapshot(3)];
    const experiment = buildPerformanceInsights({ brandId, period: "30d", snapshots: original }).experiments[0]!;
    const resolveBaseInput = vi.fn(async () => baseInput);
    const adapter = createPerformanceProposalAdapter({
      loadSnapshots: vi.fn(async () => mutate(original)),
      resolveBaseInput,
    });

    await expect(adapter.resolve({
      source: "performance_experiment",
      workspaceId,
      brandId,
      actorUserId,
      experimentId: experiment.id,
      evidenceVersion: experiment.evidenceVersion,
    }, { query: vi.fn() } as never)).rejects.toThrow(expected);
    expect(resolveBaseInput).not.toHaveBeenCalled();
  });

  it("orders deterministic ties by snapshot UUID before creating opaque evidence IDs", () => {
    const tiedAt = "2026-08-05T03:00:00.000Z";
    const evidence = selectPerformanceResearchEvidence([
      evidenceSnapshot(2, { exposureCount: 100, collectedAt: tiedAt }),
      evidenceSnapshot(1, { exposureCount: 100, collectedAt: tiedAt }),
    ]);

    expect(evidence?.items.map((item) => item.title)).toEqual(["성과 콘텐츠 1", "성과 콘텐츠 2"]);
  });
});
