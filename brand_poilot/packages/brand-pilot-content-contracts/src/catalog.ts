import { Type, type Static } from "@sinclair/typebox";

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
