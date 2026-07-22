import crypto from "node:crypto";
import type { CuratedKnowledgeUnit } from "./knowledgeCurator.js";

export type WikiSourceKind = "faq" | "product" | "policy" | "owned_snapshot";

export interface CompiledWikiSourceUnit {
  sourceKind: WikiSourceKind;
  sourceId: string;
  unitType: CuratedKnowledgeUnit["unitType"];
  stableKey: string;
  title: string;
  content: string;
  contentHash: string;
  keywords: string[];
  aliases: string[];
  structuredData: CuratedKnowledgeUnit["structuredData"];
  sourceUrl: string | null;
  destinationUrl: string | null;
  sourceQuote: string;
  validFrom: string | null;
  validUntil: string | null;
}

export interface CompiledWikiSearchChunk {
  chunkId: string;
  pageId: string;
  pageType: string;
  title: string;
  content: string;
  cosineSimilarity: number;
  keywordMatch: number;
  rrfScore: number;
}

export interface CompiledWikiSearchPacket {
  wikiVersionId: string;
  brandCore: string;
  chunks: CompiledWikiSearchChunk[];
  destinationUrls: Array<{ id: string; label: string; url: string }>;
}

function keyPart(value: string | number) {
  const normalized = String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("compiled_wiki_stable_key_invalid");
  return normalized;
}

export function stableWikiKey(
  unitType: CuratedKnowledgeUnit["unitType"],
  title: string,
  structuredData: CuratedKnowledgeUnit["structuredData"],
) {
  const sku = structuredData.sku;
  if (unitType === "product" && (typeof sku === "string" || typeof sku === "number") && String(sku).trim()) {
    return `${unitType}:sku:${keyPart(sku)}`;
  }
  return `${unitType}:${keyPart(title)}`;
}

function verifiedUrl(value: string | null | undefined, code: string) {
  if (!value?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(code);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(code);
  }
  parsed.hash = "";
  return parsed.toString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildCompiledSourceUnits(input: {
  sourceKind: WikiSourceKind;
  sourceId: string;
  sourceUrl: string | null;
  units: CuratedKnowledgeUnit[];
}): CompiledWikiSourceUnit[] {
  const sourceUrl = verifiedUrl(input.sourceUrl, "compiled_wiki_source_url_invalid");
  return input.units.map((unit) => {
    const productUrl = unit.structuredData.productUrl;
    const explicitDestination = typeof productUrl === "string"
      ? verifiedUrl(productUrl, "compiled_wiki_destination_url_invalid")
      : null;
    const destinationUrl = explicitDestination ?? (input.sourceKind === "owned_snapshot" ? sourceUrl : null);
    const stableKey = stableWikiKey(unit.unitType, unit.title, unit.structuredData);
    const hashInput = stableJson({
      ...unit,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceUrl,
      destinationUrl,
      stableKey,
    });
    return {
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      unitType: unit.unitType,
      stableKey,
      title: unit.title,
      content: unit.content,
      contentHash: crypto.createHash("sha256").update(hashInput).digest("hex"),
      keywords: unit.keywords,
      aliases: unit.aliases,
      structuredData: unit.structuredData,
      sourceUrl,
      destinationUrl,
      sourceQuote: unit.sourceQuote,
      validFrom: unit.validFrom,
      validUntil: unit.validUntil,
    };
  });
}
