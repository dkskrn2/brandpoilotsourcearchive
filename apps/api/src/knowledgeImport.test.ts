import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseKnowledgeUpload } from "./knowledgeImport.js";

describe("parseKnowledgeUpload", () => {
  it("parses FAQ fields and retains invalid rows without rejecting the upload", async () => {
    const result = await parseKnowledgeUpload({
      entryType: "faq",
      fileName: "faq.csv",
      bytes: Buffer.from([
        "question,answer,category,keywords,aliases,priority,direct_reply_enabled",
        " 운영   시간 ,09-18,안내,운영;시간,business hours|영업 시간,3,false",
        ",답변,안내,,,,",
      ].join("\n")),
    });

    expect(result.entryType).toBe("faq");
    expect(result.validRows).toEqual([expect.objectContaining({
      entryType: "faq",
      normalizedKey: "운영 시간",
      question: "운영 시간",
      answer: "09-18",
      title: "운영 시간",
      content: "09-18",
      category: "안내",
      keywords: ["운영", "시간"],
      aliases: ["business hours", "영업 시간"],
      priority: 3,
      directReplyEnabled: false,
      structuredData: {},
    })]);
    expect(result.invalidRows).toEqual([expect.objectContaining({ errors: ["question_required"] })]);
  });

  it("parses product CSV rows into normalized keys and structured data", async () => {
    const result = await parseKnowledgeUpload({
      entryType: "product",
      fileName: "products.csv",
      bytes: Buffer.from([
        "name,description,price,currency,product_url,sku,keywords,aliases,priority",
        " Signature Mug ,\"Stoneware, 350ml\",29000,KRW,https://example.com/mug,MUG-1,mug;cup,머그|잔,7",
      ].join("\n")),
    });

    expect(result.validRows).toEqual([expect.objectContaining({
      entryType: "product",
      normalizedKey: "product:signature mug",
      title: "Signature Mug",
      content: "Stoneware, 350ml",
      question: null,
      answer: null,
      aliases: ["머그", "잔"],
      keywords: ["mug", "cup"],
      priority: 7,
      directReplyEnabled: false,
      structuredData: {
        price: "29000",
        currency: "KRW",
        productUrl: "https://example.com/mug",
        sku: "MUG-1",
      },
    })]);
  });

  it("reads product rows from the first XLSX worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Products");
    sheet.addRow(["name", "description", "currency"]);
    sheet.addRow(["Canvas Bag", "Heavy cotton tote", "KRW"]);

    const result = await parseKnowledgeUpload({
      entryType: "product",
      fileName: "products.xlsx",
      bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
    });

    expect(result.validRows).toEqual([expect.objectContaining({
      normalizedKey: "product:canvas bag",
      title: "Canvas Bag",
      content: "Heavy cotton tote",
      structuredData: { currency: "KRW" },
    })]);
  });

  it.each([
    { entryType: "faq" as const, csv: "title,body\nQuestion,Answer" },
    { entryType: "product" as const, csv: "name,body\nMug,Description" },
    { entryType: "faq" as const, csv: "question,answer\n\"unterminated,Answer" },
  ])("rejects malformed $entryType files and missing required headers", async ({ entryType, csv }) => {
    await expect(parseKnowledgeUpload({
      entryType,
      fileName: `${entryType}.csv`,
      bytes: Buffer.from(csv),
    })).rejects.toThrow("knowledge_upload_invalid_file");
  });
});
