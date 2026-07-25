import { extname } from "node:path";
import { head, type HeadBlobResult } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

export interface BrandAnalysisFileDescriptor {
  fileName: string;
  mimeType: string;
  byteSize: number;
}

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const supported = new Map<string, readonly string[]>([
  [".txt", ["text/plain"]],
  [".md", ["text/markdown", "text/plain"]],
  [".markdown", ["text/markdown", "text/plain"]],
  [".pdf", ["application/pdf"]],
  [".csv", ["text/csv", "application/csv", "application/vnd.ms-excel"]],
  [".xlsx", ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
]);

export function validateBrandAnalysisFiles(
  files: BrandAnalysisFileDescriptor[],
): BrandAnalysisFileDescriptor[] {
  if (files.length > MAX_FILES) throw new Error("brand_analysis_upload_limit_exceeded");
  return files.map((file) => {
    const extension = extname(file.fileName).toLowerCase();
    const mimeTypes = supported.get(extension);
    if (!mimeTypes) throw new Error("brand_analysis_file_type_unsupported");
    if (!mimeTypes.includes(file.mimeType.toLowerCase())) {
      throw new Error("brand_analysis_file_type_mismatch");
    }
    if (!Number.isSafeInteger(file.byteSize) || file.byteSize <= 0 || file.byteSize > MAX_FILE_BYTES) {
      throw new Error("brand_analysis_file_too_large");
    }
    return { ...file, fileName: file.fileName.trim(), mimeType: file.mimeType.toLowerCase() };
  });
}

export function buildBrandAnalysisUploadPath(input: {
  brandId: string;
  analysisId: string;
  checksum: string;
  fileName: string;
}): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.brandId) || !uuid.test(input.analysisId)) {
    throw new Error("brand_analysis_upload_path_invalid");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.checksum)) throw new Error("brand_analysis_checksum_invalid");
  const extension = extname(input.fileName).toLowerCase();
  const baseName = input.fileName.slice(0, Math.max(0, input.fileName.length - extension.length));
  const safeName = baseName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "_";
  return `brands/${input.brandId}/brand-analysis/${input.analysisId}/uploads/${input.checksum.toLowerCase()}-${safeName}${extension}`;
}

export interface BrandAnalysisUploadPolicy extends BrandAnalysisFileDescriptor { checksum: string }
export interface BrandAnalysisUploadTokenOptions {
  token: string;
  generateClientToken?: typeof generateClientTokenFromReadWriteToken;
}

export async function issueBrandAnalysisUploadToken(input: {
  brandId: string;
  uploadSessionId: string;
  file: BrandAnalysisUploadPolicy;
}, options: BrandAnalysisUploadTokenOptions) {
  if (!options.token.trim()) throw new Error("brand_analysis_storage_not_configured");
  const [file] = validateBrandAnalysisFiles([input.file]);
  if (!/^[a-f0-9]{64}$/i.test(input.file.checksum)) throw new Error("brand_analysis_checksum_invalid");
  const pathname = buildBrandAnalysisUploadPath({
    brandId: input.brandId,
    analysisId: input.uploadSessionId,
    checksum: input.file.checksum,
    fileName: file!.fileName,
  });
  const generate = options.generateClientToken ?? generateClientTokenFromReadWriteToken;
  return {
    pathname,
    clientToken: await generate({
      token: options.token,
      pathname,
      allowedContentTypes: [file!.mimeType],
      maximumSizeInBytes: file!.byteSize,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: Date.now() + 10 * 60 * 1000,
    }),
  };
}

export async function verifyBrandAnalysisUpload(input: {
  brandId: string;
  uploadSessionId: string;
  file: BrandAnalysisUploadPolicy;
  storagePath: string;
  storageUrl: string;
}, options: { token: string; headBlob?: typeof head }) {
  if (!options.token.trim()) throw new Error("brand_analysis_storage_not_configured");
  const [file] = validateBrandAnalysisFiles([input.file]);
  const expectedPath = buildBrandAnalysisUploadPath({
    brandId: input.brandId,
    analysisId: input.uploadSessionId,
    checksum: input.file.checksum,
    fileName: file!.fileName,
  });
  if (input.storagePath !== expectedPath) throw new Error("brand_analysis_upload_path_mismatch");
  let url: URL;
  try { url = new URL(input.storageUrl); }
  catch { throw new Error("brand_analysis_upload_url_mismatch"); }
  const decodedPath = decodeURIComponent(url.pathname).replace(/^\//, "");
  if (url.protocol !== "https:"
    || !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))
    || decodedPath !== expectedPath) throw new Error("brand_analysis_upload_url_mismatch");
  let metadata: HeadBlobResult;
  try { metadata = await (options.headBlob ?? head)(input.storageUrl, { token: options.token }); }
  catch { throw new Error("brand_analysis_upload_blob_unavailable"); }
  if (metadata.pathname !== expectedPath || metadata.size !== file!.byteSize
    || metadata.contentType.toLowerCase() !== file!.mimeType) {
    throw new Error("brand_analysis_upload_metadata_mismatch");
  }
  return { ...file!, checksum: input.file.checksum.toLowerCase(), storagePath: expectedPath, storageUrl: input.storageUrl };
}
