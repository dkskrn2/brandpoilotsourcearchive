import { createHash } from "node:crypto";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import type { BrandEvidenceDocument, BrandEvidenceSourceType } from "./brandIntelligenceContracts.js";

export interface BrandDocumentInput {
  sourceId: string;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  sourceUrl?: string | null;
}

export interface BrandDocumentExtractorDependencies {
  extractPdfText?: (bytes: Buffer) => Promise<string>;
}

const MAX_NORMALIZED_CHARACTERS = 200_000;
const MAX_ROWS = 500;
const MAX_CELLS = 100;

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("brand_document_utf8_invalid");
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function assertCharacterBudget(value: string): void {
  if (value.length > MAX_NORMALIZED_CHARACTERS) {
    throw new Error("brand_document_content_limit_exceeded");
  }
}

function parseDelimitedCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const finishField = () => { row.push(field.trim()); field = ""; };
  const finishRow = () => {
    finishField();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') {
      if (field.trim()) throw new Error("brand_document_csv_invalid");
      quoted = true;
    } else if (character === ",") finishField();
    else if (character === "\n") finishRow();
    else field += character;
  }
  if (quoted) throw new Error("brand_document_csv_invalid");
  if (field || row.length) finishRow();
  if (rows.length === 0) throw new Error("brand_document_empty");
  if (rows.length > MAX_ROWS + 1 || rows.some((cells) => cells.length > MAX_CELLS)) {
    throw new Error("brand_document_table_limit_exceeded");
  }
  return rows;
}

function parseMarkdown(text: string): Array<{ heading: string | null; text: string }> {
  const blocks: Array<{ heading: string | null; text: string }> = [];
  let heading: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) blocks.push({ heading, text: body });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (match) { flush(); heading = match[1]!.trim(); }
    else lines.push(line);
  }
  flush();
  return blocks.length ? blocks : [{ heading: null, text }];
}

function excelCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map(({ text }) => text).join("");
    }
  }
  return String(value);
}

async function parseXlsx(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const tables: BrandEvidenceDocument["tables"] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values;
      const values = (Array.isArray(cells) ? cells.slice(1) : [])
        .map((value) => excelCellText(value as ExcelJS.CellValue).trim());
      if (values.some(Boolean)) rows.push(values);
    });
    if (!rows.length) return;
    if (rows.length > MAX_ROWS + 1 || rows.some((cells) => cells.length > MAX_CELLS)) {
      throw new Error("brand_document_table_limit_exceeded");
    }
    tables.push({ sheet: sheet.name, headers: rows[0] ?? [], rows: rows.slice(1) });
  });
  if (!tables.length) throw new Error("brand_document_empty");
  return tables;
}

async function defaultPdfText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try { return (await parser.getText()).text; }
  finally { await parser.destroy(); }
}

function inferSourceType(fileName: string): BrandEvidenceSourceType {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".txt") return "text";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".pdf") return "pdf";
  if (extension === ".csv") return "csv";
  if (extension === ".xlsx") return "xlsx";
  throw new Error("brand_analysis_file_type_unsupported");
}

export async function extractBrandDocument(
  input: BrandDocumentInput,
  dependencies: BrandDocumentExtractorDependencies = {},
): Promise<BrandEvidenceDocument> {
  const sourceType = inferSourceType(input.fileName);
  let textBlocks: BrandEvidenceDocument["textBlocks"] = [];
  let tables: BrandEvidenceDocument["tables"] = [];

  if (sourceType === "xlsx") {
    tables = await parseXlsx(input.bytes);
  } else if (sourceType === "csv") {
    const rows = parseDelimitedCsv(decodeUtf8(input.bytes));
    tables = [{ sheet: null, headers: rows[0] ?? [], rows: rows.slice(1) }];
  } else {
    const rawText = sourceType === "pdf"
      ? await (dependencies.extractPdfText ?? defaultPdfText)(input.bytes)
      : decodeUtf8(input.bytes);
    const normalized = normalizeText(rawText);
    if (sourceType === "pdf" && normalized.replace(/\s/g, "").length < 30) {
      throw new Error("scanned_pdf_not_supported");
    }
    if (!normalized) throw new Error("brand_document_empty");
    assertCharacterBudget(normalized);
    textBlocks = sourceType === "markdown"
      ? parseMarkdown(normalized)
      : [{ heading: null, text: normalized }];
  }

  const normalizedCharacters = textBlocks.reduce((sum, block) => sum + block.text.length, 0)
    + tables.reduce((sum, table) => sum + table.headers.join("").length
      + table.rows.flat().join("").length, 0);
  if (normalizedCharacters > MAX_NORMALIZED_CHARACTERS) {
    throw new Error("brand_document_content_limit_exceeded");
  }
  return {
    sourceId: input.sourceId,
    sourceType,
    title: input.fileName,
    sourceUrl: input.sourceUrl ?? null,
    textBlocks,
    tables,
    contentHash: createHash("sha256").update(input.bytes).digest("hex"),
  };
}
