import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import {
  parseBlogPlanV2 as parseCanonicalBlogPlanV2,
  parseCardNewsPlanV2 as parseCanonicalCardNewsPlanV2,
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
  parseReelPlanV2 as parseCanonicalReelPlanV2,
  type BlogPlanV2,
  type CardNewsPlanV2,
  type ContentGenerationInputV3,
  type ImageGenerationPackageV1,
  type ReelPlanV2,
} from "@brand-pilot/content-contracts";
import {
  parseBlogPlanDraftV1,
  parseCardNewsPlanDraftV1,
  parseReelPlanDraftV1,
  type CreativeAssetDraftV1,
} from "@brand-pilot/content-contracts/planner-drafts";
import { parseResearchEvidenceSnapshotV1 } from "./aiContentGenerationInputV3.js";

export const BLOG_PASSIVE_HTML_FORBIDDEN_TAGS = [
  "script", "style", "form", "iframe", "link", "source", "svg", "image", "noscript", "object", "embed", "video", "audio", "meta", "base",
] as const;
export const BLOG_PASSIVE_HTML_FORBIDDEN_ATTRIBUTES = new Set([
  "style", "srcset", "xlink:href", "poster", "background", "data", "ping", "formaction", "action", "srcdoc", "manifest",
]);

export type ContentPlanResultV2 = CardNewsPlanV2 | BlogPlanV2 | ReelPlanV2;

const FIXED_LOGO_POLICY = {
  allowGeneratedLogo: false,
  allowReservedLogoArea: false,
  allowExternalReferenceLogo: false,
  allowExistingProductPackagingLogo: true,
} as const;

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !keys.includes(key)) || keys.some((key) => !(key in source))) {
    throw new Error();
  }
  return source;
}

function text(value: unknown, max = 100_000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error();
  return value.trim();
}

function hashtags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error();
  const result = value.map((item) => text(item, 100));
  if (new Set(result).size !== result.length) throw new Error();
  return result;
}

function socialContent(value: unknown) {
  const source = object(value, ["caption", "hashtags", "cta"]);
  return { caption: text(source.caption, 20_000), hashtags: hashtags(source.hashtags), cta: text(source.cta, 2_000) };
}

function assertPurposeProductInvariant(input: ContentGenerationInputV3): void {
  if (input.outputSettings.purpose === "informational") {
    if (input.product !== null || input.selectedProposal.purposeDetails.kind !== "informational") throw new Error();
    return;
  }
  if (
    input.product === null
    || input.selectedProposal.purposeDetails.kind !== "marketing"
    || input.selectedProposal.purposeDetails.productId !== input.product.id
  ) throw new Error();
}

function assertDuplicateFreeSubset(values: readonly string[], allowed: ReadonlySet<string>): void {
  if (new Set(values).size !== values.length || values.some((value) => !allowed.has(value))) throw new Error();
}

function assembleAssets(
  drafts: readonly CreativeAssetDraftV1[],
  input: ContentGenerationInputV3,
  allowedEvidenceIds: ReadonlySet<string>,
  lockOutline: boolean,
) {
  const allowedProductImageIds = new Set(input.product?.images.map((image) => image.assetId) ?? []);
  if (lockOutline) {
    if (
      input.selectedProposal.assetCount === null
      || drafts.length !== input.selectedProposal.assetCount
      || input.selectedProposal.outline.length !== input.selectedProposal.assetCount
    ) throw new Error();
  }
  return drafts.map((asset, offset) => {
    if (lockOutline) {
      const outline = input.selectedProposal.outline[offset];
      if (!outline || outline.index !== offset + 1 || asset.index !== outline.index || asset.role !== outline.role) {
        throw new Error();
      }
    } else if (asset.index !== offset + 1) {
      throw new Error();
    }
    assertDuplicateFreeSubset(asset.evidenceIds, allowedEvidenceIds);
    assertDuplicateFreeSubset(asset.productImageAssetIds, allowedProductImageIds);
    return { ...asset, attachmentIds: [] };
  });
}

function fixedImagePackage(
  input: ContentGenerationInputV3,
  assets: ReturnType<typeof assembleAssets>,
  aspectRatio: ImageGenerationPackageV1["aspectRatio"],
): ImageGenerationPackageV1 {
  return {
    contractVersion: "image-generation-package.v1",
    generationId: input.generationId,
    outputFormat: input.outputSettings.outputFormat,
    purpose: input.outputSettings.purpose,
    assetCount: assets.length,
    aspectRatio,
    channelTargets: input.outputSettings.channelTargets,
    assets,
    product: input.product,
    references: input.references.selected,
    brandStyleImages: input.references.brandStyleImages,
    avatarStyleImageId: input.references.avatarStyleImageId,
    attachments: input.references.attachments,
    userImageInstruction: input.userImageInstruction,
    logoPolicy: FIXED_LOGO_POLICY,
  };
}

export function assembleContentPlanResultV2(
  draft: unknown,
  rawInput: unknown,
  supplementalResearch?: unknown,
): ContentPlanResultV2 {
  try {
    const input = parseContentGenerationInputV3(rawInput);
    assertPurposeProductInvariant(input);
    const frozenEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));

    if (input.outputSettings.outputFormat === "card_news") {
      const parsedDraft = parseCardNewsPlanDraftV1(draft);
      if (input.outputSettings.aspectRatio === null) throw new Error();
      const assets = assembleAssets(parsedDraft.assets, input, frozenEvidenceIds, true);
      return parseContentPlanResultV2({
        contractVersion: "card-news-plan.v2",
        content: parsedDraft.content,
        imagePackage: fixedImagePackage(input, assets, input.outputSettings.aspectRatio),
      }, input, supplementalResearch);
    }

    if (input.outputSettings.outputFormat === "reel") {
      const parsedDraft = parseReelPlanDraftV1(draft);
      if (input.outputSettings.aspectRatio === null) throw new Error();
      const assets = assembleAssets(parsedDraft.assets, input, frozenEvidenceIds, true);
      return parseContentPlanResultV2({
        contractVersion: "reel-plan.v2",
        outputFormat: "reel",
        content: parsedDraft.content,
        imagePackage: fixedImagePackage(input, assets, input.outputSettings.aspectRatio),
      }, input, supplementalResearch);
    }

    const parsedDraft = parseBlogPlanDraftV1(draft);
    const supplemental = supplementalResearch === undefined || supplementalResearch === null
      ? null
      : parseResearchEvidenceSnapshotV1(supplementalResearch);
    const allEvidenceIds = new Set([
      ...frozenEvidenceIds,
      ...(supplemental?.items.map((item) => item.id) ?? []),
    ]);
    assertDuplicateFreeSubset(parsedDraft.content.usedEvidenceIds, allEvidenceIds);
    const usedEvidenceIds = new Set(parsedDraft.content.usedEvidenceIds);
    const imagePackage = parsedDraft.imageDraft === null
      ? null
      : fixedImagePackage(
        input,
        assembleAssets(parsedDraft.imageDraft.assets, input, usedEvidenceIds, false),
        parsedDraft.imageDraft.aspectRatio,
      );
    return parseContentPlanResultV2({
      contractVersion: "blog-plan.v2",
      content: parsedDraft.content,
      imagePackage,
    }, input, supplementalResearch);
  } catch {
    throw new Error("ai_content_plan_invalid");
  }
}

function validatePackage(
  imagePackage: ImageGenerationPackageV1,
  input: ContentGenerationInputV3,
  lockVisualOutline: boolean,
  allowedEvidenceIds = new Set(input.researchEvidence.items.map((item) => item.id)),
): void {
  if (
    imagePackage.generationId !== input.generationId
    || imagePackage.outputFormat !== input.outputSettings.outputFormat
    || imagePackage.purpose !== input.outputSettings.purpose
    || imagePackage.channelTargets[0] !== input.outputSettings.channelTargets[0]
    || (input.outputSettings.aspectRatio !== null && imagePackage.aspectRatio !== input.outputSettings.aspectRatio)
    || !isDeepStrictEqual(imagePackage.product, input.product)
    || !isDeepStrictEqual(imagePackage.references, input.references.selected)
    || !isDeepStrictEqual(imagePackage.brandStyleImages, input.references.brandStyleImages)
    || imagePackage.avatarStyleImageId !== input.references.avatarStyleImageId
    || !isDeepStrictEqual(imagePackage.attachments, input.references.attachments)
    || imagePackage.userImageInstruction !== input.userImageInstruction
  ) throw new Error();
  if (imagePackage.assets.some((asset) => asset.evidenceIds.some((id) => !allowedEvidenceIds.has(id)))) {
    throw new Error();
  }
  if (lockVisualOutline) {
    if (imagePackage.assetCount !== input.selectedProposal.assetCount) throw new Error();
    if (imagePackage.assets.length !== input.selectedProposal.outline.length) throw new Error();
    imagePackage.assets.forEach((asset, index) => {
      const locked = input.selectedProposal.outline[index];
      if (!locked || asset.index !== locked.index || asset.role !== locked.role) throw new Error();
    });
  }
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function validateBlogHtml(
  html: string,
  count: number,
  evidenceItems: Array<{ id: string; url: string }>,
  usedEvidenceIds: string[],
): void {
  const $ = load(html);
  if ($(BLOG_PASSIVE_HTML_FORBIDDEN_TAGS.join(",")).length) throw new Error();
  $("*").each((_index, element) => {
    const tagName = String($(element).prop("tagName") ?? "").toLowerCase();
    for (const [name, value] of Object.entries((element as { attribs?: Record<string, string> }).attribs ?? {})) {
      const lowerName = name.toLowerCase();
      if (/^on/i.test(name) || BLOG_PASSIVE_HTML_FORBIDDEN_ATTRIBUTES.has(lowerName)) throw new Error();
      if (lowerName === "src" && tagName !== "img") throw new Error();
      if (lowerName === "href" && tagName !== "a") throw new Error();
      if ((lowerName === "href" || lowerName === "src") && /^\s*javascript:/i.test(value)) throw new Error();
    }
  });
  const article = $("article");
  if (article.length !== 1) throw new Error();
  const h1 = article.find("h1");
  if (h1.length !== 1 || $("h1").length !== 1) throw new Error();
  const summary = h1.first().next();
  if (!summary.is('section[data-summary="true"]')) throw new Error();
  const summaryChildren = summary.children();
  if (summaryChildren.length !== 3 || summaryChildren.filter("p").length !== 3) throw new Error();
  const summaryTexts = summaryChildren.toArray().map((element) => normalizedText($(element).text()));
  if (summaryTexts.some((text) => !text) || normalizedText(summaryTexts.join(" ")).length > 300) throw new Error();
  const visibleLength = normalizedText(article.text()).length;
  if (visibleLength < 3_000 || visibleLength > 10_000) throw new Error();
  for (const heading of article.find("h2,h3").toArray()) {
    if (!normalizedText($(heading).text()).endsWith("?") || !$(heading).next().is("p")) throw new Error();
  }
  const forbiddenExperience = [/제가 직접 (?:써|사용해) ?보니/, /실제 고객의 경험을 재구성/, /가상의 경험담/, /합성된 경험/];
  if (forbiddenExperience.some((pattern) => pattern.test(article.text()))) throw new Error();

  const allImages = $("img");
  if (allImages.length !== article.find("img").length) throw new Error();
  const imageSources = allImages.toArray().map((element) => $(element).attr("src"));
  if (imageSources.some((source) => typeof source !== "string" || !/^asset:\/\/\d{2}$/.test(source))) throw new Error();
  const expected = Array.from({ length: count }, (_, index) => `asset://${String(index + 1).padStart(2, "0")}`);
  const rawPlaceholders = html.match(/asset:\/\/[^\s"'<>]*/g) ?? [];
  if (!isDeepStrictEqual(rawPlaceholders, imageSources) || !isDeepStrictEqual(imageSources, expected)) throw new Error();

  const evidenceUrls = new Map<string, string>();
  for (const item of evidenceItems) {
    let url: URL;
    try { url = new URL(item.url); } catch { throw new Error(); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    const existing = evidenceUrls.get(item.id);
    if (existing !== undefined && existing !== item.url) throw new Error();
    evidenceUrls.set(item.id, item.url);
  }
  const references = $('section[data-references="true"]');
  if (references.length !== 1 || article.find('section[data-references="true"]').length !== 1) throw new Error();
  const referenceSection = references.first();
  const evidenceLinks = article.find("a[data-evidence-id]").toArray();
  if ($("a").length !== article.find("a").length || article.find("a").length !== evidenceLinks.length) throw new Error();
  for (const link of evidenceLinks) {
    const evidenceId = $(link).attr("data-evidence-id");
    const href = $(link).attr("href");
    if (!evidenceId || !href || evidenceUrls.get(evidenceId) !== href) throw new Error();
    try {
      const protocol = new URL(href).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new Error();
    } catch { throw new Error(); }
  }
  const expectedIds = new Set(usedEvidenceIds);
  if (expectedIds.size !== usedEvidenceIds.length || [...expectedIds].some((id) => !evidenceUrls.has(id))) throw new Error();
  const referenceIds = new Set(referenceSection.find("a[data-evidence-id]").toArray().map((link) => String($(link).attr("data-evidence-id"))));
  const bodyIds = new Set(evidenceLinks.filter((link) => !referenceSection.find(link).length).map((link) => String($(link).attr("data-evidence-id"))));
  if (!sameSet(expectedIds, referenceIds) || !sameSet(expectedIds, bodyIds)) throw new Error();
}

export function parseContentPlanResultV2(value: unknown, rawInput: unknown, supplementalResearch?: unknown): ContentPlanResultV2 {
  try {
    const input = parseContentGenerationInputV3(rawInput);
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    if (source.contractVersion === "card-news-plan.v2") {
      object(value, ["contractVersion", "content", "imagePackage"]);
      if (input.outputSettings.outputFormat !== "card_news") throw new Error();
      const canonical = parseCanonicalCardNewsPlanV2(value);
      const imagePackage = canonical.imagePackage;
      validatePackage(imagePackage, input, true);
      return { ...canonical, content: socialContent(canonical.content) };
    }
    if (source.contractVersion === "reel-plan.v2") {
      object(value, ["contractVersion", "outputFormat", "content", "imagePackage"]);
      if (input.outputSettings.outputFormat !== "reel") throw new Error();
      const canonical = parseCanonicalReelPlanV2(value);
      const imagePackage = canonical.imagePackage;
      validatePackage(imagePackage, input, true);
      return { ...canonical, content: socialContent(canonical.content) };
    }
    if (source.contractVersion === "blog-plan.v2") {
      object(value, ["contractVersion", "content", "imagePackage"]);
      if (input.outputSettings.outputFormat !== "blog") throw new Error();
      const contentSource = object(source.content, ["title", "htmlTemplate", "metaTitle", "metaDescription", "usedEvidenceIds"]);
      if (!Array.isArray(contentSource.usedEvidenceIds)) throw new Error();
      const supplemental = supplementalResearch === undefined || supplementalResearch === null
        ? null
        : parseResearchEvidenceSnapshotV1(supplementalResearch);
      const evidenceIds = new Set([
        ...input.researchEvidence.items.map((item) => item.id),
        ...(supplemental?.items.map((item) => item.id) ?? []),
      ]);
      const usedEvidenceIds = contentSource.usedEvidenceIds.map((item) => {
        if (typeof item !== "string" || !evidenceIds.has(item)) throw new Error();
        return item;
      });
      if (new Set(usedEvidenceIds).size !== usedEvidenceIds.length) throw new Error();
      const htmlTemplate = text(contentSource.htmlTemplate);
      const canonical = parseCanonicalBlogPlanV2(value);
      const imagePackage = canonical.imagePackage;
      if (imagePackage === null) {
        if (/asset:\/\//.test(htmlTemplate)) throw new Error();
      } else {
        validatePackage(imagePackage, input, false, new Set(usedEvidenceIds));
      }
      validateBlogHtml(htmlTemplate, imagePackage?.assetCount ?? 0, [
        ...input.researchEvidence.items,
        ...(supplemental?.items ?? []),
      ], usedEvidenceIds);
      return {
        contractVersion: "blog-plan.v2",
        content: {
          title: text(contentSource.title, 500), htmlTemplate,
          metaTitle: text(contentSource.metaTitle, 500), metaDescription: text(contentSource.metaDescription, 2_000),
          usedEvidenceIds,
        },
        imagePackage,
      };
    }
    throw new Error();
  } catch {
    throw new Error("ai_content_plan_invalid");
  }
}
