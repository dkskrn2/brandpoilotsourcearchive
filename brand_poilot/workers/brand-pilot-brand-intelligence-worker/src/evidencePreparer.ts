import { createHash } from "node:crypto";
import { extractBrandDocument } from "./brandDocumentExtractor.js";
import type { BrandAnalysisJob, BrandEvidenceDocument } from "./contracts.js";
import { crawlImportantOwnedPages } from "./ownedSiteCrawler.js";

async function readUpload(
  upload: BrandAnalysisJob["uploads"][number],
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetch(upload.accessUrl, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("brand_analysis_upload_download_failed");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > upload.byteSize || declared > 10 * 1024 * 1024) {
    throw new Error("brand_analysis_file_too_large");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== upload.byteSize
    || createHash("sha256").update(bytes).digest("hex") !== upload.checksum.toLowerCase()) {
    throw new Error("brand_analysis_upload_checksum_mismatch");
  }
  return bytes;
}

export async function prepareBrandEvidence(
  job: BrandAnalysisJob,
  {
    signal,
    progress,
  }: {
    signal?: AbortSignal;
    progress?: (input: {
      stage: string;
      inputCount: number;
      successCount: number;
      failedCount: number;
      selectedPageCount?: number;
      successfulPageCount?: number;
      failedPageCount?: number;
      requiredPageCount?: number;
      status?: "running" | "succeeded" | "failed";
      errorCode?: string;
    }) => Promise<void>;
  } = {},
): Promise<BrandEvidenceDocument[]> {
  const evidence: BrandEvidenceDocument[] = [];
  if (job.input.ownedUrl) {
    let crawlState = { attemptedCount: 0, successfulCount: 0, requiredCount: 0 };
    await progress?.({
      stage: "crawling_pages",
      status: "running",
      inputCount: 0,
      successCount: 0,
      failedCount: 0,
      selectedPageCount: 0,
      successfulPageCount: 0,
      failedPageCount: 0,
      requiredPageCount: 0,
    });
    let crawl: Awaited<ReturnType<typeof crawlImportantOwnedPages>>;
    try {
      crawl = await crawlImportantOwnedPages(job.input.ownedUrl, {
        signal,
        onProgress: async (state) => {
          crawlState = state;
          await progress?.({
            stage: "crawling_pages",
            status: "running",
            inputCount: state.attemptedCount,
            successCount: state.successfulCount,
            failedCount: state.attemptedCount - state.successfulCount,
            selectedPageCount: state.attemptedCount,
            successfulPageCount: state.successfulCount,
            failedPageCount: state.attemptedCount - state.successfulCount,
            requiredPageCount: state.requiredCount,
          });
        },
      });
    } catch (error) {
      await progress?.({
        stage: "crawling_pages",
        status: "failed",
        inputCount: crawlState.attemptedCount,
        successCount: crawlState.successfulCount,
        failedCount: crawlState.attemptedCount - crawlState.successfulCount,
        selectedPageCount: crawlState.attemptedCount,
        successfulPageCount: crawlState.successfulCount,
        failedPageCount: crawlState.attemptedCount - crawlState.successfulCount,
        requiredPageCount: crawlState.requiredCount,
        errorCode: error instanceof Error
          ? error.message.split(":")[0]!.replace(/[^a-z0-9_]/g, "_").slice(0, 120)
          : "brand_analysis_crawl_failed",
      });
      throw error;
    }
    await progress?.({
      stage: "crawling_pages",
      status: "succeeded",
      inputCount: crawl.attemptedCount,
      successCount: crawl.successfulCount,
      failedCount: crawl.attemptedCount - crawl.successfulCount,
      selectedPageCount: crawl.attemptedCount,
      successfulPageCount: crawl.successfulCount,
      failedPageCount: crawl.attemptedCount - crawl.successfulCount,
      requiredPageCount: crawl.requiredCount,
    });
    for (const [index, page] of crawl.pages.entries()) {
      evidence.push({
        sourceId: `owned-page-${index + 1}`,
        sourceType: "owned_url",
        title: page.title ?? page.sourceUrl,
        sourceUrl: page.sourceUrl,
        textBlocks: [{ heading: page.title, text: page.text }],
        tables: [],
        contentHash: page.contentHash,
      });
    }
  }
  let uploaded = 0;
  if (job.uploads.length) {
    await progress?.({
      stage: "extracting_documents",
      status: "running",
      inputCount: job.uploads.length,
      successCount: 0,
      failedCount: 0,
    });
    try {
      for (const upload of job.uploads) {
        if (signal?.aborted) throw signal.reason ?? new Error("brand_analysis_cancelled");
        const bytes = await readUpload(upload, signal);
        evidence.push(await extractBrandDocument({
          sourceId: `upload-${upload.id}`,
          fileName: upload.fileName,
          mimeType: upload.mimeType,
          bytes,
          sourceUrl: null,
        }));
        uploaded += 1;
        await progress?.({
          stage: "extracting_documents",
          status: "running",
          inputCount: job.uploads.length,
          successCount: uploaded,
          failedCount: 0,
        });
      }
    } catch (error) {
      await progress?.({
        stage: "extracting_documents",
        status: "failed",
        inputCount: job.uploads.length,
        successCount: uploaded,
        failedCount: 1,
        errorCode: error instanceof Error
          ? error.message.split(":")[0]!.replace(/[^a-z0-9_]/g, "_").slice(0, 120)
          : "brand_analysis_document_extraction_failed",
      });
      throw error;
    }
    await progress?.({
      stage: "extracting_documents",
      status: "succeeded",
      inputCount: job.uploads.length,
      successCount: uploaded,
      failedCount: 0,
    });
  }
  if (!evidence.length) throw new Error("brand_analysis_source_required");
  return evidence;
}
