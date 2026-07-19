import { extractSubjectPage, type ExtractSubjectPageInput, type SubjectImageArchiveInput } from "./aiContentSubjectExtractor.js";
import type { SubjectAnalysisInputV1 } from "./aiContentSubjectContracts.js";
import type { ApiRepository } from "./types.js";
import type { SubjectAnalysisRepository } from "./aiContentSubjectRepository.js";

export interface AiContentSubjectRuntime {
  extractPage?: typeof extractSubjectPage;
  archiveImage?: (
    image: SubjectImageArchiveInput & { analysisId: string; workspaceId: string; brandId: string },
  ) => ReturnType<ExtractSubjectPageInput["archiveImage"]>;
}

export async function claimAndPrepareSubjectAnalysis(
  repository: ApiRepository & SubjectAnalysisRepository,
  input: { workerId: string; leaseSeconds: number },
  runtime: AiContentSubjectRuntime = {},
): Promise<SubjectAnalysisInputV1 | null> {
  const claim = await repository.claimSubjectAnalysis(input);
  if (!claim) return null;
  const identity = { analysisId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken };
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
    const persisted = await repository.markSubjectExtractionComplete({
      ...identity,
      facts: extracted.facts,
      structuredData: extracted.structuredData,
      images: extracted.images,
    });
    const [profile, formats] = await Promise.all([
      repository.getBrandProfile(claim.brandId),
      repository.listInstagramFormats(claim.brandId),
    ]);
    return {
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
