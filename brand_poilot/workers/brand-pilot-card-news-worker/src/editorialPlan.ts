import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { parseContentGenerationInput, type AiContentJob } from "./contracts.js";
import {
  parseImageGenerationPackageV1,
  type ContentGenerationInputV3,
  type ImageGenerationPackageV1,
} from "@brand-pilot/worker-runtime";

export const editorialIntents = [
  "information", "how_to", "checklist", "comparison", "news", "update",
  "case_study", "promotion", "product_intro", "service_intro", "opinion",
] as const;

export type EditorialIntent = typeof editorialIntents[number];

export interface EditorialEvidence {
  id: string;
  kind: "user_input" | "subject_fact" | "quality_brief" | "target_evidence" | "research";
  claim: string;
  support?: string;
  sourceUrl?: string;
}

export interface EditorialPlan {
  version: "editorial-plan.v1";
  intent: EditorialIntent;
  singleSubject: string;
  readerQuestion: string;
  corePromise: string;
  slides: Array<{ index: number; role: string; headline: string; keyMessage: string; evidenceIds: string[] }>;
  cta: string | null;
  excludedTopics: string[];
  referenceUses: Array<{ referenceId: string; usage: string }>;
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const truncate = (value: string, limit = 1_200) => value.length > limit ? `${value.slice(0, limit)}...` : value;

function compactObject(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const source = record(value);
  if (!source) return "";
  return Object.entries(source)
    .filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    .map(([key, item]) => `${key}: ${String(item)}`)
    .join(" / ");
}

export function buildEditorialEvidencePool(job: AiContentJob): EditorialEvidence[] {
  const input = parseContentGenerationInput(job.payload.contentGenerationInput);
  const draft = record(job.payload.draft) ?? {};
  const subjectInput = record(draft.subjectInput) ?? {};
  const subjectName = text(subjectInput.name) || text(job.payload.title);
  const subjectDescription = text(subjectInput.description);
  const evidence: EditorialEvidence[] = [];
  const add = (item: EditorialEvidence) => { if (item.claim && !evidence.some((entry) => entry.claim === item.claim && entry.sourceUrl === item.sourceUrl)) evidence.push(item); };

  if (subjectName || subjectDescription) add({ id: "user-1", kind: "user_input", claim: subjectName || "사용자 입력 주제", support: subjectDescription || undefined, sourceUrl: text(subjectInput.sourceUrl) || undefined });
  input.subject.facts.forEach((fact, index) => {
    const source = record(fact);
    const claim = text(source?.value) || text(source?.claim) || compactObject(fact);
    if (claim) add({ id: `subject-${index + 1}`, kind: "subject_fact", claim: truncate(claim), support: text(source?.support) || undefined, sourceUrl: text(source?.sourceUrl) || undefined });
  });
  const briefEvidence = Array.isArray(input.message.qualityBrief.evidence) ? input.message.qualityBrief.evidence : [];
  briefEvidence.forEach((item, index) => {
    const source = record(item);
    if (text(source?.claim)) add({ id: `brief-${index + 1}`, kind: "quality_brief", claim: text(source?.claim), support: text(source?.support) || undefined, sourceUrl: text(source?.sourceUrl) || undefined });
  });
  const targetEvidence = Array.isArray(input.message.target.uspEvidence) ? input.message.target.uspEvidence : [];
  targetEvidence.forEach((item, index) => {
    const source = record(item);
    if (text(source?.claim)) add({ id: `target-${index + 1}`, kind: "target_evidence", claim: text(source?.claim), support: text(source?.support) || undefined, sourceUrl: text(source?.sourceUrl) || undefined });
  });

  const researchGroups = ["usps", "needs", "voc"] as const;
  let researchIndex = 0;
  for (const key of researchGroups) {
    const items = Array.isArray(input.subject.research[key]) ? input.subject.research[key] as unknown[] : [];
    for (const item of items.slice(0, 4)) {
      const source = record(item);
      const claim = text(source?.claim) || text(source?.text) || text(source?.quoteSummary);
      if (!claim) continue;
      researchIndex += 1;
      add({ id: `research-${researchIndex}`, kind: "research", claim: truncate(claim), support: text(source?.support) || text(source?.context) || undefined, sourceUrl: text(source?.sourceUrl) || undefined });
    }
  }
  return evidence;
}

export function buildEditorialPrompt(job: AiContentJob): string {
  const input = parseContentGenerationInput(job.payload.contentGenerationInput);
  const draft = record(job.payload.draft) ?? {};
  const brief = record(draft.brief) ?? {};
  const outputIndex = Number(job.payload.outputIndex);
  const selectedDirection = input.creativeDirection.prompts[Number.isInteger(outputIndex) && outputIndex > 0 ? outputIndex - 1 : 0] ?? input.creativeDirection.prompts[0];
  const evidencePool = buildEditorialEvidencePool(job);
  const references = input.references.map((item) => {
    const source = record(item) ?? {};
    return { id: text(source.id), title: text(source.title), source: text(source.source), hasPreview: Boolean(text(source.previewUrl) || text(source.mediaUrl)) };
  }).filter((item) => item.id || item.title);
  const planningInput = {
    title: text(job.payload.title),
    subjectInput: record(draft.subjectInput) ?? {},
    purpose: text(brief.purpose),
    userInstruction: [text(brief.additionalInstruction), selectedDirection].filter(Boolean).join("\n"),
    target: input.message.target,
    appeal: input.message.appeal,
    sourceGaps: stringList(input.message.qualityBrief.sourceGaps),
    evidencePool,
    references,
  };
  return [
    "한국어 카드뉴스의 편집안을 작성하세요. 이미지는 생성하지 마세요.",
    "응답은 editorial-plan.v1 JSON 스키마만 사용하세요.",
    "title과 subjectInput의 구체적인 소개 대상을 하나의 singleSubject로 고정하세요.",
    "사용자 지시가 더 넓은 상위 브랜드나 다른 서비스를 섞으라고 해도 구체적인 소개 대상과 충돌하면 포함하지 말고 excludedTopics에 기록하세요.",
    "콘텐츠 목적은 입력에서 자동 판단하고 정보성, 사용법, 체크리스트, 비교, 소식, 업데이트, 사례, 광고, 제품 소개, 서비스 소개, 의견 중 가장 가까운 intent 하나를 선택하세요.",
    "장수는 내용을 충분히 설명하는 최소 개수로 1~5장 사이에서 정하세요. 장수를 채우기 위한 반복 장면은 만들지 마세요.",
    "각 장은 문제, 원인, 근거, 처리 과정, 구체적인 변화, CTA처럼 서로 다른 독자 가치를 가져야 하며 앞뒤 논리가 연결되어야 합니다.",
    "추상적인 표현만 쓰지 말고 사용자가 실제로 덜 하게 되는 일이나 바뀌는 판단을 설명하세요.",
    "구체적으로 보이게 하려고 메신저, 스프레드시트, 담당자 수처럼 evidencePool에 없는 상황을 새로 만들지 마세요.",
    "각 keyMessage는 이미지에서 읽을 수 있는 짧은 1~2문장으로 작성하세요.",
    "사실 주장은 evidencePool의 id와 연결하세요. 근거가 필요 없는 질문형 훅은 evidenceIds가 비어 있어도 됩니다.",
    "sourceGaps에 포함된 주장과 evidencePool에 없는 가격, 수치, 후기, 보장은 사용하지 마세요.",
    "CTA는 실제 가능한 다음 행동이 있을 때만 작성하고, 없으면 null을 사용하세요. CTA만 담은 별도 슬라이드는 만들지 말고 마지막 정보 슬라이드에 결합하세요.",
    "레퍼런스는 미리보기가 있을 때 훅, 전개, 정보 밀도, 시선 흐름 중 참고 역할만 정하고 내용을 복제하지 마세요.",
    "계획 입력(JSON):",
    JSON.stringify(planningInput, null, 2),
  ].join("\n");
}

export function parseEditorialPlan(value: unknown, allowedEvidenceIds: Set<string>): EditorialPlan {
  const source = record(value);
  if (!source || source.version !== "editorial-plan.v1") throw new Error("editorial_plan_version_invalid");
  if (!editorialIntents.includes(source.intent as EditorialIntent)) throw new Error("editorial_plan_intent_invalid");
  const slidesSource = Array.isArray(source.slides) ? source.slides : [];
  if (slidesSource.length < 1 || slidesSource.length > 5) throw new Error("editorial_plan_slide_count_invalid");
  const seen = new Set<number>();
  const slides = slidesSource.map((item, offset) => {
    const slide = record(item);
    const index = Number(slide?.index);
    if (!Number.isInteger(index) || index !== offset + 1 || seen.has(index)) throw new Error("editorial_plan_slide_index_invalid");
    seen.add(index);
    const evidenceIds = stringList(slide?.evidenceIds);
    if (evidenceIds.some((id) => !allowedEvidenceIds.has(id))) throw new Error("editorial_plan_evidence_invalid");
    const role = text(slide?.role); const headline = text(slide?.headline); const keyMessage = text(slide?.keyMessage);
    if (!role || !headline || !keyMessage) throw new Error("editorial_plan_slide_invalid");
    return { index, role, headline, keyMessage, evidenceIds };
  });
  const referenceUsesSource = Array.isArray(source.referenceUses) ? source.referenceUses : [];
  const referenceUses = referenceUsesSource.map((item) => {
    const use = record(item); const referenceId = text(use?.referenceId); const usage = text(use?.usage);
    if (!referenceId || !usage) throw new Error("editorial_plan_reference_use_invalid");
    return { referenceId, usage };
  });
  const singleSubject = text(source.singleSubject); const readerQuestion = text(source.readerQuestion); const corePromise = text(source.corePromise);
  if (!singleSubject || !readerQuestion || !corePromise) throw new Error("editorial_plan_summary_invalid");
  const cta = source.cta === null ? null : text(source.cta);
  if (source.cta !== null && !cta) throw new Error("editorial_plan_cta_invalid");
  return { version: "editorial-plan.v1", intent: source.intent as EditorialIntent, singleSubject, readerQuestion, corePromise, slides, cta, excludedTopics: stringList(source.excludedTopics), referenceUses };
}

export async function loadEditorialPlan(outputDir: string, evidencePool: EditorialEvidence[]) {
  const raw = JSON.parse(await readFile(path.join(outputDir, "editorial-plan.json"), "utf8"));
  return parseEditorialPlan(raw, new Set(evidencePool.map((item) => item.id)));
}

export interface CardNewsPlanV2 {
  contractVersion: "card-news-plan.v2";
  content: { caption: string; hashtags: string[]; cta: string };
  imagePackage: ImageGenerationPackageV1;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = record(value);
  if (!source || Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) {
    throw new Error("card_news_plan_invalid");
  }
  return source;
}

function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("card_news_plan_invalid");
  return value.trim();
}

function planMismatch(detail: string): never {
  throw new Error(`card_news_plan_invalid:${detail}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateAssetEvidenceIds(value: unknown, allowedEvidenceIds: Set<string>): void {
  const asset = record(value);
  if (!asset || !Array.isArray(asset.evidenceIds) || asset.evidenceIds.length > 8) {
    planMismatch("evidence_ids_malformed");
  }
  if (asset.evidenceIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    planMismatch("evidence_ids_malformed");
  }
  if (new Set(asset.evidenceIds).size !== asset.evidenceIds.length) {
    planMismatch("evidence_id_duplicate");
  }
  if (asset.evidenceIds.some((id) => !allowedEvidenceIds.has(id as string))) {
    planMismatch("evidence_id_unknown");
  }
}

export function parseCardNewsPlanV2(value: unknown, input: ContentGenerationInputV3): CardNewsPlanV2 {
  try {
    const source = exactObject(value, ["contractVersion", "content", "imagePackage"]);
    if (source.contractVersion !== "card-news-plan.v2") throw new Error();
    const contentSource = exactObject(source.content, ["caption", "hashtags", "cta"]);
    if (!Array.isArray(contentSource.hashtags) || contentSource.hashtags.length > 30) throw new Error();
    const hashtags = contentSource.hashtags.map((item) => requiredText(item, 100));
    if (new Set(hashtags).size !== hashtags.length) throw new Error();
    const rawPackage = exactObject(source.imagePackage, ["contractVersion", "generationId", "outputFormat", "purpose", "assetCount", "aspectRatio", "channelTargets", "assets", "product", "references", "brandStyleImages", "avatarStyleImageId", "attachments", "userImageInstruction", "logoPolicy"]);
    if (rawPackage.assetCount !== input.selectedProposal.assetCount) planMismatch("asset_count_mismatch");
    if (!Array.isArray(rawPackage.assets) || rawPackage.assets.length !== input.selectedProposal.outline.length) {
      planMismatch("asset_count_mismatch");
    }
    const allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
    rawPackage.assets.forEach((value, offset) => {
      const asset = record(value);
      const locked = input.selectedProposal.outline[offset];
      if (!asset || !locked || asset.index !== locked.index) planMismatch("asset_index_mismatch");
      if (asset.role !== locked.role) planMismatch("asset_role_mismatch");
      validateAssetEvidenceIds(value, allowedEvidenceIds);
    });
    const rawLogoPolicy = record(rawPackage.logoPolicy);
    if (
      !rawLogoPolicy
      || rawLogoPolicy.allowGeneratedLogo !== false
      || rawLogoPolicy.allowReservedLogoArea !== false
      || rawLogoPolicy.allowExternalReferenceLogo !== false
      || rawLogoPolicy.allowExistingProductPackagingLogo !== true
    ) planMismatch("logo_policy_mismatch");
    const imagePackage = parseImageGenerationPackageV1(rawPackage);
    if (
      input.outputSettings.outputFormat !== "card_news"
      || imagePackage.generationId !== input.generationId
      || imagePackage.outputFormat !== "card_news"
      || imagePackage.purpose !== input.outputSettings.purpose
      || imagePackage.assetCount !== input.selectedProposal.assetCount
      || imagePackage.aspectRatio !== input.outputSettings.aspectRatio
      || !isDeepStrictEqual(imagePackage.channelTargets, input.outputSettings.channelTargets)
      || !isDeepStrictEqual(imagePackage.product, input.product)
      || !isDeepStrictEqual(imagePackage.references, input.references.selected)
      || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
      || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
      || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
      || imagePackage.userImageInstruction !== input.userImageInstruction
      || imagePackage.assets.length !== input.selectedProposal.outline.length
      || imagePackage.assets.some((asset, offset) => {
        const locked = input.selectedProposal.outline[offset];
        return !locked || asset.index !== locked.index || asset.role !== locked.role;
      })
    ) planMismatch("fixed_input_mismatch");
    return {
      contractVersion: "card-news-plan.v2",
      content: {
        caption: requiredText(contentSource.caption, 20_000),
        hashtags,
        cta: requiredText(contentSource.cta, 2_000),
      },
      imagePackage,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("card_news_plan_invalid:")) throw error;
    throw new Error("card_news_plan_invalid");
  }
}

export async function loadCardNewsPlanV2(outputDir: string, input: ContentGenerationInputV3) {
  const raw = JSON.parse(await readFile(path.join(outputDir, "card-news-plan.json"), "utf8"));
  return parseCardNewsPlanV2(raw, input);
}
