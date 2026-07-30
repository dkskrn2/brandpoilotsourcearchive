import { createHash } from "node:crypto";
import { extractBrandDocument } from "./brandDocumentExtractor.js";
import { crawlImportantOwnedPages } from "./brandOwnedSiteCrawler.js";
import type { BrandAnalysisWorkerClaimInput, BrandEvidenceDocument } from "./brandIntelligenceContracts.js";
import type { BrandAnalysisClaim, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import { crawlSourceUrl } from "./sourceCrawler.js";

export interface BrandIntelligenceRuntime {
  crawlOwnedUrl?: typeof crawlSourceUrl;
  fetchUpload?: typeof fetch;
}

const activePreparations = new Map<string, AbortController>();

export function abortBrandAnalysisPreparation(analysisId: string) {
  activePreparations.get(analysisId)?.abort(new Error("brand_analysis_cancelled"));
}

function verifiedBlobUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))) {
    throw new Error("brand_analysis_upload_origin_invalid");
  }
  return url;
}

async function readUpload(
  url: string,
  declaredBytes: number,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetchImpl(verifiedBlobUrl(url), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error("brand_analysis_upload_download_failed");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > declaredBytes || contentLength > 10 * 1024 * 1024) {
    throw new Error("brand_analysis_file_too_large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== declaredBytes || bytes.length > 10 * 1024 * 1024) {
    throw new Error("brand_analysis_upload_size_mismatch");
  }
  return bytes;
}

export async function claimAndPrepareBrandAnalysis(
  repository: BrandIntelligenceRepository,
  input: BrandAnalysisWorkerClaimInput,
  runtime: BrandIntelligenceRuntime = {},
): Promise<BrandAnalysisClaim | null> {
  const claim = await repository.claimBrandAnalysis(input);
  if (!claim || claim.status === "analyzing") return claim;
  const controller = new AbortController();
  const deadlineMs = claim.deadlineAt
    ? new Date(claim.deadlineAt).getTime() - Date.now()
    : 20 * 60 * 1_000;
  const deadline = setTimeout(() => {
    controller.abort(new Error("analysis_deadline_exceeded"));
  }, Math.max(0, deadlineMs));
  activePreparations.set(claim.id, controller);
  const evidence: BrandEvidenceDocument[] = [];
  try {
    const assertPreparationActive = async () => {
      const current = await repository.getBrandAnalysis({
        analysisId: claim.id,
        workspaceId: claim.workspaceId,
        brandId: claim.brandId,
      });
      if (!current
        || current.status !== "extracting"
        || current.leasedBy !== claim.leasedBy
        || current.leaseToken !== claim.leaseToken
        || (current.deadlineAt && new Date(current.deadlineAt).getTime() <= Date.now())) {
        controller.abort(new Error("brand_analysis_cancelled"));
        throw controller.signal.reason;
      }
    };
    if (claim.input.ownedUrl) {
      const crawl = await crawlImportantOwnedPages(claim.input.ownedUrl, {
        crawlPage: runtime.crawlOwnedUrl
          ? async (url) => {
              await assertPreparationActive();
              return runtime.crawlOwnedUrl!(url);
            }
          : async (url, signal) => {
              await assertPreparationActive();
              return crawlSourceUrl(url, { signal, timeoutMs: 8_000 });
            },
        signal: controller.signal,
      });
      for (const [index, snapshot] of crawl.pages.entries()) {
      evidence.push({
        sourceId: index === 0 ? "owned-url" : `owned-url-${index + 1}`,
        sourceType: "owned_url",
        title: snapshot.title ?? snapshot.sourceUrl,
        sourceUrl: snapshot.sourceUrl,
        textBlocks: [{ heading: snapshot.title, text: snapshot.text }],
        tables: [],
        contentHash: snapshot.contentHash
          || createHash("sha256").update(snapshot.text).digest("hex"),
      });
      }
    }
    const uploads = await repository.listBrandAnalysisUploads({ analysisId: claim.id });
    for (const upload of uploads) {
      await assertPreparationActive();
      if (controller.signal.aborted) throw controller.signal.reason;
      const bytes = await readUpload(
        upload.storageUrl,
        upload.byteSize,
        runtime.fetchUpload ?? fetch,
        controller.signal,
      );
      evidence.push(await extractBrandDocument({
        sourceId: upload.id, fileName: upload.fileName, mimeType: upload.mimeType,
        bytes, sourceUrl: upload.storageUrl,
      }));
    }
    if (!evidence.length) throw new Error("brand_analysis_source_required");
    return repository.markBrandEvidenceReady({
      analysisId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken, evidence,
    });
  } finally {
    clearTimeout(deadline);
    activePreparations.delete(claim.id);
  }
}
