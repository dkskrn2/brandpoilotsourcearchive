import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TSchema } from "@sinclair/typebox";
import {
  AI_CONTENT_MANIFEST_VERSION,
  CONTENT_FORMAT_CATALOG,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PROPOSAL_CONTRACT_VERSIONS,
  CONTENT_PROPOSAL_PROMPT_VERSION,
  CONTENT_PROMPT_BINDING_VERSION,
  CONTENT_PURPOSES,
  compareUnicodeCodePoints,
  GENERATED_CONTENT_CATALOG_VERSION,
  RESEARCH_EVIDENCE_VERSION,
  type GeneratedContentCatalogData,
  parseGeneratedContentCatalog,
} from "./catalog.js";
import { ContentPromptBindingSchema } from "./binding.js";
import { ContentGenerationInputV3Schema, ImageGenerationPackageV1Schema } from "./generation.js";
import { AiContentManifestV3Schema } from "./manifest.js";
import { ContentOrchestrationV2Schema } from "./orchestration.js";
import { BlogPlanV2Schema, CardNewsPlanV2Schema, ReelPlanV2Schema } from "./plans.js";
import {
  ContentProposalRequestV2Schema,
  ContentProposalSetV2Schema,
  ProposalBaseInputSnapshotV2Schema,
  ProposalInputSnapshotV2Schema,
} from "./proposal.js";
import { ResearchEvidenceSnapshotV1Schema } from "./snapshots.js";

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIRECTORY = resolve(SOURCE_DIRECTORY, "../generated");

export function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => compareUnicodeCodePoints(left, right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function authoredSourceFiles(directory: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current).sort(compareUnicodeCodePoints)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) visit(absolute);
      else if (entry.endsWith(".ts")
        && !entry.endsWith(".test.ts")
        && entry !== "generateArtifacts.ts"
        && entry !== "checkGenerated.ts") files.push(absolute);
    }
  };
  visit(directory);
  return files.sort((left, right) => compareUnicodeCodePoints(
    relative(directory, left).replaceAll("\\", "/"),
    relative(directory, right).replaceAll("\\", "/"),
  ));
}

export function computeContractSourceHash(sourceDirectory = SOURCE_DIRECTORY): string {
  const hash = createHash("sha256");
  for (const absolute of authoredSourceFiles(sourceDirectory)) {
    const relativePath = relative(sourceDirectory, absolute).replaceAll("\\", "/");
    const normalizedBytes = readFileSync(absolute, "utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(normalizedBytes, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

const SCHEMAS = {
  "content-orchestration-v2.schema.json": ContentOrchestrationV2Schema,
  "content-proposal-request-v2.schema.json": ContentProposalRequestV2Schema,
  "proposal-base-input-v2.schema.json": ProposalBaseInputSnapshotV2Schema,
  "proposal-input-v2.schema.json": ProposalInputSnapshotV2Schema,
  "research-evidence-v1.schema.json": ResearchEvidenceSnapshotV1Schema,
  "content-proposal-v2.schema.json": ContentProposalSetV2Schema,
  "content-generation-input-v3.schema.json": ContentGenerationInputV3Schema,
  "image-generation-package-v1.schema.json": ImageGenerationPackageV1Schema,
  "card-news-plan-v2.schema.json": CardNewsPlanV2Schema,
  "blog-plan-v2.schema.json": BlogPlanV2Schema,
  "reel-plan-v2.schema.json": ReelPlanV2Schema,
  "ai-content-v3.schema.json": AiContentManifestV3Schema,
  "content-prompt-binding-v1.schema.json": ContentPromptBindingSchema,
} as const satisfies Record<string, TSchema>;

type SchemaFilename = keyof typeof SCHEMAS;
type ArtifactLeaf = { filename: SchemaFilename; sha256: string };

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function generateArtifactSet(sourceDirectory = SOURCE_DIRECTORY): Promise<Map<string, string>> {
  const artifacts = new Map<string, string>();
  const leafFor = (filename: SchemaFilename): ArtifactLeaf => {
    const text = stableJson(SCHEMAS[filename]);
    artifacts.set(filename, text);
    return { filename, sha256: hashText(text) };
  };

  const contentOrchestrationV2 = leafFor("content-orchestration-v2.schema.json");
  const contentProposalRequestV2 = leafFor("content-proposal-request-v2.schema.json");
  const proposalBaseInputV2 = leafFor("proposal-base-input-v2.schema.json");
  const proposalInputV2 = leafFor("proposal-input-v2.schema.json");
  const researchEvidenceV1 = leafFor("research-evidence-v1.schema.json");
  const contentProposalV2 = leafFor("content-proposal-v2.schema.json");
  const contentGenerationInputV3 = leafFor("content-generation-input-v3.schema.json");
  const imageGenerationPackageV1 = leafFor("image-generation-package-v1.schema.json");
  const cardNewsPlanV2 = leafFor("card-news-plan-v2.schema.json");
  const blogPlanV2 = leafFor("blog-plan-v2.schema.json");
  const reelPlanV2 = leafFor("reel-plan-v2.schema.json");
  const aiContentV3 = leafFor("ai-content-v3.schema.json");
  const contentPromptBindingV1 = leafFor("content-prompt-binding-v1.schema.json");

  const contractSourceHash = computeContractSourceHash(sourceDirectory);
  const catalog = {
    catalogVersion: GENERATED_CONTENT_CATALOG_VERSION,
    contractSourceHash,
    formats: [...CONTENT_OUTPUT_FORMATS],
    purposes: [...CONTENT_PURPOSES],
    claimSlugs: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.claimSlug,
      blog: CONTENT_FORMAT_CATALOG.blog.claimSlug,
      reel: CONTENT_FORMAT_CATALOG.reel.claimSlug,
    },
    services: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.service,
      blog: CONTENT_FORMAT_CATALOG.blog.service,
      reel: CONTENT_FORMAT_CATALOG.reel.service,
    },
    workspaces: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.workspace,
      blog: CONTENT_FORMAT_CATALOG.blog.workspace,
      reel: CONTENT_FORMAT_CATALOG.reel.workspace,
    },
    releaseComponentKeys: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.releaseComponentKey,
      blog: CONTENT_FORMAT_CATALOG.blog.releaseComponentKey,
      reel: CONTENT_FORMAT_CATALOG.reel.releaseComponentKey,
    },
    imageEnvKeys: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.imageEnv,
      blog: CONTENT_FORMAT_CATALOG.blog.imageEnv,
      reel: CONTENT_FORMAT_CATALOG.reel.imageEnv,
    },
    schemas: {
      contentOrchestrationV2,
      contentProposalRequestV2,
      proposalBaseInputV2,
      proposalInputV2,
      researchEvidenceV1,
      contentProposalV2,
      contentGenerationInputV3,
      imageGenerationPackageV1,
      plans: { card_news: cardNewsPlanV2, blog: blogPlanV2, reel: reelPlanV2 },
      aiContentV3,
      contentPromptBindingV1,
    },
    proposalContracts: {
      requestVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.request,
      requestSchemaSha256: contentProposalRequestV2.sha256,
      baseInputVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput,
      baseInputSchemaSha256: proposalBaseInputV2.sha256,
      composedInputVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput,
      composedInputSchemaSha256: proposalInputV2.sha256,
      outputVersion: CONTENT_PROPOSAL_CONTRACT_VERSIONS.output,
      outputSchemaSha256: contentProposalV2.sha256,
      promptVersion: CONTENT_PROPOSAL_PROMPT_VERSION,
    },
    researchEvidence: { version: RESEARCH_EVIDENCE_VERSION, schemaSha256: researchEvidenceV1.sha256 },
    promptBinding: { version: CONTENT_PROMPT_BINDING_VERSION, schemaSha256: contentPromptBindingV1.sha256 },
    planContractVersions: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.planContractVersion,
      blog: CONTENT_FORMAT_CATALOG.blog.planContractVersion,
      reel: CONTENT_FORMAT_CATALOG.reel.planContractVersion,
    },
    plannerModels: {
      card_news: CONTENT_FORMAT_CATALOG.card_news.model,
      blog: CONTENT_FORMAT_CATALOG.blog.model,
      reel: CONTENT_FORMAT_CATALOG.reel.model,
    },
    manifestContractVersion: AI_CONTENT_MANIFEST_VERSION,
  } as const satisfies GeneratedContentCatalogData;
  const schemaArtifacts = Object.fromEntries(artifacts);
  const verifiedCatalog = await parseGeneratedContentCatalog(catalog, { contractSourceHash, schemaArtifacts });
  artifacts.set("content-catalog.json", stableJson(verifiedCatalog));
  return new Map([...artifacts].sort(([left], [right]) => compareUnicodeCodePoints(left, right)));
}

export async function generateArtifacts(outputDirectory = DEFAULT_OUTPUT_DIRECTORY): Promise<void> {
  mkdirSync(outputDirectory, { recursive: true });
  for (const [filename, text] of await generateArtifactSet()) {
    writeFileSync(join(outputDirectory, filename), text, "utf8");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await generateArtifacts();
}
