import ExcelJS from "exceljs";

const maxKnowledgeUploadBytes = 1024 * 1024;
const requiredHeaders = {
  faq: ["question", "answer"],
  product: ["name", "description"],
} as const;

export type KnowledgeEntryType = keyof typeof requiredHeaders;

export interface ParsedKnowledgeRow {
  rowNumber: number;
  entryType: KnowledgeEntryType;
  normalizedKey: string;
  question: string | null;
  answer: string | null;
  title: string;
  content: string;
  category: string | null;
  keywords: string[];
  aliases: string[];
  priority: number;
  directReplyEnabled: boolean;
  structuredData: Record<string, string>;
  errors: string[];
}

export interface ParsedKnowledgeUpload {
  entryType: KnowledgeEntryType;
  rows: ParsedKnowledgeRow[];
  validRows: ParsedKnowledgeRow[];
  invalidRows: ParsedKnowledgeRow[];
}

function invalidFile(): never {
  throw new Error("knowledge_upload_invalid_file");
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim().toLowerCase();
}

export function normalizeKnowledgeText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function splitList(value: unknown) {
  return String(value ?? "")
    .split(/[,;|]/)
    .map((item) => normalizeKnowledgeText(item))
    .filter(Boolean);
}

function readOptional(values: Record<string, unknown>, key: string) {
  return normalizeKnowledgeText(String(values[key] ?? ""));
}

function parsePriority(value: unknown, errors: string[]) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^-?\d+$/.test(text)) {
    errors.push("priority_invalid");
    return 0;
  }
  return Number.parseInt(text, 10);
}

function parseDirectReplyEnabled(value: unknown, errors: string[]) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return true;
  if (["true", "1", "y", "yes", "on"].includes(text)) return true;
  if (["false", "0", "n", "no", "off"].includes(text)) return false;
  errors.push("direct_reply_enabled_invalid");
  return true;
}

function compactObject(entries: Array<[string, string]>) {
  return Object.fromEntries(entries.filter(([, value]) => value.length > 0));
}

function parseRow(
  entryType: KnowledgeEntryType,
  rowNumber: number,
  values: Record<string, unknown>,
): ParsedKnowledgeRow {
  const errors: string[] = [];
  const priority = parsePriority(values.priority, errors);
  const keywords = splitList(values.keywords);
  const aliases = splitList(values.aliases);

  if (entryType === "faq") {
    const question = normalizeKnowledgeText(String(values.question ?? ""));
    const answer = normalizeKnowledgeText(String(values.answer ?? ""));
    if (!question) errors.unshift("question_required");
    if (!answer) errors.push("answer_required");
    return {
      rowNumber,
      entryType,
      normalizedKey: question.toLowerCase(),
      question,
      answer,
      title: question,
      content: answer,
      category: readOptional(values, "category") || null,
      keywords,
      aliases,
      priority,
      directReplyEnabled: parseDirectReplyEnabled(values.direct_reply_enabled, errors),
      structuredData: {},
      errors,
    };
  }

  const title = normalizeKnowledgeText(String(values.name ?? ""));
  const content = normalizeKnowledgeText(String(values.description ?? ""));
  if (!title) errors.unshift("name_required");
  if (!content) errors.push("description_required");
  return {
    rowNumber,
    entryType,
    normalizedKey: `product:${title.toLowerCase()}`,
    question: null,
    answer: null,
    title,
    content,
    category: null,
    keywords,
    aliases,
    priority,
    directReplyEnabled: false,
    structuredData: compactObject([
      ["price", readOptional(values, "price")],
      ["currency", readOptional(values, "currency")],
      ["productUrl", readOptional(values, "product_url")],
      ["sku", readOptional(values, "sku")],
    ]),
    errors,
  };
}

function parseCsvTable(bytes: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalidFile();
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const finishField = () => {
    row.push(field.trim());
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.trim().length > 0) return invalidFile();
      field = "";
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      field += character;
    }
  }

  if (quoted) return invalidFile();
  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}

function assertHeaders(entryType: KnowledgeEntryType, headers: string[]) {
  if (
    headers.some((header, index) => !header || headers.indexOf(header) !== index) ||
    !requiredHeaders[entryType].every((header) => headers.includes(header))
  ) {
    invalidFile();
  }
}

function rowsFromTable(entryType: KnowledgeEntryType, table: unknown[][]) {
  if (table.length < 2) return invalidFile();
  const headers = table[0].map(normalizeHeader);
  assertHeaders(entryType, headers);
  const rows = table.slice(1).map((cells, index) => {
    if (cells.length > headers.length) return invalidFile();
    return parseRow(
      entryType,
      index + 2,
      Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""])),
    );
  });
  if (rows.length === 0) return invalidFile();
  return rows;
}

function parseCsv(entryType: KnowledgeEntryType, bytes: Buffer) {
  return rowsFromTable(entryType, parseCsvTable(bytes));
}

async function parseXlsx(entryType: KnowledgeEntryType, bytes: Buffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return invalidFile();
    const table: unknown[][] = [];
    worksheet.eachRow((row) => {
      const cells = Array.isArray(row.values) ? row.values.slice(1) as unknown[] : [];
      if (cells.some((cell) => String(cell ?? "").trim().length > 0)) table.push(cells);
    });
    return rowsFromTable(entryType, table);
  } catch (error) {
    if (error instanceof Error && error.message === "knowledge_upload_invalid_file") throw error;
    return invalidFile();
  }
}

export async function parseKnowledgeUpload(input: {
  entryType: KnowledgeEntryType;
  fileName: string;
  bytes: Buffer;
}): Promise<ParsedKnowledgeUpload> {
  if (
    !requiredHeaders[input.entryType] ||
    !input.fileName ||
    input.bytes.length === 0 ||
    input.bytes.length > maxKnowledgeUploadBytes
  ) {
    return invalidFile();
  }

  const fileName = input.fileName.trim().toLowerCase();
  const rows = fileName.endsWith(".csv")
    ? parseCsv(input.entryType, input.bytes)
    : fileName.endsWith(".xlsx")
      ? await parseXlsx(input.entryType, input.bytes)
      : invalidFile();

  return {
    entryType: input.entryType,
    rows,
    validRows: rows.filter((row) => row.errors.length === 0),
    invalidRows: rows.filter((row) => row.errors.length > 0),
  };
}
