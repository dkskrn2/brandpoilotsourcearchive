import { createHash } from "node:crypto";
import type { ContentOrchestrationV2, ProposalBaseInputSnapshotV2 } from "@brand-pilot/content-contracts";
import type { ProposalInputSnapshotV2, ResearchEvidenceSnapshotV1 } from "./aiContentContracts.js";
import { parseProposalInputSnapshotV2 } from "./aiContentGenerationInputV3.js";
import {
  proposalSha256,
  type CreateProposalBatchV2Command,
  type ProposalV2Transaction,
  type ResolvedProposalV2Creation,
} from "./aiContentProposalV2Service.js";
import {
  buildPerformanceInsights,
  normalizePerformanceExternalUrl,
  PERFORMANCE_EXPERIMENT_DEFINITION,
  performanceEvidenceProjection,
  type PerformanceInsightSnapshot,
} from "./performanceInsights.js";

type PerformanceCommand = Extract<CreateProposalBatchV2Command, { source: "performance_experiment" }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PerformanceProposalAdapterDependencies {
  loadSnapshots(
    scope: { workspaceId: string; brandId: string },
    tx: ProposalV2Transaction,
  ): Promise<PerformanceInsightSnapshot[]>;
  resolveBaseInput(
    request: ContentOrchestrationV2,
    scope: { workspaceId: string; brandId: string },
    tx: ProposalV2Transaction,
  ): Promise<ProposalBaseInputSnapshotV2>;
}

function researchItemHash(item: {
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  claimSummary: string;
}): string {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}

function opaquePerformanceEvidenceId(snapshot: PerformanceInsightSnapshot): string {
  const hex = proposalSha256({
    kind: "performance-public-evidence.v1",
    snapshotId: snapshot.id,
    publishedContentHash: snapshot.contentHash,
  });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function compareEvidence(left: PerformanceInsightSnapshot, right: PerformanceInsightSnapshot): number {
  const exposure = (right.exposureCount ?? -1) - (left.exposureCount ?? -1);
  if (exposure !== 0) return exposure;
  const captured = Date.parse(right.collectedAt) - Date.parse(left.collectedAt);
  return captured !== 0 ? captured : left.id.localeCompare(right.id);
}

export function selectPerformanceResearchEvidence(
  snapshots: PerformanceInsightSnapshot[],
): ResearchEvidenceSnapshotV1 | null {
  const latestByContent = new Map<string, PerformanceInsightSnapshot>();
  for (const snapshot of snapshots) {
    if (snapshot.exposureCount === null || !Number.isFinite(snapshot.exposureCount)) continue;
    const current = latestByContent.get(snapshot.publishQueueId);
    if (!current || Date.parse(snapshot.collectedAt) > Date.parse(current.collectedAt)
      || (snapshot.collectedAt === current.collectedAt && snapshot.id.localeCompare(current.id) < 0)) {
      latestByContent.set(snapshot.publishQueueId, snapshot);
    }
  }

  const deduped: PerformanceInsightSnapshot[] = [];
  const seenUrls = new Set<string>();
  const seenContentHashes = new Set<string>();
  for (const snapshot of [...latestByContent.values()].sort(compareEvidence)) {
    const url = normalizePerformanceExternalUrl(snapshot.externalUrl);
    if (!url || !snapshot.contentHash || !/^[0-9a-f]{64}$/.test(snapshot.contentHash)) continue;
    if (seenUrls.has(url) || seenContentHashes.has(snapshot.contentHash)) continue;
    seenUrls.add(url);
    seenContentHashes.add(snapshot.contentHash);
    deduped.push({ ...snapshot, externalUrl: url });
  }
  const selected = deduped.sort(compareEvidence).slice(0, 8);
  if (selected.length === 0) return null;
  const capturedAt = selected.map((snapshot) => snapshot.collectedAt).sort().at(-1)!;
  return {
    contractVersion: "research-evidence.v1",
    decision: "searched",
    reason: "사용자가 승인한 성과 실험의 공개 게시물 근거입니다.",
    queries: [],
    capturedAt,
    items: selected.map((snapshot) => {
      const url = snapshot.externalUrl!;
      const publisher = new URL(url).hostname;
      const core = {
        title: snapshot.title,
        url,
        publisher,
        publishedAt: snapshot.publishedAt ?? null,
        claimSummary: `성과 관측에서 노출 ${snapshot.exposureCount}회가 확인된 게시 콘텐츠입니다.`,
      };
      return {
        id: opaquePerformanceEvidenceId(snapshot),
        ...core,
        capturedAt: snapshot.collectedAt,
        contentHash: researchItemHash(core),
      };
    }),
  };
}

function performanceRequest(brandId: string): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId,
    purpose: "informational",
    seed: { kind: "topic_text", title: PERFORMANCE_EXPERIMENT_DEFINITION.title },
    contentInstruction: PERFORMANCE_EXPERIMENT_DEFINITION.hypothesis,
    productId: null,
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
    },
  };
}

function composePerformanceInput(
  baseInput: ProposalBaseInputSnapshotV2,
  researchEvidence: ResearchEvidenceSnapshotV1 | null,
): ProposalInputSnapshotV2 | null {
  if (!researchEvidence) return null;
  const { contractVersion: _contractVersion, ...fields } = baseInput;
  return parseProposalInputSnapshotV2({
    ...fields,
    contractVersion: "proposal-input.v2",
    researchEvidence,
  });
}

export function createPerformanceProposalAdapter(dependencies: PerformanceProposalAdapterDependencies) {
  return {
    async resolve(command: PerformanceCommand, tx: ProposalV2Transaction): Promise<ResolvedProposalV2Creation> {
      const snapshots = await dependencies.loadSnapshots(command, tx);
      if (snapshots.some((snapshot) => snapshot.brandId !== command.brandId
        || snapshot.workspaceId !== command.workspaceId)) {
        throw new Error("performance_snapshot_tenant_mismatch");
      }
      if (new Set(snapshots.map((snapshot) => snapshot.id)).size !== snapshots.length) {
        throw new Error("performance_snapshot_duplicate");
      }
      if (snapshots.some((snapshot) => !UUID.test(snapshot.id)
        || !UUID.test(snapshot.publishQueueId)
        || typeof snapshot.title !== "string" || !snapshot.title.trim()
        || !snapshot.contentHash || !/^[0-9a-f]{64}$/.test(snapshot.contentHash)
        || Number.isNaN(Date.parse(snapshot.collectedAt))
        || !snapshot.updatedAt || Number.isNaN(Date.parse(snapshot.updatedAt)))) {
        throw new Error("performance_snapshot_incomplete");
      }
      const insights = buildPerformanceInsights({ brandId: command.brandId, period: "30d", snapshots });
      const experiment = insights.experiments.find((item) => item.id === command.experimentId);
      if (!experiment) throw new Error("performance_experiment_not_available");
      if (experiment.evidenceVersion !== command.evidenceVersion) {
        throw new Error("performance_evidence_stale");
      }

      const request = performanceRequest(command.brandId);
      const baseInput = await dependencies.resolveBaseInput(request, command, tx);
      const researchEvidence = selectPerformanceResearchEvidence(snapshots);
      const composedInput = composePerformanceInput(baseInput, researchEvidence);
      const projection = performanceEvidenceProjection(snapshots);
      const captured = projection.map((snapshot) => snapshot.collectedAt).sort();
      const capturedFrom = captured[0]!;
      const capturedTo = captured.at(-1)!;
      const resolvedInputFingerprint = proposalSha256({
        request,
        snapshotIdentities: projection.map((snapshot) => ({
          id: snapshot.id,
          contentHash: snapshot.contentHash,
        })),
        baseInput,
        researchEvidence,
      });
      return {
        request,
        baseInput,
        sourceSnapshots: [],
        performanceAudit: {
          experimentId: experiment.id,
          evidenceVersion: experiment.evidenceVersion,
          experimentDefinition: { ...PERFORMANCE_EXPERIMENT_DEFINITION },
          resolvedInputFingerprint,
          snapshotAudit: {
            policyVersion: "performance-evidence.v2",
            snapshots: projection,
          },
          capturedFrom,
          capturedTo,
          researchEvidence,
          composedInput,
        },
      };
    },
  };
}
