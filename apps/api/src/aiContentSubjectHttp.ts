import { extractSubjectPage, type ExtractSubjectPageInput, type SubjectImageArchiveInput } from "./aiContentSubjectExtractor.js";
import type {
  SubjectAnalysisInputV1,
  SubjectAnalysisInputV2,
  SubjectAppealInputV2,
} from "./aiContentSubjectContracts.js";
import {
  loadSubjectEvidence,
  type SubjectEvidenceDependencies,
  type SubjectEvidenceFetchLimits,
} from "./aiContentSubjectEvidence.js";
import type { ApiRepository } from "./types.js";
import type { SubjectAnalysisClaim, SubjectAnalysisRepository } from "./aiContentSubjectRepository.js";

export interface AiContentSubjectRuntime {
  extractPage?: typeof extractSubjectPage;
  fetchBlob?: SubjectEvidenceDependencies["fetchBlob"];
  archiveImage?: (
    image: SubjectImageArchiveInput & { analysisId: string; workspaceId: string; brandId: string },
  ) => ReturnType<ExtractSubjectPageInput["archiveImage"]>;
  /** Test override. Production renews at one third of the requested lease duration. */
  leaseHeartbeatIntervalMs?: number;
}

export interface SubjectAnalysisWorkerJob extends SubjectAnalysisInputV1 {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface SubjectAnalysisWorkerJobV2 extends SubjectAnalysisInputV2 {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface SubjectAppealWorkerJobV2 extends SubjectAppealInputV2 {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export type SubjectWorkerJob = SubjectAnalysisWorkerJob | SubjectAnalysisWorkerJobV2 | SubjectAppealWorkerJobV2;

const SOURCE_PRIORITY: SubjectAnalysisInputV2["sourcePriority"] = [
  "manual_input",
  "attachments",
  "source_url",
  "brand_context",
  "public_research",
];

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export async function fetchSubjectEvidenceBlob(
  url: string,
  limits: SubjectEvidenceFetchLimits,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(url, { signal: limits.signal });
  if (!response.ok) {
    await cancelBody(response);
    throw new Error("subject_analysis_attachment_fetch_failed");
  }
  const declaredValue = response.headers.get("content-length");
  const declaredLength = declaredValue === null ? null : Number(declaredValue);
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    await cancelBody(response);
    throw new Error("subject_analysis_attachment_size_mismatch");
  }
  if (declaredLength !== null && declaredLength > limits.maxBytes) {
    await cancelBody(response);
    throw new Error("subject_analysis_attachment_size_mismatch");
  }

  if (!response.body) {
    return {
      bytes: new Uint8Array(),
      contentType: response.headers.get("content-type") ?? "",
      contentLength: declaredLength ?? 0,
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxBytes) {
        await reader.cancel();
        throw new Error("subject_analysis_attachment_size_mismatch");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    contentType: response.headers.get("content-type") ?? "",
    contentLength: declaredLength ?? size,
  };
}

function leaseFields(claim: SubjectAnalysisClaim) {
  return {
    analysisId: claim.id,
    workerId: claim.leasedBy,
    leaseToken: claim.leaseToken,
    leaseExpiresAt: claim.leaseExpiresAt,
  };
}

async function startPreparationLeaseHeartbeat(
  repository: SubjectAnalysisRepository,
  claim: SubjectAnalysisClaim,
  leaseSeconds: number,
  intervalOverride?: number,
): Promise<() => Promise<void>> {
  const identity = {
    analysisId: claim.id,
    workerId: claim.leasedBy,
    leaseToken: claim.leaseToken,
    leaseSeconds,
  };
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let heartbeatError: Error | null = null;
  const renew = async () => {
    if (stopped || inFlight || heartbeatError) return;
    inFlight = (async () => {
      try {
        const alive = await repository.heartbeatSubjectAnalysis(identity);
        if (!alive) heartbeatError = new Error("subject_analysis_lease_invalid");
      } catch (error) {
        heartbeatError = error instanceof Error ? error : new Error("subject_analysis_lease_invalid");
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  await renew();
  if (heartbeatError) throw heartbeatError;
  const intervalMs = intervalOverride ?? Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 3));
  const timer = setInterval(() => { void renew(); }, intervalMs);
  timer.unref?.();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
    if (heartbeatError) throw heartbeatError;
  };
}

function subjectV2(claim: SubjectAnalysisClaim): SubjectAnalysisInputV2["subject"] {
  return {
    type: claim.subjectType,
    sourceUrl: claim.sourceUrl || null,
    attachmentIds: [...(claim.attachmentIds ?? [])],
    manualInput: {
      name: claim.input.name,
      promotionOrTerms: claim.input.promotionOrTerms ?? claim.input.promotion ?? "",
      description: claim.input.description,
    },
  };
}

function documentText(document: Awaited<ReturnType<typeof loadSubjectEvidence>>["documents"][number]): string {
  const blocks = document.textBlocks.map(({ heading, text }) => heading ? `${heading}\n${text}` : text);
  const tables = document.tables.map(({ sheet, headers, rows }) => [
    sheet,
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].filter(Boolean).join("\n"));
  return [...blocks, ...tables].filter(Boolean).join("\n\n");
}

function persistedSourcePage(claim: SubjectAnalysisClaim): SubjectAnalysisInputV2["extracted"]["sourcePage"] {
  if (!claim.sourceUrl || claim.facts.length === 0) return null;
  const byKey = new Map(claim.facts.map((fact) => [fact.key, fact]));
  const visibleText = byKey.get("visible_text")?.value ?? byKey.get("description")?.value ?? "";
  if (!visibleText) return null;
  return {
    sourceUrl: byKey.get("visible_text")?.sourceUrl ?? claim.sourceUrl,
    title: byKey.get("title")?.value ?? "",
    text: visibleText,
    structuredData: claim.structuredData,
  };
}

async function prepareV2Job(
  repository: ApiRepository & SubjectAnalysisRepository,
  claim: SubjectAnalysisClaim,
  runtime: AiContentSubjectRuntime,
): Promise<SubjectAnalysisWorkerJobV2 | SubjectAppealWorkerJobV2> {
  const subject = subjectV2(claim);
  if (claim.phase === "appeal") {
    if (!claim.analysisResult) throw new Error("subject_analysis_result_required");
    return {
      ...leaseFields(claim),
      contractVersion: "subject-analysis.v2",
      phase: "appeal",
      brandContext: claim.brandContext ?? {},
      subject,
      analysisResult: claim.analysisResult,
      sourcePriority: [...SOURCE_PRIORITY],
    };
  }
  if (!claim.generationId) throw new Error("subject_analysis_generation_required");
  if (!repository.listSubjectEvidenceAttachments) {
    throw new Error("subject_analysis_evidence_repository_not_configured");
  }
  const evidence = await loadSubjectEvidence({
    workspaceId: claim.workspaceId,
    brandId: claim.brandId,
    generationId: claim.generationId,
    attachmentIds: subject.attachmentIds,
  }, {
    listAttachments: (input) => repository.listSubjectEvidenceAttachments!(input),
    fetchBlob: runtime.fetchBlob ?? fetchSubjectEvidenceBlob,
  });

  let persisted = claim;
  let sourcePage = persistedSourcePage(claim);
  const sourceGaps = [...new Set([...(claim.sourceGaps ?? []), ...evidence.sourceGaps])];
  if (claim.status === "extracting") {
    let facts: SubjectAnalysisClaim["facts"] = [];
    let structuredData: Record<string, unknown> = {};
    let images: Parameters<SubjectAnalysisRepository["markSubjectExtractionComplete"]>[0]["images"] = [];
    if (claim.sourceUrl) {
      try {
        if (!runtime.archiveImage) throw new Error("subject_image_storage_not_configured");
        const extracted = await (runtime.extractPage ?? extractSubjectPage)({
          url: claim.sourceUrl,
          archiveImage: (image) => runtime.archiveImage!({
            ...image,
            analysisId: claim.id,
            workspaceId: claim.workspaceId,
            brandId: claim.brandId,
          }),
        });
        facts = extracted.facts;
        structuredData = extracted.structuredData;
        images = extracted.images;
        sourcePage = {
          sourceUrl: extracted.canonicalUrl,
          title: extracted.title,
          text: extracted.facts.find(({ key }) => key === "visible_text")?.value ?? extracted.description,
          structuredData: extracted.structuredData,
        };
      } catch (error) {
        const code = error instanceof Error ? error.message.split(":", 1)[0] : "subject_page_fetch_failed";
        const hasFallback = subject.attachmentIds.length > 0
          || Boolean(subject.manualInput.name.trim() || subject.manualInput.description.trim());
        if (!hasFallback) throw error;
        sourceGaps.push(`source_url: ${code}`);
      }
    }
    persisted = await repository.markSubjectExtractionComplete({
      analysisId: claim.id,
      workerId: claim.leasedBy,
      leaseToken: claim.leaseToken,
      facts,
      structuredData,
      images,
      sourceGaps,
    });
    sourcePage ??= persistedSourcePage(persisted);
  }

  return {
    ...leaseFields(claim),
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: claim.brandContext ?? {},
    subject,
    extracted: {
      documents: evidence.documents.map((document) => ({
        attachmentId: document.sourceId,
        fileName: document.title,
        mimeType: repositoryMimeType(document.sourceType),
        text: documentText(document),
      })),
      images: evidence.images.map((image) => ({
        attachmentId: image.id,
        sourceUrl: image.sourceUrl,
        storageUrl: image.storageUrl,
        mimeType: image.mimeType,
        altText: image.altText,
      })),
      sourcePage,
      sourceGaps,
    },
    sourcePriority: [...SOURCE_PRIORITY],
  };
}

function repositoryMimeType(sourceType: Awaited<ReturnType<typeof loadSubjectEvidence>>["documents"][number]["sourceType"]): string {
  const mimeTypes = {
    text: "text/plain",
    markdown: "text/markdown",
    pdf: "application/pdf",
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    owned_url: "text/html",
  } as const;
  return mimeTypes[sourceType];
}

export async function claimAndPrepareSubjectAnalysis(
  repository: ApiRepository & SubjectAnalysisRepository,
  input: { workerId: string; leaseSeconds: number; analysisId?: string },
  runtime: AiContentSubjectRuntime = {},
): Promise<SubjectWorkerJob | null> {
  const claim = await repository.claimSubjectAnalysis(input);
  if (!claim) return null;
  const identity = { analysisId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken };
  let stopPreparationHeartbeat: (() => Promise<void>) | null = null;
  try {
    if (claim.contractVersion === "subject-analysis.v2") {
      stopPreparationHeartbeat = await startPreparationLeaseHeartbeat(
        repository,
        claim,
        input.leaseSeconds,
        runtime.leaseHeartbeatIntervalMs,
      );
      const prepared = await prepareV2Job(repository, claim, runtime);
      await stopPreparationHeartbeat();
      stopPreparationHeartbeat = null;
      return prepared;
    }
    let persisted = claim;
    if (claim.status === "extracting") {
      if (!runtime.archiveImage) throw new Error("subject_image_storage_not_configured");
      const extracted = await (runtime.extractPage ?? extractSubjectPage)({
        url: claim.sourceUrl,
        archiveImage: (image) => runtime.archiveImage!({
          ...image,
          analysisId: claim.id,
          workspaceId: claim.workspaceId,
          brandId: claim.brandId,
        }),
      });
      persisted = await repository.markSubjectExtractionComplete({
        ...identity,
        facts: extracted.facts,
        structuredData: extracted.structuredData,
        images: extracted.images,
      });
    }
    const [profile, formats] = await Promise.all([
      repository.getBrandProfile(claim.brandId),
      repository.listInstagramFormats(claim.brandId),
    ]);
    return {
      analysisId: claim.id,
      workerId: claim.leasedBy,
      leaseToken: claim.leaseToken,
      leaseExpiresAt: claim.leaseExpiresAt,
      contractVersion: "subject-analysis.v1",
      brand: {
        name: profile.name,
        primaryCategory: profile.primaryCategory?.name ?? "",
        subcategories: profile.subcategories.map(({ name }) => name),
        brandColor: formats.brandColor ?? "",
      },
      subject: { type: claim.subjectType, sourceUrl: claim.sourceUrl, manualInput: claim.input },
      extracted: {
        facts: persisted.facts,
        structuredData: persisted.structuredData,
        imageCandidates: persisted.images.map((image) => ({
          id: image.id,
          sourceUrl: image.sourceUrl,
          storageUrl: image.storageUrl,
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          altText: image.altText,
          role: image.role,
        })),
      },
      researchPolicy: {
        publicWebSearch: true,
        allowedPurposes: ["voc", "alternatives", "market_context"],
        requireSourceUrl: true,
      },
    };
  } catch (error) {
    if (stopPreparationHeartbeat) {
      await stopPreparationHeartbeat().catch(() => undefined);
      stopPreparationHeartbeat = null;
    }
    const message = error instanceof Error ? error.message : "subject_analysis_extraction_failed";
    await repository.failSubjectAnalysis({
      ...identity,
      errorCode: message.slice(0, 120),
      errorMessage: message.slice(0, 2_000),
      retryable: true,
    });
    return null;
  }
}
