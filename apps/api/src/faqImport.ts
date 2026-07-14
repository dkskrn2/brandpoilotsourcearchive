import ExcelJS from "exceljs";

const maxFaqUploadBytes = 1024 * 1024;
const requiredHeaders = ["question", "answer"];

export interface ParsedFaqRow {
  rowNumber: number;
  question: string;
  normalizedQuestion: string;
  answer: string;
  category: string | null;
  keywords: string[];
  priority: number;
  enabled: boolean;
  errors: string[];
}

export interface ParsedFaqUpload {
  rows: ParsedFaqRow[];
  validRows: ParsedFaqRow[];
  invalidRows: ParsedFaqRow[];
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

export function normalizeFaqQuestion(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

function parseBoolean(value: string) {
  return !["false", "0", "n", "no", "off"].includes(value.trim().toLowerCase());
}

function parseRow(rowNumber: number, values: Record<string, unknown>): ParsedFaqRow {
  const question = String(values.question ?? "").trim();
  const answer = String(values.answer ?? "").trim();
  const category = String(values.category ?? "").trim() || null;
  const keywordText = String(values.keywords ?? "").trim();
  const priorityValue = Number.parseInt(String(values.priority ?? "0"), 10);
  const enabledValue = values.enabled;
  const errors = [
    ...(question ? [] : ["question_required"]),
    ...(answer ? [] : ["answer_required"]),
  ];

  return {
    rowNumber,
    question: normalizeFaqQuestion(question),
    normalizedQuestion: normalizeFaqQuestion(question).toLowerCase(),
    answer,
    category,
    keywords: keywordText.split(/[,;|]/).map((keyword) => keyword.trim()).filter(Boolean),
    priority: Number.isFinite(priorityValue) ? priorityValue : 0,
    enabled: enabledValue === undefined || enabledValue === null || enabledValue === "" ? true : parseBoolean(String(enabledValue)),
    errors,
  };
}

function assertHeaders(headers: string[]) {
  if (!requiredHeaders.every((header) => headers.includes(header))) {
    throw new Error("faq_upload_invalid_file");
  }
}

function parseCsv(bytes: Buffer) {
  const lines = bytes.toString("utf8").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("faq_upload_invalid_file");
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  assertHeaders(headers);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return parseRow(index + 2, Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])));
  });
}

async function parseXlsx(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount < 2) throw new Error("faq_upload_invalid_file");
  const firstRowValues = worksheet.getRow(1).values;
  const headerValues = Array.isArray(firstRowValues)
    ? firstRowValues.slice(1) as unknown[]
    : [];
  const headers = headerValues.map(normalizeHeader);
  assertHeaders(headers);
  const rows: ParsedFaqRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = Array.isArray(row.values) ? row.values.slice(1) as unknown[] : [];
    if (cells.every((cell: unknown) => String(cell ?? "").trim() === "")) return;
    rows.push(parseRow(rowNumber, Object.fromEntries(headers.map((header: string, cellIndex: number) => [header, cells[cellIndex] ?? ""]))));
  });
  if (rows.length === 0) throw new Error("faq_upload_invalid_file");
  return rows;
}

export async function parseFaqUpload(input: { fileName: string; bytes: Buffer }): Promise<ParsedFaqUpload> {
  if (!input.fileName || input.bytes.length === 0 || input.bytes.length > maxFaqUploadBytes) {
    throw new Error("faq_upload_invalid_file");
  }
  const fileName = input.fileName.trim().toLowerCase();
  const rows = fileName.endsWith(".csv")
    ? parseCsv(input.bytes)
    : fileName.endsWith(".xlsx")
      ? await parseXlsx(input.bytes)
      : (() => { throw new Error("faq_upload_invalid_file"); })();
  return {
    rows,
    validRows: rows.filter((row) => row.errors.length === 0),
    invalidRows: rows.filter((row) => row.errors.length > 0),
  };
}
