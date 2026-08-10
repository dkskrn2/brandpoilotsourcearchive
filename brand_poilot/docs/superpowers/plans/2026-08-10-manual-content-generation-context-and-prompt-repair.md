# Manual Content Generation Context and Prompt Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve existing manual content generation behavior while giving proposal research and final image CLIs the correct frozen context, moving immutable plan assembly to the API, and preventing API errors from causing duplicate model calls.

**Architecture:** Keep `ContentGenerationInputV3`, canonical plan v2, finalizers, manifests, downloads, quota, and leases unchanged. Introduce additive private planner-draft and render-claim contracts, use API-first dual ingress during rollout, hydrate render context at claim time, and keep automatic card-news code untouched.

**Tech Stack:** TypeScript, TypeBox, Fastify, PostgreSQL, Vitest, PGlite, Codex CLI `gpt-5.6-terra`, built-in `gpt-image-2`, React/Vite only for preserved dirty recovery changes.

---

## File structure and ownership

### Existing dirty recovery baseline

- `apps/api/src/aiContentAttachmentRepository.ts`: confirmed attachment deletion and finalization ledger atomicity
- `apps/api/src/aiContentRepository.ts`: selected-generation read/reconciliation and atomic expected-finalization start
- `apps/api/src/aiContentSeedResolver.ts`: ambiguous URL extraction fallback
- `apps/customer-ui/src/components/ai-content/ContentProposalFlow.tsx`: reload/resume and ambiguous delivery recovery
- `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`: pending upload deletion guard
- Four existing planner prompt builders: untrusted URL-subject guards

These changes are preserved and checkpointed before the new work. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are excluded.

### New planner boundary

- Create `packages/brand-pilot-content-contracts/src/plannerDrafts.ts`: exact private creative-draft schemas and parsers
- Modify `packages/brand-pilot-content-contracts/src/index.ts`: export draft types/parsers without adding them to generated canonical schema artifacts
- Modify `apps/api/src/aiContentPlanContracts.ts`: assemble drafts into existing canonical plan v2
- Modify `apps/api/src/aiContentContracts.ts`, `apps/api/src/httpServer.ts`, `apps/api/src/aiContentRepository.ts`: dual exact `plan | planDraft` completion ingress and canonical storage
- Modify each manual planner parser, prompt, generated schema handoff, worker, and tests to emit creative drafts

### New render boundary

- Modify `apps/api/src/aiContentRenderJobs.ts`: hydrate private `image_asset` v2 claim from immutable input snapshot and stored canonical plan
- Modify `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`: strict v2 parser while retaining v1 compatibility
- Modify `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`: stage frozen input, plan, render contract, all attachments, and blog insertion context
- Keep `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts` unchanged for v1 and add a separate v2 dispatcher plus format-specific prompt modules
- Modify `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`: final-pixel role, all-attachment optional reference semantics, no server overlay assumption

### Operational cutover

- Create `scripts/manual-ai-content-contract-cutover.mjs`: exact manual-lineage dry-run/apply utility
- Create `scripts/manual-ai-content-contract-cutover.test.mjs`: selection, hard-stop, atomic terminalization, quota, and automatic-row invariants

---

### Task 1: Preserve and checkpoint the existing dirty recovery work

**Files:**

- Modify: none
- Verify: all currently modified API/UI/prompt files listed by `git status --short`
- Include: `apps/api/src/aiContentAttachmentFinalization.pglite.test.ts`
- Include: `apps/api/src/aiContentRepositoryRead.test.ts`
- Include: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.pendingRemoval.test.tsx`
- Exclude: `pnpm-lock.yaml`
- Exclude: `pnpm-workspace.yaml`

- [ ] **Step 1: Capture the exact baseline**

Run:

```powershell
git rev-parse HEAD
git status --short
git diff --stat
git diff --check
```

Expected: the intended dirty manual-generation files plus the three regression tests; no automatic-card-news or unrelated-worker source file is modified.

- [ ] **Step 2: Run focused API recovery and URL tests**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run `
  src/aiContentRepositoryRead.test.ts `
  src/aiContentRepositoryV3Contracts.test.ts `
  src/legacyDataCompatibility.test.ts `
  src/aiContentAttachmentRepository.test.ts `
  src/aiContentAttachmentFinalization.pglite.test.ts `
  src/aiContentSeedResolver.test.ts `
  src/server.aiContentV2Customer.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 3: Run focused UI recovery tests**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run `
  src/components/ai-content/ContentProposalFlow.test.tsx `
  src/components/ai-content/AiContentAttachmentUploader.test.tsx `
  src/components/ai-content/AiContentAttachmentUploader.pendingRemoval.test.tsx `
  src/features/ai-content/aiContentApiGateway.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 4: Run focused prompt and type checks**

Run the four planner prompt tests and API/UI typechecks. Do not invoke automatic-card-news or unrelated worker tests.

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/blog-worker -- --run src/promptBuilder.test.ts
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
npm run typecheck --workspace @brand-pilot/api
npx tsc --noEmit -p apps/customer-ui/tsconfig.json
```

Expected: zero failures and zero TypeScript errors.

- [ ] **Step 5: Stage only the intended baseline files and commit**

Use explicit paths from `git status`; never use `git add -A`.

```powershell
git diff --cached --check
git commit -m "fix(ai-content): preserve manual generation recovery"
```

Expected: only intended tracked files and the three regression tests are committed; both pnpm files remain untracked.

---

### Task 2: Pass exact topic URLs to controlled proposal research

**Files:**

- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/research.test.ts`
- Regression: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`
- Regression: proposal Codex-model permission tests

- [ ] **Step 1: Write failing URL-context tests**

Add exact assertions equivalent to:

```ts
expect(search).toHaveBeenCalledWith(expect.objectContaining({
  publicResearchContext: expect.objectContaining({
    sourceUrls: {
      requestedUrl: "https://publisher.example/original",
      canonicalUrl: "https://publisher.example/canonical",
    },
  }),
}));
```

Add controlled-search tests that require the prompt order:

```ts
expect(prompt).toContain("requestedUrl을 먼저 직접 확인");
expect(prompt.indexOf("requestedUrl을 먼저 직접 확인"))
  .toBeLessThan(prompt.indexOf("추가 공개 근거"));
```

Also test `sourceUrls: null` for `topic_text` and `reference`, exact-key rejection, identical requested/canonical URL deduplication, and no raw frozen body in the public context.

- [ ] **Step 2: Run tests and confirm RED**

```powershell
npm test --workspace @brand-pilot/worker-runtime -- --run src/controlledSearch.test.ts
npm test --workspace @brand-pilot/content-proposal-worker -- --run src/research.test.ts
```

Expected: failures show `sourceUrls` is missing and URL-first text is absent.

- [ ] **Step 3: Add the exact public context**

Implement the type and parser shape:

```ts
export interface PublicResearchContext {
  purpose: ContentPurpose;
  subjectKind: "topic_text" | "topic_url" | "reference";
  subjectTitle: string | null;
  sourceUrls: { requestedUrl: string; canonicalUrl: string } | null;
  contentInstruction: string | null;
  primaryCategory: string;
  detailedCategory: string;
  selectedProduct: { name: string; category: string } | null;
}
```

Validate both URLs as bounded HTTPS URLs, require them only for `topic_url`, and serialize them through `safeJson` inside the existing untrusted envelope.

- [ ] **Step 4: Add URL-first research instructions without weakening audit**

The search prompt must state:

```text
topic_url이면 requestedUrl을 먼저 직접 확인하세요.
redirect 또는 접근 실패가 있으면 canonicalUrl을 확인하세요.
두 URL에서 원문을 확인할 수 없으면 동결 제목과 카테고리로 추가 공개 근거를 검색하세요.
실제 search audit에서 관찰하지 않은 URL을 읽었다고 주장하지 마세요.
```

Keep main proposal composition network-disabled. Do not turn a frozen API snapshot into an externally observed evidence item.

- [ ] **Step 5: Verify GREEN and commit**

Run the two focused suites plus proposal prompt/model permission tests and both worker builds. Expected: all pass; `codexModel` still disables network/browser/tools.

```powershell
git add -- workers/brand-pilot-worker-runtime/src/controlledSearch.ts workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts workers/brand-pilot-content-proposal-worker/src/research.ts workers/brand-pilot-content-proposal-worker/src/research.test.ts
git diff --cached --check
git commit -m "fix(proposals): ground URL research in the requested source"
```

---

### Task 3: Add creative-only planner draft contracts

**Files:**

- Create: `packages/brand-pilot-content-contracts/src/plannerDrafts.ts`
- Create: `packages/brand-pilot-content-contracts/src/plannerDrafts.test.ts`
- Modify: `packages/brand-pilot-content-contracts/src/index.ts`
- Do not modify: `packages/brand-pilot-content-contracts/src/generateArtifacts.ts`

- [ ] **Step 1: Write failing exact-schema tests**

Tests cover the six format/purpose cells and reject `generationId`, `outputFormat`, `purpose`, `product`, `references`, `attachments`, storage paths, checksums, logo policy, and unknown properties.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm test --workspace @brand-pilot/content-contracts -- --run src/plannerDrafts.test.ts
```

Expected: module/parser not found.

- [ ] **Step 3: Implement private draft schemas**

Use exact shapes:

```ts
const CreativeAssetDraftV1Schema = Type.Object({
  index: Type.Integer({ minimum: 1, maximum: 5 }),
  role: Type.String({ minLength: 1, maxLength: 200 }),
  copy: Type.String({ minLength: 1, maxLength: 4_000 }),
  visualDirection: Type.String({ minLength: 1, maxLength: 4_000 }),
  evidenceIds: Type.Array(UuidSchema, { maxItems: 8 }),
  productImageAssetIds: Type.Array(UuidSchema, { maxItems: 20 }),
}, { additionalProperties: false });
```

Define:

```ts
type CardNewsPlanDraftV1 = {
  contractVersion: "card-news-plan-draft.v1";
  content: SocialPlanContentV2;
  assets: CreativeAssetDraftV1[];
};

type ReelPlanDraftV1 = {
  contractVersion: "reel-plan-draft.v1";
  content: SocialPlanContentV2;
  assets: CreativeAssetDraftV1[];
};

type BlogPlanDraftV1 = {
  contractVersion: "blog-plan-draft.v1";
  content: BlogPlanContentV2;
  imageDraft: null | {
    aspectRatio: ContentAspectRatio;
    assets: CreativeAssetDraftV1[];
  };
};
```

Export types and parsers from `index.ts`, but do not register them as canonical stored schemas or generated artifacts.

- [ ] **Step 4: Verify GREEN and canonical catalog stability**

Run draft tests, existing schema tests, and the generated-artifact check. Assert existing plan schema hashes/files are unchanged.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/brand-pilot-content-contracts/src/plannerDrafts.ts packages/brand-pilot-content-contracts/src/plannerDrafts.test.ts packages/brand-pilot-content-contracts/src/index.ts
git diff --cached --check
git commit -m "feat(content-contracts): add private planner drafts"
```

---

### Task 4: Assemble canonical v2 plans in the API

**Files:**

- Modify: `apps/api/src/aiContentPlanContracts.ts`
- Create or modify: `apps/api/src/aiContentPlanContracts.test.ts`
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: worker-route/repository focused tests

- [ ] **Step 1: Write failing assembler matrix tests**

Cover card/news/reel outline locking, blog null/1/5 images, information versus marketing product invariants, allowed evidence IDs, allowed product image IDs, duplicate rejection, and `attachmentIds: []` in the assembled canonical assets.

- [ ] **Step 2: Run and confirm RED**

```powershell
npm test --workspace @brand-pilot/api -- --run src/aiContentPlanContracts.test.ts
```

Expected: `assembleContentPlanResultV2` does not exist.

- [ ] **Step 3: Implement the assembler**

Add:

```ts
export function assembleContentPlanResultV2(
  draft: unknown,
  rawInput: unknown,
  supplementalResearch?: unknown,
): ContentPlanResultV2
```

Build the canonical package from frozen input:

```ts
const fixedPackage = {
  contractVersion: "image-generation-package.v1" as const,
  generationId: input.generationId,
  outputFormat: input.outputSettings.outputFormat,
  purpose: input.outputSettings.purpose,
  assetCount: assets.length,
  aspectRatio,
  channelTargets: input.outputSettings.channelTargets,
  assets: assets.map((asset) => ({ ...asset, attachmentIds: [] })),
  product: input.product,
  references: input.references.selected,
  brandStyleImages: input.references.brandStyleImages,
  avatarStyleImageId: input.references.avatarStyleImageId,
  attachments: input.references.attachments,
  userImageInstruction: input.userImageInstruction,
  logoPolicy: {
    allowGeneratedLogo: false,
    allowReservedLogoArea: false,
    allowExternalReferenceLogo: false,
    allowExistingProductPackagingLogo: true,
  },
};
```

Run the assembled value through existing `parseContentPlanResultV2` before returning.

- [ ] **Step 4: Add dual exact completion ingress**

Accept exactly one of:

```ts
{ workerId, leaseToken, skillVersion, jobType: "generate", plan }
{ workerId, leaseToken, skillVersion, jobType: "generate", planDraft }
```

Reject both or neither. Existing `plan` passes existing validation; `planDraft` goes through the assembler. Store and enqueue only canonical plan v2.

- [ ] **Step 5: Verify storage and rollback boundaries**

Tests assert a draft completion writes one canonical `plan_json`, creates the same image render rows as the legacy canonical completion, and on any invalid ID writes no plan/output transition/render job.

- [ ] **Step 6: Verify GREEN and commit**

Run API assembler, worker-route, V3 runtime, and transaction tests plus API typecheck.

```powershell
git add -- apps/api/src/aiContentPlanContracts.ts apps/api/src/aiContentPlanContracts.test.ts apps/api/src/aiContentContracts.ts apps/api/src/httpServer.ts apps/api/src/aiContentRepository.ts
git diff --cached --check
git commit -m "feat(ai-content): assemble immutable plans in the API"
```

---

### Task 5: Convert the three manual planners to creative drafts

**Files:**

- Modify: `workers/brand-pilot-card-news-worker/src/editorialPlan.ts`
- Modify: card-news prompt/schema/worker tests and runner schema
- Modify: `workers/brand-pilot-blog-worker/src/contracts.ts`
- Modify: blog prompt/schema/worker tests and runner schema
- Modify: `workers/brand-pilot-reel-worker/src/contracts.ts`
- Modify: reel prompt/schema/worker tests and runner schema

- [ ] **Step 1: Write RED tests for each format**

For each worker assert:

- prompt requests only its `*-plan-draft.v1`
- prompt does not request generation ID, storage path, checksum, product/reference/attachment snapshots, or logo policy
- parser rejects immutable fields
- completion body contains `planDraft`, not `plan`
- informational and marketing prompt branches remain distinct

- [ ] **Step 2: Run each focused worker suite and confirm RED**

Run card news, blog, and reel tests separately so failures are attributable.

- [ ] **Step 3: Convert card-news worker**

Keep exact outline count/index/role in the creative draft validator. Remove attachment selection from the prompt. Preserve purpose-specific content guidance.

- [ ] **Step 4: Convert blog worker**

Keep semantic HTML and `imageDraft: null` support. If images exist, preserve exact `asset://01..NN` validation and used-evidence validation. The model chooses image count/role/aspect, but not immutable snapshots or attachment usage.

- [ ] **Step 5: Convert reel worker**

Keep exact outline count/index/role. Move API completion outside the local repair `try/catch`:

```ts
let draft: ReelPlanDraftV1 | undefined;
for (let attempt = 0; attempt < 2; attempt += 1) {
  const run = await planner.run(...);
  try {
    draft = parseReelPlanDraftV1(...);
    break;
  } catch (error) {
    if (attempt === 1) throw error;
    repairError = errorMessage(error);
  }
}
await client.complete(job.id, { ...identity, jobType: "generate", planDraft: draft });
```

- [ ] **Step 6: Verify all three workers and commit separately**

Each worker gets its own commit after its suite and build pass. Do not edit or test automatic-card-news runtime code.

---

### Task 6: Preserve API errors and prevent completion failures from re-planning

**Files:**

- Modify: `workers/brand-pilot-worker-runtime/src/index.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.test.ts`
- Modify: shared worker HTTP clients if completion replay is not centralized
- Modify: three worker tests for call counts

- [ ] **Step 1: Write explicit classification tests**

Test stable API codes and retry behavior:

```ts
expect(await contentWorkerApiError(response(400, "ai_content_plan_invalid")))
  .toMatchObject({ status: 400, errorCode: "ai_content_plan_invalid", retryable: false });
expect(classify(409)).toBe("conflict");
expect(classify(429)).toBe("retryable");
expect(classify(503)).toBe("retryable");
```

Worker tests assert local schema invalid calls planner twice, API 400 calls planner once and fail once with `retryable:false`, 409 calls planner once and reconciles/cancels, and 429/503 retries the exact same completion payload without a planner call.

- [ ] **Step 2: Run and confirm RED**

Run worker-runtime and three worker call-count tests.

- [ ] **Step 3: Implement typed error and bounded completion replay**

Introduce:

```ts
export class ContentWorkerApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(`worker_api_failed:${status}${errorCode ? `:${errorCode}` : ""}`);
  }
}
```

Classification rules are status-first, not suffix-first. Replay the identical completion body with delays `250ms, 750ms, 1500ms`, checking lease state before each attempt. Never call the planner from this helper.

- [ ] **Step 4: Verify GREEN and commit**

Run worker-runtime tests, all three worker suites, and builds.

---

### Task 7: Hydrate private image-asset render claim v2

**Files:**

- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRenderJobs.ts`
- Modify: `apps/api/src/aiContentRenderJobs.test.ts`
- Modify: `apps/api/src/aiContentRenderJobs.pglite.test.ts`
- Modify: `apps/api/src/aiContentRepositoryV3Contracts.test.ts`

- [ ] **Step 1: Write RED claim tests**

For a proven manual-lineage `image_asset`, expect claim payload:

```ts
{
  contractVersion: "ai-content-render-job.v2",
  jobKind: "image_asset",
  generationId,
  outputId,
  assetIndex,
  assetKey,
  storagePath,
  imagePackage,
  contentGenerationInput,
  contentPlan,
  rendererPromptVersion: "image-final-pixels.v2",
}
```

At planning completion, resolve manual lineage through prompt binding → selected proposal → proposal batch before enqueueing. Assert only proven manual rows are stored with the private v2 marker. Assert `scheduled_crawl`, pre-existing v1 rows, and `package_finalize` stay v1. For a row already marked v2, input/plan/generation/output/brand/workspace/lineage mismatch rolls back the claim.

- [ ] **Step 2: Run and confirm RED**

Run focused render repository unit and PGlite tests.

- [ ] **Step 3: Implement claim-time hydration**

Add a `resolveManualRenderTransport()` check at planning completion and pass the selected private version into `enqueueAiContentRenderJobs`. Add a `manualImageAssetPayloadV2()` query analogous to `finalizerPayload()`. Only when the stored row is v2, read immutable snapshot, stored plan, prompt binding, selected proposal, and proposal-batch origin in the same claim transaction. Parse input, parse canonical plan, require its `imagePackage` to equal the queued package, and return v2 only for `origin='manual'` without rewriting canonical DB state. Return every stored v1 payload untouched and do not require lineage for it.

- [ ] **Step 4: Verify GREEN and commit**

Run render repository tests and API typecheck.

---

### Task 8: Stage full context and all attachments in the image worker

**Files:**

- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`
- Modify: affected worker integration fixtures

- [ ] **Step 1: Write RED parser and staging tests**

Assert exact v2 keys, canonical input/plan parsing, ID binding, and rejection of mismatched plan/package. Assert v1 still parses and renders through the existing path for rollout compatibility.

Renderer test with three attachments and empty per-asset `attachmentIds` must prove all three are checksum-verified and present in `inputs/attachments/index.json`.

- [ ] **Step 2: Run and confirm RED**

Run render-client and asset-renderer tests.

- [ ] **Step 3: Stage read-only context files**

Write and chmod `0444`:

```text
inputs/content-generation-input.json
inputs/content-plan.json
inputs/render-contract.json
inputs/attachments/index.json
inputs/attachments/attachment-01.<ext> ... attachment-NN.<ext>
```

Do not put the large frozen input or HTML directly into the prompt string.

- [ ] **Step 4: Add deterministic blog insertion context**

For current `asset://NN`, parse finished `htmlTemplate` and stage:

```ts
{
  placeholder: "asset://01",
  altText,
  nearestHeading,
  previousParagraph,
  nextParagraph,
  role,
}
```

Fail before CLI invocation if placeholder order/count or insertion binding is invalid.

- [ ] **Step 5: Verify GREEN and commit**

Run image-worker client/renderer tests and build.

---

### Task 9: Split card-news, reel, and blog final image prompts

**Files:**

- Create: `workers/brand-pilot-image-worker/src/aiContentCardNewsAssetPromptV2.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentBlogAssetPromptV2.ts`
- Create: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.ts`
- Keep unchanged: `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts` for v1
- Add/modify: prompt tests for all three modules
- Modify: `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`
- Modify: `workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs`

- [ ] **Step 1: Write RED prompt contract tests**

All formats must name `content-generation-input.json`, `content-plan.json`, every attachment index entry, untrusted-data handling, no network/shell, and `gpt-image-2`.

Card/reel must explicitly forbid background-only output and require complete visible Korean content inside the PNG. Blog must explicitly say the HTML is final, not rewrite it, and use exact insertion context.

- [ ] **Step 2: Run and confirm RED**

Run only image asset prompt tests.

- [ ] **Step 3: Implement common safe envelope and three distinct prompts**

The reel prompt uses the user-approved 9:16 text. The card-news prompt adapts it to a 1:1 Instagram carousel card. The blog prompt describes a supporting image for the exact HTML section. Dispatch to these only for `ai-content-render-job.v2`; v1 continues through `aiContentAssetPrompt.ts` byte-for-byte.

No prompt says that the server will add text later. No prompt requires every attachment to appear. No prompt grants network access.

- [ ] **Step 4: Update the image-render skill**

For v2, replace “카피를 다시 기획하지 마세요” with format-specific final-pixel responsibility. Preserve the existing v1 section, one PNG per job, no collage, no external API, no unrelated filesystem access, and JSON-only completion. Update the runner so v1 still accepts `ai-content-asset-render.v1`, while v2 requires exact `{ contractVersion: "ai-content-asset-render.v2", assetIndex, status: "completed" }`.

- [ ] **Step 5: Verify GREEN and commit**

Run prompt, renderer, worker tests and image-worker build.

---

### Task 10: Add an exact manual-job cutover utility

**Files:**

- Create: `scripts/manual-ai-content-contract-cutover.mjs`
- Create: `scripts/manual-ai-content-contract-cutover.test.mjs`
- Modify deployment docs only if the script's command needs recording

- [ ] **Step 1: Write RED selection and hard-stop tests**

Fixtures cover `proposal-v2`, legacy `manual`, proven manual `retry-v3`, `scheduled_automation`, null/unknown origin, broken retry parent, completed output, partial generation, active lease, and usage reservation.

- [ ] **Step 2: Run and confirm RED**

```powershell
node --test scripts/manual-ai-content-contract-cutover.test.mjs
```

Expected: script/module missing.

- [ ] **Step 3: Implement dry-run first**

Default mode prints exact before IDs/counts and performs no mutation. `--apply` requires maintenance already enabled, zero ambiguous lineage, and explicit expected counts/hash from dry-run.

- [ ] **Step 4: Implement one-transaction terminalization**

Lock only proven manual nonterminal graph rows. Preserve completed outputs. Clear active leases, apply stable `manual_content_contract_cutover` failure code, recalculate generation status, and invoke existing quota reversal semantics exactly once.

- [ ] **Step 5: Prove automatic rows unchanged**

Before/after IDs and statuses for scheduled rows must be byte-for-byte equal. Any automatic row in the candidate set aborts before mutation.

- [ ] **Step 6: Verify GREEN and commit**

Run script tests and `git diff --check`. Do not connect to production in this task.

---

### Task 11: Focused regression matrix and independent review

**Files:**

- Modify tests only where a real uncovered regression is found
- Do not modify automatic-card-news or unrelated-worker production source

- [ ] **Step 1: Run contract/API matrix**

Cover 3 formats × 2 purposes × 3 seed modes at the contract/API boundary, attachments 0/1/multiple, and blog image counts 0/1/5.

- [ ] **Step 2: Run three planner workers and image worker focused suites**

Run worker-runtime, proposal research, card-news, blog, reel, and image asset/finalizer tests. Do not run automatic-card-news or unrelated worker suites.

- [ ] **Step 3: Run API/UI focused recovery suites and typechecks**

Repeat Task 1 suites plus new plan/render tests. Run package builds for content contracts, worker runtime, API, three manual planner workers, image worker, and customer UI typecheck.

- [ ] **Step 4: Verify prohibited diffs**

```powershell
git diff HEAD~1 -- apps/api/src/automatedCardNews.ts workers/brand-pilot-marketing-worker
git status --short
git diff --check
```

Expected: no automatic-card-news or marketing-worker production diff; pnpm files are still excluded.

- [ ] **Step 5: Request two-stage review**

First reviewer checks design/spec compliance. Only after it passes, second reviewer checks code quality, concurrency, transaction, prompt-trust, and compatibility. Fix every P0/P1 and re-run the affected focused tests.

---

### Task 12: Maintenance cutover, production deploy, and Chrome QA

**Files:**

- No new product code unless a production-only defect is reproduced and returned through TDD/review

- [ ] **Step 1: Produce release evidence**

Record commit SHA, image digests, migration state, current production runtime source SHA, focused test counts, and rollback target.

- [ ] **Step 2: Enable maintenance and run dry-run inventory**

Run the cutover utility without `--apply`. Stop if any unknown lineage or automatic row appears.

- [ ] **Step 3: Apply the exact cutover**

Apply only after dry-run counts/hash match. Prove zero nonterminal proven-manual rows and unchanged automatic rows.

- [ ] **Step 4: Deploy in compatibility order**

Deploy dual-ingress API/private render v2 compatibility, then image worker, then card-news/blog/reel workers, then customer UI if its preserved recovery diff is included. Keep maintenance on through smoke tests.

- [ ] **Step 5: Run authenticated Chrome production QA**

Generate six manual cases: both purposes for each format. Distribute topic_text/topic_url/reference and attachments 0/1/multiple across the six. Verify proposal, final pixels/HTML, lineage, worker/model, output files, manifest, ZIP, reload/resume, and quota.

- [ ] **Step 6: Final review and maintenance release**

If all six succeed and logs show no legacy marketing route, duplicate planner calls, or contract errors, release maintenance and record final production evidence. Automatic deployment repair remains a separate task.

---

## Plan self-review

- Every design requirement maps to Tasks 2 through 12.
- Canonical stored plan, manifest, download, quota, lease, and completed history contracts stay unchanged.
- New contracts are private and additive.
- API-first dual ingress prevents rolling-deploy breakage.
- Automatic card news is neither modified nor executed by this plan.
- Existing dirty resume/URL/attachment fixes are checkpointed before overlapping edits.
- No task uses `git add -A`, reset, restore, clean, or destructive history rewriting.
