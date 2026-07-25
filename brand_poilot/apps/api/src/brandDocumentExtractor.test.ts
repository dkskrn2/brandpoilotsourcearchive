import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { extractBrandDocument } from "./brandDocumentExtractor.js";

describe("brand document extraction", () => {
  it("extracts markdown headings into editable evidence blocks", async () => {
    const result = await extractBrandDocument({
      sourceId: "upload-1",
      fileName: "company.md",
      mimeType: "text/markdown",
      bytes: Buffer.from("# 회사 개요\n브랜드를 운영합니다.\n\n## 차별점\n근거를 재사용합니다."),
    });
    expect(result.sourceType).toBe("markdown");
    expect(result.textBlocks).toEqual([
      { heading: "회사 개요", text: "브랜드를 운영합니다." },
      { heading: "차별점", text: "근거를 재사용합니다." },
    ]);
  });

  it("parses quoted CSV fields without losing commas", async () => {
    const result = await extractBrandDocument({
      sourceId: "upload-2",
      fileName: "products.csv",
      mimeType: "text/csv",
      bytes: Buffer.from('name,description\n"콘텐츠 운영","기획, 제작, 게시"'),
    });
    expect(result.tables[0]).toMatchObject({
      headers: ["name", "description"],
      rows: [["콘텐츠 운영", "기획, 제작, 게시"]],
    });
  });

  it("extracts every non-empty XLSX worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("회사").addRows([["항목", "내용"], ["소개", "브랜드 운영"]]);
    workbook.addWorksheet("제품").addRows([["이름", "설명"], ["모종애드", "통합 마케팅"]]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const result = await extractBrandDocument({
      sourceId: "upload-3",
      fileName: "company.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    });
    expect(result.tables.map(({ sheet }) => sheet)).toEqual(["회사", "제품"]);
  });

  it("accepts text PDFs and rejects scanned PDFs", async () => {
    const accepted = await extractBrandDocument({
      sourceId: "upload-4",
      fileName: "company.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-test"),
    }, { extractPdfText: async () => "기업 소개와 사업 내용, 핵심 고객과 차별점이 충분히 포함된 정상 텍스트 문서입니다." });
    expect(accepted.textBlocks[0]?.text).toContain("기업 소개");

    await expect(extractBrandDocument({
      sourceId: "upload-5",
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-scan"),
    }, { extractPdfText: async () => " " })).rejects.toThrow("scanned_pdf_not_supported");
  });

  it("rejects invalid UTF-8 and normalized content over budget", async () => {
    await expect(extractBrandDocument({
      sourceId: "upload-6",
      fileName: "bad.txt",
      mimeType: "text/plain",
      bytes: Buffer.from([0xff, 0xfe]),
    })).rejects.toThrow("brand_document_utf8_invalid");

    await expect(extractBrandDocument({
      sourceId: "upload-7",
      fileName: "large.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("x".repeat(200_001)),
    })).rejects.toThrow("brand_document_content_limit_exceeded");
  });
});
