import { createHash } from "node:crypto";
import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedProductSnapshotV2,
  AiContentType,
  ContentChannelTarget,
  ContentOrchestrationV1,
  ContentOrchestrationV2,
  ContentPurposeV2,
  ContentSeedV2,
  FrozenReferenceSnapshotV2,
  OutputFormat,
} from "./aiContentContracts.js";
import {
  isChannelGenerationReady,
  type ChannelCapability,
} from "./channelCapabilities.js";
import type {
  ChannelExportMode,
  ChannelGenerationFormat,
} from "./channelCatalog.js";
import { parseContentOrchestrationV2 } from "./aiContentGenerationInputV3.js";
import type {
  AiContentProposalBatchRecord,
  AiContentRepository,
  AuthenticatedBrandScope,
  BrandScope,
} from "./aiContentRepository.js";
import type {
  ResolvedAiContentSubjectV2,
} from "./aiContentSeedResolver.js";
import type { AiContentSnapshotRepository } from "./aiContentSnapshotRepository.js";
import type { DeliveryFormat } from "./types.js";

const informationalStrategies = new Set([
  "problem_solution",
  "how_to",
  "comparison",
  "faq",
  "insight",
]);
const marketingStrategies = new Set([
  "benefit",
  "social_proof",
  "brand_story",
  "cta",
]);
const informationalFormats = new Set(["card_news", "blog"]);
const marketingFormats = new Set(["single_image", "channel_text"]);
const channelTargets = new Set([
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
]);
const referenceRoles = new Set([
  "planning",
  "copy_pattern",
  "visual_composition",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProposalBaseInputSnapshotV2 {
  contractVersion: "proposal-base-input.v2";
  brandCore: ApprovedBrandCoreSnapshotV2;
  subject: ResolvedAiContentSubjectV2;
  contentInstruction: string | null;
  product: ApprovedProductSnapshotV2 | null;
  references: FrozenReferenceSnapshotV2[];
  outputSettings: ContentOrchestrationV2["outputSettings"] & { purpose: ContentPurposeV2 };
  capturedAt: string;
}

export interface OrchestrateContentProposalBatchV2Input {
  routeBrandId: string;
  scope: AuthenticatedBrandScope;
  body: unknown;
  idempotencyKey: string;
}

export interface ContentProposalOrchestrationV2Dependencies {
  getAiContentProposalBatchV2Replay(
    input: Parameters<AiContentRepository["getAiContentProposalBatchV2Replay"]>[0],
  ): Promise<AiContentProposalBatchRecord | null>;
  loadChannelCapability(
    scope: BrandScope,
    channel: ChannelCapability["channel"],
  ): Promise<ChannelCapability | null>;
  resolveAiContentSeed(seed: ContentSeedV2): Promise<ResolvedAiContentSubjectV2>;
  snapshotRepository: AiContentSnapshotRepository;
  createAiContentProposalBatchV2(
    input: Parameters<AiContentRepository["createAiContentProposalBatchV2"]>[0],
  ): Promise<AiContentProposalBatchRecord>;
  now(): Date;
}

function invalid(): never {
  throw new Error("content_orchestration_invalid");
}

function invalidV2(): never {
  throw new Error("content_orchestration_v2_invalid");
}

function normalizedBrandId(value: unknown): string {
  if (typeof value !== "string") invalidV2();
  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized)) invalidV2();
  return normalized;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function clone<T>(value: T): T {
  try {
    const json = JSON.stringify(value, (_key, nested) => {
      if (
        nested === undefined
        || typeof nested === "bigint"
        || typeof nested === "function"
        || typeof nested === "symbol"
        || typeof nested === "number" && !Number.isFinite(nested)
      ) invalid();
      return nested;
    });
    if (json === undefined) invalid();
    return JSON.parse(json) as T;
  } catch {
    invalid();
  }
}

type CatalogGenerationStartCapability = {
  channel: ChannelCapability["channel"];
  generationFormats: readonly ChannelGenerationFormat[];
  exportModes: readonly ChannelExportMode[];
  publishModes: readonly DeliveryFormat[];
};

interface BlogExportGenerationStartCapability {
  channel: "blog_export";
  generationFormats: readonly OutputFormat[];
  exportModes: readonly ChannelExportMode[];
  publishModes: readonly never[];
}

export type ContentGenerationStartCapability =
  | CatalogGenerationStartCapability
  | BlogExportGenerationStartCapability;

const publishModesByChannelAndFormat: Partial<Record<
  ChannelCapability["channel"],
  Partial<Record<OutputFormat, readonly DeliveryFormat[]>>
>> = {
  instagram: {
    card_news: ["instagram_feed_carousel", "instagram_story"],
    single_image: ["instagram_feed_single", "instagram_story"],
  },
  threads: { channel_text: ["threads_text"] },
  x: { channel_text: ["x_post"] },
  linkedin: { channel_text: ["linkedin_post"] },
};

export function parseContentOrchestrationV1(value: unknown): ContentOrchestrationV1 {
  const source = record(value);
  if (source.contractVersion !== "content-orchestration.v1") invalid();
  const familyMatches = source.contentFamily === "informational"
    ? informationalStrategies.has(String(source.strategy))
      && informationalFormats.has(String(source.outputFormat))
    : source.contentFamily === "marketing"
      && marketingStrategies.has(String(source.strategy))
      && marketingFormats.has(String(source.outputFormat));
  if (!familyMatches) throw new Error("content_orchestration_combination_invalid");
  const subject = record(source.subject);
  if (
    subject.mode === "brand_topic"
      ? !nonempty(subject.topic)
        || Object.prototype.hasOwnProperty.call(subject, "wikiItemIds")
      : subject.mode === "product_service"
        ? !nonempty(subject.productServiceId)
        : subject.mode === "new_subject"
          ? !nonempty(subject.subjectAnalysisId)
          : true
  ) invalid();
  const target = record(source.target);
  if (
    target.id !== null && !nonempty(target.id)
    || !target.snapshot || typeof target.snapshot !== "object"
    || Array.isArray(target.snapshot)
  ) invalid();
  if (!source.brief || typeof source.brief !== "object" || Array.isArray(source.brief)) {
    invalid();
  }
  if (
    !Array.isArray(source.channelTargets)
    || source.channelTargets.length === 0
    || source.channelTargets.some((item) => !channelTargets.has(String(item)))
  ) invalid();
  if (!Array.isArray(source.references)) invalid();
  if (source.references.length > 5) {
    throw new Error("content_orchestration_reference_limit_exceeded");
  }
  const normalizedReferenceIds = new Set<string>();
  for (const value of source.references) {
    const reference = record(value);
    if (
      !nonempty(reference.referenceItemId)
      || !Array.isArray(reference.roles)
      || reference.roles.length === 0
      || reference.roles.some((role) => !referenceRoles.has(String(role)))
    ) invalid();
    if (new Set(reference.roles).size !== reference.roles.length) {
      throw new Error("content_orchestration_reference_roles_invalid");
    }
    const referenceItemId = (reference.referenceItemId as string).trim();
    if (normalizedReferenceIds.has(referenceItemId)) {
      throw new Error("content_orchestration_reference_ids_invalid");
    }
    normalizedReferenceIds.add(referenceItemId);
  }
  if (Array.isArray(source.avatar)) {
    throw new Error("content_orchestration_avatar_invalid");
  }
  if (source.avatar !== null) {
    const avatar = record(source.avatar);
    if (
      avatar.mode !== "library" && avatar.mode !== "one_time"
      || !nonempty(avatar.id)
      || !avatar.snapshot || typeof avatar.snapshot !== "object"
      || Array.isArray(avatar.snapshot)
    ) invalid();
  }
  const canonicalSubject = subject.mode === "brand_topic"
    ? {
      mode: "brand_topic" as const,
      topic: subject.topic as string,
    }
    : subject.mode === "product_service"
      ? {
        mode: "product_service" as const,
        productServiceId: subject.productServiceId as string,
      }
      : {
        mode: "new_subject" as const,
        subjectAnalysisId: subject.subjectAnalysisId as string,
      };
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: source.contentFamily,
    subject: canonicalSubject,
    target: {
      id: target.id as string | null,
      snapshot: clone(target.snapshot as Record<string, unknown>),
    },
    strategy: source.strategy,
    outputFormat: source.outputFormat,
    channelTargets: clone(source.channelTargets),
    brief: clone(source.brief),
    references: source.references.map((value) => {
      const reference = value as Record<string, unknown>;
      return {
        referenceItemId: (reference.referenceItemId as string).trim(),
        roles: clone(reference.roles),
      };
    }),
    avatar: source.avatar === null
      ? null
      : {
        mode: (source.avatar as Record<string, unknown>).mode,
        id: (source.avatar as Record<string, unknown>).id,
        snapshot: clone((source.avatar as Record<string, unknown>).snapshot),
      },
  } as ContentOrchestrationV1;
}

export function mapOrchestrationToWorkerType(
  input: Pick<ContentOrchestrationV1, "contentFamily" | "outputFormat">,
): AiContentType {
  if (input.outputFormat === "card_news") return "card_news";
  if (input.outputFormat === "blog") return "blog";
  return "marketing";
}

export function assertContentGenerationStartAllowed(
  input: Pick<ContentOrchestrationV1, "outputFormat" | "channelTargets">,
  capabilities: readonly ContentGenerationStartCapability[],
): void {
  const requiredExportMode = input.outputFormat === "blog"
    ? "html"
    : input.outputFormat === "channel_text"
      ? "text"
      : "image";
  for (const channel of input.channelTargets) {
    if (channel === "youtube" || channel === "tiktok") {
      throw new Error("content_orchestration_channel_unsupported");
    }
    if (channel === "blog_export" && input.outputFormat !== "blog") {
      throw new Error("content_orchestration_channel_capability_mismatch");
    }
    const capability = capabilities.find((item) => item.channel === channel);
    const allowedPublishModes = channel === "blog_export"
      ? []
      : publishModesByChannelAndFormat[channel]?.[input.outputFormat] ?? [];
    if (
      !capability
      || (
        !capability.generationFormats.includes(input.outputFormat)
        && !capability.exportModes.includes(requiredExportMode)
        && !capability.publishModes.some((mode) => allowedPublishModes.includes(mode))
      )
    ) {
      throw new Error("content_orchestration_channel_capability_mismatch");
    }
  }
}

export async function orchestrateContentProposalBatchV2(
  input: OrchestrateContentProposalBatchV2Input,
  dependencies: ContentProposalOrchestrationV2Dependencies,
): Promise<AiContentProposalBatchRecord> {
  const request = parseContentOrchestrationV2(input.body);
  const routeBrandId = normalizedBrandId(input.routeBrandId);
  const scopeBrandId = normalizedBrandId(input.scope.brandId);
  if (request.brandId !== routeBrandId || request.brandId !== scopeBrandId) invalidV2();

  const scope = { workspaceId: input.scope.workspaceId, brandId: scopeBrandId };
  const requestFingerprint = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  const replay = await dependencies.getAiContentProposalBatchV2Replay({
    ...scope,
    actorUserId: input.scope.actorUserId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
  });
  if (replay) return replay;

  const channelTarget = request.outputSettings.channelTargets[0];
  if (channelTarget !== "blog_export") {
    const capability = await dependencies.loadChannelCapability(scope, channelTarget);
    if (
      !capability
      || capability.channel !== channelTarget
      || !isChannelGenerationReady(capability, request.outputSettings.outputFormat)
    ) {
      throw new Error("content_orchestration_channel_capability_mismatch");
    }
  }

  const subject = await dependencies.resolveAiContentSeed(request.seed);
  const brandCore = await dependencies.snapshotRepository.loadApprovedCore(scope);
  const product = request.purpose === "marketing"
    ? await dependencies.snapshotRepository.loadApprovedProduct(scope, request.productId!)
    : null;
  let references: FrozenReferenceSnapshotV2[] = [];
  if (request.seed.kind === "reference") {
    const referenceSeed = request.seed;
    if (subject.kind !== "reference" || subject.referenceIds.length !== referenceSeed.items.length) {
      throw new Error("ai_content_seed_resolution_failed");
    }
    references = await dependencies.snapshotRepository.freezeReferences(
      scope,
      subject.referenceIds.map((referenceId, index) => ({
        referenceId,
        roles: [...referenceSeed.items[index]!.roles],
      })),
    );
  }

  const inputSnapshot: ProposalBaseInputSnapshotV2 = {
    contractVersion: "proposal-base-input.v2",
    brandCore,
    subject,
    contentInstruction: request.contentInstruction,
    product,
    references,
    outputSettings: {
      ...request.outputSettings,
      channelTargets: [channelTarget],
      purpose: request.purpose,
    },
    capturedAt: dependencies.now().toISOString(),
  };

  return dependencies.createAiContentProposalBatchV2({
    workspaceId: input.scope.workspaceId,
    brandId: scopeBrandId,
    actorUserId: input.scope.actorUserId,
    origin: "manual",
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    purpose: request.purpose,
    outputFormat: request.outputSettings.outputFormat,
    channelTarget,
    inputSnapshot,
  });
}
