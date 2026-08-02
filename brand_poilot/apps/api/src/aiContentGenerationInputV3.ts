import type {
  ApprovedBrandCoreSnapshotV2,
  ApprovedProductSnapshotV2,
  ContentChannelV2,
  ContentGenerationInputV3,
  ContentFinalizationDraftV2,
  ContentGenerationStartV2,
  ContentGenerationOutputSettingsV3,
  ContentOrchestrationV2,
  ContentOutputFormatV2,
  ContentOutputSettingsV2,
  ContentProposalSetV2,
  ContentProposalV2,
  ContentPurposeV2,
  ContentRatioV2,
  ContentReferenceRoleV2,
  ContentSeedV2,
  FinalAttachmentV2,
  FrozenReferenceImageSnapshotV2,
  FrozenReferenceSnapshotV2,
  FrozenStyleImageV2,
  GeneratedImageMimeTypeV2,
  ImageGenerationAssetV1,
  ImageGenerationPackageV1,
  ProposalInputOutputSettingsV2,
  ProposalInputSnapshotV2,
  ProposalSubjectV2,
  ResearchEvidenceSnapshotV1,
} from "./aiContentContracts.js";

export type {
  ContentFinalizationDraftV2,
  ContentGenerationStartV2,
  ContentGenerationInputV3,
  ContentOrchestrationV2,
  ContentProposalSetV2,
  ContentProposalV2,
  FinalAttachmentV2,
  FrozenStyleImageV2,
  ImageGenerationPackageV1,
  ProposalInputSnapshotV2,
  ProposalSubjectV2,
  ResearchEvidenceSnapshotV1,
} from "./aiContentContracts.js";

export function parseContentFinalizationDraftV2(value: unknown): ContentFinalizationDraftV2 {
  try {
    const source = exactObject(value, [
      "contractVersion",
      "avatarStyleImageId",
      "userImageInstruction",
      "attachmentIds",
    ]);
    if (source.contractVersion !== "content-finalization-draft.v2") throw new Error();
    const attachmentIds = boundedArray(source.attachmentIds, 0, 5).map(uuid);
    unique(attachmentIds);
    return {
      contractVersion: source.contractVersion,
      avatarStyleImageId: source.avatarStyleImageId === null ? null : uuid(source.avatarStyleImageId),
      userImageInstruction: nullableString(source.userImageInstruction, 4_000),
      attachmentIds,
    };
  } catch {
    throw new Error("content_finalization_draft_v2_invalid");
  }
}

export function parseContentGenerationStartV2(value: unknown): ContentGenerationStartV2 {
  try {
    const source = exactObject(value, ["contractVersion", "idempotencyKey"]);
    if (source.contractVersion !== "content-generation-start.v2") throw new Error();
    return {
      contractVersion: source.contractVersion,
      idempotencyKey: boundedString(source.idempotencyKey, 200),
    };
  } catch {
    throw new Error("content_generation_start_v2_invalid");
  }
}

const CODE = "content_orchestration_v2_invalid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256 = /^[0-9a-f]{64}$/i;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const channels = new Set<ContentChannelV2>([
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
]);
const referenceRoles = new Set<ContentReferenceRoleV2>([
  "planning",
  "copy_pattern",
  "visual_composition",
]);
const formats = new Set<ContentOutputFormatV2>([
  "card_news",
  "blog",
  "reel",
  "marketing_content",
]);
const ratios = new Set<ContentRatioV2>(["1:1", "4:5", "16:9", "9:16"]);
const imageMimeTypes = new Set<GeneratedImageMimeTypeV2>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const informationalTypes = new Set<NonNullable<ContentProposalV2["informationalType"]>>([
  "problem_solution",
  "how_to",
  "checklist",
  "comparison",
  "trend_insight",
  "q_and_a",
  "myth_fact",
]);
const differentiationAxes = new Set<ContentProposalV2["differentiationAxes"][number]>([
  "target",
  "situation",
  "question",
  "appeal",
  "narrative",
  "informational_type",
]);

function fail(): never {
  throw new Error(CODE);
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const source = value as Record<string, unknown>;
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
  return source;
}

function boundedString(value: unknown, maxLength = 4_000): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) fail();
  return normalized;
}

function boundedStringAllowEmpty(value: unknown, maxLength = 4_000): string {
  if (typeof value !== "string") fail();
  const normalized = value.trim();
  if (normalized.length > maxLength) fail();
  return normalized;
}

function nullableString(value: unknown, maxLength = 4_000): string | null {
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
    if (!["http:", "https:"].includes(new URL(normalized).protocol)) fail();
  } catch {
    fail();
  }
  return normalized;
}

function purpose(value: unknown): ContentPurposeV2 {
  if (value !== "informational" && value !== "marketing") fail();
  return value;
}

function outputFormat(value: unknown): ContentOutputFormatV2 {
  if (typeof value !== "string" || !formats.has(value as ContentOutputFormatV2)) fail();
  return value as ContentOutputFormatV2;
}

function parseAspectRatio(value: unknown): ContentRatioV2 {
  if (typeof value !== "string" || !ratios.has(value as ContentRatioV2)) fail();
  return value as ContentRatioV2;
}

function channelTuple(value: unknown): [ContentChannelV2] {
  if (
    !Array.isArray(value)
    || value.length !== 1
    || typeof value[0] !== "string"
    || !channels.has(value[0] as ContentChannelV2)
  ) fail();
  return [value[0] as ContentChannelV2];
}

function validateOutputChannel(output: ContentOutputFormatV2, channel: ContentChannelV2): void {
  if ((output === "blog") !== (channel === "blog_export")) fail();
}

function parseOutputSettings(value: unknown): ContentOutputSettingsV2 {
  const source = exactObject(value, ["outputFormat", "channelTargets", "aspectRatio", "outputCount"]);
  const result: ContentOutputSettingsV2 = {
    outputFormat: outputFormat(source.outputFormat),
    channelTargets: channelTuple(source.channelTargets),
    aspectRatio: source.aspectRatio === null ? null : parseAspectRatio(source.aspectRatio),
    outputCount: source.outputCount === 1 ? 1 : fail(),
  };
  validateOutputChannel(result.outputFormat, result.channelTargets[0]);
  if (result.outputFormat === "blog" && result.aspectRatio !== null) fail();
  if (result.outputFormat === "reel" && result.aspectRatio !== "9:16") fail();
  if (result.outputFormat !== "blog" && result.aspectRatio === null) fail();
  return result;
}

function parseFinalOutputSettings(value: unknown): ContentGenerationOutputSettingsV3 {
  const source = exactObject(value, [
    "outputFormat",
    "channelTargets",
    "aspectRatio",
    "outputCount",
    "purpose",
  ]);
  const result: ContentGenerationOutputSettingsV3 = {
    outputFormat: outputFormat(source.outputFormat),
    channelTargets: channelTuple(source.channelTargets),
    aspectRatio: source.aspectRatio === null ? null : parseAspectRatio(source.aspectRatio),
    outputCount: source.outputCount === 1 ? 1 : fail(),
    purpose: purpose(source.purpose),
  };
  validateOutputChannel(result.outputFormat, result.channelTargets[0]);
  if (result.outputFormat === "blog" && result.aspectRatio !== null) fail();
  if (result.outputFormat === "reel" && result.aspectRatio !== "9:16") fail();
  if (result.outputFormat !== "blog" && result.aspectRatio === null) fail();
  return result;
}

function parseSeed(value: unknown): ContentSeedV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "topic_text") {
    const source = exactObject(value, ["kind", "title"]);
    return { kind, title: boundedString(source.title, 500) };
  }
  if (kind === "topic_url") {
    const source = exactObject(value, ["kind", "url"]);
    return { kind, url: httpUrl(source.url) };
  }
  if (kind === "reference") {
    const source = exactObject(value, ["kind", "items"]);
    const items = boundedArray(source.items, 1, 5).map((item) => {
      const reference = exactObject(item, ["referenceId", "roles"]);
      const roles = boundedArray(reference.roles, 1, 3).map((role) => {
        if (typeof role !== "string" || !referenceRoles.has(role as ContentReferenceRoleV2)) fail();
        return role as ContentReferenceRoleV2;
      });
      unique(roles);
      return { referenceId: uuid(reference.referenceId), roles };
    });
    unique(items.map((item) => item.referenceId));
    return { kind, items };
  }
  return fail();
}

export function parseContentOrchestrationV2(value: unknown): ContentOrchestrationV2 {
  const source = exactObject(value, [
    "contractVersion",
    "brandId",
    "purpose",
    "seed",
    "contentInstruction",
    "productId",
    "outputSettings",
  ]);
  if (source.contractVersion !== "content-orchestration.v2") fail();
  const result: ContentOrchestrationV2 = {
    contractVersion: source.contractVersion,
    brandId: uuid(source.brandId),
    purpose: purpose(source.purpose),
    seed: parseSeed(source.seed),
    contentInstruction: nullableString(source.contentInstruction, 4_000),
    productId: source.productId === null ? null : uuid(source.productId),
    outputSettings: parseOutputSettings(source.outputSettings),
  };
  if ((result.purpose === "informational") !== (result.productId === null)) fail();
  return result;
}

function parseBrandCore(value: unknown): ApprovedBrandCoreSnapshotV2 {
  const source = exactObject(value, [
    "versionId",
    "companyOverview",
    "businessDescription",
    "primaryCategory",
    "detailedCategory",
    "primaryTarget",
    "differentiator",
    "coreAppeal",
  ]);
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

function parseImageFields(value: unknown): {
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  checksum: string;
} {
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

function parseFrozenImage(value: unknown): FrozenReferenceImageSnapshotV2 {
  const image = parseImageFields(value);
  if (!imageMimeTypes.has(image.mimeType as GeneratedImageMimeTypeV2)) fail();
  return { ...image, mimeType: image.mimeType as GeneratedImageMimeTypeV2 };
}

function parseProduct(value: unknown): ApprovedProductSnapshotV2 {
  const source = exactObject(value, [
    "id",
    "versionId",
    "kind",
    "name",
    "description",
    "features",
    "benefits",
    "cautions",
    "evergreenPurchaseInfo",
    "images",
  ]);
  if (source.kind !== "product" && source.kind !== "service") fail();
  const images = boundedArray(source.images, 0, 20).map((item) => {
    const image = exactObject(item, ["assetId", "role", "storageUrl", "storagePath", "mimeType", "checksum"]);
    if (image.role !== "hero" && image.role !== "detail") fail();
    const role: "hero" | "detail" = image.role;
    return {
      assetId: uuid(image.assetId),
      role,
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
    kind: source.kind,
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
  const source = exactObject(value, [
    "referenceItemId",
    "snapshotId",
    "roles",
    "title",
    "sourceUrl",
    "capturedAt",
    "contentHash",
    "text",
    "image",
  ]);
  const roles = boundedArray(source.roles, 1, 3).map((role) => {
    if (typeof role !== "string" || !referenceRoles.has(role as ContentReferenceRoleV2)) fail();
    return role as ContentReferenceRoleV2;
  });
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

export function parseResearchEvidenceSnapshotV1(value: unknown): ResearchEvidenceSnapshotV1 {
  const source = exactObject(value, [
    "contractVersion",
    "decision",
    "reason",
    "queries",
    "capturedAt",
    "items",
  ]);
  if (
    source.contractVersion !== "research-evidence.v1"
    || (source.decision !== "searched" && source.decision !== "not_needed")
  ) fail();
  const queries = boundedStrings(source.queries, 0, 8, 500);
  const items = boundedArray(source.items, 0, 8).map((item) => {
    const evidence = exactObject(item, [
      "id",
      "title",
      "url",
      "publisher",
      "publishedAt",
      "capturedAt",
      "claimSummary",
      "contentHash",
    ]);
    return {
      id: uuid(evidence.id),
      title: boundedString(evidence.title, 500),
      url: httpUrl(evidence.url),
      publisher: nullableString(evidence.publisher, 500),
      publishedAt: evidence.publishedAt === null ? null : utcTimestamp(evidence.publishedAt),
      capturedAt: utcTimestamp(evidence.capturedAt),
      claimSummary: boundedString(evidence.claimSummary, 4_000),
      contentHash: sha256(evidence.contentHash),
    };
  });
  unique(items.map((item) => item.id));
  if (source.decision === "not_needed" && (queries.length !== 0 || items.length !== 0)) fail();
  return {
    contractVersion: source.contractVersion,
    decision: source.decision,
    reason: boundedString(source.reason, 4_000),
    queries,
    capturedAt: utcTimestamp(source.capturedAt),
    items,
  };
}

function parseSubject(value: unknown): ProposalSubjectV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "topic_text") {
    const source = exactObject(value, ["kind", "title"]);
    return { kind, title: boundedString(source.title, 500) };
  }
  if (kind === "topic_url") {
    const source = exactObject(value, [
      "kind",
      "requestedUrl",
      "canonicalUrl",
      "title",
      "text",
      "contentHash",
      "capturedAt",
    ]);
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

function parseSettingsWithPurpose(value: unknown): ProposalInputOutputSettingsV2 {
  const source = exactObject(value, [
    "outputFormat",
    "channelTargets",
    "aspectRatio",
    "outputCount",
    "purpose",
  ]);
  return {
    ...parseOutputSettings({
      outputFormat: source.outputFormat,
      channelTargets: source.channelTargets,
      aspectRatio: source.aspectRatio,
      outputCount: source.outputCount,
    }),
    purpose: purpose(source.purpose),
  };
}

function validatePurpose(
  requestedPurpose: ContentPurposeV2,
  product: ApprovedProductSnapshotV2 | null,
  evidence?: ResearchEvidenceSnapshotV1,
): void {
  if ((requestedPurpose === "informational") !== (product === null)) fail();
  if (
    requestedPurpose === "informational"
    && evidence
    && (evidence.decision !== "searched" || evidence.items.length < 1 || evidence.items.length > 8)
  ) fail();
}

export function parseProposalInputSnapshotV2(value: unknown): ProposalInputSnapshotV2 {
  const source = exactObject(value, [
    "contractVersion",
    "brandCore",
    "subject",
    "contentInstruction",
    "product",
    "references",
    "researchEvidence",
    "outputSettings",
    "capturedAt",
  ]);
  if (source.contractVersion !== "proposal-input.v2") fail();
  const references = boundedArray(source.references, 0, 5).map(parseReference);
  unique(references.map((reference) => reference.referenceItemId));
  const subject = parseSubject(source.subject);
  if (
    subject.kind === "reference"
    && subject.referenceIds.some((id) => !references.some((reference) => reference.referenceItemId === id))
  ) fail();
  const product = source.product === null ? null : parseProduct(source.product);
  const researchEvidence = parseResearchEvidenceSnapshotV1(source.researchEvidence);
  const outputSettings = parseSettingsWithPurpose(source.outputSettings);
  validatePurpose(outputSettings.purpose, product, researchEvidence);
  return {
    contractVersion: source.contractVersion,
    brandCore: parseBrandCore(source.brandCore),
    subject,
    contentInstruction: nullableString(source.contentInstruction, 4_000),
    product,
    references,
    researchEvidence,
    outputSettings,
    capturedAt: utcTimestamp(source.capturedAt),
  };
}

function parsePurposeDetails(value: unknown): ContentProposalV2["purposeDetails"] {
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
    const source = exactObject(value, [
      "kind",
      "campaignObjective",
      "situationAndNeed",
      "productId",
      "targetSegment",
      "strengths",
      "limitations",
      "appeal",
      "buyingBarriers",
      "cta",
    ]);
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
  const source = exactObject(value, [
    "conceptKey",
    "title",
    "informationalType",
    "oneLineIntent",
    "differentiator",
    "differentiationAxes",
    "target",
    "customerContext",
    "keyMessage",
    "hook",
    "selectionReason",
    "evidenceIds",
    "referenceIds",
    "outputFormat",
    "channelTargets",
    "assetCount",
    "outline",
    "purposeDetails",
  ]);
  const informationalType = source.informationalType === null
    ? null
    : typeof source.informationalType === "string"
      ? source.informationalType
      : fail();
  if (
    informationalType !== null
    && !informationalTypes.has(informationalType as NonNullable<ContentProposalV2["informationalType"]>)
  ) fail();
  const axes = boundedArray(source.differentiationAxes, 1, 6).map((axis) => {
    if (typeof axis !== "string" || !differentiationAxes.has(axis as ContentProposalV2["differentiationAxes"][number])) fail();
    return axis as ContentProposalV2["differentiationAxes"][number];
  });
  unique(axes);
  const evidenceIds = boundedArray(source.evidenceIds, 0, 8).map(uuid);
  const referenceIds = boundedArray(source.referenceIds, 0, 5).map(uuid);
  unique(evidenceIds);
  unique(referenceIds);
  const outline = boundedArray(source.outline, 1, 100).map((item) => {
    const part = exactObject(item, ["index", "role", "headline", "purpose"]);
    if (!Number.isSafeInteger(part.index) || (part.index as number) < 1) fail();
    return {
      index: part.index as number,
      role: boundedString(part.role, 200),
      headline: boundedString(part.headline, 500),
      purpose: boundedString(part.purpose, 4_000),
    };
  });
  outline.forEach((item, index) => {
    if (item.index !== index + 1) fail();
  });
  const purposeDetails = parsePurposeDetails(source.purposeDetails);
  if ((purposeDetails.kind === "informational") !== (informationalType !== null)) fail();
  const parsedOutputFormat = outputFormat(source.outputFormat);
  const channelTargets = channelTuple(source.channelTargets);
  validateOutputChannel(parsedOutputFormat, channelTargets[0]);
  const assetCount = source.assetCount === null
    ? null
    : Number.isSafeInteger(source.assetCount)
      && (source.assetCount as number) >= 1
      && (source.assetCount as number) <= 5
      ? source.assetCount as number
      : fail();
  if (parsedOutputFormat === "blog") {
    if (assetCount !== null) fail();
  } else if (assetCount === null || assetCount !== outline.length) {
    fail();
  }
  return {
    conceptKey: boundedString(source.conceptKey, 200),
    title: boundedString(source.title, 500),
    informationalType: informationalType as ContentProposalV2["informationalType"],
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
    outputFormat: parsedOutputFormat,
    channelTargets,
    assetCount,
    outline,
    purposeDetails,
  };
}

function proposalDifferentiationValue(
  proposal: ContentProposalV2,
  axis: ContentProposalV2["differentiationAxes"][number],
): string | null {
  switch (axis) {
    case "target":
      return proposal.target;
    case "situation":
      return proposal.customerContext;
    case "question":
      return proposal.purposeDetails.kind === "informational"
        ? proposal.purposeDetails.question
        : proposal.hook;
    case "appeal":
      return proposal.purposeDetails.kind === "marketing"
        ? proposal.purposeDetails.appeal
        : proposal.keyMessage;
    case "narrative":
      return JSON.stringify({
        oneLineIntent: proposal.oneLineIntent,
        hook: proposal.hook,
        outline: proposal.outline,
      });
    case "informational_type":
      return proposal.informationalType;
  }
}

function validateSubstantiveDifferentiation(proposals: ContentProposalSetV2["proposals"]): void {
  for (let leftIndex = 0; leftIndex < proposals.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < proposals.length; rightIndex += 1) {
      const left = proposals[leftIndex];
      const right = proposals[rightIndex];
      if (!left || !right) fail();
      const declaredAxes = new Set([...left.differentiationAxes, ...right.differentiationAxes]);
      const hasSubstantiveDifference = [...declaredAxes].some((axis) => (
        proposalDifferentiationValue(left, axis) !== proposalDifferentiationValue(right, axis)
      ));
      if (!hasSubstantiveDifference) fail();
    }
  }
}

export function parseContentProposalSetV2(value: unknown): ContentProposalSetV2 {
  const source = exactObject(value, ["contractVersion", "proposals"]);
  if (source.contractVersion !== "content-proposal.v2") fail();
  const proposals = boundedArray(source.proposals, 3, 3).map(parseProposal) as ContentProposalSetV2["proposals"];
  unique(proposals.map((proposal) => proposal.conceptKey));
  validateSubstantiveDifferentiation(proposals);
  return { contractVersion: source.contractVersion, proposals };
}

function parseStyleImage(value: unknown): FrozenStyleImageV2 {
  const source = exactObject(value, [
    "referenceItemId",
    "description",
    "tags",
    "storageUrl",
    "storagePath",
    "mimeType",
    "checksum",
  ]);
  const image = parseFrozenImage({
    storageUrl: source.storageUrl,
    storagePath: source.storagePath,
    mimeType: source.mimeType,
    checksum: source.checksum,
  });
  const tags = boundedStrings(source.tags, 0, 20, 200);
  unique(tags);
  return {
    referenceItemId: uuid(source.referenceItemId),
    description: boundedStringAllowEmpty(source.description, 4_000),
    tags,
    ...image,
  };
}

function parseAttachment(value: unknown): FinalAttachmentV2 {
  const source = exactObject(value, [
    "id",
    "role",
    "fileName",
    "mimeType",
    "sizeBytes",
    "checksum",
    "storageUrl",
    "storagePath",
  ]);
  if (
    source.role !== "product_image"
    && source.role !== "visual_reference"
    && source.role !== "supporting_image"
  ) fail();
  if (!Number.isSafeInteger(source.sizeBytes) || (source.sizeBytes as number) <= 0) fail();
  const image = parseFrozenImage({
    storageUrl: source.storageUrl,
    storagePath: source.storagePath,
    mimeType: source.mimeType,
    checksum: source.checksum,
  });
  return {
    id: uuid(source.id),
    role: source.role,
    fileName: boundedString(source.fileName, 500),
    sizeBytes: source.sizeBytes as number,
    ...image,
  };
}

function parseProposalWithId(value: unknown): ContentProposalV2 & { id: string } {
  const source = exactObject(value, [
    "id",
    "conceptKey",
    "title",
    "informationalType",
    "oneLineIntent",
    "differentiator",
    "differentiationAxes",
    "target",
    "customerContext",
    "keyMessage",
    "hook",
    "selectionReason",
    "evidenceIds",
    "referenceIds",
    "outputFormat",
    "channelTargets",
    "assetCount",
    "outline",
    "purposeDetails",
  ]);
  const { id, ...proposal } = source;
  return { id: uuid(id), ...parseProposal(proposal) };
}

function parseFinalReferences(value: unknown): ContentGenerationInputV3["references"] {
  const source = exactObject(value, [
    "selected",
    "brandStyleImages",
    "avatarStyleImageId",
    "attachments",
  ]);
  const selected = boundedArray(source.selected, 0, 5).map(parseReference);
  const brandStyleImages = boundedArray(source.brandStyleImages, 0, 5).map(parseStyleImage);
  const attachments = boundedArray(source.attachments, 0, 20).map(parseAttachment);
  unique(selected.map((reference) => reference.referenceItemId));
  unique(brandStyleImages.map((image) => image.referenceItemId));
  unique(attachments.map((attachment) => attachment.id));
  const avatarStyleImageId = source.avatarStyleImageId === null ? null : uuid(source.avatarStyleImageId);
  if (
    avatarStyleImageId !== null
    && !brandStyleImages.some((image) => image.referenceItemId === avatarStyleImageId)
  ) fail();
  return { selected, brandStyleImages, avatarStyleImageId, attachments };
}

function validateFinalBindings(input: ContentGenerationInputV3): void {
  validatePurpose(input.outputSettings.purpose, input.product, input.researchEvidence);
  const proposal = input.selectedProposal;
  if (
    proposal.outputFormat !== input.outputSettings.outputFormat
    || proposal.channelTargets[0] !== input.outputSettings.channelTargets[0]
    || proposal.purposeDetails.kind !== input.outputSettings.purpose
  ) fail();
  if (
    proposal.purposeDetails.kind === "marketing"
    && proposal.purposeDetails.productId !== input.product?.id
  ) fail();
  const evidenceIds = new Set(input.researchEvidence.items.map((item) => item.id));
  const referenceIds = new Set(input.references.selected.map((reference) => reference.referenceItemId));
  if (proposal.evidenceIds.some((id) => !evidenceIds.has(id))) fail();
  if (proposal.referenceIds.some((id) => !referenceIds.has(id))) fail();
  if (
    input.subject.kind === "reference"
    && input.subject.referenceIds.some((id) => !referenceIds.has(id))
  ) fail();
}

export function parseContentGenerationInputV3(value: unknown): ContentGenerationInputV3 {
  const source = exactObject(value, [
    "contractVersion",
    "generationId",
    "brandCore",
    "subject",
    "contentInstruction",
    "product",
    "researchEvidence",
    "references",
    "selectedProposal",
    "userImageInstruction",
    "outputSettings",
    "capturedAt",
  ]);
  if (source.contractVersion !== "content-generation-input.v3") fail();
  const result: ContentGenerationInputV3 = {
    contractVersion: source.contractVersion,
    generationId: uuid(source.generationId),
    brandCore: parseBrandCore(source.brandCore),
    subject: parseSubject(source.subject),
    contentInstruction: nullableString(source.contentInstruction, 4_000),
    product: source.product === null ? null : parseProduct(source.product),
    researchEvidence: parseResearchEvidenceSnapshotV1(source.researchEvidence),
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
  const source = exactObject(value, [
    "index",
    "role",
    "copy",
    "visualDirection",
    "evidenceIds",
    "productImageAssetIds",
    "attachmentIds",
  ]);
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
  const source = exactObject(value, [
    "contractVersion",
    "generationId",
    "outputFormat",
    "purpose",
    "assetCount",
    "aspectRatio",
    "channelTargets",
    "assets",
    "product",
    "references",
    "brandStyleImages",
    "avatarStyleImageId",
    "attachments",
    "userImageInstruction",
    "logoPolicy",
  ]);
  if (
    source.contractVersion !== "image-generation-package.v1"
    || !Number.isSafeInteger(source.assetCount)
    || (source.assetCount as number) < 1
    || (source.assetCount as number) > 5
  ) fail();
  const parsedOutputFormat = outputFormat(source.outputFormat);
  const parsedPurpose = purpose(source.purpose);
  const aspectRatio = parseAspectRatio(source.aspectRatio);
  const channelTargets = channelTuple(source.channelTargets);
  validateOutputChannel(parsedOutputFormat, channelTargets[0]);
  if (parsedOutputFormat === "reel" && aspectRatio !== "9:16") fail();
  const references = boundedArray(source.references, 0, 5).map(parseReference);
  const brandStyleImages = boundedArray(source.brandStyleImages, 0, 5).map(parseStyleImage);
  const attachments = boundedArray(source.attachments, 0, 20).map(parseAttachment);
  unique(references.map((reference) => reference.referenceItemId));
  unique(brandStyleImages.map((image) => image.referenceItemId));
  unique(attachments.map((attachment) => attachment.id));
  const avatarStyleImageId = source.avatarStyleImageId === null ? null : uuid(source.avatarStyleImageId);
  if (
    avatarStyleImageId !== null
    && !brandStyleImages.some((image) => image.referenceItemId === avatarStyleImageId)
  ) fail();
  const product = source.product === null ? null : parseProduct(source.product);
  validatePurpose(parsedPurpose, product);
  const assets = boundedArray(
    source.assets,
    source.assetCount as number,
    source.assetCount as number,
  ).map(parseImageAsset);
  assets.forEach((asset, index) => {
    if (asset.index !== index + 1) fail();
  });
  const productImageIds = new Set(product?.images.map((image) => image.assetId) ?? []);
  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  if (
    assets.some((asset) => (
      asset.productImageAssetIds.some((id) => !productImageIds.has(id))
      || asset.attachmentIds.some((id) => !attachmentIds.has(id))
    ))
  ) fail();
  const logoPolicy = exactObject(source.logoPolicy, [
    "allowGeneratedLogo",
    "allowReservedLogoArea",
    "allowExternalReferenceLogo",
    "allowExistingProductPackagingLogo",
  ]);
  if (
    logoPolicy.allowGeneratedLogo !== false
    || logoPolicy.allowReservedLogoArea !== false
    || logoPolicy.allowExternalReferenceLogo !== false
    || logoPolicy.allowExistingProductPackagingLogo !== true
  ) fail();
  return {
    contractVersion: source.contractVersion,
    generationId: uuid(source.generationId),
    outputFormat: parsedOutputFormat,
    purpose: parsedPurpose,
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
