import { createHash } from "node:crypto";
import { extractBrandDocument } from "./brandDocumentExtractor.js";
import type { BrandAnalysisWorkerClaimInput, BrandEvidenceDocument } from "./brandIntelligenceContracts.js";
import type { BrandAnalysisClaim, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import { crawlSourceUrl } from "./sourceCrawler.js";

export interface BrandIntelligenceRuntime {
  crawlOwnedUrl?: typeof crawlSourceUrl;
  fetchUpload?: typeof fetch;
}

function verifiedBlobUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))) {
    throw new Error("brand_analysis_upload_origin_invalid");
  }
  return url;
}

async function readUpload(url: string, declaredBytes: number, fetchImpl: typeof fetch): Promise<Buffer> {
  const response = await fetchImpl(verifiedBlobUrl(url), { signal: AbortSignal.timeout(15_000) });
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
  const evidence: BrandEvidenceDocument[] = [];
  if (claim.input.ownedUrl) {
    const snapshot = await (runtime.crawlOwnedUrl ?? crawlSourceUrl)(claim.input.ownedUrl);
    evidence.push({
      sourceId: "owned-url", sourceType: "owned_url", title: snapshot.title ?? claim.input.ownedUrl,
      sourceUrl: snapshot.canonicalUrl ?? claim.input.ownedUrl,
      textBlocks: [{ heading: snapshot.title, text: snapshot.text }], tables: [],
      contentHash: snapshot.contentHash || createHash("sha256").update(snapshot.text).digest("hex"),
    });
  }
  const uploads = await repository.listBrandAnalysisUploads({ analysisId: claim.id });
  for (const upload of uploads) {
    const bytes = await readUpload(upload.storageUrl, upload.byteSize, runtime.fetchUpload ?? fetch);
    evidence.push(await extractBrandDocument({
      sourceId: upload.id, fileName: upload.fileName, mimeType: upload.mimeType,
      bytes, sourceUrl: upload.storageUrl,
    }));
  }
  if (!evidence.length) throw new Error("brand_analysis_source_required");
  return repository.markBrandEvidenceReady({
    analysisId: claim.id, workerId: claim.leasedBy, leaseToken: claim.leaseToken, evidence,
  });
}
