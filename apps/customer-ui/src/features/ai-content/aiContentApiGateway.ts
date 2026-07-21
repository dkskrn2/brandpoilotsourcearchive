import { put as putBlob } from "@vercel/blob/client";
import { apiClient, mapApiChannelConnection, type ApiChannel } from "../../lib/apiClient";
import type { PublishArtifact, PublishArtifactAsset } from "../../types";
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
  SubjectAnalysis,
  SubjectAnalysisInput,
  SubjectAppeal,
  SubjectTarget,
  SubjectType,
} from "./types";
import { DEFAULT_BRAND_COLOR } from "./useAiContentDraft";

interface ApiOutput {
  id: string; generationId: string; outputIndex: number; title: string | null; status: AiGenerationOutput["status"];
  content: Record<string, unknown>; manifest: Record<string, unknown>; manifestUrl: string | null;
  failureCode: string | null; failureMessage: string | null; downloadedAt: string | null;
}
interface ApiGeneration {
  id: string; brandId: string; type: AiContentType; title: string; status: AiContentGeneration["status"];
  currentStage: string | null; draft: Partial<AiContentDraft> | null; analysis: Record<string, unknown>; outputs?: ApiOutput[];
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

function normalizeBrief(value: Partial<GenerationBrief> | null | undefined, brandColor = DEFAULT_BRAND_COLOR): GenerationBrief {
  return {
    purpose: value?.purpose ?? ("" as GenerationBrief["purpose"]), emphasis: value?.emphasis ?? "", cta: value?.cta ?? "",
    additionalInstruction: value?.additionalInstruction ?? "", selectedColor: value?.selectedColor ?? brandColor,
    attachments: Array.isArray(value?.attachments) ? value.attachments : [], aspectRatio: value?.aspectRatio ?? "1:1",
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

export function normalizeAiContentDraft(type: AiContentType, value: ApiGeneration["draft"], brandColor = DEFAULT_BRAND_COLOR): AiContentDraft {
  const source = value ?? {};
  const legacySourceUrl = typeof source.productUrl === "string" ? source.productUrl : "";
  const subjectInput = source.subjectInput && typeof source.subjectInput === "object"
    ? { sourceUrl: source.subjectInput.sourceUrl ?? legacySourceUrl, name: source.subjectInput.name ?? "", promotion: source.subjectInput.promotion ?? "", description: source.subjectInput.description ?? "" }
    : { sourceUrl: legacySourceUrl, name: "", promotion: "", description: "" };
  const selectedSubjectImageIds = Array.isArray(source.selectedSubjectImageIds) ? source.selectedSubjectImageIds : Array.isArray(source.selectedAnalysisImageIds) ? source.selectedAnalysisImageIds : [];
  const selectedTarget = source.selectedTarget ?? legacyTarget(source);
  const selectedAppeal = source.selectedAppeal ?? legacyAppeal(source);
  const subjectType = source.subjectType ?? (source.analysisSource === "product_url" ? "product" : source.analysisSource === "owned" ? "service" : null);
  return {
    type: source.type ?? type, subjectType,
    subjectInput,
    subjectAnalysisId: source.subjectAnalysisId ?? null,
    subjectAnalysisVersion: typeof source.subjectAnalysisVersion === "number" ? source.subjectAnalysisVersion : null,
    subjectAttachments: Array.isArray(source.subjectAttachments) ? [...source.subjectAttachments] : [],
    selectedSubjectImageIds: [...selectedSubjectImageIds], selectedTarget, selectedAppeal,
    referenceIds: Array.isArray(source.referenceIds) ? [...source.referenceIds] : [], brief: normalizeBrief(source.brief, brandColor),
    analysisSource: source.analysisSource ?? (subjectType === "product" ? "product_url" : subjectType === "service" ? "owned" : null),
    productUrl: subjectInput.sourceUrl, selectedAnalysisImageIds: [...selectedSubjectImageIds],
    audience: source.audience ?? (selectedTarget ? { id: selectedTarget.id, name: selectedTarget.name, situation: selectedTarget.traits[0] ?? "", problem: selectedTarget.painPoints[0] ?? "", motivation: selectedTarget.purchaseMotivations[0] ?? "" } : null),
    coreAppeal: source.coreAppeal ?? (selectedAppeal ? { id: selectedAppeal.id, title: selectedAppeal.title, description: selectedAppeal.description, evidenceType: selectedAppeal.evidenceType === "product_fact" ? "fact" : selectedAppeal.evidenceType === "public_research" ? "benefit" : "emotion" } : null),
    secondaryAppeals: Array.isArray(source.secondaryAppeals) ? source.secondaryAppeals : [],
  };
}

function serializeDraft(draft: AiContentDraft): Record<string, unknown> {
  return {
    type: draft.type, subjectType: draft.subjectType, subjectInput: { ...draft.subjectInput, sourceUrl: draft.subjectInput.sourceUrl || draft.productUrl },
    subjectAnalysisId: draft.subjectAnalysisId, subjectAnalysisVersion: draft.subjectAnalysisVersion,
    subjectAttachments: (draft.subjectAttachments ?? []).map(({ file: _file, ...attachment }) => attachment),
    selectedSubjectImageIds: [...draft.selectedSubjectImageIds], selectedTarget: draft.selectedTarget, selectedAppeal: draft.selectedAppeal,
    referenceIds: [...draft.referenceIds], brief: draft.brief ? { ...draft.brief, attachments: [...draft.brief.attachments], outputDirections: [...draft.brief.outputDirections] } : null,
  };
}

function outputArtifact(type: AiContentType, output: ApiOutput): PublishArtifact | null {
  if (output.status !== "completed") return null;
  const assets = Array.isArray(output.manifest.assets)
    ? [...output.manifest.assets as Array<PublishArtifactAsset & { index?: number }>].sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    : [];
  const content = output.content ?? {};
  const html = type === "blog" && typeof content.html === "string" ? content.html : null;
  const text = type === "card_news"
    ? [content.caption, ...(Array.isArray(content.hashtags) ? content.hashtags : [])].filter(Boolean).join("\n\n")
    : type === "marketing"
      ? [content.concept, content.headline, content.body, content.cta].filter(Boolean).join("\n\n")
      : [content.title, content.summary].filter(Boolean).join("\n\n");
  return {
    queueId: output.id,
    kind: type === "blog" ? "html" : type === "card_news" ? "image_gallery" : "image",
    deliveryFormat: null,
    assets: assets.map((asset) => ({ ...asset, width: asset.width ?? null, height: asset.height ?? null })),
    posterUrl: assets.find((asset) => asset.mimeType === "image/png")?.url ?? null,
    html,
    text,
  };
}

function mapGeneration(value: ApiGeneration): AiContentGeneration {
  const stepByStatus: Record<AiContentGeneration["status"], AiContentWizardStep> = { draft: 1, analyzing: 2, analysis_ready: 3, queued: 5, planning: 5, generating: 5, completed: 5, partial_failed: 5, failed: 5 };
  return {
    id: value.id, brandId: value.brandId, title: value.title, type: value.type, status: value.status,
    currentStep: stepByStatus[value.status], draft: normalizeAiContentDraft(value.type, value.draft), analysis: value.analysis,
    outputs: (value.outputs ?? []).map((output) => ({ id: output.id, generationId: output.generationId, title: output.title ?? `결과 ${output.outputIndex}`, status: output.status, artifact: outputArtifact(value.type, output), failureReason: output.failureMessage ?? output.failureCode, downloadedAt: output.downloadedAt })),
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

export function createAiContentApiGateway(client = apiClient(), blobPut: typeof putBlob = putBlob): AiContentGateway {
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
    async createAnalysis(brandId, input) { return mapGeneration(await client.requestJson<ApiGeneration>(`/brands/${brandId}/ai-content/generations`, { method: "POST", body: JSON.stringify({ ...input, draft: serializeDraft(input.draft) }) })); },
    async updateGeneration(brandId, generationId, input) { return mapGeneration(await client.requestJson<ApiGeneration>(`/brands/${brandId}/ai-content/generations/${generationId}`, { method: "PATCH", body: JSON.stringify({ ...input, draft: serializeDraft(input.draft) }) })); },
    async startGeneration(brandId, generationId, input) { return mapGeneration(await client.requestJson<ApiGeneration>(`/brands/${brandId}/ai-content/generations/${generationId}/generate`, { method: "POST", body: JSON.stringify(input) })); },
    async uploadAttachment(brandId, generationId, attachment, onProgress) {
      if (!attachment.file) throw new Error("ai_content_attachment_file_required");
      const checksum = await sha256(attachment.file);
      const metadata = { role: attachment.role, fileName: attachment.fileName, mimeType: attachment.mimeType, sizeBytes: attachment.size, checksum };
      const token = await client.requestJson<{ pathname: string; clientToken: string }>(`/brands/${brandId}/ai-content/generations/${generationId}/attachments/token`, { method: "POST", body: JSON.stringify(metadata) });
      const stored = await blobPut(token.pathname, attachment.file, {
        access: "public",
        token: token.clientToken,
        contentType: attachment.mimeType,
        onUploadProgress: onProgress ? ({ percentage }) => onProgress(percentage) : undefined,
      });
      const confirmed = await client.requestJson<{ id: string; storageUrl?: string; storagePath?: string }>(`/brands/${brandId}/ai-content/generations/${generationId}/attachments/confirm`, { method: "POST", body: JSON.stringify({ ...metadata, storageUrl: stored.url, storagePath: token.pathname }) });
      return { ...attachment, id: confirmed.id, file: undefined, storageUrl: confirmed.storageUrl ?? stored.url, storagePath: confirmed.storagePath ?? token.pathname };
    },
    listAudiencePresets(brandId) { return client.requestJson(`/brands/${brandId}/ai-content/audiences`, { method: "GET" }); },
    saveAudiencePreset(brandId, input) { return client.requestJson(`/brands/${brandId}/ai-content/audiences`, { method: "POST", body: JSON.stringify(input) }); },
    listAppealPresets(brandId) { return client.requestJson(`/brands/${brandId}/ai-content/appeals`, { method: "GET" }); },
    saveAppealPreset(brandId, input) { return client.requestJson(`/brands/${brandId}/ai-content/appeals`, { method: "POST", body: JSON.stringify(input) }); },
    async listReferences(brandId, type) {
      const types = type ? [type] : ["card_news", "blog", "marketing"] as AiContentType[];
      const rows = (await Promise.all(types.map(async (format) => {
        const references = await client.requestJson<Array<{ id: string; source: string; title: string; url: string | null; previewUrl: string | null; metrics: Record<string, unknown> }>>(`/brands/${brandId}/ai-content/references?type=${format}`, { method: "GET" });
        return references.map((reference) => ({ ...reference, format }));
      }))).flat();
      const unique = new Map<string, AiContentReference>();
      rows.forEach((row) => {
        const metricEntry = Object.entries(row.metrics).map(([label, value]) => [label, Number(value)] as const).filter(([, value]) => Number.isFinite(value)).sort((a, b) => b[1] - a[1])[0];
        unique.set(row.id, { id: row.id, title: row.title, previewUrl: row.previewUrl, source: row.source === "brand_output" ? "owned" : row.source === "saved_trend" ? "saved_trend" : "uploaded", format: row.format, primaryCategory: null, subcategory: null, appealIds: [], comparableMetric: metricEntry ? { label: metricEntry[0], value: metricEntry[1] } : null });
      });
      return [...unique.values()];
    },
    async retryOutput(brandId, outputId, reason) {
      if (!reason.trim()) throw new Error("retry_reason_required");
      const generation = mapGeneration(await client.requestJson<ApiGeneration>(`/brands/${brandId}/ai-content/outputs/${outputId}/retry`, { method: "POST", body: JSON.stringify({ reason }) }));
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
    async requestSubjectAnalysis(brandId, input: SubjectAnalysisInput<string | null>) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses`, { method: "POST", body: JSON.stringify({ contractVersion: "subject-analysis.v2", ...input }) }));
    },
    async getSubjectAnalysis(brandId, analysisId) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}`, { method: "GET" }));
    },
    async reanalyzeSubject(brandId, analysisId, idempotencyKey) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}/reanalyze`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }));
    },
    async selectSubjectImage(brandId, analysisId, imageId) {
      return mapSubjectAnalysis(await client.requestJson<ApiSubjectAnalysis>(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}/selection`, { method: "PATCH", body: JSON.stringify({ imageId }) }));
    },
  };
}

export const aiContentApiGateway = createAiContentApiGateway();
