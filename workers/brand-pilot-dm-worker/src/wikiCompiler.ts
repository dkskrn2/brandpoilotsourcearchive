import type { CompiledWikiSourceUnit } from "./compiledWikiTypes.js";

export type WikiPageType =
  | "brand_overview"
  | "catalog"
  | "product"
  | "service"
  | "policy"
  | "faq"
  | "guide";

export type CompiledWikiSourceRecord = CompiledWikiSourceUnit & { id: string };

export interface WikiCompilationGroup {
  pageType: WikiPageType;
  stableKey: string;
  sourceUnits: CompiledWikiSourceRecord[];
  requiredLinkedStableKeys: string[];
}

export interface WikiCompilerSection {
  sectionKey: string;
  heading: string;
  body: string;
  sourceUnitIds: string[];
  destinationUrlId: string | null;
}

export interface WikiCompilerOutput {
  pageType: WikiPageType;
  stableKey: string;
  title: string;
  summary: string;
  sections: WikiCompilerSection[];
  links: Array<{ targetStableKey: string; relation: string }>;
}

export interface CompiledWikiPage extends WikiCompilerOutput {
  contentJson: { sections: WikiCompilerSection[] };
  contentMarkdown: string;
}

const pageTypes: WikiPageType[] = [
  "brand_overview", "catalog", "product", "service", "policy", "faq", "guide",
];
const topLevelKeys = ["links", "pageType", "sections", "stableKey", "summary", "title"];
const sectionKeys = ["body", "destinationUrlId", "heading", "sectionKey", "sourceUnitIds"];
const linkKeys = ["relation", "targetStableKey"];
const rawUrlPattern = /https?:\/\//i;

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  if (rawUrlPattern.test(value)) throw new Error("wiki_compiler_raw_url_forbidden");
  return value.trim();
}

function groupByStableKey(units: CompiledWikiSourceRecord[]) {
  const grouped = new Map<string, CompiledWikiSourceRecord[]>();
  for (const unit of units) {
    const existing = grouped.get(unit.stableKey) ?? [];
    existing.push(unit);
    grouped.set(unit.stableKey, existing);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

const editorialPathSegments = new Set(["article", "articles", "blog", "content", "insight", "insights", "news", "resource", "resources"]);

export function isEditorialSourceUrl(sourceUrl: string | null) {
  if (!sourceUrl) return false;
  try {
    return new URL(sourceUrl).pathname
      .toLowerCase()
      .split("/")
      .filter(Boolean)
      .some((segment) => editorialPathSegments.has(segment));
  } catch {
    return false;
  }
}

export function isBrandOfferingSource(unit: CompiledWikiSourceRecord) {
  if (unit.sourceKind === "product") return true;
  return unit.sourceKind === "owned_snapshot"
    && Boolean(unit.sourceUrl)
    && !isEditorialSourceUrl(unit.sourceUrl);
}

export function createWikiCompilationGroups(units: CompiledWikiSourceRecord[]): WikiCompilationGroup[] {
  const ids = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) throw new Error("wiki_compiler_source_unit_duplicate");
    ids.add(unit.id);
  }
  const sorted = [...units].sort((left, right) =>
    left.stableKey.localeCompare(right.stableKey) || left.id.localeCompare(right.id));
  const offerings = sorted.filter((unit) => (
    unit.unitType === "product" || unit.unitType === "service"
  ) && isBrandOfferingSource(unit));
  const overviewSources = sorted.filter((unit) => (
    unit.unitType === "fact" || unit.unitType === "guide_section"
  ) && !isEditorialSourceUrl(unit.sourceUrl));
  const groups: WikiCompilationGroup[] = [];

  for (const [stableKey, sourceUnits] of groupByStableKey(offerings)) {
    groups.push({
      pageType: sourceUnits[0].unitType as "product" | "service",
      stableKey,
      sourceUnits,
      requiredLinkedStableKeys: [],
    });
  }
  for (const [stableKey, sourceUnits] of groupByStableKey(sorted.filter((unit) => unit.unitType === "policy"))) {
    groups.push({ pageType: "policy", stableKey, sourceUnits, requiredLinkedStableKeys: [] });
  }
  for (const [stableKey, sourceUnits] of groupByStableKey(sorted.filter((unit) => unit.unitType === "faq"))) {
    groups.push({ pageType: "faq", stableKey, sourceUnits, requiredLinkedStableKeys: [] });
  }
  for (const [stableKey, sourceUnits] of groupByStableKey(sorted.filter((unit) => unit.unitType === "guide_section"))) {
    groups.push({ pageType: "guide", stableKey, sourceUnits, requiredLinkedStableKeys: [] });
  }

  groups.push({
    pageType: "brand_overview",
    stableKey: "brand-overview",
    sourceUnits: overviewSources.length ? overviewSources : sorted,
    requiredLinkedStableKeys: [],
  });
  groups.push({
    pageType: "catalog",
    stableKey: "catalog",
    sourceUnits: offerings.length ? offerings : sorted,
    requiredLinkedStableKeys: [...new Set(offerings.map((unit) => unit.stableKey))].sort(),
  });
  return groups;
}

export function validateWikiCompilerOutput(
  value: unknown,
  group: WikiCompilationGroup,
): WikiCompilerOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value as Record<string, unknown>, topLevelKeys)) {
    throw new Error("wiki_compiler_result_shape_invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (!pageTypes.includes(candidate.pageType as WikiPageType) || candidate.pageType !== group.pageType) {
    throw new Error("wiki_compiler_page_type_invalid");
  }
  if (candidate.stableKey !== group.stableKey) throw new Error("wiki_compiler_stable_key_invalid");
  const allowedUnits = new Map(group.sourceUnits.map((unit) => [unit.id, unit]));
  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    throw new Error("wiki_compiler_sections_invalid");
  }
  const seenSections = new Set<string>();
  const sections = candidate.sections.map((rawSection) => {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)
      || !exactKeys(rawSection as Record<string, unknown>, sectionKeys)) {
      throw new Error("wiki_compiler_section_shape_invalid");
    }
    const section = rawSection as Record<string, unknown>;
    const sectionKey = requiredString(section.sectionKey, "wiki_compiler_section_key_invalid");
    if (seenSections.has(sectionKey)) throw new Error("wiki_compiler_section_key_duplicate");
    seenSections.add(sectionKey);
    if (!Array.isArray(section.sourceUnitIds) || section.sourceUnitIds.length === 0
      || !section.sourceUnitIds.every((id) => typeof id === "string" && id)) {
      throw new Error("wiki_compiler_source_units_invalid");
    }
    const sourceUnitIds = [...new Set(section.sourceUnitIds as string[])];
    for (const sourceUnitId of sourceUnitIds) {
      if (!allowedUnits.has(sourceUnitId)) throw new Error("wiki_compiler_source_unit_unknown");
    }
    const destinationUrlId = section.destinationUrlId;
    if (destinationUrlId !== null) {
      if (typeof destinationUrlId !== "string" || !allowedUnits.get(destinationUrlId)?.destinationUrl) {
        throw new Error("wiki_compiler_destination_url_unknown");
      }
    }
    return {
      sectionKey,
      heading: requiredString(section.heading, "wiki_compiler_heading_invalid"),
      body: requiredString(section.body, "wiki_compiler_body_invalid"),
      sourceUnitIds,
      destinationUrlId: destinationUrlId as string | null,
    };
  });
  if (!Array.isArray(candidate.links)) throw new Error("wiki_compiler_links_invalid");
  const links = candidate.links.map((rawLink) => {
    if (!rawLink || typeof rawLink !== "object" || Array.isArray(rawLink)
      || !exactKeys(rawLink as Record<string, unknown>, linkKeys)) {
      throw new Error("wiki_compiler_link_shape_invalid");
    }
    const link = rawLink as Record<string, unknown>;
    return {
      targetStableKey: requiredString(link.targetStableKey, "wiki_compiler_link_target_invalid"),
      relation: requiredString(link.relation, "wiki_compiler_link_relation_invalid"),
    };
  });
  const linked = new Set(links.map((link) => link.targetStableKey));
  if (group.requiredLinkedStableKeys.some((stableKey) => !linked.has(stableKey))) {
    throw new Error("wiki_compiler_catalog_item_missing");
  }
  return {
    pageType: group.pageType,
    stableKey: group.stableKey,
    title: requiredString(candidate.title, "wiki_compiler_title_invalid"),
    summary: requiredString(candidate.summary, "wiki_compiler_summary_invalid"),
    sections,
    links,
  };
}

function compilerInput(group: WikiCompilationGroup) {
  return {
    pageType: group.pageType,
    stableKey: group.stableKey,
    requiredLinkedStableKeys: group.requiredLinkedStableKeys,
    sourceUnits: group.sourceUnits.map((unit) => ({
      id: unit.id,
      unitType: unit.unitType,
      stableKey: unit.stableKey,
      title: unit.title,
      content: unit.content,
      keywords: unit.keywords,
      aliases: unit.aliases,
      sourceQuote: unit.sourceQuote,
      hasDestinationUrl: Boolean(unit.destinationUrl),
    })),
  };
}

function buildCompilerPrompt(group: WikiCompilationGroup) {
  return `당신은 브랜드별 Wiki 대표 페이지를 작성하는 담당자입니다. 반드시 $wiki-compiler Skill을 사용하세요. 아래 sourceUnits에 있는 사실만 사용하고 URL 문자열을 출력하지 마세요. 모든 section에는 근거 sourceUnitIds를 넣고 strict JSON만 출력하세요.\n\n입력:\n${JSON.stringify(compilerInput(group))}\n\n출력 계약:\n{"pageType":"brand_overview|catalog|product|service|policy|faq|guide","stableKey":"string","title":"string","summary":"string","sections":[{"sectionKey":"string","heading":"string","body":"string","sourceUnitIds":["string"],"destinationUrlId":"source-unit-id|null"}],"links":[{"targetStableKey":"string","relation":"string"}]}\n\nJSON만 출력하세요.`;
}

function renderMarkdown(output: WikiCompilerOutput) {
  return output.sections
    .map((section) => `## ${section.heading}\n\n${section.body}`)
    .join("\n\n");
}

export async function compileWikiGroup(input: {
  group: WikiCompilationGroup;
  runtimeDirectory: string;
  timeoutMs: number;
  runCodex: (input: { prompt: string; runtimeDirectory: string; timeoutMs: number }) => Promise<unknown>;
}): Promise<CompiledWikiPage> {
  const value = await input.runCodex({
    prompt: buildCompilerPrompt(input.group),
    runtimeDirectory: input.runtimeDirectory,
    timeoutMs: input.timeoutMs,
  });
  const output = validateWikiCompilerOutput(value, input.group);
  return {
    ...output,
    contentJson: { sections: output.sections },
    contentMarkdown: renderMarkdown(output),
  };
}

export function buildBrandCore(input: { overviewSummary: string; catalogItems: string[] }) {
  const parts = [input.overviewSummary.trim(), ...input.catalogItems.map((item) => item.trim())]
    .filter(Boolean);
  const selected: string[] = [];
  for (const part of parts) {
    const candidate = [...selected, part].join("\n");
    if (candidate.length > 3000) break;
    selected.push(part);
  }
  return selected.join("\n");
}
