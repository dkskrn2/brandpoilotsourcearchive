# Three-Format Canonical Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create one browser-safe package that owns the three Studio formats, two purposes, contract schemas, semantic validators, generated JSON Schema, and deployment catalog.

**Architecture:** TypeBox 0.34.x is the authored schema source because the repository uses TypeScript 5.7. Static types derive from schemas, semantic validators remain pure functions in the same package, and one deterministic generator produces committed provider/deployment artifacts. No API, UI, worker, SQL, or shell file may become a second contract authority.

**Tech Stack:** TypeScript 5.7, `@sinclair/typebox` 0.34.52, Vitest, Node.js 20+, npm workspaces, JSON Schema.

---

## Task 1: Scaffold the canonical workspace and catalog

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/brand-pilot-content-contracts/package.json`
- Create: `packages/brand-pilot-content-contracts/tsconfig.json`
- Create: `packages/brand-pilot-content-contracts/src/catalog.test.ts`
- Create: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Create: `packages/brand-pilot-content-contracts/src/index.ts`

- [ ] **Step 1: Write the failing catalog test**

```ts
import { describe, expect, it } from "vitest";
import {
  CONTENT_FORMAT_CATALOG,
  CONTENT_OUTPUT_FORMATS,
  CONTENT_PURPOSES,
  parseContentStudioOutputFormat,
  parseContentPurpose,
} from "./catalog.js";

describe("canonical content catalog", () => {
  it("owns exactly three formats, two purposes, and direct claim slugs", () => {
    expect(CONTENT_OUTPUT_FORMATS).toEqual(["card_news", "blog", "reel"]);
    expect(CONTENT_PURPOSES).toEqual(["informational", "marketing"]);
    expect(Object.keys(CONTENT_FORMAT_CATALOG)).toEqual(CONTENT_OUTPUT_FORMATS);
    expect(Object.values(CONTENT_FORMAT_CATALOG).map((item) => item.claimSlug))
      .toEqual(["card_news", "blog", "reel"]);
    expect(Object.values(CONTENT_FORMAT_CATALOG).map((item) => item.model))
      .toEqual(["gpt-5.6-terra", "gpt-5.6-terra", "gpt-5.6-terra"]);
  });

  it.each(["marketing", "marketing_content", "single_image", "channel_text", "card-news"])(
    "rejects retired or transport-only value %s",
    (value) => expect(() => parseContentStudioOutputFormat(value)).toThrow("content_output_format_invalid"),
  );

  it("parses only the canonical purposes", () => {
    expect(parseContentPurpose("informational")).toBe("informational");
    expect(parseContentPurpose("marketing")).toBe("marketing");
    expect(() => parseContentPurpose("both")).toThrow("content_purpose_invalid");
  });
});
```

- [ ] **Step 2: Run the test to prove RED**

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/catalog.test.ts
```

Expected: npm reports the workspace/package does not exist.

- [ ] **Step 3: Add the workspace and package metadata**

Change the root workspace list to:

```json
"workspaces": [
  "packages/*",
  "apps/*",
  "workers/*"
]
```

Create the package with these scripts and pinned dependency:

```json
{
  "name": "@brand-pilot/content-contracts",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./generated/*": "./generated/*"
  },
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "generate": "tsx src/generateArtifacts.ts",
    "check:generated": "tsx src/checkGenerated.ts"
  },
  "dependencies": {
    "@sinclair/typebox": "0.34.52"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.21.0",
    "typescript": "^5.7.2",
    "vitest": "^4.1.10"
  }
}
```

Use the worker-runtime TypeScript settings as the baseline and set `rootDir: "src"`, `outDir: "dist"`, `declaration: true`, `noEmit: false`.

- [ ] **Step 4: Implement the exact catalog**

```ts
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
```

Export the catalog and types from `src/index.ts`.

- [ ] **Step 5: Install, run GREEN, and build**

Run:

```powershell
npm install
npm test --workspace @brand-pilot/content-contracts -- src/catalog.test.ts
npm run build --workspace @brand-pilot/content-contracts
```

Expected: all seven expanded catalog cases pass and TypeScript exits 0.

- [ ] **Step 6: Commit the scaffold**

```powershell
git add -- package.json package-lock.json packages/brand-pilot-content-contracts/package.json packages/brand-pilot-content-contracts/tsconfig.json packages/brand-pilot-content-contracts/src/catalog.test.ts packages/brand-pilot-content-contracts/src/catalog.ts packages/brand-pilot-content-contracts/src/index.ts
git commit -m "feat: add canonical content contract catalog"
```

## Task 2: Author exact TypeBox schemas and derived types

**Files:**

- Create: `packages/brand-pilot-content-contracts/src/orchestration.ts`
- Create: `packages/brand-pilot-content-contracts/src/snapshots.ts`
- Create: `packages/brand-pilot-content-contracts/src/proposal.ts`
- Create: `packages/brand-pilot-content-contracts/src/proposal.test.ts`
- Create: `packages/brand-pilot-content-contracts/src/generation.ts`
- Create: `packages/brand-pilot-content-contracts/src/plans.ts`
- Create: `packages/brand-pilot-content-contracts/src/manifest.ts`
- Create: `packages/brand-pilot-content-contracts/src/schemas.test.ts`
- Create: `packages/brand-pilot-content-contracts/src/fixtures/legacy-invalid-json-schema.fixture.json`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`

- [ ] **Step 1: Write RED tests for exact schemas and provider constraints**

Create table-driven tests that assert:

```ts
const validCells = [
  ["card_news", "informational"], ["card_news", "marketing"],
  ["blog", "informational"], ["blog", "marketing"],
  ["reel", "informational"], ["reel", "marketing"],
] as const;

it.each(validCells)("accepts %s/%s", (outputFormat, purpose) => {
  expect(parseContentOrchestrationV2({
    contractVersion: "content-orchestration.v2",
    brandId: "00000000-0000-4000-8000-000000000001",
    purpose,
    seed: { kind: "topic_text", title: "검증 주제" },
    contentInstruction: null,
    productId: purpose === "marketing" ? "00000000-0000-4000-8000-000000000002" : null,
    outputSettings: {
      outputFormat,
      channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
      aspectRatio: outputFormat === "blog" ? null : outputFormat === "reel" ? "9:16" : "1:1",
      outputCount: 1,
    },
  })).toMatchObject({ purpose, outputSettings: { outputFormat } });
});

it("ships provider-compatible generated schemas", () => {
  const serialized = JSON.stringify(ALL_CONTENT_SCHEMAS);
  expect(serialized).not.toContain('"oneOf"');
  expect(serialized).not.toContain('"uniqueItems"');
  expect(findUntypedConstPaths(ALL_CONTENT_SCHEMAS)).toEqual([]);
  expect(findObjectsAllowingAdditionalProperties(ALL_CONTENT_SCHEMAS)).toEqual([]);
  expect(findOptionalStructuredOutputProperties(ALL_CONTENT_SCHEMAS)).toEqual([]);
});
```

Before implementation, recover the exact pre-fix blog plan schema from the recorded baseline Git object (not the dirty worktree), store it as `legacy-invalid-json-schema.fixture.json`, and record its SHA-256. A named `incident_invalid_json_schema` test must show the provider-compatibility checker deterministically rejects that captured schema for its legacy keyword/untyped-constant paths, then accepts all canonical generated schemas and exact local parsers. This is the old-failure reproduction and makes no model call. Phase 5 compares the fixture hash to exported incident evidence; a mismatch is recorded `not_found`/different-hash but does not erase the deterministic regression.

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/schemas.test.ts src/proposal.test.ts
```

Expected: FAIL because the schema modules and parsers do not exist.

- [ ] **Step 3: Move the existing exact contracts into focused modules**

Use these source symbols as the authoritative behavior to move, then narrow formats and remove duplicate fields:

- from `apps/api/src/aiContentContracts.ts`: orchestration/proposal/image-package/manifest interfaces;
- from `apps/api/src/aiContentGenerationInputV3.ts`: exact V3 parser and cross-field bindings;
- from `apps/api/src/aiContentPlanContracts.ts`: card/blog/reel plan parsers;
- from `workers/brand-pilot-worker-runtime/src/aiContentV3.ts`: worker-side V3/image-package parser behavior.

Import the shared format/purpose schemas and schema-derived types from `catalog.ts`; do not redeclare them in any other module. The constant arrays are schema construction inputs and catalog iteration values, while every exported TypeScript domain type derives from TypeBox `Static`.

Use the catalog-owned constants for every schema literal. `snapshots.ts` owns the approved brand/product/reference/research snapshot schemas so proposal and generation schemas do not form a circular import. `proposal.ts` owns schema-derived `ContentProposalRequestV2`, `ProposalBaseInputSnapshotV2`, `ProposalInputSnapshotV2`, and `ContentProposalSetV2` types plus exact parsers `parseContentProposalRequestV2`, `parseProposalBaseInputSnapshotV2`, `parseProposalInputSnapshotV2`, `parseResearchEvidenceSnapshotV1`, and `parseContentProposalSetV2`; API and proposal-worker may not redeclare any of them. Build the composed input as one closed `Type.Object` from source-level shared properties—do not use `Type.Intersect`/`allOf`. Tests must prove orchestration, proposal request/base/composed/output, research evidence, V3 generation input, image package, and final manifest schemas expose exactly their catalog literals and reject an omitted version or any unknown/legacy version. Do not repeat these strings in API/UI/worker code.

`ContentProposalSetV2Schema.proposals` is `minItems: 3, maxItems: 3`. Do not use `Type.Tuple`, `uniqueItems`, `oneOf`, or an untyped `const`; concept/evidence/reference uniqueness and substantive differentiation belong to a semantic validator. The Proposal request/base/composed/output constants are accessed only through `CONTENT_PROPOSAL_CONTRACT_VERSIONS.request|baseInput|composedInput|output`; do not create compatibility aliases.

The exact top-level final manifest is:

```ts
export const AiContentManifestV3Schema = Type.Object({
  version: Type.Literal(AI_CONTENT_MANIFEST_VERSION),
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  title: NonEmptyStringSchema,
  assets: Type.Array(ManifestAssetSchema, { minItems: 1 }),
  content: ManifestContentSchema,
}, { additionalProperties: false });
export type AiContentManifestV3 = Static<typeof AiContentManifestV3Schema>;
```

There is no manifest `type`, generation `type`, `marketing_content`, `single_image`, or `channel_text` schema member. Keep `content-generation-input.v3`, `image-generation-package.v1`, three plan V2 versions, and their full existing exact fields.

The following Task 2 tie-breakers were approved on 2026-08-05 after comparing the actual API, repository, worker-runtime, and finalizer contracts:

- `ContentProposalRequestV2Schema` is the closed persisted common-service request `{ contractVersion, purpose, outputFormat, channelTargets, requestFingerprint }`; `requestFingerprint` is lowercase SHA-256. `ProposalBaseInputSnapshotV2Schema` is the closed shape currently assembled by `contentOrchestration.ts`, and the composed input adds only `contractVersion=proposal-input.v2` plus `researchEvidence` to those shared source-level properties.
- `ApprovedProductSnapshotV2.evergreenPurchaseInfo` permits the normalized empty string, because approved DB/UI snapshots legitimately store it; the worker-runtime non-empty check is drift and is not canonicalized.
- `brandStyleImages` is an independently loaded, approved same-scope collection. It is not required to be a subset of `references.selected`. Structural parsing keeps the collections separate; Task 3 validates scope/ownership, uniqueness, and that a non-null `avatarStyleImageId` names one of the frozen style images.
- the former marketing-plan field set is retained only after the approved breaking rename/narrowing to `contractVersion=reel-plan.v2` and `outputFormat=reel`; neither `marketing-plan.v2` nor `marketing_content` is accepted.

Here `asset` means a final generated/downloadable file, not an input attachment, product image, or brand-library asset. The exact closed manifest asset variants are:

```ts
export const ManifestImageAssetSchema = Type.Object({
  role: Type.Union([Type.Literal("slide"), Type.Literal("inline"), Type.Literal("scene")]),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("image/png"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const ManifestHtmlAssetSchema = Type.Object({
  role: Type.Literal("html"),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("text/html"),
}, { additionalProperties: false });

export const ManifestVideoAssetSchema = Type.Object({
  role: Type.Literal("video"),
  index: Type.Integer({ minimum: 1 }),
  url: NonEmptyStringSchema,
  fileName: NonEmptyStringSchema,
  mimeType: Type.Literal("video/mp4"),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  durationSeconds: Type.Number({ exclusiveMinimum: 0 }),
  videoCodec: Type.Literal("h264"),
  fps: Type.Literal(30),
  audioCodec: Type.Null(),
}, { additionalProperties: false });

export const ManifestAssetSchema = Type.Union([
  ManifestImageAssetSchema,
  ManifestHtmlAssetSchema,
  ManifestVideoAssetSchema,
]);
```

The exact closed manifest content variants are social content for card-news/reel and final blog content:

```ts
export const SocialManifestContentSchema = Type.Object({
  caption: NonEmptyStringSchema,
  hashtags: Type.Array(NonEmptyStringSchema),
  cta: NonEmptyStringSchema,
}, { additionalProperties: false });

export const BlogManifestContentSchema = Type.Object({
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  html: NonEmptyStringSchema,
  metaTitle: NonEmptyStringSchema,
  metaDescription: NonEmptyStringSchema,
}, { additionalProperties: false });

export const ManifestContentSchema = Type.Union([
  SocialManifestContentSchema,
  BlogManifestContentSchema,
]);
```

Every variant property is required and every variant is closed; there are no irrelevant nullable/optional superset fields. Task 3 binds `card_news|reel` to social content, `blog` to blog content, and each format to its permitted asset roles/counts. It also validates final HTTPS/storage provenance. Task 2 performs only exact structural parsing.

- [ ] **Step 4: Add exact runtime compilation and parsing**

Use `Value.Check` and one stable error per boundary:

```ts
import { Value } from "@sinclair/typebox/value";

export function parseAiContentManifestV3(value: unknown): AiContentManifestV3 {
  if (!Value.Check(AiContentManifestV3Schema, value)) {
    throw new Error("ai_content_manifest_v3_invalid");
  }
  return value as AiContentManifestV3;
}
```

Keep semantic checks out of TypeBox-only parsing and call the validators created in Task 3. Every structured-output object is closed with `additionalProperties: false`; structured-output properties are required, and nullable values use an explicit `null` union rather than optional omission.

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/schemas.test.ts src/proposal.test.ts
npm run build --workspace @brand-pilot/content-contracts
```

Expected: all six cells pass, retired values fail, provider-compatibility scan reports zero paths, and build exits 0.

```powershell
git add -- packages/brand-pilot-content-contracts/src/orchestration.ts packages/brand-pilot-content-contracts/src/snapshots.ts packages/brand-pilot-content-contracts/src/proposal.ts packages/brand-pilot-content-contracts/src/proposal.test.ts packages/brand-pilot-content-contracts/src/generation.ts packages/brand-pilot-content-contracts/src/plans.ts packages/brand-pilot-content-contracts/src/manifest.ts packages/brand-pilot-content-contracts/src/schemas.test.ts packages/brand-pilot-content-contracts/src/fixtures/legacy-invalid-json-schema.fixture.json packages/brand-pilot-content-contracts/src/index.ts
git commit -m "feat: centralize content generation schemas"
```

## Task 3: Centralize semantic cross-field validators and prompt bindings

**Files:**

- Create: `packages/brand-pilot-content-contracts/src/validators.ts`
- Create: `packages/brand-pilot-content-contracts/src/validators.test.ts`
- Create: `packages/brand-pilot-content-contracts/src/binding.ts`
- Create: `packages/brand-pilot-content-contracts/src/binding.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`

Task 3 ownership validation uses the server-owned authority envelope from the approved Phase 3 fixed-input assembler; it does not add workspace, brand, or proposal-batch fields to the planner's V3 JSON. This preserves the rule that V3 plus prompt binding are the only planner inputs while still making cross-scope provenance testable before model execution. Define a closed TypeBox `ContentPipelineAuthorityContextSchema` in `validators.ts` with these exact closed nested records:

```ts
{
  scope: { workspaceId, brandId },
  selection: {
    workspaceId, brandId, proposalBatchId, proposalId, outputFormat, purpose,
  },
  evidence: Array<{
    workspaceId, brandId, proposalBatchId, evidenceId,
  }>,
  references: Array<{
    workspaceId, brandId, proposalBatchId, referenceItemId, snapshotId,
  }>,
}
```

All IDs use the canonical UUID schema and format/purpose use the catalog schemas. The API constructs this envelope only after its scoped transaction has proved that the selection belongs to the batch and every evidence/reference row belongs to that selection's frozen set. `assertEvidenceOwnership` still independently rejects any envelope row whose scope/batch differs from `scope`/`selection`, any V3 evidence/reference identity absent from the envelope, and any selected-proposal evidence/reference identity absent from the frozen V3 sets. `assertSelectedProposalInvariant` compares the V3 proposal ID, format, and purpose with `selection`. The authority envelope is claim/validation metadata only and is never passed to Codex or image generation.

The rendered-asset inventory is also trusted server/worker completion metadata, not model output. Its closed image, HTML, and video variants mirror every public manifest asset field and additionally require `storagePath` plus lowercase `checksum`; image/video variants retain their exact dimensions and the video variant retains its exact codec/FPS/duration metadata. Each URL must be absolute HTTPS. Each storage path must be a canonical relative `/`-separated path with no empty, `.` or `..` segment, must begin `ai-content/{authority.scope.brandId}/{input.generationId}/`, and its URL pathname must equal that storage path. Compare the raw URL path before WHATWG normalization as well as the parsed path; reject credentials, query, fragment, raw backslashes, and case-insensitive percent-encoded slash, backslash, or dot-segment escapes in either representation. The manifest's complete public asset object must equal the corresponding rendered record after removing only `storagePath` and `checksum`. Reject duplicate role/index identities, URLs, file names, storage paths, or checksums and require the format-specific contiguous inventories below. Do not hardcode a storage hostname: provenance comes from the trusted completion record plus the exact HTTPS/path binding, so environments may use their configured owned Vercel Blob host without weakening the manifest comparison.

Before image execution, every image-package asset's evidence, product-image, and attachment IDs must be duplicate-free subsets of the V3 frozen evidence, approved product images, and finalized attachments respectively. Card-news and reel asset indices/roles must exactly match their selected proposal outline; blog keeps its independently planned semantic image roles (`cover`, `explanation`, and similar) rather than incorrectly replacing them with the final manifest role `inline`. The selected proposal's `channelTargets` must exactly equal V3 `outputSettings.channelTargets`. Every rendered/manifest `fileName` must be a trimmed safe basename with no slash, backslash, control character, `.` or `..`; it is deliberately not required to equal the internal storage-path tail because the final public names (`slide-01.png`, `inline-01.png`, `scene-01.png`) and owned internal object names may differ. Structural binding validation runs before semantic mismatch checks so malformed bindings receive the stable boundary error.

- [ ] **Step 1: Write RED tests for format, purpose, product, plan, and manifest drift**

Tests must prove:

- informational requires `product === null` and non-empty frozen evidence;
- marketing requires one approved product snapshot;
- selected proposal, V3 settings, prompt binding, plan, image package, and manifest share format/purpose;
- every frozen evidence row and reference snapshot belongs to the same workspace/brand and to the selected proposal's approved evidence set;
- the selected proposal ID belongs to the batch recorded by V3 and its format/purpose exactly match the generation draft;
- `outputSettings.outputCount` is exactly `1` and means one final content output, not slide/scene asset count;
- the format plan derives its own expected asset count, which agrees only across plan, image package, rendered assets, and manifest;
- wrong plan version for a format fails;
- blog requires `blog_export/null`, reel requires `instagram/9:16`, card-news requires `instagram/1:1`;
- prompt binding model is exactly `gpt-5.6-terra`;
- all six planner prompt IDs and all six image prompt IDs are literal catalog-owned values; a syntactically valid but unknown string fails before model or image execution.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/validators.test.ts src/binding.test.ts
```

Expected: FAIL because the schema-derived binding and the evidence/selection/asset validators are missing.

- [ ] **Step 3: Implement one binding constructor and one exhaustive validator**

```ts
export const PlannerPromptVersionSchema = Type.Union(
  Object.values(CONTENT_PROMPT_DEFINITION_VERSIONS)
    .flatMap((versions) => Object.values(versions))
    .map((value) => Type.Literal(value)),
);
export const ImagePromptVersionSchema = Type.Union(
  Object.values(CONTENT_IMAGE_PROMPT_VERSIONS)
    .flatMap((versions) => Object.values(versions))
    .map((value) => Type.Literal(value)),
);
export const ContentPromptBindingSchema = Type.Object({
  contractVersion: Type.Literal(CONTENT_PROMPT_BINDING_VERSION),
  outputFormat: ContentStudioOutputFormatSchema,
  purpose: ContentPurposeSchema,
  proposalRequestVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.request),
  proposalBaseInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.baseInput),
  proposalComposedInputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.composedInput),
  proposalOutputVersion: Type.Literal(CONTENT_PROPOSAL_CONTRACT_VERSIONS.output),
  proposalPromptVersion: Type.Literal(CONTENT_PROPOSAL_PROMPT_VERSION),
  proposalSchemaSha256: Sha256Schema,
  generationInputVersion: Type.Literal(CONTENT_GENERATION_INPUT_VERSION),
  generationSchemaSha256: Sha256Schema,
  planContractVersion: PlanContractVersionSchema,
  planSchemaSha256: Sha256Schema,
  plannerPromptVersion: PlannerPromptVersionSchema,
  imagePackageVersion: Type.Literal(IMAGE_GENERATION_PACKAGE_VERSION),
  imagePromptVersion: ImagePromptVersionSchema,
  manifestVersion: Type.Literal(AI_CONTENT_MANIFEST_VERSION),
  contractSourceHash: Sha256Schema,
  model: Type.Literal(CONTENT_PLANNER_MODEL_ID),
}, { additionalProperties: false });
export type ContentPromptBinding = Static<typeof ContentPromptBindingSchema>;

```

Task 3 deliberately does not add `promptBindingFor`: the verified generated-catalog parser and its exact `schemas` shape do not exist until Task 4. Binding tests here use explicit parser-valid six-cell fixtures with named 64-hex hashes; they test schema/semantic rejection but may not claim that hashes came from a catalog. Task 4 adds the sole constructor after it can consume a branded, parser-verified catalog. The binding's `model` is the format planner's fixed Terra model; the proposal model/command remain in proposal-job audit and preflight evidence, so the two model boundaries cannot be confused.

Implement and export `assertPurposeProductInvariant`, `assertEvidenceOwnership`, `assertSelectedProposalInvariant`, `assertPlannerPromptBinding`, `assertPlanMatchesInput`, `assertAssetCountInvariant`, `assertManifestMatchesInput`, and the composing `assertContentPipelineBindings`. The composing validator accepts parsed V3, parsed authority context, binding, plan, image package, rendered-asset inventory, and manifest; it compares every identity/format/purpose/version/hash/count field and throws a stable boundary error on the first disagreement. It must never repair or default a value. Tests require every binding field and reject a generic `schemaHash`; catalog-origin proof for the three specific schema hashes plus `contractSourceHash` is owned by Task 4.

- [ ] **Step 4: Run GREEN and commit**

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/validators.test.ts src/binding.test.ts
npm test --workspace @brand-pilot/content-contracts
git add -- packages/brand-pilot-content-contracts/src/validators.ts packages/brand-pilot-content-contracts/src/validators.test.ts packages/brand-pilot-content-contracts/src/binding.ts packages/brand-pilot-content-contracts/src/binding.test.ts packages/brand-pilot-content-contracts/src/index.ts
git commit -m "feat: enforce content pipeline bindings"
```

Expected: package suite passes with six valid cells and every mismatch fixture rejected.

## Task 4: Generate deterministic schemas and deployment catalog

**Files:**

- Create: `.gitattributes`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.ts`
- Modify: `packages/brand-pilot-content-contracts/src/catalog.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/binding.ts`
- Modify: `packages/brand-pilot-content-contracts/src/binding.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Create: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`
- Create: `packages/brand-pilot-content-contracts/src/checkGenerated.ts`
- Create: `packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts`
- Create: `packages/brand-pilot-content-contracts/generated/content-catalog.json`
- Create: `packages/brand-pilot-content-contracts/generated/content-orchestration-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/content-proposal-request-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/proposal-base-input-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/proposal-input-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/research-evidence-v1.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/content-proposal-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/content-generation-input-v3.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/image-generation-package-v1.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/card-news-plan-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/blog-plan-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/reel-plan-v2.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/ai-content-v3.schema.json`
- Create: `packages/brand-pilot-content-contracts/generated/content-prompt-binding-v1.schema.json`

- [ ] **Step 1: Write RED determinism tests**

Test two temp-directory generations for byte equality, sorted object keys, final LF, SHA-256 source hash, explicit `type` beside every `const`, and absence of `oneOf`/`uniqueItems`.

- [ ] **Step 2: Run RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- src/generatedArtifacts.test.ts
```

Expected: FAIL because generator/checker and generated files do not exist.

- [ ] **Step 3: Implement stable serialization and catalog output**

Pin `packages/brand-pilot-content-contracts/generated/*.json` and `packages/brand-pilot-content-contracts/src/fixtures/*.json` to `text eol=lf` in the root `.gitattributes`. This preserves the exact incident-fixture and generated-artifact bytes across checkout settings; do not add unrelated repository-wide EOL rules.

```ts
export function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
```

The source hash input is exact and platform-independent: enumerate only authored `src/**/*.ts` files excluding `*.test.ts`, `generateArtifacts.ts`, and `checkGenerated.ts`; sort normalized `/` relative paths by Unicode code point; normalize file bytes to UTF-8 with LF line endings; and hash the concatenation `relativePath + NUL + normalizedBytes + NUL`. Generated files and `content-catalog.json` never participate in this source hash.

Define and export a closed source-level `GeneratedContentCatalogSchema` plus raw schema-derived `GeneratedContentCatalogData = Static<typeof GeneratedContentCatalogSchema>` in `catalog.ts`. Its `schemas` object has exactly these keys: `contentOrchestrationV2`, `contentProposalRequestV2`, `proposalBaseInputV2`, `proposalInputV2`, `researchEvidenceV1`, `contentProposalV2`, `contentGenerationInputV3`, `imageGenerationPackageV1`, `plans: { card_news, blog, reel }`, `aiContentV3`, and `contentPromptBindingV1`. Each leaf is exactly `{ filename, sha256 }`, with the filename pinned to its listed artifact and SHA-256 constrained to lowercase 64-hex. The remaining closed top-level fields are `catalogVersion="content-catalog.v1"`, `contractSourceHash`, `formats`, `purposes`, `claimSlugs`, `services`, `workspaces`, `releaseComponentKeys`, `imageEnvKeys`, `proposalContracts` (request/base/composed/output versions, proposal prompt version, and their schema hashes), `researchEvidence`, `promptBinding`, `planContractVersions`, `plannerModels`, and `manifestContractVersion`.

Export opaque `VerifiedGeneratedContentCatalog = GeneratedContentCatalogData & { readonly __verifiedGeneratedContentCatalog: unique symbol }`. `parseGeneratedContentCatalog` is the only function that returns it after TypeBox, exact filename/hash-set validation, and cross-field equality: every duplicated proposal schema hash equals the corresponding `schemas` leaf, research/prompt-binding hashes equal their leaves, and every plan version/model/format descriptor agrees with the canonical format catalog. Ordinary callers cannot construct the verified type with free-form strings. Emit the catalog JSON from a raw object that `satisfies GeneratedContentCatalogData`, then parse it back before writing. Per-artifact hashes cover the exact thirteen generated schema filenames listed above; the catalog never hashes itself, avoiding a circular digest. Tests compare the exact filename set rather than only a count. All path/key sorting uses the same locale-independent code-point comparator and every emitted file ends with one LF.

Only now implement/export `promptBindingFor(outputFormat, purpose, verifiedCatalog)`. It accepts only the branded parser result and reads `schemas.contentProposalV2.sha256`, `schemas.contentGenerationInputV3.sha256`, `schemas.plans[outputFormat].sha256`, and `contractSourceHash`; it never accepts caller-provided hashes. Tests prove all three binding schema hashes plus source hash come from the emitted catalog, catalog filename/key drift fails, and API start must first verify the selected proposal job's stored request/base/composed/output/prompt/schema metadata against this catalog.

- [ ] **Step 4: Generate, byte-check, and run GREEN**

```powershell
npm run generate --workspace @brand-pilot/content-contracts
npm run check:generated --workspace @brand-pilot/content-contracts
npm test --workspace @brand-pilot/content-contracts -- src/catalog.test.ts src/binding.test.ts src/generatedArtifacts.test.ts src/schemas.test.ts
```

Expected: generator is idempotent, checker exits 0, and tests report no provider-incompatible schema keyword or untyped constant.

- [ ] **Step 5: Commit generated artifacts**

```powershell
git add -- .gitattributes packages/brand-pilot-content-contracts/src/catalog.ts packages/brand-pilot-content-contracts/src/catalog.test.ts packages/brand-pilot-content-contracts/src/binding.ts packages/brand-pilot-content-contracts/src/binding.test.ts packages/brand-pilot-content-contracts/src/index.ts packages/brand-pilot-content-contracts/src/generateArtifacts.ts packages/brand-pilot-content-contracts/src/checkGenerated.ts packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts packages/brand-pilot-content-contracts/generated/content-catalog.json packages/brand-pilot-content-contracts/generated/content-orchestration-v2.schema.json packages/brand-pilot-content-contracts/generated/content-proposal-request-v2.schema.json packages/brand-pilot-content-contracts/generated/proposal-base-input-v2.schema.json packages/brand-pilot-content-contracts/generated/proposal-input-v2.schema.json packages/brand-pilot-content-contracts/generated/research-evidence-v1.schema.json packages/brand-pilot-content-contracts/generated/content-proposal-v2.schema.json packages/brand-pilot-content-contracts/generated/content-generation-input-v3.schema.json packages/brand-pilot-content-contracts/generated/image-generation-package-v1.schema.json packages/brand-pilot-content-contracts/generated/card-news-plan-v2.schema.json packages/brand-pilot-content-contracts/generated/blog-plan-v2.schema.json packages/brand-pilot-content-contracts/generated/reel-plan-v2.schema.json packages/brand-pilot-content-contracts/generated/ai-content-v3.schema.json packages/brand-pilot-content-contracts/generated/content-prompt-binding-v1.schema.json
git commit -m "build: generate canonical content contracts"
```

## Phase 1 verification

Run:

```powershell
npm test --workspace @brand-pilot/content-contracts
npm run build --workspace @brand-pilot/content-contracts
npm run check:generated --workspace @brand-pilot/content-contracts
```

Expected: package tests, build, and generated-artifact check all pass. The package is not wired into production consumers until Phases 3 and 4, so Phase 1 is not deployable by itself.
