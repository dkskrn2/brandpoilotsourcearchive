import { createHash } from "node:crypto";
import {
  parseBrandRulesContentV1,
  type ApprovedBrandRulesSnapshotV1,
} from "@brand-pilot/content-contracts";
export type { ApprovedBrandRulesSnapshotV1 } from "@brand-pilot/content-contracts";

export type ContentPurposeV2 = "informational" | "marketing";
export type ContentOutputFormatV2 = "card_news" | "blog" | "reel" | "marketing_content";
export type ContentChannelTargetV2 =
  | "instagram"
  | "threads"
  | "x"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "blog_export";
export type ReferenceRoleV2 = "planning" | "copy_pattern" | "visual_composition";
export type ContentAspectRatioV2 = "1:1" | "4:5" | "16:9" | "9:16";
export type InformationalProposalTypeV2 =
  | "problem_solution"
  | "how_to"
  | "checklist"
  | "comparison"
  | "trend_insight"
  | "q_and_a"
  | "myth_fact";
export type ProposalDifferentiationAxisV2 =
  | "target"
  | "situation"
  | "question"
  | "appeal"
  | "narrative"
  | "informational_type";
export type GeneratedImageMimeTypeV2 = "image/png" | "image/jpeg" | "image/webp";

// Compatibility aliases retained for existing worker consumers.
export type WorkerContentPurposeV3 = ContentPurposeV2;
export type WorkerOutputFormatV3 = ContentOutputFormatV2;
export type WorkerChannelV3 = ContentChannelTargetV2;
export type WorkerRatioV3 = ContentAspectRatioV2;
export type WorkerReferenceRoleV3 = ReferenceRoleV2;
export type WorkerInformationTypeV3 = InformationalProposalTypeV2;

export interface ApprovedBrandCoreSnapshotV2 {
  versionId: string;
  companyOverview: string;
  businessDescription: string;
  primaryCategory: string;
  detailedCategory: string;
  primaryTarget: string;
  differentiator: string;
  coreAppeal: string;
}

export interface ApprovedProductImageSnapshotV2 {
  assetId: string;
  role: "hero" | "detail";
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  checksum: string;
}

export interface ApprovedProductSnapshotV2 {
  id: string;
  versionId: string;
  kind: "product" | "service";
  name: string;
  description: string;
  features: string[];
  benefits: string[];
  cautions: string[];
  evergreenPurchaseInfo: string;
  images: ApprovedProductImageSnapshotV2[];
}

export interface FrozenOwnedImageSnapshotV2 {
  storageUrl: string;
  storagePath: string;
  mimeType: GeneratedImageMimeTypeV2;
  checksum: string;
}

export interface FrozenReferenceSnapshotV2 {
  referenceItemId: string;
  snapshotId: string;
  roles: ReferenceRoleV2[];
  title: string;
  sourceUrl: string;
  capturedAt: string;
  contentHash: string;
  text: string;
  image: FrozenOwnedImageSnapshotV2 | null;
}

export interface ResearchEvidenceItemSnapshotV1 {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
  capturedAt: string;
  claimSummary: string;
  contentHash: string;
}

export interface ResearchEvidenceSnapshotV1 {
  contractVersion: "research-evidence.v1";
  decision: "searched" | "not_needed";
  reason: string;
  queries: string[];
  capturedAt: string;
  items: ResearchEvidenceItemSnapshotV1[];
}

export type ContentSubjectV2 =
  | { kind: "topic_text"; title: string }
  | {
    kind: "topic_url";
    requestedUrl: string;
    canonicalUrl: string;
    title: string | null;
    text: string;
    contentHash: string;
    capturedAt: string;
  }
  | { kind: "reference"; referenceIds: string[] };
export type WorkerSubjectV3 = ContentSubjectV2;

export interface ContentGenerationOutputSettingsV3 {
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelTargetV2];
  aspectRatio: ContentAspectRatioV2 | null;
  outputCount: 1;
  purpose: ContentPurposeV2;
}
export type WorkerOutputSettingsV3 = ContentGenerationOutputSettingsV3;

export interface InformationalPurposeDetailsV2 {
  kind: "informational";
  question: string;
  value: string;
  whyNow: string;
  learningPoints: string[];
}

export interface MarketingPurposeDetailsV2 {
  kind: "marketing";
  campaignObjective: string;
  situationAndNeed: string;
  productId: string;
  targetSegment: string;
  strengths: string[];
  limitations: string[];
  appeal: string;
  buyingBarriers: string[];
  cta: string;
}

export type WorkerPurposeDetailsV3 = InformationalPurposeDetailsV2 | MarketingPurposeDetailsV2;

export interface ContentProposalOutlineItemV2 {
  index: number;
  role: string;
  headline: string;
  purpose: string;
}

export interface ContentProposalV2 {
  conceptKey: string;
  title: string;
  informationalType: InformationalProposalTypeV2 | null;
  oneLineIntent: string;
  differentiator: string;
  differentiationAxes: ProposalDifferentiationAxisV2[];
  target: string;
  customerContext: string;
  keyMessage: string;
  hook: string;
  selectionReason: string;
  evidenceIds: string[];
  referenceIds: string[];
  outputFormat: ContentOutputFormatV2;
  channelTargets: [ContentChannelTargetV2];
  assetCount: number | null;
  outline: ContentProposalOutlineItemV2[];
  purposeDetails: WorkerPurposeDetailsV3;
}

export interface FrozenStyleImageSnapshotV1 extends FrozenOwnedImageSnapshotV2 {
  referenceItemId: string;
  description: string;
  tags: string[];
}
export type FrozenStyleImageV2 = FrozenStyleImageSnapshotV1;

export interface FinalAttachmentSnapshotV1 extends FrozenOwnedImageSnapshotV2 {
  id: string;
  role: "product_image" | "visual_reference" | "supporting_image";
  fileName: string;
  sizeBytes: number;
}
export type FinalAttachmentV2 = FinalAttachmentSnapshotV1;

export interface ContentGenerationReferencesV3 {
  selected: FrozenReferenceSnapshotV2[];
  brandStyleImages: FrozenStyleImageSnapshotV1[];
  avatarStyleImageId: string | null;
  attachments: FinalAttachmentSnapshotV1[];
}

export interface ContentGenerationInputV3 {
  contractVersion: "content-generation-input.v3";
  generationId: string;
  brandCore: ApprovedBrandCoreSnapshotV2;
  brandRules: ApprovedBrandRulesSnapshotV1;
  subject: ContentSubjectV2;
  contentInstruction: string | null;
  product: ApprovedProductSnapshotV2 | null;
  researchEvidence: ResearchEvidenceSnapshotV1;
  references: ContentGenerationReferencesV3;
  selectedProposal: ContentProposalV2 & { id: string };
  userImageInstruction: string | null;
  outputSettings: ContentGenerationOutputSettingsV3;
  capturedAt: string;
}

export interface ImageGenerationAssetV1 {
  index: number;
  role: string;
  copy: string;
  visualDirection: string;
  evidenceIds: string[];
  productImageAssetIds: string[];
  attachmentIds: string[];
}

export interface ImageGenerationLogoPolicyV1 {
  allowGeneratedLogo: false;
  allowReservedLogoArea: false;
  allowExternalReferenceLogo: false;
  allowExistingProductPackagingLogo: true;
}

export interface ImageGenerationPackageV1 {
  contractVersion: "image-generation-package.v1";
  generationId: string;
  outputFormat: ContentOutputFormatV2;
  purpose: ContentPurposeV2;
  assetCount: number;
  aspectRatio: ContentAspectRatioV2;
  channelTargets: [ContentChannelTargetV2];
  assets: ImageGenerationAssetV1[];
  product: ApprovedProductSnapshotV2 | null;
  references: FrozenReferenceSnapshotV2[];
  brandStyleImages: FrozenStyleImageSnapshotV1[];
  avatarStyleImageId: string | null;
  attachments: FinalAttachmentSnapshotV1[];
  userImageInstruction: string | null;
  logoPolicy: ImageGenerationLogoPolicyV1;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256 = /^[0-9a-f]{64}$/i;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const OUTPUT_FORMATS: readonly ContentOutputFormatV2[] = ["card_news", "blog", "reel", "marketing_content"];
const CHANNELS: readonly ContentChannelTargetV2[] = ["instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export"];
const RATIOS: readonly ContentAspectRatioV2[] = ["1:1", "4:5", "16:9", "9:16"];
const REFERENCE_ROLES: readonly ReferenceRoleV2[] = ["planning", "copy_pattern", "visual_composition"];
const IMAGE_MIME_TYPES: readonly GeneratedImageMimeTypeV2[] = ["image/png", "image/jpeg", "image/webp"];
const INFORMATIONAL_TYPES: readonly InformationalProposalTypeV2[] = ["problem_solution", "how_to", "checklist", "comparison", "trend_insight", "q_and_a", "myth_fact"];
const DIFFERENTIATION_AXES: readonly ProposalDifferentiationAxisV2[] = ["target", "situation", "question", "appeal", "narrative", "informational_type"];

function fail(): never {
  throw new Error("worker_ai_content_v3_invalid");
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  return source;
}

function boundedString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) fail();
  return normalized;
}

function boundedStringAllowEmpty(value: unknown, maxLength: number): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (normalized.length > maxLength) fail();
  return normalized;
}

function nullableString(value: unknown, maxLength: number): string | null {
  return value === null ? null : boundedString(value, maxLength);
}

function boundedArray(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail();
  return value;
}

function boundedStrings(value: unknown, min: number, max: number, itemMax = 2_000): string[] {
  return boundedArray(value, min, max).map((item) => boundedString(item, itemMax));
}

function unique<T>(values: readonly T[]): void {
  if (new Set(values).size !== values.length) fail();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail();
  return value as T;
}

function uuid(value: unknown): string {
  const normalized = boundedString(value, 100);
  if (!UUID.test(normalized)) fail();
  return normalized.toLowerCase();
}

function sha256(value: unknown): string {
  const normalized = boundedString(value, 64);
  if (!SHA_256.test(normalized)) fail();
  return normalized.toLowerCase();
}

function utcTimestamp(value: unknown): string {
  const normalized = boundedString(value, 40);
  const match = UTC_TIMESTAMP.exec(normalized);
  if (!match) fail();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0").slice(0, 3));
  const parsed = new Date(normalized);
  if (
    year === 0
    || Number.isNaN(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
    || parsed.getUTCSeconds() !== second
    || parsed.getUTCMilliseconds() !== millisecond
  ) fail();
  return normalized;
}

function httpUrl(value: unknown): string {
  const normalized = boundedString(value, 2_000);
  try {
    if (!['http:', 'https:'].includes(new URL(normalized).protocol)) fail();
  } catch {
    fail();
  }
  return normalized;
}

function parseBrandCore(value: unknown): ApprovedBrandCoreSnapshotV2 {
  const source = exactObject(value, ["versionId", "companyOverview", "businessDescription", "primaryCategory", "detailedCategory", "primaryTarget", "differentiator", "coreAppeal"]);
  return {
    versionId: uuid(source.versionId),
    companyOverview: boundedString(source.companyOverview, 10_000),
    businessDescription: boundedString(source.businessDescription, 10_000),
    primaryCategory: boundedString(source.primaryCategory, 500),
    detailedCategory: boundedString(source.detailedCategory, 500),
    primaryTarget: boundedString(source.primaryTarget, 2_000),
    differentiator: boundedString(source.differentiator, 4_000),
    coreAppeal: boundedString(source.coreAppeal, 4_000),
  };
}

function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function parseBrandRulesSnapshot(value: unknown): ApprovedBrandRulesSnapshotV1 {
  const source = exactObject(value, ["versionId", "version", "content", "contentSha256"]);
  const content = parseBrandRulesContentV1(source.content);
  const contentSha256 = sha256(source.contentSha256);
  if (typeof source.version !== "number" || !Number.isInteger(source.version) || source.version < 1
    || contentSha256 !== createHash("sha256").update(canonicalJson(content)).digest("hex")) fail();
  return { versionId: uuid(source.versionId), version: source.version, content, contentSha256 };
}

function parseImageFields(value: unknown): Omit<ApprovedProductImageSnapshotV2, "assetId" | "role"> {
  const source = exactObject(value, ["storageUrl", "storagePath", "mimeType", "checksum"]);
  const mimeType = boundedString(source.mimeType, 100);
  if (!mimeType.startsWith("image/")) fail();
  return {
    storageUrl: httpUrl(source.storageUrl),
    storagePath: boundedString(source.storagePath, 2_000),
    mimeType,
    checksum: sha256(source.checksum),
  };
}

function parseFrozenImage(value: unknown): FrozenOwnedImageSnapshotV2 {
  const image = parseImageFields(value);
  const mimeType = oneOf(image.mimeType, IMAGE_MIME_TYPES);
  return { ...image, mimeType };
}

function parseProduct(value: unknown): ApprovedProductSnapshotV2 {
  const source = exactObject(value, ["id", "versionId", "kind", "name", "description", "features", "benefits", "cautions", "evergreenPurchaseInfo", "images"]);
  const kind = oneOf(source.kind, ["product", "service"] as const);
  const images = boundedArray(source.images, 0, 20).map((value) => {
    const image = exactObject(value, ["assetId", "role", "storageUrl", "storagePath", "mimeType", "checksum"]);
    return {
      assetId: uuid(image.assetId),
      role: oneOf(image.role, ["hero", "detail"] as const),
      ...parseImageFields({
        storageUrl: image.storageUrl,
        storagePath: image.storagePath,
        mimeType: image.mimeType,
        checksum: image.checksum,
      }),
    };
  });
  unique(images.map((image) => image.assetId));
  return {
    id: uuid(source.id),
    versionId: uuid(source.versionId),
    kind,
    name: boundedString(source.name, 500),
    description: boundedString(source.description, 10_000),
    features: boundedStrings(source.features, 0, 50),
    benefits: boundedStrings(source.benefits, 0, 50),
    cautions: boundedStrings(source.cautions, 0, 50),
    evergreenPurchaseInfo: boundedString(source.evergreenPurchaseInfo, 4_000),
    images,
  };
}

function parseReference(value: unknown): FrozenReferenceSnapshotV2 {
  const source = exactObject(value, ["referenceItemId", "snapshotId", "roles", "title", "sourceUrl", "capturedAt", "contentHash", "text", "image"]);
  const roles = boundedArray(source.roles, 1, 3).map((role) => oneOf(role, REFERENCE_ROLES));
  unique(roles);
  return {
    referenceItemId: uuid(source.referenceItemId),
    snapshotId: uuid(source.snapshotId),
    roles,
    title: boundedString(source.title, 500),
    sourceUrl: httpUrl(source.sourceUrl),
    capturedAt: utcTimestamp(source.capturedAt),
    contentHash: sha256(source.contentHash),
    text: boundedString(source.text, 50_000),
    image: source.image === null ? null : parseFrozenImage(source.image),
  };
}

function parseResearchEvidence(value: unknown): ResearchEvidenceSnapshotV1 {
  const source = exactObject(value, ["contractVersion", "decision", "reason", "queries", "capturedAt", "items"]);
  if (source.contractVersion !== "research-evidence.v1") fail();
  const decision = oneOf(source.decision, ["searched", "not_needed"] as const);
  const queries = boundedStrings(source.queries, 0, 8, 500);
  const items = boundedArray(source.items, 0, 8).map((value) => {
    const item = exactObject(value, ["id", "title", "url", "publisher", "publishedAt", "capturedAt", "claimSummary", "contentHash"]);
    return {
      id: uuid(item.id),
      title: boundedString(item.title, 500),
      url: httpUrl(item.url),
      publisher: nullableString(item.publisher, 500),
      publishedAt: item.publishedAt === null ? null : utcTimestamp(item.publishedAt),
      capturedAt: utcTimestamp(item.capturedAt),
      claimSummary: boundedString(item.claimSummary, 4_000),
      contentHash: sha256(item.contentHash),
    };
  });
  unique(items.map((item) => item.id));
  if (decision === "not_needed" && (queries.length !== 0 || items.length !== 0)) fail();
  return {
    contractVersion: "research-evidence.v1",
    decision,
    reason: boundedString(source.reason, 4_000),
    queries,
    capturedAt: utcTimestamp(source.capturedAt),
    items,
  };
}

function parseSubject(value: unknown): ContentSubjectV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "topic_text") {
    const source = exactObject(value, ["kind", "title"]);
    return { kind, title: boundedString(source.title, 500) };
  }
  if (kind === "topic_url") {
    const source = exactObject(value, ["kind", "requestedUrl", "canonicalUrl", "title", "text", "contentHash", "capturedAt"]);
    return {
      kind,
      requestedUrl: httpUrl(source.requestedUrl),
      canonicalUrl: httpUrl(source.canonicalUrl),
      title: nullableString(source.title, 500),
      text: boundedString(source.text, 50_000),
      contentHash: sha256(source.contentHash),
      capturedAt: utcTimestamp(source.capturedAt),
    };
  }
  if (kind === "reference") {
    const source = exactObject(value, ["kind", "referenceIds"]);
    const referenceIds = boundedArray(source.referenceIds, 1, 5).map(uuid);
    unique(referenceIds);
    return { kind, referenceIds };
  }
  return fail();
}

function parseOutputFormat(value: unknown): ContentOutputFormatV2 {
  return oneOf(value, OUTPUT_FORMATS);
}

function parseChannelTargets(value: unknown): [ContentChannelTargetV2] {
  const targets = boundedArray(value, 1, 1).map((item) => oneOf(item, CHANNELS));
  return [targets[0]!];
}

function validateOutputChannel(outputFormat: ContentOutputFormatV2, channel: ContentChannelTargetV2): void {
  if ((outputFormat === "blog") !== (channel === "blog_export")) fail();
}

function parseFinalOutputSettings(value: unknown): ContentGenerationOutputSettingsV3 {
  const source = exactObject(value, ["outputFormat", "channelTargets", "aspectRatio", "outputCount", "purpose"]);
  const outputFormat = parseOutputFormat(source.outputFormat);
  const channelTargets = parseChannelTargets(source.channelTargets);
  const aspectRatio = source.aspectRatio === null ? null : oneOf(source.aspectRatio, RATIOS);
  const purpose = oneOf(source.purpose, ["informational", "marketing"] as const);
  if (source.outputCount !== 1) fail();
  validateOutputChannel(outputFormat, channelTargets[0]);
  if (outputFormat === "blog" && aspectRatio !== null) fail();
  if (outputFormat === "reel" && aspectRatio !== "9:16") fail();
  if (outputFormat !== "blog" && aspectRatio === null) fail();
  return { outputFormat, channelTargets, aspectRatio, outputCount: 1, purpose };
}

function parsePurposeDetails(value: unknown): WorkerPurposeDetailsV3 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "informational") {
    const source = exactObject(value, ["kind", "question", "value", "whyNow", "learningPoints"]);
    return {
      kind,
      question: boundedString(source.question, 4_000),
      value: boundedString(source.value, 4_000),
      whyNow: boundedString(source.whyNow, 4_000),
      learningPoints: boundedStrings(source.learningPoints, 1, 20),
    };
  }
  if (kind === "marketing") {
    const source = exactObject(value, ["kind", "campaignObjective", "situationAndNeed", "productId", "targetSegment", "strengths", "limitations", "appeal", "buyingBarriers", "cta"]);
    return {
      kind,
      campaignObjective: boundedString(source.campaignObjective, 4_000),
      situationAndNeed: boundedString(source.situationAndNeed, 4_000),
      productId: uuid(source.productId),
      targetSegment: boundedString(source.targetSegment, 4_000),
      strengths: boundedStrings(source.strengths, 0, 20),
      limitations: boundedStrings(source.limitations, 0, 20),
      appeal: boundedString(source.appeal, 4_000),
      buyingBarriers: boundedStrings(source.buyingBarriers, 0, 20),
      cta: boundedString(source.cta, 4_000),
    };
  }
  return fail();
}

function parseProposal(value: unknown): ContentProposalV2 {
  const source = exactObject(value, ["conceptKey", "title", "informationalType", "oneLineIntent", "differentiator", "differentiationAxes", "target", "customerContext", "keyMessage", "hook", "selectionReason", "evidenceIds", "referenceIds", "outputFormat", "channelTargets", "assetCount", "outline", "purposeDetails"]);
  const informationalType = source.informationalType === null
    ? null
    : oneOf(source.informationalType, INFORMATIONAL_TYPES);
  const axes = boundedArray(source.differentiationAxes, 1, 6).map((axis) => oneOf(axis, DIFFERENTIATION_AXES));
  unique(axes);
  const evidenceIds = boundedArray(source.evidenceIds, 0, 8).map(uuid);
  const referenceIds = boundedArray(source.referenceIds, 0, 5).map(uuid);
  unique(evidenceIds);
  unique(referenceIds);
  const outline = boundedArray(source.outline, 1, 100).map((value) => {
    const item = exactObject(value, ["index", "role", "headline", "purpose"]);
    if (!Number.isSafeInteger(item.index) || (item.index as number) < 1) fail();
    return {
      index: item.index as number,
      role: boundedString(item.role, 200),
      headline: boundedString(item.headline, 500),
      purpose: boundedString(item.purpose, 4_000),
    };
  });
  outline.forEach((item, index) => {
    if (item.index !== index + 1) fail();
  });
  const purposeDetails = parsePurposeDetails(source.purposeDetails);
  if ((purposeDetails.kind === "informational") !== (informationalType !== null)) fail();
  const outputFormat = parseOutputFormat(source.outputFormat);
  const channelTargets = parseChannelTargets(source.channelTargets);
  validateOutputChannel(outputFormat, channelTargets[0]);
  const assetCount = source.assetCount === null
    ? null
    : Number.isSafeInteger(source.assetCount)
      && (source.assetCount as number) >= 1
      && (source.assetCount as number) <= 5
      ? source.assetCount as number
      : fail();
  if (outputFormat === "blog") {
    if (assetCount !== null) fail();
  } else if (assetCount === null || assetCount !== outline.length) {
    fail();
  }
  return {
    conceptKey: boundedString(source.conceptKey, 200),
    title: boundedString(source.title, 500),
    informationalType,
    oneLineIntent: boundedString(source.oneLineIntent, 4_000),
    differentiator: boundedString(source.differentiator, 4_000),
    differentiationAxes: axes,
    target: boundedString(source.target, 4_000),
    customerContext: boundedString(source.customerContext, 4_000),
    keyMessage: boundedString(source.keyMessage, 4_000),
    hook: boundedString(source.hook, 4_000),
    selectionReason: boundedString(source.selectionReason, 4_000),
    evidenceIds,
    referenceIds,
    outputFormat,
    channelTargets,
    assetCount,
    outline,
    purposeDetails,
  };
}

function parseProposalWithId(value: unknown): ContentProposalV2 & { id: string } {
  const source = exactObject(value, ["id", "conceptKey", "title", "informationalType", "oneLineIntent", "differentiator", "differentiationAxes", "target", "customerContext", "keyMessage", "hook", "selectionReason", "evidenceIds", "referenceIds", "outputFormat", "channelTargets", "assetCount", "outline", "purposeDetails"]);
  const { id, ...proposal } = source;
  return { id: uuid(id), ...parseProposal(proposal) };
}

function parseStyleImage(value: unknown): FrozenStyleImageSnapshotV1 {
  const source = exactObject(value, ["referenceItemId", "description", "tags", "storageUrl", "storagePath", "mimeType", "checksum"]);
  const tags = boundedStrings(source.tags, 0, 20, 200);
  unique(tags);
  return {
    referenceItemId: uuid(source.referenceItemId),
    description: boundedStringAllowEmpty(source.description, 4_000),
    tags,
    ...parseFrozenImage({
      storageUrl: source.storageUrl,
      storagePath: source.storagePath,
      mimeType: source.mimeType,
      checksum: source.checksum,
    }),
  };
}

function parseAttachment(value: unknown): FinalAttachmentSnapshotV1 {
  const source = exactObject(value, ["id", "role", "fileName", "mimeType", "sizeBytes", "checksum", "storageUrl", "storagePath"]);
  const role = oneOf(source.role, ["product_image", "visual_reference", "supporting_image"] as const);
  if (!Number.isSafeInteger(source.sizeBytes) || (source.sizeBytes as number) <= 0) fail();
  return {
    id: uuid(source.id),
    role,
    fileName: boundedString(source.fileName, 500),
    sizeBytes: source.sizeBytes as number,
    ...parseFrozenImage({
      storageUrl: source.storageUrl,
      storagePath: source.storagePath,
      mimeType: source.mimeType,
      checksum: source.checksum,
    }),
  };
}

function validateReferenceCollections(
  selected: FrozenReferenceSnapshotV2[],
  brandStyleImages: FrozenStyleImageSnapshotV1[],
  avatarStyleImageId: string | null,
  attachments: FinalAttachmentSnapshotV1[],
): void {
  unique(selected.map((reference) => reference.referenceItemId));
  unique(brandStyleImages.map((image) => image.referenceItemId));
  unique(attachments.map((item) => item.id));
  const referenceIds = new Set(selected.map((reference) => reference.referenceItemId));
  if (brandStyleImages.some((image) => !referenceIds.has(image.referenceItemId))) fail();
  if (avatarStyleImageId !== null && !brandStyleImages.some((image) => image.referenceItemId === avatarStyleImageId)) fail();
}

function parseFinalReferences(value: unknown): ContentGenerationReferencesV3 {
  const source = exactObject(value, ["selected", "brandStyleImages", "avatarStyleImageId", "attachments"]);
  const selected = boundedArray(source.selected, 0, 5).map(parseReference);
  const brandStyleImages = boundedArray(source.brandStyleImages, 0, 5).map(parseStyleImage);
  const avatarStyleImageId = source.avatarStyleImageId === null ? null : uuid(source.avatarStyleImageId);
  const attachments = boundedArray(source.attachments, 0, 20).map(parseAttachment);
  validateReferenceCollections(selected, brandStyleImages, avatarStyleImageId, attachments);
  return { selected, brandStyleImages, avatarStyleImageId, attachments };
}

function validatePurpose(
  purpose: ContentPurposeV2,
  product: ApprovedProductSnapshotV2 | null,
  evidence?: ResearchEvidenceSnapshotV1,
): void {
  if ((purpose === "informational") !== (product === null)) fail();
  if (purpose === "informational" && evidence && (evidence.decision !== "searched" || evidence.items.length < 1 || evidence.items.length > 8)) fail();
}

function validateFinalBindings(input: ContentGenerationInputV3): void {
  validatePurpose(input.outputSettings.purpose, input.product, input.researchEvidence);
  const proposal = input.selectedProposal;
  if (
    proposal.outputFormat !== input.outputSettings.outputFormat
    || proposal.channelTargets[0] !== input.outputSettings.channelTargets[0]
    || proposal.purposeDetails.kind !== input.outputSettings.purpose
  ) fail();
  if (proposal.purposeDetails.kind === "marketing" && proposal.purposeDetails.productId !== input.product?.id) fail();
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const referenceIds = new Set(input.references.selected.map((reference) => reference.referenceItemId));
  if (proposal.evidenceIds.some((id) => !evidenceIds.has(id))) fail();
  if (proposal.referenceIds.some((id) => !referenceIds.has(id))) fail();
  if (input.subject.kind === "reference" && input.subject.referenceIds.some((id) => !referenceIds.has(id))) fail();
}

export function parseContentGenerationInputV3(value: unknown): ContentGenerationInputV3 {
  const source = exactObject(value, ["contractVersion", "generationId", "brandCore", "brandRules", "subject", "contentInstruction", "product", "researchEvidence", "references", "selectedProposal", "userImageInstruction", "outputSettings", "capturedAt"]);
  if (source.contractVersion !== "content-generation-input.v3") fail();
  const result: ContentGenerationInputV3 = {
    contractVersion: "content-generation-input.v3",
    generationId: uuid(source.generationId),
    brandCore: parseBrandCore(source.brandCore),
    brandRules: parseBrandRulesSnapshot(source.brandRules),
    subject: parseSubject(source.subject),
    contentInstruction: nullableString(source.contentInstruction, 4_000),
    product: source.product === null ? null : parseProduct(source.product),
    researchEvidence: parseResearchEvidence(source.researchEvidence),
    references: parseFinalReferences(source.references),
    selectedProposal: parseProposalWithId(source.selectedProposal),
    userImageInstruction: nullableString(source.userImageInstruction, 4_000),
    outputSettings: parseFinalOutputSettings(source.outputSettings),
    capturedAt: utcTimestamp(source.capturedAt),
  };
  validateFinalBindings(result);
  return result;
}

function parseImageAsset(value: unknown): ImageGenerationAssetV1 {
  const source = exactObject(value, ["index", "role", "copy", "visualDirection", "evidenceIds", "productImageAssetIds", "attachmentIds"]);
  if (!Number.isSafeInteger(source.index) || (source.index as number) < 1) fail();
  const evidenceIds = boundedArray(source.evidenceIds, 0, 8).map(uuid);
  const productImageAssetIds = boundedArray(source.productImageAssetIds, 0, 20).map(uuid);
  const attachmentIds = boundedArray(source.attachmentIds, 0, 20).map(uuid);
  unique(evidenceIds);
  unique(productImageAssetIds);
  unique(attachmentIds);
  return {
    index: source.index as number,
    role: boundedString(source.role, 200),
    copy: boundedString(source.copy, 4_000),
    visualDirection: boundedString(source.visualDirection, 4_000),
    evidenceIds,
    productImageAssetIds,
    attachmentIds,
  };
}

export function parseImageGenerationPackageV1(value: unknown): ImageGenerationPackageV1 {
  const source = exactObject(value, ["contractVersion", "generationId", "outputFormat", "purpose", "assetCount", "aspectRatio", "channelTargets", "assets", "product", "references", "brandStyleImages", "avatarStyleImageId", "attachments", "userImageInstruction", "logoPolicy"]);
  if (
    source.contractVersion !== "image-generation-package.v1"
    || !Number.isSafeInteger(source.assetCount)
    || (source.assetCount as number) < 1
    || (source.assetCount as number) > 5
  ) fail();
  const outputFormat = parseOutputFormat(source.outputFormat);
  const purpose = oneOf(source.purpose, ["informational", "marketing"] as const);
  const aspectRatio = oneOf(source.aspectRatio, RATIOS);
  const channelTargets = parseChannelTargets(source.channelTargets);
  validateOutputChannel(outputFormat, channelTargets[0]);
  if (outputFormat === "reel" && aspectRatio !== "9:16") fail();
  const references = boundedArray(source.references, 0, 5).map(parseReference);
  const brandStyleImages = boundedArray(source.brandStyleImages, 0, 5).map(parseStyleImage);
  const avatarStyleImageId = source.avatarStyleImageId === null ? null : uuid(source.avatarStyleImageId);
  const attachments = boundedArray(source.attachments, 0, 20).map(parseAttachment);
  validateReferenceCollections(references, brandStyleImages, avatarStyleImageId, attachments);
  const product = source.product === null ? null : parseProduct(source.product);
  validatePurpose(purpose, product);
  const assets = boundedArray(source.assets, source.assetCount as number, source.assetCount as number).map(parseImageAsset);
  assets.forEach((asset, index) => {
    if (asset.index !== index + 1) fail();
  });
  const productImageIds = new Set(product?.images.map((image) => image.assetId) ?? []);
  const attachmentIds = new Set(attachments.map((item) => item.id));
  if (assets.some((asset) => (
    asset.productImageAssetIds.some((id) => !productImageIds.has(id))
    || asset.attachmentIds.some((id) => !attachmentIds.has(id))
  ))) fail();
  const logoPolicy = exactObject(source.logoPolicy, ["allowGeneratedLogo", "allowReservedLogoArea", "allowExternalReferenceLogo", "allowExistingProductPackagingLogo"]);
  if (
    logoPolicy.allowGeneratedLogo !== false
    || logoPolicy.allowReservedLogoArea !== false
    || logoPolicy.allowExternalReferenceLogo !== false
    || logoPolicy.allowExistingProductPackagingLogo !== true
  ) fail();
  return {
    contractVersion: "image-generation-package.v1",
    generationId: uuid(source.generationId),
    outputFormat,
    purpose,
    assetCount: source.assetCount as number,
    aspectRatio,
    channelTargets,
    assets,
    product,
    references,
    brandStyleImages,
    avatarStyleImageId,
    attachments,
    userImageInstruction: nullableString(source.userImageInstruction, 4_000),
    logoPolicy: {
      allowGeneratedLogo: false,
      allowReservedLogoArea: false,
      allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  };
}
