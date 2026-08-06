import { put as putBlob } from "@vercel/blob/client";
import {
  parseAiContentManifestV3,
  parseContentPurpose,
  parseContentStudioOutputFormat,
  type AiContentManifestV3,
  type ContentPurpose,
  type ContentStudioOutputFormat,
} from "@brand-pilot/content-contracts";
import { ApiRequestError, apiClient, mapApiChannelConnection, type ApiChannel } from "../../lib/apiClient";
import type { PublishArtifact } from "../../types";
import type {
  AiContentDraft,
  AiContentGateway,
  AiContentGeneration,
  AiContentReference,
  AiContentType,
  AiContentWizardStep,
  AiGenerationOutput,
  GenerationAttachment,
  GenerationBrief,
  LegacySubjectAnalysisInput,
  SubjectAnalysis,
  SubjectAnalysisInput,
  SubjectAppeal,
  SubjectTarget,
  SubjectType,
  ContentProposalBatch,
  ContentProposalRecord,
  ContentProposalRecordV2,
  ContentProposalV2,
  AiContentDraftReference,
  ContentOrchestration,
} from "./types";

const DEFAULT_BRAND_COLOR = "#0057B8";

export interface ContentGenerationFieldError {
  phase: "setup" | "proposal_selection" | "generating";
  field: "contentFamily" | "subject" | "channelTargets" | "outputFormat" | "references" | "avatar" | "outputCount";
  errorCode: string;
}

export function contentGenerationFieldError(error: unknown): ContentGenerationFieldError | null {
  if (!(error instanceof ApiRequestError) || !error.errorCode) return null;
  const errorCode = error.errorCode;
  const path = error.fieldPath ?? (
    typeof error.details?.fieldPath === "string" ? error.details.fieldPath : null
  );
  const phase = error.details?.phase;
  const mappedPhase = phase === "setup" || phase === "proposal_selection" || phase === "generating"
    ? phase
    : null;
  if (path) {
    if (path.includes("reference")) {
      return { phase: mappedPhase ?? "proposal_selection", field: "references", errorCode };
    }
    if (path.includes("avatar")) {
      return { phase: mappedPhase ?? "proposal_selection", field: "avatar", errorCode };
    }
    if (path.includes("channel")) {
      return { phase: mappedPhase ?? "setup", field: "channelTargets", errorCode };
    }
    if (path.includes("outputCount") || path.includes("output_count")) {
      return { phase: mappedPhase ?? "generating", field: "outputCount", errorCode };
    }
    if (path.includes("outputFormat") || path.includes("output_format") || path.includes("type")) {
      return { phase: mappedPhase ?? "setup", field: "outputFormat", errorCode };
    }
    if (path.includes("subject")) {
      return { phase: mappedPhase ?? "setup", field: "subject", errorCode };
    }
    if (path.includes("contentFamily") || path.includes("content_family")) {
      return { phase: mappedPhase ?? "setup", field: "contentFamily", errorCode };
    }
  }
  if (errorCode.includes("reference")) {
    return { phase: "proposal_selection", field: "references", errorCode };
  }
  if (errorCode.includes("avatar")) {
    return { phase: "proposal_selection", field: "avatar", errorCode };
  }
  if (errorCode.includes("channel")) {
    return { phase: "setup", field: "channelTargets", errorCode };
  }
  if (errorCode.includes("output_count")) {
    return { phase: "generating", field: "outputCount", errorCode };
  }
  if (errorCode.includes("output_format") || errorCode.includes("type_mapping")) {
    return { phase: "setup", field: "outputFormat", errorCode };
  }
  if (errorCode.includes("subject") || errorCode.includes("seed")) {
    return { phase: "setup", field: "subject", errorCode };
  }
  if (errorCode.includes("family")) {
    return { phase: "setup", field: "contentFamily", errorCode };
  }
  return null;
}

interface ApiOutput {
  id: string; generationId: string; outputIndex: number; title: string | null; status: AiGenerationOutput["status"];
  content: Record<string, unknown>; manifest: Record<string, unknown>; manifestUrl: string | null;
  failureCode: string | null; failureMessage: string | null; downloadedAt: string | null;
  revisionCapabilities?: AiGenerationOutput["revisionCapabilities"];
  manifestVersion?: AiGenerationOutput["manifestVersion"];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function outputCopy(content: Record<string, unknown>) {
  return {
    hook: text(content.hook ?? content.headline ?? content.title),
    keyMessage: text(content.keyMessage ?? content.concept ?? content.summary),
    body: text(content.body),
    cta: text(content.cta),
    caption: text(content.caption),
    hashtags: Array.isArray(content.hashtags)
      ? content.hashtags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}
interface ApiGeneration {
  id: string; brandId: string; outputFormat: ContentStudioOutputFormat; purpose: ContentPurpose;
  title: string; status: AiContentGeneration["status"];
  currentStage: string | null; draft: Partial<AiContentDraft> | null; analysis: Record<string, unknown>; outputs?: ApiOutput[];
  attachmentsLockedAt?: string | null; terminalAt?: string | null; retryableUntil?: string | null;
  evidenceSnapshot?: AiContentGeneration["evidenceSnapshot"];
  createdAt: string; updatedAt: string;
}

interface ApiSubjectAnalysis {
  id: string; generationId?: string | null; contractVersion?: "subject-analysis.v1" | "subject-analysis.v2";
  workspaceId?: string; brandId?: string; subjectType?: SubjectType; sourceUrl?: string; normalizedUrl?: string;
  input?: { name?: string; promotion?: string; promotionOrTerms?: string; description?: string }; status: SubjectAnalysis["status"];
  facts?: SubjectAnalysis["facts"]; structuredData?: Record<string, unknown>; research?: Record<string, unknown>;
  targets?: SubjectTarget[]; appealsByTarget?: Record<string, SubjectAppeal[]>; selectedImageId?: string | null;
  images?: SubjectAnalysis["images"]; analysisVersion: number; errorCode?: string | null; errorMessage?: string | null;
  createdAt?: string; updatedAt?: string; completedAt?: string | null;
  sourceGaps?: string[];
}

function invalidProposalBatchResponse(): never {
  throw new Error("ai_content_proposal_batch_response_invalid");
}

function responseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidProposalBatchResponse();
  return value as Record<string, unknown>;
}

function exactResponseObject(value: unknown, keys: string[]): Record<string, unknown> {
  const source = responseObject(value);
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidProposalBatchResponse();
  }
  return source;
}

function responseString(value: unknown): string {
  if (typeof value !== "string") invalidProposalBatchResponse();
  return value;
}

function responseStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalidProposalBatchResponse();
  return [...value] as string[];
}

const v2ChannelTargets = [
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
] as const satisfies readonly ContentProposalV2["channelTargets"][number][];
const allowedV2ChannelTargets: ReadonlySet<string> = new Set(v2ChannelTargets);

function parseV2PurposeDetails(value: unknown): ContentProposalV2["purposeDetails"] {
  const raw = responseObject(value);
  if (raw.kind === "informational") {
    const source = exactResponseObject(value, ["kind", "question", "value", "whyNow", "learningPoints"]);
    return {
      kind: "informational",
      question: responseString(source.question),
      value: responseString(source.value),
      whyNow: responseString(source.whyNow),
      learningPoints: responseStrings(source.learningPoints),
    };
  }
  if (raw.kind === "marketing") {
    const source = exactResponseObject(value, [
      "kind", "campaignObjective", "situationAndNeed", "productId", "targetSegment",
      "strengths", "limitations", "appeal", "buyingBarriers", "cta",
    ]);
    return {
      kind: "marketing",
      campaignObjective: responseString(source.campaignObjective),
      situationAndNeed: responseString(source.situationAndNeed),
      productId: responseString(source.productId),
      targetSegment: responseString(source.targetSegment),
      strengths: responseStrings(source.strengths),
      limitations: responseStrings(source.limitations),
      appeal: responseString(source.appeal),
      buyingBarriers: responseStrings(source.buyingBarriers),
      cta: responseString(source.cta),
    };
  }
  return invalidProposalBatchResponse();
}

function parseV2Proposal(value: unknown): ContentProposalV2 {
  const source = exactResponseObject(value, [
    "conceptKey", "title", "informationalType", "oneLineIntent", "differentiator",
    "differentiationAxes", "target", "customerContext", "keyMessage", "hook",
    "selectionReason", "evidenceIds", "referenceIds", "outputFormat", "channelTargets",
    "assetCount", "outline", "purposeDetails",
  ]);
  const details = parseV2PurposeDetails(source.purposeDetails);
  const format = source.outputFormat;
  if (format !== "card_news" && format !== "blog" && format !== "reel") {
    invalidProposalBatchResponse();
  }
  const channelTargets = responseStrings(source.channelTargets);
  if (channelTargets.length !== 1 || !allowedV2ChannelTargets.has(channelTargets[0]!)) {
    invalidProposalBatchResponse();
  }
  const axes = responseStrings(source.differentiationAxes);
  const allowedAxes = new Set(["target", "situation", "question", "appeal", "narrative", "informational_type"]);
  if (!axes.length || axes.some((axis) => !allowedAxes.has(axis))) invalidProposalBatchResponse();
  const informationalType = source.informationalType;
  const allowedInformationalTypes = new Set(["problem_solution", "how_to", "checklist", "comparison", "trend_insight", "q_and_a", "myth_fact"]);
  if (informationalType !== null && (typeof informationalType !== "string" || !allowedInformationalTypes.has(informationalType))) {
    invalidProposalBatchResponse();
  }
  if ((details.kind === "informational") !== (informationalType !== null)) invalidProposalBatchResponse();
  if (!Array.isArray(source.outline)) invalidProposalBatchResponse();
  const outline = source.outline.map((value, index) => {
    const row = exactResponseObject(value, ["index", "role", "headline", "purpose"]);
    if (row.index !== index + 1) invalidProposalBatchResponse();
    return {
      index: row.index as number,
      role: responseString(row.role),
      headline: responseString(row.headline),
      purpose: responseString(row.purpose),
    };
  });
  const assetCount = source.assetCount;
  if (format === "blog") {
    if (assetCount !== null || outline.length < 1) invalidProposalBatchResponse();
  } else if (!Number.isSafeInteger(assetCount) || (assetCount as number) < 1 || (assetCount as number) > 5 || assetCount !== outline.length) {
    invalidProposalBatchResponse();
  }
  return {
    conceptKey: responseString(source.conceptKey),
    title: responseString(source.title),
    informationalType: informationalType as ContentProposalV2["informationalType"],
    oneLineIntent: responseString(source.oneLineIntent),
    differentiator: responseString(source.differentiator),
    differentiationAxes: axes as ContentProposalV2["differentiationAxes"],
    target: responseString(source.target),
    customerContext: responseString(source.customerContext),
    keyMessage: responseString(source.keyMessage),
    hook: responseString(source.hook),
    selectionReason: responseString(source.selectionReason),
    evidenceIds: responseStrings(source.evidenceIds),
    referenceIds: responseStrings(source.referenceIds),
    outputFormat: format,
    channelTargets: channelTargets as ContentProposalV2["channelTargets"],
    assetCount: assetCount as number | null,
    outline,
    purposeDetails: details,
  };
}

function parseV2ProposalBatch(value: unknown): ContentProposalBatch {
  const source = responseObject(value);
  const request = responseObject(source.request);
  if (request.contractVersion !== "content-proposal-request.v2") return value as ContentProposalBatch;
  if (
    typeof source.id !== "string"
    || typeof source.workspaceId !== "string"
    || typeof source.brandId !== "string"
    || (source.origin !== "manual" && source.origin !== "scheduled_crawl")
    || (source.contentFamily !== "informational" && source.contentFamily !== "marketing")
    || (source.status !== "queued" && source.status !== "building" && source.status !== "ready" && source.status !== "failed")
    || !Array.isArray(source.sourceSnapshots)
    || typeof source.createdAt !== "string"
    || typeof source.updatedAt !== "string"
  ) invalidProposalBatchResponse();
  const proposals = source.proposals === undefined ? undefined : (() => {
    if (!Array.isArray(source.proposals)) invalidProposalBatchResponse();
    return source.proposals.map((value) => {
      const row = responseObject(value);
      if (
        typeof row.id !== "string" || typeof row.batchId !== "string"
        || (row.status !== "suggested" && row.status !== "selected" && row.status !== "dismissed")
        || (row.generationId !== null && typeof row.generationId !== "string")
        || typeof row.createdAt !== "string"
      ) invalidProposalBatchResponse();
      return {
        id: row.id,
        batchId: row.batchId,
        proposal: parseV2Proposal(row.proposal),
        status: row.status,
        generationId: row.generationId,
        createdAt: row.createdAt,
      } as ContentProposalRecordV2;
    });
  })();
  if (source.status === "ready" && proposals?.length !== 3) invalidProposalBatchResponse();
  const evidenceSource = responseObject(source.researchEvidence ?? { items: [] });
  if (!Array.isArray(evidenceSource.items)) invalidProposalBatchResponse();
  const evidenceItems = evidenceSource.items.map((value) => {
    const row = responseObject(value);
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.url !== "string"
      || (row.publisher !== null && typeof row.publisher !== "string")) invalidProposalBatchResponse();
    return { id: row.id, title: row.title, url: row.url, publisher: row.publisher };
  });
  const rawSelectedReferences = source.selectedReferences ?? [];
  if (!Array.isArray(rawSelectedReferences)) invalidProposalBatchResponse();
  const selectedReferences = rawSelectedReferences.map((value: unknown) => {
    const row = responseObject(value);
    const preview = responseObject(row.preview);
    if (typeof row.id !== "string" || typeof row.title !== "string"
      || (preview.url !== null && typeof preview.url !== "string")
      || (preview.mimeType !== null && typeof preview.mimeType !== "string")) invalidProposalBatchResponse();
    return { id: row.id, title: row.title, preview: { url: preview.url, mimeType: preview.mimeType } };
  });
  return {
    id: source.id,
    workspaceId: source.workspaceId,
    brandId: source.brandId,
    origin: source.origin,
    contentFamily: source.contentFamily,
    request,
    sourceSnapshots: source.sourceSnapshots as Record<string, unknown>[],
    status: source.status,
    ...(proposals ? { proposals } : {}),
    researchEvidence: { items: evidenceItems },
    selectedReferences,
    errorCode: source.errorCode === null ? null : responseString(source.errorCode),
    errorMessage: source.errorMessage === null ? null : responseString(source.errorMessage),
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function confirmedServerAttachments(value: GenerationAttachment[] | null | undefined) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((attachment) => typeof attachment.storageUrl === "string" && typeof attachment.storagePath === "string")
    .map((attachment) => ({
      id: attachment.id,
      role: attachment.role,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storageUrl: attachment.storageUrl,
      storagePath: attachment.storagePath,
      uploadStatus: "confirmed" as const,
    }));
}

function normalizeBrief(value: Partial<GenerationBrief> | null | undefined, brandColor = DEFAULT_BRAND_COLOR): GenerationBrief {
  return {
    purpose: value?.purpose ?? ("" as GenerationBrief["purpose"]), emphasis: value?.emphasis ?? "", cta: value?.cta ?? "",
    additionalInstruction: value?.additionalInstruction ?? "", selectedColor: value?.selectedColor ?? brandColor,
    attachments: confirmedServerAttachments(value?.attachments), aspectRatio: value?.aspectRatio ?? "1:1",
    outputCount: value?.outputCount ?? 1, outputDirections: Array.isArray(value?.outputDirections) ? value.outputDirections : [""],
  };
}

function legacyTarget(value: Partial<AiContentDraft>): SubjectTarget | null {
  const audience = value.audience;
  return audience ? { id: audience.id, name: audience.name, traits: [audience.situation].filter(Boolean), painPoints: [audience.problem].filter(Boolean), purchaseMotivations: [audience.motivation].filter(Boolean), uspEvidence: [] } : null;
}

function legacyAppeal(value: Partial<AiContentDraft>): SubjectAppeal | null {
  const appeal = value.coreAppeal;
  return appeal ? { id: appeal.id, targetId: value.audience?.id ?? "legacy-target", title: appeal.title, description: appeal.description, evidenceType: appeal.evidenceType === "fact" ? "product_fact" : appeal.evidenceType === "benefit" ? "public_research" : "manual_input", connectionReason: "기존 저장 소구점", sources: [] } : null;
}

export function normalizeAiContentDraft(outputFormat: ContentStudioOutputFormat, value: ApiGeneration["draft"], brandColor = DEFAULT_BRAND_COLOR): AiContentDraft {
  const source = value ?? {};
  const legacySourceUrl = typeof source.productUrl === "string" ? source.productUrl : "";
  const subjectInput = source.subjectInput && typeof source.subjectInput === "object"
    ? { sourceUrl: source.subjectInput.sourceUrl ?? legacySourceUrl, name: source.subjectInput.name ?? "", promotion: source.subjectInput.promotion ?? "", description: source.subjectInput.description ?? "" }
    : { sourceUrl: legacySourceUrl, name: "", promotion: "", description: "" };
  const selectedSubjectImageIds = Array.isArray(source.selectedSubjectImageIds) ? source.selectedSubjectImageIds : Array.isArray(source.selectedAnalysisImageIds) ? source.selectedAnalysisImageIds : [];
  const selectedTarget = source.selectedTarget ?? legacyTarget(source);
  const selectedAppeal = source.selectedAppeal ?? legacyAppeal(source);
  const subjectType = source.subjectType ?? (source.analysisSource === "product_url" ? "product" : source.analysisSource === "owned" ? "service" : null);
  const appealOverridesByTarget = source.appealOverridesByTarget && typeof source.appealOverridesByTarget === "object"
    ? Object.fromEntries(Object.entries(source.appealOverridesByTarget).filter((entry): entry is [string, SubjectAppeal[]] => Array.isArray(entry[1])).map(([targetId, appeals]) => [targetId, appeals.map((appeal) => ({ ...appeal, sources: [...appeal.sources] }))]))
    : {};
  return {
    type: source.type ?? (outputFormat === "reel" ? "marketing" : outputFormat),
    orchestration: source.orchestration as ContentOrchestration | undefined,
    subjectType,
    subjectInput,
    subjectAnalysisId: source.subjectAnalysisId ?? null,
    subjectAnalysisVersion: typeof source.subjectAnalysisVersion === "number" ? source.subjectAnalysisVersion : null,
    subjectAttachments: confirmedServerAttachments(source.subjectAttachments),
    selectedSubjectImageIds: [...selectedSubjectImageIds], selectedTarget, selectedAppeal, appealOverridesByTarget,
    referenceIds: Array.isArray(source.referenceIds) ? [...source.referenceIds] : [], brief: normalizeBrief(source.brief, brandColor),
    analysisSource: source.analysisSource ?? (subjectType === "product" ? "product_url" : subjectType === "service" ? "owned" : null),
    productUrl: subjectInput.sourceUrl, selectedAnalysisImageIds: [...selectedSubjectImageIds],
    audience: source.audience ?? (selectedTarget ? { id: selectedTarget.id, name: selectedTarget.name, situation: selectedTarget.traits[0] ?? "", problem: selectedTarget.painPoints[0] ?? "", motivation: selectedTarget.purchaseMotivations[0] ?? "" } : null),
    coreAppeal: source.coreAppeal ?? (selectedAppeal ? { id: selectedAppeal.id, title: selectedAppeal.title, description: selectedAppeal.description, evidenceType: selectedAppeal.evidenceType === "product_fact" ? "fact" : selectedAppeal.evidenceType === "public_research" ? "benefit" : "emotion" } : null),
    secondaryAppeals: Array.isArray(source.secondaryAppeals) ? source.secondaryAppeals : [],
  };
}

function activeV3Manifest(output: ApiOutput, generation: ApiGeneration): AiContentManifestV3 {
  let manifest: AiContentManifestV3;
  try {
    manifest = parseAiContentManifestV3(output.manifest);
  } catch {
    throw new Error("ai_content_output_manifest_invalid");
  }
  if (manifest.outputFormat !== generation.outputFormat || manifest.purpose !== generation.purpose) {
    throw new Error("ai_content_output_manifest_invalid");
  }
  return manifest;
}

function outputArtifact(outputId: string, manifest: AiContentManifestV3): PublishArtifact {
  const rawAssets = [...manifest.assets].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  const outputFormat = manifest.outputFormat;
  const assets = outputFormat === "blog"
    ? rawAssets.filter((asset) => asset.mimeType?.startsWith("image/"))
    : rawAssets;
  const content = manifest.content;
  const html = outputFormat === "blog" && "html" in content ? content.html : null;
  const deliveryFormat = null;
  const text = outputFormat === "card_news"
    ? ["caption" in content ? content.caption : "", ...("hashtags" in content ? content.hashtags : [])].filter(Boolean).join("\n\n")
    : outputFormat === "reel"
      ? ["caption" in content ? content.caption : "", ...("hashtags" in content ? content.hashtags : []), "cta" in content ? content.cta : ""].filter(Boolean).join("\n\n")
      : ["title" in content ? content.title : "", "summary" in content ? content.summary : ""].filter(Boolean).join("\n\n");
  const firstImage = rawAssets.find((asset) => asset.mimeType?.startsWith("image/"));
  return {
    queueId: outputId,
    kind: outputFormat === "blog"
      ? "html"
      : outputFormat === "reel"
        ? "video"
        : "image_gallery",
    deliveryFormat,
    assets: assets.map((asset) => ({
      ...asset,
      width: "width" in asset ? asset.width : null,
      height: "height" in asset ? asset.height : null,
    })),
    posterUrl: firstImage?.url ?? null,
    html,
    text,
  };
}

function mapGeneration(value: ApiGeneration): AiContentGeneration {
  const stepByStatus: Record<AiContentGeneration["status"], AiContentWizardStep> = { draft: 1, analyzing: 2, analysis_ready: 3, queued: 5, planning: 5, generating: 5, completed: 5, partial_failed: 5, failed: 5 };
  try {
    parseContentStudioOutputFormat(value.outputFormat);
    parseContentPurpose(value.purpose);
  } catch {
    throw new Error("ai_content_generation_contract_invalid");
  }
  return {
    id: value.id, brandId: value.brandId, title: value.title,
    outputFormat: value.outputFormat, purpose: value.purpose, status: value.status,
    currentStep: stepByStatus[value.status], draft: normalizeAiContentDraft(value.outputFormat, value.draft), analysis: value.analysis,
    outputs: (value.outputs ?? []).map((output) => {
      const manifest = output.status === "completed" ? activeV3Manifest(output, value) : null;
      const outputFormat = manifest?.outputFormat ?? value.outputFormat;
      return {
        id: output.id,
        generationId: output.generationId,
        title: manifest?.title ?? output.title ?? `결과 ${output.outputIndex}`,
        status: output.status,
        artifact: manifest ? outputArtifact(output.id, manifest) : null,
        copy: outputCopy(manifest?.content ?? output.content),
        failureReason: output.failureMessage ?? output.failureCode,
        downloadedAt: output.downloadedAt,
        revisionCapabilities: output.revisionCapabilities ?? [],
        manifestVersion: manifest?.version ?? null,
        outputFormat,
        publishSupported: manifest?.outputFormat === "card_news",
      };
    }),
    evidenceSnapshot: value.evidenceSnapshot ?? null,
    attachmentsLockedAt: value.attachmentsLockedAt ?? null,
    terminalAt: value.terminalAt ?? null,
    retryableUntil: value.retryableUntil ?? null,
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

function mapSubjectAnalysis(value: ApiSubjectAnalysis): SubjectAnalysis {
  const targets = Array.isArray(value.targets) ? value.targets : [];
  return {
    id: value.id, generationId: value.generationId ?? null, contractVersion: value.contractVersion,
    workspaceId: value.workspaceId ?? "", brandId: value.brandId ?? "", subjectType: value.subjectType ?? "product",
    sourceUrl: value.sourceUrl ?? "", normalizedUrl: value.normalizedUrl ?? "",
    input: { name: value.input?.name ?? "", promotion: value.input?.promotionOrTerms ?? value.input?.promotion ?? "", description: value.input?.description ?? "" },
    status: value.status, facts: value.facts ?? [], structuredData: value.structuredData ?? {}, research: value.research ?? {},
    targets, appealsByTarget: value.appealsByTarget ?? {}, selectedImageId: value.selectedImageId ?? null,
    images: value.images ?? [], analysisVersion: value.analysisVersion, errorCode: value.errorCode ?? null, errorMessage: value.errorMessage ?? null,
    createdAt: value.createdAt ?? "", updatedAt: value.updatedAt ?? "", completedAt: value.completedAt ?? null,
    sourceGaps: value.sourceGaps ?? [],
  };
}

function isSubjectAnalysisInputV2(input: SubjectAnalysisInput | LegacySubjectAnalysisInput): input is SubjectAnalysisInput {
  return typeof (input as Partial<SubjectAnalysisInput>).generationId === "string"
    && Array.isArray((input as Partial<SubjectAnalysisInput>).attachmentIds)
    && "promotionOrTerms" in input.manualInput;
}

async function fileBytes(file: File) {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("ai_content_attachment_read_failed"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await fileBytes(file));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

interface LegacyAttachmentToken {
  pathname: string;
  clientToken: string;
}

interface SessionAttachmentToken extends LegacyAttachmentToken {
  sessionId: string;
  nonce: string;
}

function isSessionAttachmentToken(token: LegacyAttachmentToken | SessionAttachmentToken): token is SessionAttachmentToken {
  return typeof (token as Partial<SessionAttachmentToken>).sessionId === "string"
    && typeof (token as Partial<SessionAttachmentToken>).nonce === "string";
}

function shouldRetryConfirm(error: unknown) {
  if (!(error instanceof ApiRequestError)) return true;
  if (error.status >= 400 && error.status < 500) return false;
  return error.status >= 500 || error.deliveryStatus === "unknown";
}

export function createAiContentApiGateway(client = apiClient(), blobPut: typeof putBlob = putBlob): AiContentGateway {
  const retryIdempotencyKeys = new Map<string, string>();
  return {
    async getUsage(brandId) {
      const usage = await client.requestJson<{ usageDate: string; generationCount: number; downloadCount: number; dailyGenerationLimit: number; dailyDownloadLimit: number }>(`/brands/${brandId}/ai-content/usage`, { method: "GET" });
      const reset = new Date(`${usage.usageDate}T00:00:00+09:00`); reset.setDate(reset.getDate() + 1);
      return { generationUsed: usage.generationCount, generationLimit: usage.dailyGenerationLimit, newDownloadUsed: usage.downloadCount, newDownloadLimit: usage.dailyDownloadLimit, resetsAt: reset.toISOString() };
    },
    getBrandContext(brandId) {
      return client.requestJson(`/brands/${brandId}/ai-content/brand-context`, { method: "GET" });
    },
    async listGenerations(brandId) { return (await client.requestJson<ApiGeneration[]>(`/brands/${brandId}/ai-content/generations`, { method: "GET" })).map(mapGeneration); },
    async getGeneration(brandId, generationId) { return mapGeneration(await client.requestJson<ApiGeneration>(`/brands/${brandId}/ai-content/generations/${generationId}`, { method: "GET" })); },
    async updateFinalizationDraft(brandId, generationId, finalizationDraft) {
      return mapGeneration(await client.requestJson<ApiGeneration>(
        `/brands/${brandId}/ai-content/generations/${generationId}`,
        { method: "PATCH", body: JSON.stringify(finalizationDraft) },
      ));
    },
    async startGenerationV2(brandId, generationId, idempotencyKey) {
      return mapGeneration(await client.requestJson<ApiGeneration>(
        `/brands/${brandId}/ai-content/generations/${generationId}/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey,
            contractVersion: "content-generation-start.v2",
          }),
        },
      ));
    },
    async uploadAttachment(brandId, generationId, attachment, onProgress) {
      if (!attachment.file) throw new Error("ai_content_attachment_file_required");
      const checksum = await sha256(attachment.file);
      const v3 = attachment.role === "product_image"
        || attachment.role === "visual_reference"
        || attachment.role === "supporting_image";
      const metadata = {
        ...(v3 ? { contractVersion: "ai-content-attachment-upload.v3" as const } : {}),
        role: attachment.role,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
        checksum,
      };
      const token = await client.requestJson<LegacyAttachmentToken | SessionAttachmentToken>(`/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`, { method: "POST", body: JSON.stringify(metadata) });
      let stored: Awaited<ReturnType<typeof blobPut>>;
      try {
        stored = await blobPut(token.pathname, attachment.file, {
          access: "public",
          token: token.clientToken,
          contentType: attachment.mimeType,
          onUploadProgress: onProgress ? ({ percentage }) => onProgress(percentage) : undefined,
        });
      } catch (error) {
        if (isSessionAttachmentToken(token)) {
          await client.requestJson(
            `/brands/${brandId}/ai-content/generations/${generationId}/attachments/cancel`,
            { method: "POST", body: JSON.stringify({ sessionId: token.sessionId, nonce: token.nonce }) },
          ).catch(() => undefined);
        }
        throw error;
      }
      const confirmBody = isSessionAttachmentToken(token)
        ? JSON.stringify({ sessionId: token.sessionId, nonce: token.nonce })
        : JSON.stringify({ ...metadata, storageUrl: stored.url, storagePath: token.pathname });
      const confirm = () => client.requestJson<{ id: string; storageUrl?: string; storagePath?: string }>(
        `/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`,
        { method: "POST", body: confirmBody },
      );
      let confirmed;
      try {
        confirmed = await confirm();
      } catch (error) {
        if (!isSessionAttachmentToken(token) || !shouldRetryConfirm(error)) throw error;
        confirmed = await confirm();
      }
      return { ...attachment, id: confirmed.id, file: undefined, storageUrl: confirmed.storageUrl ?? stored.url, storagePath: confirmed.storagePath ?? token.pathname, uploadStatus: "confirmed" };
    },
    async removeAttachment(brandId, generationId, attachmentId) {
      await client.requestJson(
        `/brands/${brandId}/ai-content/generations/${generationId}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
    },
    listAudiencePresets(brandId) { return client.requestJson(`/brands/${brandId}/ai-content/audiences`, { method: "GET" }); },
    saveAudiencePreset(brandId, input) { return client.requestJson(`/brands/${brandId}/ai-content/audiences`, { method: "POST", body: JSON.stringify(input) }); },
    listAppealPresets(brandId) { return client.requestJson(`/brands/${brandId}/ai-content/appeals`, { method: "GET" }); },
    saveAppealPreset(brandId, input) { return client.requestJson(`/brands/${brandId}/ai-content/appeals`, { method: "POST", body: JSON.stringify(input) }); },
    async listReferences(brandId, query) {
      const type = typeof query === "string" ? query : undefined;
      const types = type ? [type] : ["card_news", "blog", "marketing"] as AiContentType[];
      const filters = typeof query === "object" && query
        ? `&${new URLSearchParams({
          strategies: query.strategies.join(","),
          formats: query.formats.join(","),
          tags: query.tags.join(","),
        }).toString()}`
        : "";
      const rows = (await Promise.all(types.map(async (format) => {
        const references = await client.requestJson<Array<{ id: string; source: string; title: string; url: string | null; previewUrl: string | null; metrics: Record<string, unknown> }>>(`/brands/${brandId}/ai-content/references?type=${format}${filters}`, { method: "GET" });
        return references.map((reference) => ({ ...reference, format }));
      }))).flat();
      const unique = new Map<string, AiContentReference>();
      rows.forEach((row) => {
        const metricEntry = Object.entries(row.metrics).map(([label, value]) => [label, Number(value)] as const).filter(([, value]) => Number.isFinite(value)).sort((a, b) => b[1] - a[1])[0];
        unique.set(row.id, { id: row.id, title: row.title, previewUrl: row.previewUrl, source: row.source === "brand_output" ? "owned" : row.source === "saved_trend" ? "saved_trend" : "uploaded", format: row.format, primaryCategory: null, subcategory: null, appealIds: [], comparableMetric: metricEntry ? { label: metricEntry[0], value: metricEntry[1] } : null });
      });
      return [...unique.values()];
    },
    listReferenceSeeds(brandId, format) {
      return client.listAiContentReferenceSeeds(brandId, format);
    },
    async retryOutput(brandId, outputId, reason) {
      if (!reason.trim()) throw new Error("retry_reason_required");
      const normalizedReason = reason.trim();
      const retryKey = `${brandId}:${outputId}:${normalizedReason}`;
      const idempotencyKey = retryIdempotencyKeys.get(retryKey) ?? crypto.randomUUID();
      retryIdempotencyKeys.set(retryKey, idempotencyKey);
      const generation = mapGeneration(await client.requestJson<ApiGeneration>(
        `/brands/${brandId}/ai-content/outputs/${outputId}/retry`,
        {
          method: "POST",
          body: JSON.stringify({ contractVersion: "content-generation-retry.v1", idempotencyKey, reason: normalizedReason }),
        },
      ));
      retryIdempotencyKeys.delete(retryKey);
      if (generation.outputs.length !== 1 || generation.outputs[0]?.status !== "queued") {
        throw new Error("ai_content_generation_retry_response_invalid");
      }
      return generation;
    },
    async saveOutputCopy(brandId, outputId, input) {
      const generation = mapGeneration(await client.requestJson<ApiGeneration>(
        `/brands/${brandId}/ai-content/outputs/${outputId}/copy`,
        { method: "PUT", body: JSON.stringify(input) },
      ));
      const output = generation.outputs.find((item) => item.id === outputId);
      if (!output) throw new Error("ai_content_output_not_found");
      return output;
    },
    downloadOutput(brandId, outputId) {
      return client.requestBlob(`/brands/${brandId}/ai-content/outputs/${outputId}/download`, { method: "GET" });
    },
    downloadGeneration(brandId, generationId, outputIds) {
      const query = outputIds?.length ? `?outputIds=${encodeURIComponent(outputIds.join(","))}` : "";
      return client.requestBlob(`/brands/${brandId}/ai-content/generations/${generationId}/download${query}`, { method: "GET" });
    },
    publishOutput(brandId, outputId, input) {
      return client.requestJson(`/brands/${brandId}/ai-content/outputs/${outputId}/publish`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    listChannels(brandId) {
      return client.requestJson<ApiChannel[]>(`/brands/${brandId}/channels`, { method: "GET" })
        .then((channels) => channels.map(mapApiChannelConnection));
    },
    async getCachedSubjectAnalysis(brandId, subjectType, sourceUrl) {
      try {
        return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/cache?${new URLSearchParams({ subjectType, sourceUrl }).toString()}`, { method: "GET" }));
      } catch (error) {
        if (error instanceof Error && error.message.includes("subject_analysis_not_found")) return null;
        throw error;
      }
    },
    async requestSubjectAnalysis(brandId, input: SubjectAnalysisInput | LegacySubjectAnalysisInput) {
      if (!isSubjectAnalysisInputV2(input)) throw new Error("subject_analysis_v2_input_required");
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses`, { method: "POST", body: JSON.stringify({ contractVersion: "subject-analysis.v2", ...input }) }));
    },
    async getSubjectAnalysis(brandId, analysisId) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}`, { method: "GET" }));
    },
    async regenerateSubjectAppeals(brandId, analysisId, idempotencyKey) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}/appeals/regenerate`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }));
    },
    async reanalyzeSubject(brandId, analysisId, idempotencyKey) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}/reanalyze`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }));
    },
    async selectSubjectImage(brandId, analysisId, imageId) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}/selection`, { method: "PATCH", body: JSON.stringify({ imageId }) }));
    },
    createProposalBatch(brandId, input) {
      return client.requestJson(`/brands/${brandId}/ai-content/proposal-batches`, {
        method: "POST",
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: JSON.stringify(input.request),
      });
    },
    async getProposalBatch(brandId, batchId, signal) {
      const value = await client.requestJson<unknown>(
        `/brands/${brandId}/ai-content/proposal-batches/${batchId}`,
        { method: "GET", ...(signal ? { signal } : {}) },
      );
      return parseV2ProposalBatch(value);
    },
    listSuggestedProposals(brandId, signal) {
      return client.requestJson<ContentProposalRecord[]>(
        `/brands/${brandId}/ai-content/proposals?status=suggested`,
        { method: "GET", ...(signal ? { signal } : {}) },
      );
    },
    async selectProposal(brandId, proposalId, idempotencyKey) {
      return mapGeneration(await client.requestJson<ApiGeneration>(
        `/brands/${brandId}/ai-content/proposals/${proposalId}/select`,
        { method: "POST", body: JSON.stringify({ idempotencyKey }) },
      ));
    },
    dismissProposal(brandId, proposalId) {
      return client.requestJson<ContentProposalRecord>(
        `/brands/${brandId}/ai-content/proposals/${proposalId}/dismiss`,
        { method: "POST" },
      );
    },
    listDraftReferences(brandId, assetType, assetId, signal) {
      const query = new URLSearchParams({ assetType, assetId }).toString();
      return client.requestJson<AiContentDraftReference[]>(
        `/brands/${brandId}/ai-content/draft-references?${query}`,
        { method: "GET", ...(signal ? { signal } : {}) },
      );
    },
  };
}

export const aiContentApiGateway = createAiContentApiGateway();
