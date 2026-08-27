import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedBrandRulesSnapshotV1,
  ContentOrchestrationV2,
  ProposalBaseInputSnapshotV2,
} from "@brand-pilot/content-contracts";
import { parseBrandRulesContentV2, parseProposalBaseInputSnapshotV2 } from "@brand-pilot/content-contracts";
import {
  parseContentSuggestionCategoryCode,
  parseStoredContentSuggestionSources,
  type ContentSuggestionItemDto,
} from "./contentSuggestionContracts.js";
import { proposalSha256 } from "./proposalHash.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unavailableAnalysisStatuses = new Set([
  "cancel_requested",
  "purging",
  "cancelled",
  "failed",
  "purged",
]);

export function isOnboardingContentStartUnavailableStatus(value: unknown): boolean {
  return unavailableAnalysisStatuses.has(String(value));
}

export interface OnboardingContentStart {
  categoryCode: string;
  subcategoryCodes: string[];
  suggestionId: string;
  contentInstruction: string | null;
  idempotencyKey: string;
}

export interface OnboardingProvisionalAuthority {
  kind: "onboarding_provisional";
  analysisId: string;
  ownedUrl: string | null;
  categoryCode: string;
  subcategoryCodes: string[];
  suggestionId: string;
  sourceUrls: string[];
}

export type OnboardingProposalAuthority = OnboardingProvisionalAuthority & {
  brandRules: ApprovedBrandRulesSnapshotV1;
};

export function parseOnboardingProposalAuthority(value: unknown): OnboardingProposalAuthority {
  try {
    const source = record(value);
    const keys = [
      "kind", "analysisId", "ownedUrl", "categoryCode", "subcategoryCodes",
      "suggestionId", "sourceUrls", "brandRules",
    ];
    if (Object.keys(source).length !== keys.length
      || Object.keys(source).some((key) => !keys.includes(key))
      || source.kind !== "onboarding_provisional") throw new Error();
    const subcategoryCodes = Array.isArray(source.subcategoryCodes)
      ? source.subcategoryCodes.map(parseContentSuggestionCategoryCode)
      : [];
    if (subcategoryCodes.length < 1 || subcategoryCodes.length > 5
      || new Set(subcategoryCodes).size !== subcategoryCodes.length) throw new Error();
    if (!Array.isArray(source.sourceUrls)
      || source.sourceUrls.length < 1
      || source.sourceUrls.length > 3) throw new Error();
    const sourceUrls = source.sourceUrls.map((candidate) => {
      const normalized = boundedText(candidate, "invalid", 2_000);
      const parsed = new URL(normalized);
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      return normalized;
    });
    const rules = record(source.brandRules);
    const ruleKeys = ["versionId", "version", "content", "contentSha256"];
    if (Object.keys(rules).length !== ruleKeys.length
      || Object.keys(rules).some((key) => !ruleKeys.includes(key))
      || rules.version !== 1) throw new Error();
    const content = parseBrandRulesContentV2(rules.content);
    if (typeof rules.contentSha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(rules.contentSha256)
      || rules.contentSha256 !== proposalSha256(content)) throw new Error();
    const ownedUrl = source.ownedUrl === null
      ? null
      : (() => {
          const normalized = boundedText(source.ownedUrl, "invalid", 2_000);
          const parsed = new URL(normalized);
          if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error();
          return normalized;
        })();
    return {
      kind: "onboarding_provisional",
      analysisId: uuid(source.analysisId),
      ownedUrl,
      categoryCode: parseContentSuggestionCategoryCode(source.categoryCode),
      subcategoryCodes,
      suggestionId: uuid(source.suggestionId),
      sourceUrls,
      brandRules: {
        versionId: uuid(rules.versionId),
        version: 1,
        content,
        contentSha256: rules.contentSha256,
      },
    };
  } catch {
    throw new Error("onboarding_content_authority_invalid");
  }
}

export interface OnboardingContentSnapshot {
  categoryCode: string;
  subcategoryCodes: string[];
  suggestion: ContentSuggestionItemDto;
  contentInstruction: string | null;
  requestFingerprint: string;
  proposalBatchId: string | null;
  generationId: string | null;
  requestedAt: string;
  proposalBaseInput: ProposalBaseInputSnapshotV2 | null;
  proposalAuthority: OnboardingProposalAuthority | null;
}

export function parseOnboardingContentSnapshot(value: unknown): OnboardingContentSnapshot {
  try {
    const source = record(value);
    const requiredKeys = [
      "categoryCode", "subcategoryCodes", "suggestion", "contentInstruction",
      "requestFingerprint", "proposalBatchId", "generationId", "requestedAt",
    ];
    const optionalKeys = ["proposalBaseInput", "proposalAuthority"];
    if (requiredKeys.some((key) => !(key in source))
      || Object.keys(source).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))) throw new Error();
    const suggestion = record(source.suggestion);
    const suggestionKeys = [
      "id", "subcategoryCode", "subcategoryName", "intent", "title", "whyNow",
      "contentBrief", "sources",
    ];
    if (Object.keys(suggestion).length !== suggestionKeys.length
      || Object.keys(suggestion).some((key) => !suggestionKeys.includes(key))) throw new Error();
    if (!Array.isArray(source.subcategoryCodes)
      || source.subcategoryCodes.length < 1
      || source.subcategoryCodes.length > 5) throw new Error();
    const subcategoryCodes = source.subcategoryCodes.map(parseContentSuggestionCategoryCode);
    if (new Set(subcategoryCodes).size !== subcategoryCodes.length) throw new Error();
    if (suggestion.intent !== "informational" && suggestion.intent !== "trend") throw new Error();
    const sources = parseStoredContentSuggestionSources(suggestion.sources);
    if (typeof source.requestFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(source.requestFingerprint)) throw new Error();
    if (typeof source.requestedAt !== "string"
      || Number.isNaN(new Date(source.requestedAt).getTime())) throw new Error();
    const requestedAt = new Date(source.requestedAt).toISOString();
    const proposalBaseInput = source.proposalBaseInput == null
      ? null
      : parseProposalBaseInputSnapshotV2(source.proposalBaseInput);
    const proposalAuthority = source.proposalAuthority == null
      ? null
      : parseOnboardingProposalAuthority(source.proposalAuthority);
    if ((proposalBaseInput === null) !== (proposalAuthority === null)) throw new Error();
    if (proposalBaseInput && proposalAuthority) {
      if (proposalBaseInput.brandCore.versionId !== proposalAuthority.analysisId
        || proposalBaseInput.subject.kind !== "topic_text"
        || proposalBaseInput.subject.title !== suggestion.title
        || proposalBaseInput.contentInstruction !== source.contentInstruction
        || proposalBaseInput.product !== null
        || proposalBaseInput.references.length !== 0
        || proposalBaseInput.outputSettings.outputFormat !== "card_news"
        || proposalBaseInput.outputSettings.purpose !== "informational"
        || proposalBaseInput.capturedAt !== requestedAt
        || proposalAuthority.categoryCode !== source.categoryCode
        || proposalAuthority.suggestionId !== suggestion.id
        || proposalAuthority.subcategoryCodes.length !== subcategoryCodes.length
        || proposalAuthority.subcategoryCodes.some((code, index) => code !== subcategoryCodes[index])
        || proposalAuthority.sourceUrls.length !== sources.length
        || proposalAuthority.sourceUrls.some((url, index) => url !== sources[index]?.url)) throw new Error();
    }
    return {
      categoryCode: parseContentSuggestionCategoryCode(source.categoryCode),
      subcategoryCodes,
      suggestion: {
        id: uuid(suggestion.id),
        subcategoryCode: parseContentSuggestionCategoryCode(suggestion.subcategoryCode),
        subcategoryName: boundedText(suggestion.subcategoryName, "invalid", 500),
        intent: suggestion.intent,
        title: boundedText(suggestion.title, "invalid", 120),
        whyNow: boundedText(suggestion.whyNow, "invalid", 300),
        contentBrief: boundedText(suggestion.contentBrief, "invalid", 500),
        sources,
      },
      contentInstruction: source.contentInstruction === null
        ? null
        : boundedText(source.contentInstruction, "invalid", 4_000),
      requestFingerprint: source.requestFingerprint,
      proposalBatchId: source.proposalBatchId === null ? null : uuid(source.proposalBatchId),
      generationId: source.generationId === null ? null : uuid(source.generationId),
      requestedAt,
      proposalBaseInput,
      proposalAuthority,
    };
  } catch {
    throw new Error("onboarding_content_snapshot_invalid");
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("onboarding_content_request_invalid");
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function uuid(value: unknown): string {
  const normalized = boundedText(value, "onboarding_content_uuid_invalid", 36);
  if (!UUID_PATTERN.test(normalized)) throw new Error("onboarding_content_uuid_invalid");
  return normalized;
}

export function parseOnboardingContentStart(value: unknown): OnboardingContentStart {
  const source = record(value);
  const keys = [
    "categoryCode",
    "subcategoryCodes",
    "suggestionId",
    "contentInstruction",
    "idempotencyKey",
  ];
  if (Object.keys(source).some((key) => !keys.includes(key))) {
    throw new Error("onboarding_content_unknown_field");
  }
  if (!Array.isArray(source.subcategoryCodes)
    || source.subcategoryCodes.length < 1
    || source.subcategoryCodes.length > 5) {
    throw new Error("onboarding_content_subcategories_invalid");
  }
  const subcategoryCodes = [...new Set(
    source.subcategoryCodes.map(parseContentSuggestionCategoryCode),
  )];
  if (subcategoryCodes.length !== source.subcategoryCodes.length) {
    throw new Error("onboarding_content_subcategories_invalid");
  }
  return {
    categoryCode: parseContentSuggestionCategoryCode(source.categoryCode),
    subcategoryCodes,
    suggestionId: uuid(source.suggestionId),
    contentInstruction: source.contentInstruction === null
      ? null
      : boundedText(source.contentInstruction, "onboarding_content_instruction_invalid", 4_000),
    idempotencyKey: boundedText(source.idempotencyKey, "onboarding_content_idempotency_key_invalid", 200),
  };
}

function clipped(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export function buildProvisionalBrandContext(input: {
  analysisId: string;
  brandName: string;
  ownedUrl: string | null;
  ownedExcerpt: string | null;
  category: { code: string; name: string };
  subcategories: Array<{ code: string; name: string }>;
  suggestion: ContentSuggestionItemDto;
}): {
  brandCore: ApprovedBrandCoreSnapshotV2;
  brandRules: ApprovedBrandRulesSnapshotV1;
  authority: OnboardingProvisionalAuthority;
} {
  const brandName = clipped(input.brandName, 500);
  const categoryName = clipped(input.category.name, 500);
  const detailedCategory = clipped(input.subcategories.map((item) => item.name).join(", "), 500);
  const evidence = input.ownedExcerpt
    ? clipped(input.ownedExcerpt, 4_000)
    : `${brandName}의 공식 정보는 브랜드 분석 중이며 선택한 분야를 기준으로 초안을 만듭니다.`;
  const brandCore: ApprovedBrandCoreSnapshotV2 = {
    versionId: input.analysisId,
    companyOverview: evidence,
    businessDescription: `${brandName}은(는) ${categoryName} 분야의 브랜드입니다.`,
    primaryCategory: categoryName,
    detailedCategory,
    primaryTarget: `${input.suggestion.subcategoryName} 주제에 관심 있는 고객`,
    differentiator: "확인된 자사 정보와 선택한 추천 주제만 사용한 보수적 초안",
    coreAppeal: clipped(input.suggestion.contentBrief, 4_000),
  };
  const content = {
    contractVersion: "brand-rules.v2" as const,
    requiredPhrases: [],
    forbiddenPhrases: [],
    exaggerationRules: ["확인되지 않은 수치, 최상급 표현, 효능을 단정하지 않습니다."],
    ctaRules: { defaultCta: "자세한 내용은 공식 채널에서 확인해 주세요.", allowed: [] },
    channelRules: {
      instagram: ["짧고 명확한 문장을 사용합니다.", "출처로 확인할 수 있는 사실을 우선합니다."],
    },
    autoApprovalRules: { enabled: false, conditions: [] },
  };
  const brandRules: ApprovedBrandRulesSnapshotV1 = {
    versionId: input.suggestion.id,
    version: 1,
    content,
    contentSha256: proposalSha256(content),
  };
  return {
    brandCore,
    brandRules,
    authority: {
      kind: "onboarding_provisional",
      analysisId: input.analysisId,
      ownedUrl: input.ownedUrl,
      categoryCode: input.category.code,
      subcategoryCodes: input.subcategories.map((item) => item.code),
      suggestionId: input.suggestion.id,
      sourceUrls: input.suggestion.sources.map((source) => source.url),
    },
  };
}

type OnboardingScope = {
  workspaceId: string;
  brandId: string;
  actorUserId: string;
  analysisId: string;
};

export type OnboardingContentPublicState = {
  state: "not_started" | "preparing" | "generating" | "completed" | "failed";
  proposalBatchId: string | null;
  generationId: string | null;
  title: string | null;
  progress: unknown;
  outputs: unknown[];
  errorCode: string | null;
  errorMessage: string | null;
};

export function createOnboardingContentService(dependencies: {
  brandIntelligence: {
    getBrandAnalysis(input: OnboardingScope): Promise<any>;
    getBrandCompanyName(input: Pick<OnboardingScope, "workspaceId" | "brandId">): Promise<{ name: string } | null>;
    getOnboardingContent(input: OnboardingScope): Promise<OnboardingContentSnapshot | null>;
    saveOnboardingContentSelection(input: OnboardingScope & { snapshot: OnboardingContentSnapshot }): Promise<OnboardingContentSnapshot>;
    linkOnboardingProposalBatch(input: OnboardingScope & {
      requestFingerprint: string;
      proposalBatchId: string;
    }): Promise<OnboardingContentSnapshot>;
    linkOnboardingGeneration(input: OnboardingScope & {
      requestFingerprint: string;
      generationId: string;
    }): Promise<OnboardingContentSnapshot>;
  };
  suggestions: {
    listForSelection(input: {
      brandId: string;
      categoryCode: string;
      subcategoryCodes: string[];
    }): Promise<{ category: { code: string; name: string } | null; personal: ContentSuggestionItemDto[]; general: ContentSuggestionItemDto[] }>;
  };
  categories: {
    list(): Promise<Array<{
      code: string;
      name: string;
      subcategories: Array<{ code: string; name: string }>;
    }>>;
  };
  proposals: {
    create(command: {
      source: "onboarding";
      workspaceId: string;
      brandId: string;
      actorUserId: string;
      request: ContentOrchestrationV2;
      baseInput: ProposalBaseInputSnapshotV2;
      authority: OnboardingProposalAuthority;
      idempotencyKey: string;
    }): Promise<{ proposalBatchId: string }>;
  };
  content: {
    getAiContentProposalBatch(input: { workspaceId: string; brandId: string; batchId: string }): Promise<any>;
    selectAiContentProposal(input: OnboardingScope & { proposalId: string; idempotencyKey: string }): Promise<any>;
    startAiContentGenerationV3(input: OnboardingScope & {
      generationId: string;
      contractVersion: "content-generation-start.v2";
      idempotencyKey: string;
      usageDate: string;
      dailyGenerationLimit: number;
    }, snapshots: any): Promise<any>;
    getAiContentGeneration(input: OnboardingScope & { generationId: string }): Promise<any>;
  };
  snapshots: any;
  now(): Date;
  usageDate(): string;
  dailyGenerationLimit: number;
}) {
  const publicGenerationState = (
    snapshot: OnboardingContentSnapshot,
    generation: any,
  ): OnboardingContentPublicState => {
    const failed = generation.status === "failed";
    const completed = generation.status === "completed" || generation.status === "partial_failed";
    return {
      state: failed ? "failed" : completed ? "completed" : "generating",
      proposalBatchId: snapshot.proposalBatchId,
      generationId: generation.id,
      title: typeof generation.title === "string" ? generation.title : snapshot.suggestion.title,
      progress: generation.progress ?? null,
      outputs: Array.isArray(generation.outputs) ? generation.outputs : [],
      errorCode: generation.errorCode ?? null,
      errorMessage: generation.errorMessage ?? null,
    };
  };

  const proposalRequest = (
    brandId: string,
    snapshot: Pick<OnboardingContentSnapshot, "suggestion" | "contentInstruction">,
  ): ContentOrchestrationV2 => ({
    contractVersion: "content-orchestration.v2",
    brandId,
    purpose: "informational",
    seed: { kind: "topic_text", title: snapshot.suggestion.title },
    contentInstruction: snapshot.contentInstruction,
    productId: null,
    outputSettings: {
      outputFormat: "card_news",
      channelTargets: ["instagram"],
      aspectRatio: "1:1",
      outputCount: 1,
    },
  });

  const ensureProposalBatch = async (
    scope: OnboardingScope,
    snapshot: OnboardingContentSnapshot,
  ): Promise<OnboardingContentSnapshot> => {
    if (snapshot.proposalBatchId) return snapshot;
    if (!snapshot.proposalBaseInput || !snapshot.proposalAuthority) {
      throw new Error("onboarding_content_recovery_context_missing");
    }
    const created = await dependencies.proposals.create({
      source: "onboarding",
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      actorUserId: scope.actorUserId,
      request: proposalRequest(scope.brandId, snapshot),
      baseInput: snapshot.proposalBaseInput,
      authority: snapshot.proposalAuthority,
      idempotencyKey: `onboarding:${scope.analysisId}:${snapshot.requestFingerprint}`,
    });
    return dependencies.brandIntelligence.linkOnboardingProposalBatch({
      ...scope,
      requestFingerprint: snapshot.requestFingerprint,
      proposalBatchId: created.proposalBatchId,
    });
  };

  const reconcile = async (scope: OnboardingScope): Promise<OnboardingContentPublicState> => {
    const snapshot = await dependencies.brandIntelligence.getOnboardingContent(scope);
    if (!snapshot) {
      return {
        state: "not_started", proposalBatchId: null, generationId: null, title: null,
        progress: null, outputs: [], errorCode: null, errorMessage: null,
      };
    }
    if (snapshot.generationId) {
      let generation = await dependencies.content.getAiContentGeneration({
        ...scope,
        generationId: snapshot.generationId,
      });
      if (!generation) throw new Error("onboarding_content_generation_not_found");
      if (generation.status === "draft") {
        generation = await dependencies.content.startAiContentGenerationV3({
          ...scope,
          generationId: snapshot.generationId,
          contractVersion: "content-generation-start.v2",
          idempotencyKey: `onboarding-generate:${scope.analysisId}`,
          usageDate: dependencies.usageDate(),
          dailyGenerationLimit: dependencies.dailyGenerationLimit,
        }, dependencies.snapshots);
      }
      return publicGenerationState(snapshot, generation);
    }
    if (!snapshot.proposalBatchId) {
      if (!snapshot.proposalBaseInput || !snapshot.proposalAuthority) {
        return {
          state: "failed", proposalBatchId: null, generationId: null,
          title: snapshot.suggestion.title, progress: null, outputs: [],
          errorCode: "onboarding_content_recovery_context_missing", errorMessage: null,
        };
      }
      const linked = await ensureProposalBatch(scope, snapshot);
      return {
        state: "preparing", proposalBatchId: linked.proposalBatchId, generationId: null,
        title: snapshot.suggestion.title, progress: null, outputs: [],
        errorCode: null, errorMessage: null,
      };
    }
    const batch = await dependencies.content.getAiContentProposalBatch({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      batchId: snapshot.proposalBatchId,
    });
    if (!batch) throw new Error("onboarding_content_proposal_batch_not_found");
    if (batch.status === "failed") {
      return {
        state: "failed", proposalBatchId: snapshot.proposalBatchId, generationId: null,
        title: snapshot.suggestion.title, progress: null, outputs: [],
        errorCode: batch.errorCode ?? "content_proposal_failed",
        errorMessage: batch.errorMessage ?? null,
      };
    }
    const firstProposal = Array.isArray(batch.proposals) ? batch.proposals[0] : null;
    if (batch.status !== "ready" || !firstProposal?.id) {
      return {
        state: "preparing", proposalBatchId: snapshot.proposalBatchId, generationId: null,
        title: snapshot.suggestion.title, progress: null, outputs: [],
        errorCode: null, errorMessage: null,
      };
    }
    const draft = await dependencies.content.selectAiContentProposal({
      ...scope,
      proposalId: firstProposal.id,
      idempotencyKey: `onboarding-select:${scope.analysisId}`,
    });
    const linked = await dependencies.brandIntelligence.linkOnboardingGeneration({
      ...scope,
      requestFingerprint: snapshot.requestFingerprint,
      generationId: draft.id,
    });
    const generation = await dependencies.content.startAiContentGenerationV3({
      ...scope,
      generationId: draft.id,
      contractVersion: "content-generation-start.v2",
      idempotencyKey: `onboarding-generate:${scope.analysisId}`,
      usageDate: dependencies.usageDate(),
      dailyGenerationLimit: dependencies.dailyGenerationLimit,
    }, dependencies.snapshots);
    return publicGenerationState(linked, generation);
  };

  return {
    async start(input: OnboardingScope & { body: unknown }): Promise<OnboardingContentPublicState> {
      const requestInput = parseOnboardingContentStart(input.body);
      const requestFingerprint = proposalSha256({
        categoryCode: requestInput.categoryCode,
        subcategoryCodes: requestInput.subcategoryCodes,
        suggestionId: requestInput.suggestionId,
        contentInstruction: requestInput.contentInstruction,
      });
      const existing = await dependencies.brandIntelligence.getOnboardingContent(input);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new Error("onboarding_content_request_conflict");
        }
        return reconcile(input);
      }
      const analysis = await dependencies.brandIntelligence.getBrandAnalysis(input);
      if (!analysis || isOnboardingContentStartUnavailableStatus(analysis.status)) {
        throw new Error("brand_analysis_not_available");
      }
      const listed = await dependencies.suggestions.listForSelection({
        brandId: input.brandId,
        categoryCode: requestInput.categoryCode,
        subcategoryCodes: requestInput.subcategoryCodes,
      });
      const suggestions = [...listed.personal, ...listed.general];
      const suggestion = suggestions.find((item) => item.id === requestInput.suggestionId);
      if (!listed.category || !suggestion
        || !requestInput.subcategoryCodes.includes(suggestion.subcategoryCode)) {
        throw new Error("onboarding_content_suggestion_mismatch");
      }
      const categories = await dependencies.categories.list();
      const selectedCategory = categories.find((item) => item.code === requestInput.categoryCode);
      if (!selectedCategory || selectedCategory.name !== listed.category.name) {
        throw new Error("onboarding_content_suggestion_mismatch");
      }
      const subcategories = requestInput.subcategoryCodes.map((code) => (
        selectedCategory.subcategories.find((item) => item.code === code) ?? null
      ));
      if (subcategories.some((item) => item === null)) {
        throw new Error("onboarding_content_suggestion_mismatch");
      }
      const company = await dependencies.brandIntelligence.getBrandCompanyName(input);
      const evidenceText = Array.isArray(analysis.evidence)
        ? analysis.evidence.flatMap((document: any) => (
            Array.isArray(document.textBlocks)
              ? document.textBlocks.map((block: any) => String(block.text ?? ""))
              : []
          )).join(" ").trim()
        : "";
      const prepared = buildProvisionalBrandContext({
        analysisId: input.analysisId,
        brandName: company?.name ?? analysis.input?.companyName ?? "브랜드",
        ownedUrl: analysis.input?.ownedUrl ?? null,
        ownedExcerpt: evidenceText || null,
        category: selectedCategory,
        subcategories: subcategories as Array<{ code: string; name: string }>,
        suggestion,
      });
      const requestedAt = dependencies.now().toISOString();
      const orchestration = proposalRequest(input.brandId, {
        suggestion,
        contentInstruction: requestInput.contentInstruction,
      });
      const proposalBaseInput: ProposalBaseInputSnapshotV2 = {
        contractVersion: "proposal-base-input.v2",
        brandCore: prepared.brandCore,
        subject: { kind: "topic_text", title: suggestion.title },
        contentInstruction: requestInput.contentInstruction,
        product: null,
        references: [],
        outputSettings: { ...orchestration.outputSettings, purpose: "informational" },
        capturedAt: requestedAt,
      };
      const proposalAuthority: OnboardingProposalAuthority = {
        ...prepared.authority,
        brandRules: prepared.brandRules,
      };
      const snapshot = await dependencies.brandIntelligence.saveOnboardingContentSelection({
        ...input,
        snapshot: {
          categoryCode: requestInput.categoryCode,
          subcategoryCodes: requestInput.subcategoryCodes,
          suggestion,
          contentInstruction: requestInput.contentInstruction,
          requestFingerprint,
          proposalBatchId: null,
          generationId: null,
          requestedAt,
          proposalBaseInput,
          proposalAuthority,
        },
      });
      if (snapshot.proposalBatchId) return reconcile(input);
      const linked = await ensureProposalBatch(input, snapshot);
      return {
        state: "preparing",
        proposalBatchId: linked.proposalBatchId,
        generationId: null,
        title: suggestion.title,
        progress: null,
        outputs: [],
        errorCode: null,
        errorMessage: null,
      };
    },
    reconcile,
  };
}
