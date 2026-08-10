import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { load } from "cheerio";
import {
  parseAiContentManifestV3,
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
  type AiContentManifestV3,
  type ContentGenerationInputV3,
} from "@brand-pilot/content-contracts";
import type { AiContentPackageFinalizeJob, AiContentRenderedAsset } from "./aiContentRenderClient.js";
import { buildAiContentReelManifest } from "./manifest.js";
import { createAiContentReelRenderer, type AiContentReelRenderer } from "./reelRenderer.js";

export class AiContentFinalizerError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean) {
    super(code);
  }
}

export interface AiContentFinalizerStorage {
  readOwned(storagePath: string): Promise<Buffer>;
  uploadVideo(input: { path: string; bytes: Buffer; width: number; height: number; durationSeconds: number; videoCodec: "h264"; audioCodec: null; fps: 30 }): Promise<{ url: string; checksum: string }>;
  uploadText(input: { path: string; text: string; contentType: "text/html; charset=utf-8" | "application/json" }): Promise<{ url: string; checksum: string }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ai_content_finalizer_payload_invalid");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("ai_content_finalizer_payload_invalid");
  return value;
}

function successfulAssets(values: AiContentRenderedAsset[]): AiContentRenderedAsset[] {
  const assets = [...values].sort((left, right) => left.index - right.index);
  assets.forEach((asset, offset) => {
    let url: URL;
    try { url = new URL(asset.url); } catch { throw new Error("ai_content_finalizer_asset_invalid"); }
    if (asset.index !== offset + 1 || url.protocol !== "https:" || asset.mimeType !== "image/png") throw new Error("ai_content_finalizer_asset_invalid");
  });
  return assets;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function evidenceUrls(finalInput: ContentGenerationInputV3, supplemental: Record<string, unknown> | null): Map<string, string> {
  const supplementalItems = supplemental && Array.isArray(supplemental.items) ? supplemental.items : [];
  const map = new Map<string, string>();
  for (const raw of [...finalInput.researchEvidence.items, ...supplementalItems]) {
    const item = record(raw);
    const id = text(item.id);
    const url = text(item.url);
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== "http:" && protocol !== "https:") throw new Error();
    } catch { throw new Error("ai_content_blog_html_invalid"); }
    const existing = map.get(id);
    if (existing !== undefined && existing !== url) throw new Error("ai_content_blog_html_invalid");
    map.set(id, url);
  }
  return map;
}

function validateFinalBlogHtml(html: string, input: ContentGenerationInputV3, supplemental: Record<string, unknown> | null, usedEvidenceIds: string[], assets: AiContentRenderedAsset[]): string {
  if (/asset:\/\//.test(html)) throw new Error("ai_content_blog_placeholder_remaining");
  const $ = load(html);
  if ($("script,style,form,iframe,link,source,svg,image,noscript,object,embed,video,audio,meta,base").length) throw new Error("ai_content_blog_html_invalid");
  for (const element of $("*").toArray()) {
    const tag = String($(element).prop("tagName") ?? "").toLowerCase();
    const attributes = (element as { attribs?: Record<string, string> }).attribs ?? {};
    for (const [name, value] of Object.entries(attributes)) {
      const lower = name.toLowerCase();
      if (/^on/.test(lower) || ["style", "srcset", "xlink:href", "poster", "background", "data", "ping", "formaction", "action", "srcdoc", "manifest"].includes(lower)) throw new Error("ai_content_blog_html_invalid");
      if (lower === "src" && tag !== "img" || lower === "href" && tag !== "a" || ((lower === "src" || lower === "href") && /^\s*javascript:/i.test(value))) throw new Error("ai_content_blog_html_invalid");
    }
  }
  const article = $("article");
  const h1 = article.find("h1");
  if (article.length !== 1 || h1.length !== 1 || $("h1").length !== 1) throw new Error("ai_content_blog_html_invalid");
  const summary = h1.first().next();
  if (!summary.is('section[data-summary="true"]') || summary.children().length !== 3 || summary.children("p").length !== 3) throw new Error("ai_content_blog_html_invalid");
  const summaryText = summary.children("p").toArray().map((element) => normalized($(element).text()));
  if (summaryText.some((value) => !value) || normalized(summaryText.join(" ")).length > 300) throw new Error("ai_content_blog_html_invalid");
  const visibleLength = normalized(article.text()).length;
  if (visibleLength < 3_000 || visibleLength > 10_000) throw new Error("ai_content_blog_html_invalid");
  for (const heading of article.find("h2,h3").toArray()) {
    if (!normalized($(heading).text()).endsWith("?") || !$(heading).next().is("p")) throw new Error("ai_content_blog_html_invalid");
  }
  if ([/제가 직접 (?:써|사용해) ?보니/, /실제 고객의 경험을 재구성/, /가상의 경험담/, /합성된 경험/].some((pattern) => pattern.test(article.text()))) throw new Error("ai_content_blog_html_invalid");
  const expectedImageUrls = assets.map((asset) => asset.url);
  const actualImageUrls = $("img").toArray().map((element) => String($(element).attr("src") ?? ""));
  if (!isDeepStrictEqual(actualImageUrls, expectedImageUrls)) throw new Error("ai_content_blog_html_invalid");

  const frozenEvidence = evidenceUrls(input, supplemental);
  const expectedIds = new Set(usedEvidenceIds);
  if (expectedIds.size !== usedEvidenceIds.length || [...expectedIds].some((id) => !frozenEvidence.has(id))) throw new Error("ai_content_blog_html_invalid");
  const allLinks = article.find("a").toArray();
  for (const link of allLinks) {
    const id = String($(link).attr("data-evidence-id") ?? "");
    const href = String($(link).attr("href") ?? "");
    if (!id || frozenEvidence.get(id) !== href) throw new Error("ai_content_blog_html_invalid");
  }
  const references = article.find('section[data-references="true"]');
  if (references.length !== 1) throw new Error("ai_content_blog_html_invalid");
  const referenceIds = new Set(references.find("a[data-evidence-id]").toArray().map((link) => String($(link).attr("data-evidence-id"))));
  const bodyIds = new Set(allLinks.filter((link) => !references.find(link).length).map((link) => String($(link).attr("data-evidence-id"))));
  if (!sameSet(expectedIds, referenceIds) || !sameSet(expectedIds, bodyIds)) throw new Error("ai_content_blog_html_invalid");
  return summaryText.join("\n");
}

function socialManifest(finalInput: ContentGenerationInputV3, plan: Record<string, unknown>, assets: AiContentRenderedAsset[]): AiContentManifestV3 {
  const content = record(plan.content);
  const expectedCount = finalInput.selectedProposal.assetCount;
  if (expectedCount === null || assets.length !== expectedCount) throw new Error("ai_content_finalizer_asset_count_invalid");
  return parseAiContentManifestV3({
    version: "ai-content.v3", purpose: finalInput.outputSettings.purpose,
    outputFormat: finalInput.outputSettings.outputFormat, title: finalInput.selectedProposal.title,
    assets: assets.map((asset) => ({ role: "slide", index: asset.index, url: asset.url, fileName: `slide-${String(asset.index).padStart(2, "0")}.png`, mimeType: "image/png", width: asset.width, height: asset.height })),
    content: { caption: content.caption, hashtags: content.hashtags, cta: content.cta },
  });
}

export async function finalizeAiContentPackage(job: AiContentPackageFinalizeJob, storage: AiContentFinalizerStorage, reelRenderer?: AiContentReelRenderer, signal = new AbortController().signal): Promise<{ manifest: AiContentManifestV3; manifestUrl: string }> {
  const throwIfAborted = () => {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("ai_content_reel_aborted");
  };
  throwIfAborted();
  const finalInput = parseContentGenerationInputV3(job.payload.finalInput);
  if (finalInput.generationId !== job.generationId || job.payload.generationId !== job.generationId || job.payload.outputId !== job.outputId) throw new Error("ai_content_finalizer_payload_invalid");
  const format = finalInput.outputSettings.outputFormat;
  const plan = record(job.payload.plan);
  const assets = successfulAssets(job.payload.assets);
  if (plan.imagePackage === null) {
    if (format !== "blog" || assets.length !== 0) throw new Error("ai_content_finalizer_asset_count_invalid");
  } else {
    const imagePackage = parseImageGenerationPackageV1(plan.imagePackage);
    if (
      imagePackage.generationId !== job.generationId || imagePackage.outputFormat !== format
      || imagePackage.purpose !== finalInput.outputSettings.purpose || imagePackage.assetCount !== assets.length
    ) throw new Error("ai_content_finalizer_asset_count_invalid");
  }
  let manifest: AiContentManifestV3;
  if (format === "reel") {
    if (plan.contractVersion !== "reel-plan.v2" || plan.outputFormat !== "reel") throw new Error("ai_content_finalizer_plan_invalid");
    if (assets.some((asset) => asset.width * 16 !== asset.height * 9)) throw new Error("ai_content_finalizer_asset_dimensions_invalid");
    const assetPrefix = `ai-content/${job.brandId}/${job.generationId}/${job.outputId}/assets`;
    if (assets.some((asset) => asset.storagePath !== `${assetPrefix}/${String(asset.index).padStart(2, "0")}.png`)) {
      throw new Error("ai_content_finalizer_asset_path_invalid");
    }
    const sceneBytes = await Promise.all(assets.map((asset) => storage.readOwned(asset.storagePath)));
    throwIfAborted();
    if (sceneBytes.some((bytes, offset) => createHash("sha256").update(bytes).digest("hex") !== assets[offset]!.checksum)) {
      throw new Error("ai_content_finalizer_asset_checksum_invalid");
    }
    const rendered = await (reelRenderer ?? createAiContentReelRenderer()).render({
      jobId: job.id,
      scenes: assets.map((asset, offset) => ({ index: asset.index, bytes: sceneBytes[offset]!, mimeType: "image/png", width: asset.width, height: asset.height }))
    }, signal);
    throwIfAborted();
    if (!rendered.cover.bytes.equals(sceneBytes[0]!)) throw new Error("ai_content_finalizer_cover_invalid");
    const videoPath = `ai-content/${job.brandId}/${job.generationId}/${job.outputId}/reel.mp4`;
    const uploadedVideo = await storage.uploadVideo({ path: videoPath, ...rendered.video });
    throwIfAborted();
    manifest = buildAiContentReelManifest({
      purpose: finalInput.outputSettings.purpose,
      title: finalInput.selectedProposal.title,
      scenes: assets.map((asset) => ({ index: asset.index, url: asset.url, width: asset.width, height: asset.height })),
      video: { url: uploadedVideo.url, width: rendered.video.width, height: rendered.video.height, durationSeconds: rendered.video.durationSeconds },
      content: record(plan.content)
    });
  } else if (format === "card_news") {
    if (plan.contractVersion !== "card-news-plan.v2") throw new Error("ai_content_finalizer_plan_invalid");
    manifest = socialManifest(finalInput, plan, assets);
  } else {
    if (plan.contractVersion !== "blog-plan.v2") throw new Error("ai_content_finalizer_plan_invalid");
    const content = record(plan.content);
    let html = text(content.htmlTemplate);
    for (const asset of assets) html = html.replaceAll(`asset://${String(asset.index).padStart(2, "0")}`, asset.url);
    if (/asset:\/\//.test(html)) throw new Error("ai_content_blog_placeholder_remaining");
    const usedEvidenceIds = Array.isArray(content.usedEvidenceIds) ? content.usedEvidenceIds.map(text) : [];
    const summary = validateFinalBlogHtml(html, finalInput, job.payload.supplementalResearch, usedEvidenceIds, assets);
    const prefix = `ai-content/${job.brandId}/${job.generationId}/${job.outputId}`;
    const uploadedHtml = await storage.uploadText({ path: `${prefix}/content.html`, text: html, contentType: "text/html; charset=utf-8" });
    manifest = parseAiContentManifestV3({
      version: "ai-content.v3", purpose: finalInput.outputSettings.purpose, outputFormat: "blog", title: text(content.title),
      assets: [
        { role: "html", index: 1, url: uploadedHtml.url, fileName: "content.html", mimeType: "text/html" },
        ...assets.map((asset) => ({ role: "inline", index: asset.index, url: asset.url, fileName: `inline-${String(asset.index).padStart(2, "0")}.png`, mimeType: "image/png", width: asset.width, height: asset.height })),
      ],
      content: { title: text(content.title), summary, html, metaTitle: text(content.metaTitle), metaDescription: text(content.metaDescription) },
    });
  }
  throwIfAborted();
  const manifestPath = `ai-content/${job.brandId}/${job.generationId}/${job.outputId}/manifest.json`;
  const uploadedManifest = await storage.uploadText({ path: manifestPath, text: JSON.stringify(manifest), contentType: "application/json" });
  return { manifest, manifestUrl: uploadedManifest.url };
}
