import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import {
  parseContentOrchestrationV2,
  parseProposalBaseInputSnapshotV2,
  type ContentOrchestrationV2,
  type ContentProposalRequestV2,
  type ProposalBaseInputSnapshotV2,
} from "@brand-pilot/content-contracts";
import { parseContentOrchestrationV2 as parseApiContentOrchestrationV2 } from "./aiContentGenerationInputV3.js";
import type { ProposalInputSnapshotV2, ResearchEvidenceSnapshotV1 } from "./aiContentContracts.js";
import {
  parseResearchSourceAcquisitionV1,
  type ResearchSourceAcquisitionV1,
} from "@brand-pilot/content-contracts/research-source-acquisition";

export type CreateProposalBatchV2Command = {
  workspaceId: string;
  brandId: string;
} & (
  | {
      source: "manual";
      actorUserId: string;
      request: ContentOrchestrationV2;
      idempotencyKey: string;
    }
  | {
      source: "performance_experiment";
      actorUserId: string;
      experimentId: string;
      evidenceVersion: string;
    }
  | {
      source: "scheduled_crawl";
      callerOperationKey: string;
      contentTopicId: string;
      sourceSnapshotIds: string[];
      legacySourceOutputId: string | null;
      request: ContentOrchestrationV2;
    }
);

export type ProposalV2Transaction = Pick<PoolClient, "query">;

export interface ProposalV2ReplayIdentity {
  workspaceId: string;
  brandId: string;
  actorUserId: string | null;
  idempotencyKey: string;
  replayFingerprint: string;
}

export interface ProposalV2CreationResult {
  disposition: "created" | "replayed";
  proposalRunId: string | null;
  proposalBatchId: string;
  status: "proposal_pending";
}

export interface ResolvedProposalV2Creation {
  request: ContentOrchestrationV2;
  baseInput: ProposalBaseInputSnapshotV2;
  sourceSnapshots: Record<string, unknown>[];
  researchSourceAcquisition?: ResearchSourceAcquisitionV1;
  proposalRunId?: string | null;
  performanceAudit?: {
    experimentId: string;
    evidenceVersion: string;
    experimentDefinition: Record<string, unknown>;
    resolvedInputFingerprint: string;
    snapshotAudit: Record<string, unknown>;
    capturedFrom: string;
    capturedTo: string;
    researchEvidence: ResearchEvidenceSnapshotV1 | null;
    composedInput: ProposalInputSnapshotV2 | null;
  } | null;
}

export interface EnqueueProposalV2Input extends ProposalV2ReplayIdentity {
  source: CreateProposalBatchV2Command["source"];
  request: ContentOrchestrationV2;
  workerRequest: ContentProposalRequestV2;
  baseInput: ProposalBaseInputSnapshotV2;
  sourceSnapshots: Record<string, unknown>[];
  researchSourceAcquisition?: ResearchSourceAcquisitionV1;
  proposalRunId: string | null;
  performanceAudit: ResolvedProposalV2Creation["performanceAudit"];
}

export interface ProposalV2CreationPorts {
  findCommittedReplay(identity: ProposalV2ReplayIdentity): Promise<ProposalV2CreationResult | null>;
  assertReady(): Promise<void>;
  withTransaction<T>(work: (tx: ProposalV2Transaction) => Promise<T>): Promise<T>;
  lockIdempotencyKey(tx: ProposalV2Transaction, identity: ProposalV2ReplayIdentity): Promise<void>;
  findReplay(
    tx: ProposalV2Transaction,
    identity: ProposalV2ReplayIdentity,
  ): Promise<ProposalV2CreationResult | null>;
  resolve(
    command: CreateProposalBatchV2Command,
    tx: ProposalV2Transaction,
  ): Promise<ResolvedProposalV2Creation>;
  enqueue(
    tx: ProposalV2Transaction,
    input: EnqueueProposalV2Input,
  ): Promise<ProposalV2CreationResult>;
}

export interface AiContentProposalV2Service {
  create(
    command: CreateProposalBatchV2Command,
    options?: { tx?: ProposalV2Transaction },
  ): Promise<ProposalV2CreationResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function canonicalProposalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

export function proposalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalProposalJson(value)).digest("hex");
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value.trim();
}

function normalizedUuid(value: unknown, code: string): string {
  const normalized = requiredText(value, code).toLowerCase();
  if (!UUID.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizedCommand(command: CreateProposalBatchV2Command): CreateProposalBatchV2Command {
  const workspaceId = normalizedUuid(command.workspaceId, "proposal_v2_scope_invalid");
  const brandId = normalizedUuid(command.brandId, "proposal_v2_scope_invalid");
  if (command.source === "manual") {
    const parsed = parseContentOrchestrationV2(parseApiContentOrchestrationV2(command.request));
    if (parsed.brandId !== brandId) throw new Error("content_orchestration_v2_invalid");
    return {
      ...command,
      workspaceId,
      brandId,
      actorUserId: normalizedUuid(command.actorUserId, "ai_content_actor_required"),
      idempotencyKey: requiredText(command.idempotencyKey, "idempotency_key_required"),
      request: parsed,
    };
  }
  if (command.source === "performance_experiment") {
    return {
      ...command,
      workspaceId,
      brandId,
      actorUserId: normalizedUuid(command.actorUserId, "ai_content_actor_required"),
      experimentId: normalizedUuid(command.experimentId, "performance_experiment_invalid"),
      evidenceVersion: (() => {
        const value = requiredText(command.evidenceVersion, "performance_evidence_version_required").toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("performance_evidence_version_invalid");
        return value;
      })(),
    };
  }
  const parsed = parseContentOrchestrationV2(parseApiContentOrchestrationV2(command.request));
  if (parsed.brandId !== brandId) throw new Error("content_orchestration_v2_invalid");
  return {
    ...command,
    workspaceId,
    brandId,
    callerOperationKey: requiredText(command.callerOperationKey, "scheduled_operation_key_required"),
    contentTopicId: normalizedUuid(command.contentTopicId, "scheduled_content_topic_invalid"),
    sourceSnapshotIds: [...command.sourceSnapshotIds]
      .map((id) => normalizedUuid(id, "scheduled_source_snapshot_invalid"))
      .sort(),
    legacySourceOutputId: command.legacySourceOutputId === null
      ? null
      : normalizedUuid(command.legacySourceOutputId, "scheduled_source_output_invalid"),
    request: parsed,
  };
}

function replayIdentity(command: CreateProposalBatchV2Command): ProposalV2ReplayIdentity {
  const actorUserId = command.source === "scheduled_crawl" ? null : command.actorUserId;
  const idempotencyKey = command.source === "manual"
    ? command.idempotencyKey
    : command.source === "performance_experiment"
      ? `performance:${command.actorUserId}:${command.experimentId}:${command.evidenceVersion}`
      : command.callerOperationKey;
  const replayMaterial = command.source === "manual"
    ? { source: command.source, workspaceId: command.workspaceId, brandId: command.brandId, actorUserId, request: command.request }
    : command.source === "performance_experiment"
      ? {
          source: command.source,
          workspaceId: command.workspaceId,
          brandId: command.brandId,
          actorUserId,
          experimentId: command.experimentId,
          evidenceVersion: command.evidenceVersion,
        }
      : {
          source: command.source,
          workspaceId: command.workspaceId,
          brandId: command.brandId,
          actorUserId,
          callerOperationKey: command.callerOperationKey,
          contentTopicId: command.contentTopicId,
          sourceSnapshotIds: command.sourceSnapshotIds,
          legacySourceOutputId: command.legacySourceOutputId,
          request: command.request,
        };
  return {
    workspaceId: command.workspaceId,
    brandId: command.brandId,
    actorUserId,
    idempotencyKey,
    replayFingerprint: proposalSha256(replayMaterial),
  };
}

function assertResolvedCommand(
  command: CreateProposalBatchV2Command,
  resolved: ResolvedProposalV2Creation,
): ResolvedProposalV2Creation {
  const request = parseContentOrchestrationV2(resolved.request);
  const baseInput = parseProposalBaseInputSnapshotV2(resolved.baseInput);
  if (request.brandId !== command.brandId) throw new Error("proposal_v2_resolved_scope_mismatch");
  if (command.source !== "performance_experiment"
    && canonicalProposalJson(request) !== canonicalProposalJson(command.request)) {
    throw new Error("proposal_v2_resolved_request_mismatch");
  }
  if (!Array.isArray(resolved.sourceSnapshots)) throw new Error("proposal_v2_source_snapshots_invalid");
  const requiresAcquisition = command.source === "manual"
    && (request.outputSettings.outputFormat === "card_news" || request.outputSettings.outputFormat === "reel");
  if (requiresAcquisition && resolved.researchSourceAcquisition === undefined) {
    throw new Error("proposal_v2_research_source_acquisition_required");
  }
  if (!requiresAcquisition && resolved.researchSourceAcquisition !== undefined) {
    throw new Error("proposal_v2_research_source_acquisition_forbidden");
  }
  const researchSourceAcquisition = resolved.researchSourceAcquisition === undefined
    ? undefined
    : parseResearchSourceAcquisitionV1(resolved.researchSourceAcquisition);
  return { ...resolved, request, baseInput, researchSourceAcquisition };
}

export function createAiContentProposalV2Service(
  ports: ProposalV2CreationPorts,
): AiContentProposalV2Service {
  return {
    async create(rawCommand, options = {}) {
      const command = normalizedCommand(rawCommand);
      if (options.tx && command.source !== "scheduled_crawl") {
        throw new Error("proposal_v2_caller_transaction_invalid");
      }
      if (!options.tx && command.source === "scheduled_crawl") {
        throw new Error("proposal_v2_caller_transaction_required");
      }
      const identity = replayIdentity(command);
      const committedReplay = await ports.findCommittedReplay(identity);
      if (committedReplay) return { ...committedReplay, disposition: "replayed" };

      await ports.assertReady();
      const createInside = async (tx: ProposalV2Transaction) => {
        await ports.lockIdempotencyKey(tx, identity);
        const lockedReplay = await ports.findReplay(tx, identity);
        if (lockedReplay) return { ...lockedReplay, disposition: "replayed" as const };
        const resolved = assertResolvedCommand(command, await ports.resolve(command, tx));
        const workerRequest: ContentProposalRequestV2 = {
          contractVersion: "content-proposal-request.v2",
          purpose: resolved.request.purpose,
          outputFormat: resolved.request.outputSettings.outputFormat,
          channelTargets: [...resolved.request.outputSettings.channelTargets],
          requestFingerprint: proposalSha256(resolved.request),
        };
        return ports.enqueue(tx, {
          ...identity,
          source: command.source,
          request: resolved.request,
          workerRequest,
          baseInput: resolved.baseInput,
          sourceSnapshots: resolved.sourceSnapshots.map((item) => structuredClone(item)),
          ...(resolved.researchSourceAcquisition === undefined
            ? {}
            : { researchSourceAcquisition: structuredClone(resolved.researchSourceAcquisition) }),
          proposalRunId: resolved.proposalRunId ?? null,
          performanceAudit: resolved.performanceAudit ?? null,
        });
      };
      return options.tx ? createInside(options.tx) : ports.withTransaction(createInside);
    },
  };
}
