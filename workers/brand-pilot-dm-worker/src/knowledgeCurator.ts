import { normalizeWhitespace } from "./knowledgeNormalizer.js";

const unitTypes = ["faq", "product", "policy", "fact", "guide_section"] as const;
const protectedProductFields = ["price", "currency", "productUrl", "sku"] as const;
const topLevelKeys = ["units"];
const unitKeys = [
  "aliases",
  "content",
  "keywords",
  "sourceQuote",
  "structuredData",
  "title",
  "unitType",
  "validFrom",
  "validUntil",
].sort();

export interface CuratedKnowledgeUnit {
  unitType: typeof unitTypes[number];
  title: string;
  content: string;
  keywords: string[];
  aliases: string[];
  sourceQuote: string;
  validFrom: string | null;
  validUntil: string | null;
  structuredData: Record<string, string | number | null>;
}

type StructuredData = Record<string, string | number | null>;

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function stringArray(value: unknown, code: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) {
    throw new Error(code);
  }
  return value.map((item) => item.trim());
}

function nullableDate(value: unknown, code: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(code);
  return value;
}

function structuredObject(value: unknown): StructuredData {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("curator_structured_data_invalid");
  }
  const result: StructuredData = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item !== "string" && typeof item !== "number") {
      throw new Error("curator_structured_data_invalid");
    }
    result[key] = item;
  }
  return result;
}

function comparable(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : String(value).trim();
}

export function validateCuratedKnowledge(
  value: unknown,
  normalizedSource: string,
  sourceStructuredData: StructuredData = {},
): CuratedKnowledgeUnit[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value as Record<string, unknown>, topLevelKeys)) {
    throw new Error("curator_result_shape_invalid");
  }
  const units = (value as { units?: unknown }).units;
  if (!Array.isArray(units) || units.length === 0) throw new Error("curator_units_invalid");
  const normalizedHaystack = normalizeWhitespace(normalizedSource);

  return units.map((rawUnit) => {
    if (!rawUnit || typeof rawUnit !== "object" || Array.isArray(rawUnit)
      || !exactKeys(rawUnit as Record<string, unknown>, unitKeys)) {
      throw new Error("curator_unit_shape_invalid");
    }
    const candidate = rawUnit as Record<string, unknown>;
    if (!unitTypes.includes(candidate.unitType as typeof unitTypes[number])) {
      throw new Error("curator_unit_type_invalid");
    }
    const sourceQuote = requiredString(candidate.sourceQuote, "curator_source_quote_required");
    if (!normalizedHaystack.includes(normalizeWhitespace(sourceQuote))) {
      throw new Error("curator_source_quote_missing");
    }
    const structuredData = structuredObject(candidate.structuredData);
    if (candidate.unitType === "product") {
      for (const field of protectedProductFields) {
        if (comparable(structuredData[field]) !== comparable(sourceStructuredData[field])) {
          throw new Error(`curator_product_field_changed:${field}`);
        }
      }
    }
    return {
      unitType: candidate.unitType as CuratedKnowledgeUnit["unitType"],
      title: requiredString(candidate.title, "curator_title_required"),
      content: requiredString(candidate.content, "curator_content_required"),
      keywords: stringArray(candidate.keywords, "curator_keywords_invalid"),
      aliases: stringArray(candidate.aliases, "curator_aliases_invalid"),
      sourceQuote,
      validFrom: nullableDate(candidate.validFrom, "curator_valid_from_invalid"),
      validUntil: nullableDate(candidate.validUntil, "curator_valid_until_invalid"),
      structuredData,
    };
  });
}

export function buildKnowledgeCuratorPrompt(input: {
  normalizedSource: string;
  sourceTitle: string;
  sourceStructuredData?: StructuredData;
}) {
  return `당신은 브랜드 지식 원문을 검색 가능한 원자 단위로 정리하는 담당자입니다. 반드시 $knowledge-curator Skill을 사용하세요. 정제된 원문에 명시된 사실만 사용하고 추측, 보정, 최신화하지 마세요. 아래 필드만 가진 strict JSON 객체를 출력하고 설명, Markdown, 코드 펜스는 출력하지 마세요.\n\n원문 제목:\n${input.sourceTitle}\n\n원문 structuredData:\n${JSON.stringify(input.sourceStructuredData ?? {})}\n\n정제된 원문:\n${input.normalizedSource}\n\n출력 계약:\n{"units":[{"unitType":"faq|product|policy|fact|guide_section","title":"string","content":"string","keywords":["string"],"aliases":["string"],"sourceQuote":"정제된 원문에 공백 정규화 후 그대로 존재하는 인용","validFrom":"YYYY-MM-DD|null","validUntil":"YYYY-MM-DD|null","structuredData":{"key":"string|number|null"}}]}\n\nJSON만 출력하세요.`;
}

export async function curateKnowledge({
  normalizedSource,
  sourceTitle,
  sourceStructuredData = {},
  runtimeDirectory,
  timeoutMs = 30_000,
  runCodex,
}: {
  normalizedSource: string;
  sourceTitle: string;
  sourceStructuredData?: StructuredData;
  runtimeDirectory: string;
  timeoutMs?: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}) {
  const prompt = buildKnowledgeCuratorPrompt({ normalizedSource, sourceTitle, sourceStructuredData });
  const result = await runCodex({
    prompt,
    runtimeDirectory,
    timeoutMs,
  });
  try {
    return validateCuratedKnowledge(result, normalizedSource, sourceStructuredData);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "curator_source_quote_missing") throw error;
  }

  const corrected = await runCodex({
    prompt: `${prompt}\n\n이전 출력의 sourceQuote가 원문의 연속 문자열과 일치하지 않았습니다. 각 sourceQuote를 위 정제된 원문에서 그대로 복사해 다시 출력하세요. 요약, 맞춤법 보정, 문장부호 변경은 금지합니다.`,
    runtimeDirectory,
    timeoutMs,
  });
  return validateCuratedKnowledge(corrected, normalizedSource, sourceStructuredData);
}
