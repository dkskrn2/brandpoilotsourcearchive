import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseFaqUpload } from "./faqImport.js";

describe("parseFaqUpload", () => {
  it("normalizes duplicate questions and retains the final valid row", async () => {
    const result = await parseFaqUpload({
      fileName: "faq.csv",
      bytes: Buffer.from("question,answer\n 운영 시간 ,09-18\n운영   시간,10-19\n"),
    });

    expect(result.validRows).toHaveLength(2);
    expect(result.rows.at(-1)).toMatchObject({
      normalizedQuestion: "운영 시간",
      question: "운영 시간",
      answer: "10-19",
    });
  });

  it("retains invalid rows without rejecting a valid file", async () => {
    const result = await parseFaqUpload({
      fileName: "faq.csv",
      bytes: Buffer.from("question,answer\n,답변\n환불,\n"),
    });

    expect(result.invalidRows).toHaveLength(2);
    expect(result.rows.map((row) => row.errors)).toEqual([
      ["question_required"],
      ["answer_required"],
    ]);
  });

  it("reads the first worksheet from an xlsx file", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("FAQ");
    sheet.addRow(["question", "answer", "priority"]);
    sheet.addRow(["배송 기간", "영업일 기준 2-3일", 3]);

    const result = await parseFaqUpload({
      fileName: "faq.xlsx",
      bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
    });

    expect(result.validRows).toEqual([expect.objectContaining({
      question: "배송 기간",
      priority: 3,
    })]);
  });

  it("rejects files without the required question and answer headers", async () => {
    await expect(parseFaqUpload({
      fileName: "faq.csv",
      bytes: Buffer.from("title,body\n질문,답변\n"),
    })).rejects.toThrow("faq_upload_invalid_file");
  });
});
