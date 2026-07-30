import { describe, expect, it } from "vitest";
import { buildBrandAnalysisUploadPath, validateBrandAnalysisFiles } from "./brandAnalysisUpload.js";

describe("brand analysis upload policy", () => {
  it("accepts the supported document formats", () => {
    expect(validateBrandAnalysisFiles([
      { fileName: "company.txt", mimeType: "text/plain", byteSize: 10 },
      { fileName: "company.md", mimeType: "text/markdown", byteSize: 10 },
      { fileName: "company.pdf", mimeType: "application/pdf", byteSize: 10 },
      { fileName: "company.csv", mimeType: "text/csv", byteSize: 10 },
      {
        fileName: "company.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        byteSize: 10,
      },
    ])).toHaveLength(5);
  });

  it("rejects unsupported, mismatched, oversized, and excessive files", () => {
    expect(() => validateBrandAnalysisFiles(Array.from({ length: 6 }, (_, index) => ({
      fileName: `company-${index}.txt`, mimeType: "text/plain", byteSize: 10,
    })))).toThrow("brand_analysis_upload_limit_exceeded");
    expect(() => validateBrandAnalysisFiles([
      { fileName: "company.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", byteSize: 10 },
    ])).toThrow("brand_analysis_file_type_unsupported");
    expect(() => validateBrandAnalysisFiles([
      { fileName: "company.pdf", mimeType: "text/plain", byteSize: 10 },
    ])).toThrow("brand_analysis_file_type_mismatch");
    expect(() => validateBrandAnalysisFiles([
      { fileName: "company.txt", mimeType: "text/plain", byteSize: 10 * 1024 * 1024 + 1 },
    ])).toThrow("brand_analysis_file_too_large");
  });

  it("builds a tenant-scoped sanitized storage path", () => {
    expect(buildBrandAnalysisUploadPath({
      brandId: "10000000-0000-4000-8000-000000000001",
      analysisId: "20000000-0000-4000-8000-000000000001",
      checksum: "a".repeat(64),
      fileName: "회사 소개 (최종).pdf",
    })).toBe(`brands/10000000-0000-4000-8000-000000000001/brand-analysis/20000000-0000-4000-8000-000000000001/uploads/${"a".repeat(64)}-_.pdf`);
  });
});
