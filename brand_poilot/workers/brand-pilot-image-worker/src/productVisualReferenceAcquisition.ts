import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";
import sharp from "sharp";
import type {
  ProductVisualCandidateV1,
  ProductVisualSourceSnapshotV1,
} from "@brand-pilot/content-contracts/product-visual-references";
import { readPublicUrlBytes, type PublicResourceReadResult } from "./sourceReader.js";

export type ProductImageDiscoveryMethod = ProductVisualCandidateV1["discoveryMethod"];
export interface DiscoveredProductImage {
  sourcePageUrl: string;
  imageUrl: string;
  discoveryMethod: ProductImageDiscoveryMethod;
}

const PAGE_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERED_CANDIDATES = 20;
const EXCLUDED_MARKERS = /(?:^|[\s_./-])(logo|icon|favicon|sprite|social|share|banner|recommend|related|tracking|pixel)(?:$|[\s_./-])/i;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeImageUrl(value: string | undefined, pageUrl: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), pageUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function originalFromConventionalThumbnail(imageUrl: string): string | null {
  try {
    const url = new URL(imageUrl);
    const match = /^(.*\/)thumb-(.+)_\d+x\d+(\.[a-z0-9]+)$/i.exec(url.pathname);
    if (!match) return null;
    url.pathname = `${match[1]}${match[2]}${match[3]}`;
    return url.toString();
  } catch {
    return null;
  }
}

function visualFamilyId(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    url.pathname = url.pathname.replace(/\/thumb-([^/]+)_\d+x\d+(\.[a-z0-9]+)$/i, "/$1$2");
    return `${url.origin}${url.pathname}`;
  } catch {
    return imageUrl;
  }
}

function jsonLdProductImages(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdProductImages);
  if (!value || typeof value !== "object") return [];
  const source = value as Record<string, unknown>;
  const graphImages = jsonLdProductImages(source["@graph"]);
  const types = Array.isArray(source["@type"]) ? source["@type"] : [source["@type"]];
  const own = types.some((type) => typeof type === "string" && /(?:^|[/#])Product$/i.test(type))
    ? (Array.isArray(source.image) ? source.image : [source.image]).flatMap((item) => {
        if (typeof item === "string") return [item];
        if (item && typeof item === "object") {
          const url = (item as Record<string, unknown>).url;
          return typeof url === "string" ? [url] : [];
        }
        return [];
      })
    : [];
  return [...own, ...graphImages];
}

function preferredImageAttribute(element: ReturnType<ReturnType<typeof load>>): string | undefined {
  const sourceSet = element.attr("srcset") ?? element.attr("data-srcset");
  if (sourceSet) {
    const entries = sourceSet.split(",").map((item) => item.trim().split(/\s+/, 1)[0]).filter(Boolean);
    if (entries.length) return entries.at(-1);
  }
  return element.attr("data-original") ?? element.attr("data-zoom-image")
    ?? element.attr("data-src") ?? element.attr("src") ?? undefined;
}

function elementMarker($: ReturnType<typeof load>, image: ReturnType<ReturnType<typeof load>>): string {
  const ancestors = image.parents().slice(0, 4).map((_, node) => [$(node).attr("class"), $(node).attr("id")]
    .filter(Boolean).join(" ")).get();
  return [image.attr("class"), image.attr("id"), image.attr("alt"), ...ancestors]
    .filter(Boolean).join(" ");
}

export function extractProductImageCandidates(html: string, pageUrl: string): DiscoveredProductImage[] {
  const $ = load(html);
  const candidates: DiscoveredProductImage[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined, discoveryMethod: ProductImageDiscoveryMethod) => {
    const imageUrl = safeImageUrl(raw, pageUrl);
    if (!imageUrl || seen.has(imageUrl) || EXCLUDED_MARKERS.test(imageUrl)) return;
    const original = originalFromConventionalThumbnail(imageUrl);
    if (original && !seen.has(original)) {
      seen.add(original);
      candidates.push({ sourcePageUrl: pageUrl, imageUrl: original, discoveryMethod });
    }
    seen.add(imageUrl);
    candidates.push({ sourcePageUrl: pageUrl, imageUrl, discoveryMethod });
  };

  $("script[type='application/ld+json']").each((_, element) => {
    try {
      const parsed = JSON.parse($(element).text());
      for (const image of jsonLdProductImages(parsed)) add(image, "json_ld");
    } catch {
      // Invalid third-party structured data is ignored.
    }
  });

  const gallerySelectors = [
    "[class*='product'][class*='gallery'] img", "[id*='product'][id*='gallery'] img",
    "[class*='item'][class*='photo'] img", "[class*='item'][class*='image'] img",
    "[data-product-gallery] img", "[class*='goods'][class*='view'] img",
  ].join(",");
  $(gallerySelectors).each((_, node) => {
    const image = $(node);
    const marker = elementMarker($, image);
    if (!EXCLUDED_MARKERS.test(marker)) add(preferredImageAttribute(image), "product_gallery");
  });

  add($("meta[property='og:image']").first().attr("content"), "open_graph");
  $("main img, article img").slice(0, 12).each((_, node) => {
    const image = $(node);
    const marker = elementMarker($, image);
    if (!EXCLUDED_MARKERS.test(marker)) add(preferredImageAttribute(image), "main_image");
  });
  return candidates.slice(0, MAX_DISCOVERED_CANDIDATES);
}

function unique(values: readonly string[]): string[] { return [...new Set(values)]; }

export function selectProductReferenceBudget(input: {
  attachmentIds: readonly string[];
  registeredIds: readonly string[];
  maxReferences?: number;
}) {
  const max = input.maxReferences ?? 5;
  const attachmentIds = unique(input.attachmentIds).slice(0, max);
  const registeredIds = unique(input.registeredIds).slice(0, Math.max(0, max - attachmentIds.length));
  return { attachmentIds, registeredIds, urlSlots: Math.max(0, max - attachmentIds.length - registeredIds.length) };
}

export interface AcquiredProductUrlReference {
  candidate: ProductVisualCandidateV1;
  absolutePath: string;
  relativePath: string;
}

export interface ProductVisualAcquisitionEvent {
  sourcePageUrl: string;
  imageUrl: string | null;
  status: "selected" | "excluded" | "unavailable";
  reason: string;
}

export async function acquireProductUrlReferences(input: {
  snapshot: ProductVisualSourceSnapshotV1 | null;
  slots: number;
  inputDir: string;
  readResource?: typeof readPublicUrlBytes;
}): Promise<{ references: AcquiredProductUrlReference[]; candidates: ProductVisualCandidateV1[]; events: ProductVisualAcquisitionEvent[] }> {
  if (!input.snapshot || input.slots <= 0) return { references: [], candidates: [], events: [] };
  const readResource = input.readResource ?? readPublicUrlBytes;
  const discovered: DiscoveredProductImage[] = [];
  const events: ProductVisualAcquisitionEvent[] = [];
  for (const sourcePageUrl of input.snapshot.sourceUrls) {
    const page = await readResource(sourcePageUrl, { acceptedMimeTypes: PAGE_TYPES, maxBytes: MAX_PAGE_BYTES, httpsOnly: true });
    if (page.status !== "fetched") {
      events.push({ sourcePageUrl, imageUrl: null, status: "unavailable", reason: `page_${page.status}` });
      continue;
    }
    discovered.push(...extractProductImageCandidates(new TextDecoder().decode(page.bytes), page.finalUrl));
    if (discovered.length >= MAX_DISCOVERED_CANDIDATES) break;
  }

  const references: AcquiredProductUrlReference[] = [];
  const candidates: ProductVisualCandidateV1[] = [];
  const contentHashes = new Set<string>();
  const selectedFamilies = new Set<string>();
  for (const item of discovered.slice(0, MAX_DISCOVERED_CANDIDATES)) {
    if (references.length >= input.slots) break;
    const familyId = visualFamilyId(item.imageUrl);
    if (selectedFamilies.has(familyId)) {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: "duplicate_variant" });
      continue;
    }
    const resource: PublicResourceReadResult = await readResource(item.imageUrl, {
      acceptedMimeTypes: IMAGE_TYPES,
      maxBytes: MAX_IMAGE_BYTES,
      httpsOnly: true,
    });
    if (resource.status !== "fetched") {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: `image_${resource.status}` });
      continue;
    }
    const bytes = Buffer.from(resource.bytes);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata().catch(() => null);
    if (!metadata?.width || !metadata.height || metadata.width < 256 || metadata.height < 256
      || metadata.width > 20_000 || metadata.height > 20_000) {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: "image_too_small_or_invalid" });
      continue;
    }
    const ratio = metadata.width / metadata.height;
    if (ratio > 3 || ratio < 1 / 3) {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: "image_extreme_ratio" });
      continue;
    }
    const detectedMimeType = metadata.format === "jpeg" ? "image/jpeg"
      : metadata.format === "png" ? "image/png"
      : metadata.format === "webp" ? "image/webp"
      : null;
    if (detectedMimeType === null || detectedMimeType !== resource.mimeType) {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: "image_mime_mismatch" });
      continue;
    }
    const contentSha256 = sha256(bytes);
    if (contentHashes.has(contentSha256)) {
      events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "excluded", reason: "duplicate_content" });
      continue;
    }
    contentHashes.add(contentSha256);
    selectedFamilies.add(familyId);
    const candidateId = sha256(`${item.sourcePageUrl}\n${item.imageUrl}`);
    const mimeType = detectedMimeType as ProductVisualCandidateV1["mimeType"];
    const candidate: ProductVisualCandidateV1 = {
      candidateId,
      sourcePageUrl: item.sourcePageUrl,
      imageUrl: item.imageUrl,
      discoveryMethod: item.discoveryMethod,
      mimeType,
      width: metadata.width,
      height: metadata.height,
      contentSha256,
      decision: "selected",
      reason: "url_fill",
    };
    const extension = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : ".png";
    const fileName = `product-url-${references.length + 1}${extension}`;
    const absolutePath = path.join(input.inputDir, fileName);
    await mkdir(input.inputDir, { recursive: true });
    await writeFile(absolutePath, bytes, { mode: 0o444 });
    candidates.push(candidate);
    references.push({ candidate, absolutePath, relativePath: path.posix.join("inputs", fileName) });
    events.push({ sourcePageUrl: item.sourcePageUrl, imageUrl: item.imageUrl, status: "selected", reason: "url_fill" });
  }
  return { references, candidates, events };
}
