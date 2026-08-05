import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const CONTENT_OUTPUT_FORMATS = ["card_news", "blog", "reel"] as const;
export const CONTENT_PURPOSES = ["informational", "marketing"] as const;
export const CONTENT_PLANNER_MODEL_ID = "gpt-5.6-terra" as const;
export const CONTENT_ORCHESTRATION_VERSION = "content-orchestration.v2" as const;
export const CONTENT_PROPOSAL_CONTRACT_VERSIONS = {
  request: "content-proposal-request.v2",
  baseInput: "proposal-base-input.v2",
  composedInput: "proposal-input.v2",
  output: "content-proposal.v2",
} as const;
export const CONTENT_PROPOSAL_PROMPT_VERSION = "proposal.writer.v2" as const;
export const RESEARCH_EVIDENCE_VERSION = "research-evidence.v1" as const;
export const CONTENT_GENERATION_INPUT_VERSION = "content-generation-input.v3" as const;
export const CONTENT_PROMPT_BINDING_VERSION = "content-prompt-binding.v1" as const;
export const IMAGE_GENERATION_PACKAGE_VERSION = "image-generation-package.v1" as const;
export const AI_CONTENT_MANIFEST_VERSION = "ai-content.v3" as const;
export const GENERATED_CONTENT_CATALOG_VERSION = "content-catalog.v1" as const;

export const CONTENT_PROMPT_DEFINITION_VERSIONS = {
  card_news: {
    informational: "planner.card_news.informational.v1",
    marketing: "planner.card_news.marketing.v1",
  },
  blog: {
    informational: "planner.blog.informational.v1",
    marketing: "planner.blog.marketing.v1",
  },
  reel: {
    informational: "planner.reel.informational.v1",
    marketing: "planner.reel.marketing.v1",
  },
} as const satisfies Record<ContentStudioOutputFormat, Record<ContentPurpose, string>>;

export const CONTENT_IMAGE_PROMPT_VERSIONS = {
  card_news: {
    informational: "image.card_news.informational.v1",
    marketing: "image.card_news.marketing.v1",
  },
  blog: {
    informational: "image.blog.informational.v1",
    marketing: "image.blog.marketing.v1",
  },
  reel: {
    informational: "image.reel.informational.v1",
    marketing: "image.reel.marketing.v1",
  },
} as const satisfies Record<ContentStudioOutputFormat, Record<ContentPurpose, string>>;

export const ContentStudioOutputFormatSchema = Type.Union(
  CONTENT_OUTPUT_FORMATS.map((value) => Type.Literal(value)),
);
export const ContentPurposeSchema = Type.Union(
  CONTENT_PURPOSES.map((value) => Type.Literal(value)),
);
export type ContentStudioOutputFormat = Static<typeof ContentStudioOutputFormatSchema>;
export type ContentPurpose = Static<typeof ContentPurposeSchema>;

type ContentFormatDescriptorShape = {
  readonly workerName: "card-news-worker" | "blog-worker" | "reel-worker";
  readonly workspace: "@brand-pilot/card-news-worker" | "@brand-pilot/blog-worker" | "@brand-pilot/reel-worker";
  readonly service: "card-news-worker-1" | "blog-worker-1" | "reel-worker-1";
  readonly domainValue: ContentStudioOutputFormat;
  readonly claimSlug: ContentStudioOutputFormat;
  readonly releaseComponentKey: "cardNewsWorker" | "blogWorker" | "reelWorker";
  readonly imageEnv: "CARD_NEWS_WORKER_IMAGE" | "BLOG_WORKER_IMAGE" | "REEL_WORKER_IMAGE";
  readonly planContractVersion: "card-news-plan.v2" | "blog-plan.v2" | "reel-plan.v2";
  readonly model: "gpt-5.6-terra";
  readonly koreanLabel: "카드뉴스" | "블로그" | "릴스";
  readonly promptDefinitionVersions: Readonly<Record<ContentPurpose, string>>;
  readonly imagePromptVersions: Readonly<Record<ContentPurpose, string>>;
};

export const CONTENT_FORMAT_CATALOG = {
  card_news: {
    domainValue: "card_news",
    workerName: "card-news-worker",
    workspace: "@brand-pilot/card-news-worker",
    service: "card-news-worker-1",
    claimSlug: "card_news",
    releaseComponentKey: "cardNewsWorker",
    imageEnv: "CARD_NEWS_WORKER_IMAGE",
    planContractVersion: "card-news-plan.v2",
    model: "gpt-5.6-terra",
    koreanLabel: "카드뉴스",
    promptDefinitionVersions: CONTENT_PROMPT_DEFINITION_VERSIONS.card_news,
    imagePromptVersions: CONTENT_IMAGE_PROMPT_VERSIONS.card_news,
  },
  blog: {
    domainValue: "blog",
    workerName: "blog-worker",
    workspace: "@brand-pilot/blog-worker",
    service: "blog-worker-1",
    claimSlug: "blog",
    releaseComponentKey: "blogWorker",
    imageEnv: "BLOG_WORKER_IMAGE",
    planContractVersion: "blog-plan.v2",
    model: "gpt-5.6-terra",
    koreanLabel: "블로그",
    promptDefinitionVersions: CONTENT_PROMPT_DEFINITION_VERSIONS.blog,
    imagePromptVersions: CONTENT_IMAGE_PROMPT_VERSIONS.blog,
  },
  reel: {
    domainValue: "reel",
    workerName: "reel-worker",
    workspace: "@brand-pilot/reel-worker",
    service: "reel-worker-1",
    claimSlug: "reel",
    releaseComponentKey: "reelWorker",
    imageEnv: "REEL_WORKER_IMAGE",
    planContractVersion: "reel-plan.v2",
    model: "gpt-5.6-terra",
    koreanLabel: "릴스",
    promptDefinitionVersions: CONTENT_PROMPT_DEFINITION_VERSIONS.reel,
    imagePromptVersions: CONTENT_IMAGE_PROMPT_VERSIONS.reel,
  },
} as const satisfies Record<ContentStudioOutputFormat, ContentFormatDescriptorShape>;

const Sha256PatternSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const ArtifactSchema = (filename: string) => Type.Object({
  filename: Type.Literal(filename),
  sha256: Sha256PatternSchema,
}, { additionalProperties: false });
const FormatMapSchema = <C extends TSchema, B extends TSchema, R extends TSchema>(cardNews: C, blog: B, reel: R) => Type.Object({
  card_news: cardNews,
  blog,
  reel,
}, { additionalProperties: false });

export const GeneratedContentCatalogSchema = Type.Object({
  catalogVersion: Type.Literal(GENERATED_CONTENT_CATALOG_VERSION),
  contractSourceHash: Sha256PatternSchema,
  formats: Type.Tuple([Type.Literal("card_news"), Type.Literal("blog"), Type.Literal("reel")]),
  purposes: Type.Tuple([Type.Literal("informational"), Type.Literal("marketing")]),
  claimSlugs: FormatMapSchema(Type.Literal("card_news"), Type.Literal("blog"), Type.Literal("reel")),
  services: FormatMapSchema(Type.Literal("card-news-worker-1"), Type.Literal("blog-worker-1"), Type.Literal("reel-worker-1")),
  workspaces: FormatMapSchema(Type.Literal("@brand-pilot/card-news-worker"), Type.Literal("@brand-pilot/blog-worker"), Type.Literal("@brand-pilot/reel-worker")),
  releaseComponentKeys: FormatMapSchema(Type.Literal("cardNewsWorker"), Type.Literal("blogWorker"), Type.Literal("reelWorker")),
  imageEnvKeys: FormatMapSchema(Type.Literal("CARD_NEWS_WORKER_IMAGE"), Type.Literal("BLOG_WORKER_IMAGE"), Type.Literal("REEL_WORKER_IMAGE")),
  schemas: Type.Object({
    contentOrchestrationV2: ArtifactSchema("content-orchestration-v2.schema.json"),
    contentProposalRequestV2: ArtifactSchema("content-proposal-request-v2.schema.json"),
    proposalBaseInputV2: ArtifactSchema("proposal-base-input-v2.schema.json"),
    proposalInputV2: ArtifactSchema("proposal-input-v2.schema.json"),
    researchEvidenceV1: ArtifactSchema("research-evidence-v1.schema.json"),
    contentProposalV2: ArtifactSchema("content-proposal-v2.schema.json"),
    contentGenerationInputV3: ArtifactSchema("content-generation-input-v3.schema.json"),
    imageGenerationPackageV1: ArtifactSchema("image-generation-package-v1.schema.json"),
    plans: Type.Object({
      card_news: ArtifactSchema("card-news-plan-v2.schema.json"),
      blog: ArtifactSchema("blog-plan-v2.schema.json"),
      reel: ArtifactSchema("reel-plan-v2.schema.json"),
    }, { additionalProperties: false }),
    aiContentV3: ArtifactSchema("ai-content-v3.schema.json"),
    contentPromptBindingV1: ArtifactSchema("content-prompt-binding-v1.schema.json"),
  }, { additionalProperties: false }),
  proposalContracts: Type.Object({
    requestVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.request),
    requestSchemaSha256: Sha256PatternSchema,
    baseInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput),
    baseInputSchemaSha256: Sha256PatternSchema,
    composedInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput),
    composedInputSchemaSha256: Sha256PatternSchema,
    outputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.output),
    outputSchemaSha256: Sha256PatternSchema,
    promptVersion: Type.Literal(CONTENT_PROPOSAL_PROMPT_VERSION),
  }, { additionalProperties: false }),
  researchEvidence: Type.Object({
    version: Type.Literal(RESEARCH_EVIDENCE_VERSION),
    schemaSha256: Sha256PatternSchema,
  }, { additionalProperties: false }),
  promptBinding: Type.Object({
    version: Type.Literal(CONTENT_PROMPT_BINDING_VERSION),
    schemaSha256: Sha256PatternSchema,
  }, { additionalProperties: false }),
  planContractVersions: FormatMapSchema(
    Type.Literal(CONTENT_FORMAT_CATALOG.card_news.planContractVersion),
    Type.Literal(CONTENT_FORMAT_CATALOG.blog.planContractVersion),
    Type.Literal(CONTENT_FORMAT_CATALOG.reel.planContractVersion),
  ),
  plannerModels: FormatMapSchema(
    Type.Literal(CONTENT_FORMAT_CATALOG.card_news.model),
    Type.Literal(CONTENT_FORMAT_CATALOG.blog.model),
    Type.Literal(CONTENT_FORMAT_CATALOG.reel.model),
  ),
  manifestContractVersion: Type.Literal(AI_CONTENT_MANIFEST_VERSION),
}, { additionalProperties: false });

export type GeneratedContentCatalogData = Static<typeof GeneratedContentCatalogSchema>;
declare const verifiedGeneratedContentCatalogBrand: unique symbol;
export type VerifiedGeneratedContentCatalog = GeneratedContentCatalogData & {
  readonly [verifiedGeneratedContentCatalogBrand]: true;
};

const EXPECTED_GENERATED_SCHEMA_FILENAMES = [
  "content-orchestration-v2.schema.json",
  "content-proposal-request-v2.schema.json",
  "proposal-base-input-v2.schema.json",
  "proposal-input-v2.schema.json",
  "research-evidence-v1.schema.json",
  "content-proposal-v2.schema.json",
  "content-generation-input-v3.schema.json",
  "image-generation-package-v1.schema.json",
  "card-news-plan-v2.schema.json",
  "blog-plan-v2.schema.json",
  "reel-plan-v2.schema.json",
  "ai-content-v3.schema.json",
  "content-prompt-binding-v1.schema.json",
] as const;

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftPoint = leftPoints[index]!.codePointAt(0)!;
    const rightPoint = rightPoints[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
  }
  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0;
}

export type GeneratedContentCatalogVerificationInput = {
  readonly contractSourceHash: string;
  readonly schemaArtifacts: Readonly<Record<string, string>>;
};

async function sha256Utf8(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseGeneratedContentCatalog(
  value: unknown,
  verification: GeneratedContentCatalogVerificationInput,
): Promise<VerifiedGeneratedContentCatalog> {
  if (!Value.Check(GeneratedContentCatalogSchema, value)) {
    throw new Error("generated_content_catalog_invalid");
  }
  const catalog = value as GeneratedContentCatalogData;
  const schemaLeaves = [
    catalog.schemas.contentOrchestrationV2,
    catalog.schemas.contentProposalRequestV2,
    catalog.schemas.proposalBaseInputV2,
    catalog.schemas.proposalInputV2,
    catalog.schemas.researchEvidenceV1,
    catalog.schemas.contentProposalV2,
    catalog.schemas.contentGenerationInputV3,
    catalog.schemas.imageGenerationPackageV1,
    catalog.schemas.plans.card_news,
    catalog.schemas.plans.blog,
    catalog.schemas.plans.reel,
    catalog.schemas.aiContentV3,
    catalog.schemas.contentPromptBindingV1,
  ];
  const actualFilenames = schemaLeaves.map(({ filename }) => filename).sort(compareUnicodeCodePoints);
  const expectedFilenames = [...EXPECTED_GENERATED_SCHEMA_FILENAMES].sort(compareUnicodeCodePoints);
  const formatCatalogAgrees = CONTENT_OUTPUT_FORMATS.every((format) =>
    catalog.claimSlugs[format] === CONTENT_FORMAT_CATALOG[format].claimSlug
    && catalog.services[format] === CONTENT_FORMAT_CATALOG[format].service
    && catalog.workspaces[format] === CONTENT_FORMAT_CATALOG[format].workspace
    && catalog.releaseComponentKeys[format] === CONTENT_FORMAT_CATALOG[format].releaseComponentKey
    && catalog.imageEnvKeys[format] === CONTENT_FORMAT_CATALOG[format].imageEnv
    && catalog.planContractVersions[format] === CONTENT_FORMAT_CATALOG[format].planContractVersion
    && catalog.plannerModels[format] === CONTENT_FORMAT_CATALOG[format].model);
  const proposalAgrees =
    catalog.proposalContracts.requestSchemaSha256 === catalog.schemas.contentProposalRequestV2.sha256
    && catalog.proposalContracts.baseInputSchemaSha256 === catalog.schemas.proposalBaseInputV2.sha256
    && catalog.proposalContracts.composedInputSchemaSha256 === catalog.schemas.proposalInputV2.sha256
    && catalog.proposalContracts.outputSchemaSha256 === catalog.schemas.contentProposalV2.sha256;
  const duplicateHashesAgree =
    catalog.researchEvidence.schemaSha256 === catalog.schemas.researchEvidenceV1.sha256
    && catalog.promptBinding.schemaSha256 === catalog.schemas.contentPromptBindingV1.sha256;
  if (JSON.stringify(actualFilenames) !== JSON.stringify(expectedFilenames)
    || !formatCatalogAgrees || !proposalAgrees || !duplicateHashesAgree) {
    throw new Error("generated_content_catalog_invalid");
  }
  if (!verification || verification.contractSourceHash !== catalog.contractSourceHash
    || !verification.schemaArtifacts || typeof verification.schemaArtifacts !== "object") {
    throw new Error("generated_content_catalog_invalid");
  }
  const artifactFilenames = Object.keys(verification.schemaArtifacts).sort(compareUnicodeCodePoints);
  if (JSON.stringify(artifactFilenames) !== JSON.stringify(expectedFilenames)) {
    throw new Error("generated_content_catalog_invalid");
  }
  const expectedHashes = new Map(schemaLeaves.map((leaf) => [leaf.filename, leaf.sha256]));
  for (const filename of expectedFilenames) {
    const artifact = verification.schemaArtifacts[filename];
    if (typeof artifact !== "string" || await sha256Utf8(artifact) !== expectedHashes.get(filename)) {
      throw new Error("generated_content_catalog_invalid");
    }
  }
  return catalog as VerifiedGeneratedContentCatalog;
}

export type ContentFormatDescriptor =
  (typeof CONTENT_FORMAT_CATALOG)[ContentStudioOutputFormat];

export function parseContentStudioOutputFormat(value: unknown): ContentStudioOutputFormat {
  if (typeof value !== "string" || !CONTENT_OUTPUT_FORMATS.includes(value as ContentStudioOutputFormat)) {
    throw new Error("content_output_format_invalid");
  }
  return value as ContentStudioOutputFormat;
}

export function parseContentPurpose(value: unknown): ContentPurpose {
  if (typeof value !== "string" || !CONTENT_PURPOSES.includes(value as ContentPurpose)) {
    throw new Error("content_purpose_invalid");
  }
  return value as ContentPurpose;
}
