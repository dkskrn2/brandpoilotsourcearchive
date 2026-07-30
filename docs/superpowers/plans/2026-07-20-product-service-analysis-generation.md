# Product/Service Analysis Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a five-step AI content flow that analyzes a product or service URL once, recommends three targets and one selectable appeal, and passes the confirmed data to the card-news, blog, or marketing CLI worker through one versioned contract.

**Architecture:** The API owns URL normalization, bounded page extraction, image archiving, cache/version control, and immutable generation snapshots. A dedicated subject-analysis CLI worker claims one analysis at a time and performs public-web research, while the existing three content workers receive the same `content-generation-input.v2` envelope and remain responsible only for their output format. React polls analysis state, presents exactly five steps, and never runs analysis when merely opening or navigating the wizard.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Supabase, React 18, Vite, Vitest, PGlite, Codex CLI, Vercel Blob/Object Storage

---

## File Map

**Create**

- `db/migrations/047_ai_content_subject_analysis.sql`: cached analysis, archived image, lease, version, and generation-snapshot schema.
- `apps/api/src/aiContentSubjectContracts.ts`: customer and worker request/result parsers.
- `apps/api/src/aiContentSubjectContracts.test.ts`: strict contract tests.
- `apps/api/src/aiContentSubjectExtractor.ts`: bounded page fact/image extraction and image archive validation.
- `apps/api/src/aiContentSubjectExtractor.test.ts`: extraction, SSRF, redirect, size, and MIME tests.
- `apps/api/src/aiContentSubjectRepository.ts`: cache lookup, queue/lease, completion, selection, and snapshot persistence.
- `apps/api/src/aiContentSubjectRepository.test.ts`: repository behavior and concurrency tests.
- `apps/api/src/aiContentGenerationInput.ts`: builds `content-generation-input.v2` from persisted records.
- `apps/api/src/aiContentGenerationInput.test.ts`: envelope and one-target/one-appeal validation tests.
- `workers/brand-pilot-subject-analysis-worker/*`: dedicated Codex CLI worker and Korean research skill.
- `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx`: product/service input, cached analysis, image selection, and progress UI.
- `apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx`: three recommendations, custom target, and exactly one appeal.
- `apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx`: color, prompt, image roles, count, and final generation action.
- `apps/customer-ui/src/components/ai-content/*.test.tsx`: focused step interaction tests.
- `scripts/ai-content-subject-smoke.mjs`: optional local live smoke test.

**Modify**

- `apps/api/src/aiContentContracts.ts`, `apps/api/src/types.ts`, `apps/api/src/repository.ts`, `apps/api/src/httpServer.ts`, `apps/api/src/index.ts`: expose the new customer and worker operations.
- `apps/api/src/aiContentRepository.ts`: validate and freeze the selected analysis snapshot before generation.
- `apps/api/src/server.aiContentCustomer.test.ts`, `apps/api/src/server.aiContentWorker.test.ts`: route contracts and authentication.
- `apps/customer-ui/src/features/ai-content/types.ts`, `useAiContentDraft.ts`, `aiContentApiGateway.ts`, `mockAiContentGateway.ts`: new draft and gateway contracts.
- `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`, `ReferencePicker.tsx`, `AiContentAttachmentUploader.tsx`: compose the five-step flow and preserve existing reference/upload behavior.
- `apps/customer-ui/src/pages/AiContentWizardPage.tsx`, `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`: navigation, validation, polling, and submit behavior.
- `apps/customer-ui/src/styles/prototype.css`: responsive analysis, target, reference, and prompt layouts.
- `workers/brand-pilot-card-news-worker/src/contracts.ts`, `promptBuilder.ts`, tests: consume the common envelope.
- `workers/brand-pilot-blog-worker/src/contracts.ts`, `promptBuilder.ts`, tests: consume the common envelope.
- `workers/brand-pilot-marketing-worker/src/contracts.ts`, `promptBuilder.ts`, tests: consume the common envelope.
- `package.json`, `package-lock.json`, `scripts/check-local-env.mjs`, `README.md`, `docs/ARCHITECTURE.md`: worker scripts and operations.

### Task 1: Add the persisted analysis and image model

**Files:**
- Create: `db/migrations/047_ai_content_subject_analysis.sql`
- Modify: `db/smoke/001_schema_smoke.sql`
- Modify: `scripts/migrationRunner.test.mjs`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write the failing migration assertions**

Add assertions that the migration creates both tables, the active-cache partial unique index, the claim index, and foreign keys to `brands`, `workspaces`, and `ai_content_generations`.

```js
assert.match(sql, /create table if not exists ai_content_subject_analyses/i);
assert.match(sql, /create table if not exists ai_content_subject_images/i);
assert.match(sql, /where superseded_at is null/i);
assert.match(sql, /lease_expires_at/i);
assert.match(sql, /subject_analysis_snapshot/i);
```

- [ ] **Step 2: Run the migration tests and confirm the failure**

Run: `npm run test:migrations`

Expected: FAIL because migration `047_ai_content_subject_analysis.sql` and its schema objects do not exist.

- [ ] **Step 3: Add the migration**

Create the tables with these exact invariants:

```sql
create table if not exists ai_content_subject_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  subject_type text not null check (subject_type in ('product', 'service')),
  source_url text not null,
  normalized_url text not null,
  input_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'extracting', 'researching', 'ready', 'partial', 'failed')),
  facts_json jsonb not null default '[]'::jsonb,
  structured_data_json jsonb not null default '{}'::jsonb,
  research_json jsonb not null default '{}'::jsonb,
  targets_json jsonb not null default '[]'::jsonb,
  appeals_json jsonb not null default '{}'::jsonb,
  selected_image_id uuid,
  analysis_version integer not null default 1 check (analysis_version > 0),
  idempotency_key text not null,
  leased_by text,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  error_code text,
  error_message text,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (brand_id, idempotency_key)
);

create table if not exists ai_content_subject_images (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references ai_content_subject_analyses(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url text not null,
  storage_url text not null,
  storage_path text not null,
  width integer,
  height integer,
  mime_type text not null,
  alt_text text,
  role text not null check (role in ('product', 'service', 'logo', 'detail', 'unknown')),
  selection_score numeric not null default 0,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (analysis_id, source_url)
);

alter table ai_content_subject_analyses
  add constraint ai_content_subject_selected_image_fk
  foreign key (selected_image_id) references ai_content_subject_images(id) on delete set null;

create unique index ai_content_subject_active_cache_uq
  on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
  where superseded_at is null;

create index ai_content_subject_claim_idx
  on ai_content_subject_analyses (available_at, created_at)
  where status in ('queued', 'researching');

alter table ai_content_generations
  add column if not exists subject_analysis_snapshot jsonb;
```

- [ ] **Step 4: Run migration and repository contract checks**

Run: `npm run test:migrations && npm run test:contract`

Expected: PASS with migration `047` applied in order and repository contract unchanged.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/047_ai_content_subject_analysis.sql db/smoke/001_schema_smoke.sql scripts/migrationRunner.test.mjs scripts/migrations.integration.test.mjs
git commit -m "feat: add AI content subject analysis schema"
```

### Task 2: Define strict customer and worker contracts

**Files:**
- Create: `apps/api/src/aiContentSubjectContracts.ts`
- Create: `apps/api/src/aiContentSubjectContracts.test.ts`
- Modify: `apps/api/src/aiContentContracts.ts`

- [ ] **Step 1: Write failing parser tests**

Cover URL normalization, product/service manual inputs, exactly three returned targets, source URLs on research claims, one selected image, and rejection of malformed worker output.

```ts
expect(parseCreateSubjectAnalysisInput({
  subjectType: "service",
  sourceUrl: "https://example.com/service#price",
  manualInput: { name: "운영 대행", description: "승인 후 게시하는 서비스" },
  idempotencyKey: "subject-1",
})).toEqual({
  subjectType: "service",
  sourceUrl: "https://example.com/service#price",
  manualInput: { name: "운영 대행", promotion: "", description: "승인 후 게시하는 서비스" },
  idempotencyKey: "subject-1",
  force: false,
});

expect(() => parseSubjectAnalysisResult({
  contractVersion: "subject-analysis-result.v1",
  targets: [{ id: "one" }],
})).toThrow("subject_analysis_targets_invalid");
```

- [ ] **Step 2: Run the focused test and confirm the failure**

Run: `npm test -- aiContentSubjectContracts.test.ts`

Workdir: `apps/api`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement versioned types and parsers**

Define these public shapes and validate all bounded strings and arrays:

```ts
export type SubjectType = "product" | "service";
export type SubjectAnalysisStatus = "queued" | "extracting" | "researching" | "ready" | "partial" | "failed";

export interface SubjectTarget {
  id: string;
  name: string;
  traits: string[];
  painPoints: string[];
  purchaseMotivations: string[];
  uspEvidence: Array<{ claim: string; support: string; sourceUrl: string }>;
}

export interface SubjectAppeal {
  id: string;
  targetId: string;
  title: string;
  description: string;
  evidenceType: "product_fact" | "public_research" | "manual_input";
  connectionReason: string;
  sources: Array<{ title: string; url: string }>;
}

export interface SubjectAnalysisResultV1 {
  contractVersion: "subject-analysis-result.v1";
  summary: string;
  needs: Array<{ text: string; sourceUrl: string }>;
  alternatives: Array<{ name: string; strengths: string[]; limitations: string[]; sourceUrls: string[] }>;
  voc: Array<{ quoteSummary: string; context: string; sourceUrl: string }>;
  usps: Array<{ claim: string; support: string; sourceUrl: string }>;
  targets: [SubjectTarget, SubjectTarget, SubjectTarget];
  appealsByTarget: Record<string, SubjectAppeal[]>;
  recommendedImageId: string | null;
  sourceGaps: string[];
}
```

The parser must reject unsupported URL protocols, duplicate target IDs, appeals pointing to an unknown target, and research entries without an `https:` URL. It may return `recommendedImageId: null` when the page has no usable image.

- [ ] **Step 4: Run focused and API type tests**

Run: `npm test -- aiContentSubjectContracts.test.ts aiContentRepository.test.ts && npm run typecheck`

Workdir: `apps/api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/aiContentSubjectContracts.ts apps/api/src/aiContentSubjectContracts.test.ts apps/api/src/aiContentContracts.ts
git commit -m "feat: define subject analysis contracts"
```

### Task 3: Extract page facts and archive allowed images

**Files:**
- Create: `apps/api/src/aiContentSubjectExtractor.ts`
- Create: `apps/api/src/aiContentSubjectExtractor.test.ts`
- Modify: `apps/api/src/sourceCrawler.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Write failing extraction tests**

Use injected `fetchImpl`, DNS resolver, and `archiveImage` dependencies. Verify title, Open Graph, JSON-LD Product/Service, visible text, `<img>`/`srcset`, duplicate URL removal, maximum 20 candidates, redirect revalidation, private-IP blocking, 5 MB HTML limit, 10 MB image limit, and image MIME rejection.

```ts
const result = await extractSubjectPage({
  url: "https://shop.example.com/items/1",
  fetchImpl,
  resolveHost: async () => ["203.0.113.10"],
  archiveImage: async (image) => ({
    ...image,
    storageUrl: `https://blob.example/${image.index}.png`,
    storagePath: `subjects/a/${image.index}.png`,
  }),
});

expect(result.structuredData).toMatchObject({ name: "여름 셔츠" });
expect(result.images).toHaveLength(2);
expect(result.facts.some((fact) => fact.sourceUrl.endsWith("/items/1"))).toBe(true);
```

- [ ] **Step 2: Run the focused test and confirm the failure**

Run: `npm test -- aiContentSubjectExtractor.test.ts`

Workdir: `apps/api`

Expected: FAIL because `extractSubjectPage` does not exist.

- [ ] **Step 3: Extract reusable crawl safety helpers**

Export the existing URL and redirect guards from `sourceCrawler.ts` without changing their current behavior:

```ts
export { assertSafeCrawlUrl, fetchWithSafeRedirects, isPrivateAddress };
```

Keep DNS resolution before every request and after every redirect. Do not accept credentials in URLs, non-HTTP protocols, loopback, link-local, RFC1918, or metadata endpoints.

- [ ] **Step 4: Implement bounded extraction and archive calls**

Return only structured data needed by the CLI contract:

```ts
export interface ExtractedSubjectPage {
  canonicalUrl: string;
  title: string;
  description: string;
  facts: Array<{ key: string; value: string; sourceUrl: string }>;
  structuredData: Record<string, unknown>;
  images: Array<{
    sourceUrl: string;
    storageUrl: string;
    storagePath: string;
    width: number | null;
    height: number | null;
    mimeType: string;
    altText: string;
    role: "product" | "service" | "logo" | "detail" | "unknown";
  }>;
}
```

Archive only images discovered on the submitted product/service page. Public-web research images must never enter this function.

- [ ] **Step 5: Run crawler regression and focused tests**

Run: `npm test -- aiContentSubjectExtractor.test.ts sourceCrawler.test.ts sourceCrawler.regression-1.test.ts`

Workdir: `apps/api`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/aiContentSubjectExtractor.ts apps/api/src/aiContentSubjectExtractor.test.ts apps/api/src/sourceCrawler.ts apps/api/src/index.ts
git commit -m "feat: extract product and service source data"
```

### Task 4: Add cache, queue, lease, and selection repository operations

**Files:**
- Create: `apps/api/src/aiContentSubjectRepository.ts`
- Create: `apps/api/src/aiContentSubjectRepository.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] **Step 1: Write failing repository tests**

Test these behaviors with PGlite:

1. Same brand/type/normalized URL returns the active ready record without queueing another row.
2. `force: true` supersedes the active row and increments `analysis_version`.
3. Two workers cannot claim the same row.
4. Expired leases become claimable again.
5. Completion stores exactly three targets and chooses only an image belonging to the same analysis.
6. Selecting an image clears the previous `is_selected` flag in one transaction.
7. A failed new version does not overwrite the prior ready result.

```ts
const first = await repository.requestSubjectAnalysis(scopeAndInput);
const cached = await repository.requestSubjectAnalysis({ ...scopeAndInput, idempotencyKey: "second" });
expect(cached.id).toBe(first.id);

const forced = await repository.requestSubjectAnalysis({ ...scopeAndInput, idempotencyKey: "third", force: true });
expect(forced.analysisVersion).toBe(first.analysisVersion + 1);
```

- [ ] **Step 2: Run the focused test and confirm the failure**

Run: `npm test -- aiContentSubjectRepository.test.ts`

Workdir: `apps/api`

Expected: FAIL because repository operations are absent.

- [ ] **Step 3: Implement repository records and operations**

Expose these methods through `Repository`:

```ts
getCachedSubjectAnalysis(input: BrandScope & { subjectType: SubjectType; sourceUrl: string }): Promise<SubjectAnalysisRecord | null>;
requestSubjectAnalysis(input: BrandScope & CreateSubjectAnalysisInput): Promise<SubjectAnalysisRecord>;
getSubjectAnalysis(input: BrandScope & { analysisId: string }): Promise<SubjectAnalysisRecord | null>;
selectSubjectImage(input: BrandScope & { analysisId: string; imageId: string }): Promise<SubjectAnalysisRecord>;
claimSubjectAnalysis(input: { workerId: string; leaseSeconds: number }): Promise<SubjectAnalysisClaim | null>;
markSubjectExtractionComplete(input: SubjectExtractionCompletion): Promise<SubjectAnalysisClaim>;
heartbeatSubjectAnalysis(input: SubjectLeaseIdentity & { leaseSeconds: number }): Promise<boolean>;
completeSubjectAnalysis(input: SubjectLeaseIdentity & SubjectAnalysisResultV1): Promise<SubjectAnalysisRecord>;
failSubjectAnalysis(input: SubjectLeaseIdentity & { errorCode: string; errorMessage: string; retryable: boolean }): Promise<SubjectAnalysisRecord>;
```

Use `FOR UPDATE SKIP LOCKED` on PostgreSQL and the existing PGlite-compatible claim pattern already used by AI content jobs. A retryable failure sets exponential `available_at` with a maximum of three attempts; the fourth failure becomes terminal.

- [ ] **Step 4: Run repository tests and typecheck**

Run: `npm test -- aiContentSubjectRepository.test.ts aiContentRepository.test.ts && npm run typecheck`

Workdir: `apps/api`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/aiContentSubjectRepository.ts apps/api/src/aiContentSubjectRepository.test.ts apps/api/src/types.ts apps/api/src/repository.ts
git commit -m "feat: queue and cache subject analyses"
```

### Task 5: Expose customer and worker HTTP APIs

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`

- [ ] **Step 1: Write failing customer route tests**

Test authenticated brand scoping for:

```text
GET    /brands/:brandId/ai-content/subject-analyses/cache?subjectType=product&sourceUrl=...
POST   /brands/:brandId/ai-content/subject-analyses
GET    /brands/:brandId/ai-content/subject-analyses/:analysisId
POST   /brands/:brandId/ai-content/subject-analyses/:analysisId/reanalyze
PATCH  /brands/:brandId/ai-content/subject-analyses/:analysisId/selection
```

Assert that a user cannot read or select another brand's analysis and that the POST response is fast and returns `status: "queued"` without running the crawler inline.

- [ ] **Step 2: Write failing worker route tests**

Test worker-token protection and lease identity for:

```text
POST /worker/ai-content-subject-analyses/claim
POST /worker/ai-content-subject-analyses/:analysisId/heartbeat
POST /worker/ai-content-subject-analyses/:analysisId/extraction-complete
POST /worker/ai-content-subject-analyses/:analysisId/complete
POST /worker/ai-content-subject-analyses/:analysisId/fail
```

The claim route must call the injected extractor after leasing the row, archive the candidate images, persist extraction, and return `subject-analysis.v1`. If extraction fails, it must call `failSubjectAnalysis` and return no job payload.

- [ ] **Step 3: Run route tests and confirm failures**

Run: `npm test -- server.aiContentCustomer.test.ts server.aiContentWorker.test.ts`

Workdir: `apps/api`

Expected: FAIL with route-not-found assertions.

- [ ] **Step 4: Implement routes and dependency injection**

Build the worker claim payload in the API:

```ts
const payload = {
  contractVersion: "subject-analysis.v1" as const,
  brand: {
    name: brand.name,
    primaryCategory: brand.primaryCategory,
    subcategories: brand.subcategories,
    brandColor: brand.primaryColor,
  },
  subject: {
    type: analysis.subjectType,
    sourceUrl: analysis.sourceUrl,
    manualInput: analysis.input,
  },
  extracted: {
    facts: extraction.facts,
    structuredData: extraction.structuredData,
    imageCandidates: images.map(toWorkerImageCandidate),
  },
  researchPolicy: {
    publicWebSearch: true,
    allowedPurposes: ["voc", "alternatives", "market_context"],
    requireSourceUrl: true,
  },
};
```

Return `202` for a newly queued analysis, `200` for a cached ready/partial analysis, and `404` for cross-brand IDs.

- [ ] **Step 5: Run API tests and typecheck**

Run: `npm test -- server.aiContentCustomer.test.ts server.aiContentWorker.test.ts aiContentSubjectRepository.test.ts && npm run typecheck`

Workdir: `apps/api`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/httpServer.ts apps/api/src/index.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/server.aiContentWorker.test.ts
git commit -m "feat: expose subject analysis APIs"
```

### Task 6: Build the dedicated subject-analysis CLI worker

**Files:**
- Create: `workers/brand-pilot-subject-analysis-worker/package.json`
- Create: `workers/brand-pilot-subject-analysis-worker/tsconfig.json`
- Create: `workers/brand-pilot-subject-analysis-worker/.env.example`
- Create: `workers/brand-pilot-subject-analysis-worker/README.md`
- Create: `workers/brand-pilot-subject-analysis-worker/.agents/skills/subject-analysis/SKILL.md`
- Create: `workers/brand-pilot-subject-analysis-worker/scripts/run-codex-subject-analysis.mjs`
- Create: `workers/brand-pilot-subject-analysis-worker/src/contracts.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/client.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/promptBuilder.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/promptBuilder.test.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/result.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/result.test.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/worker.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/worker.test.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/index.ts`
- Modify: `package.json`
- Modify: `scripts/check-local-env.mjs`

- [ ] **Step 1: Write failing prompt and result tests**

Assert that the Korean prompt:

- requires public search only for VOC, alternatives, and market context;
- treats extracted facts as the only product/service facts;
- rejects invented prices, efficacy, reviews, metrics, and first-person experiences;
- requires a source URL for every public claim;
- returns exactly three targets and appeals keyed by those target IDs;
- can return `partial` quality through `sourceGaps` without inventing evidence.

```ts
const prompt = buildSubjectAnalysisPrompt(job);
expect(prompt).toContain("제품·서비스 사실은 extracted.facts");
expect(prompt).toContain("타깃은 정확히 3개");
expect(prompt).toContain("공개 웹 근거에는 HTTPS 출처 URL");
expect(prompt).not.toContain("타사 이미지를 다운로드");
```

- [ ] **Step 2: Run worker tests and confirm failures**

Run: `npm test -- promptBuilder.test.ts result.test.ts worker.test.ts`

Workdir: `workers/brand-pilot-subject-analysis-worker`

Expected: FAIL because the worker package is absent.

- [ ] **Step 3: Implement the worker contract and Korean skill**

The skill must require this research order:

1. Read extracted facts and structured data.
2. Identify explicit information gaps.
3. Search public pages for customer language, alternatives, and category context.
4. Remove claims without accessible source URLs.
5. Produce three differentiated target segments.
6. Produce at least two grounded appeal candidates for each target.
7. Score only the provided image candidate IDs and recommend one or `null`.
8. Emit one strict JSON object and no prose outside it.

Run Codex in a dedicated directory with no repository write permission. Only the JSON job file and output path are writable.

- [ ] **Step 4: Implement sequential polling, heartbeat, and bounded retry**

Use one worker loop and one claimed job at a time:

```ts
while (!signal.aborted) {
  const job = await client.claim(workerId);
  if (!job) {
    await sleep(pollIntervalMs);
    continue;
  }
  await processSubjectAnalysisJob(job, dependencies);
}
```

Set a 15-minute CLI timeout, heartbeat every 30 seconds, retry only process/network failures, and send contract failures as non-retryable after the API's bounded attempts.

- [ ] **Step 5: Add root scripts and env validation**

```json
{
  "predev:subject-analysis-worker": "npm run env:check -- --process=subject-analysis-worker",
  "dev:subject-analysis-worker": "npm run dev --workspace @brand-pilot/subject-analysis-worker",
  "subject-analysis-worker:once": "npm run run-once --workspace @brand-pilot/subject-analysis-worker"
}
```

Require only `API_URL`, `WORKER_TOKEN`, worker ID, poll interval, lease duration, and Codex command settings. Reuse the canonical root-env loading rule.

- [ ] **Step 6: Run worker tests and build**

Run: `npm test --workspace @brand-pilot/subject-analysis-worker && npm run build --workspace @brand-pilot/subject-analysis-worker`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/brand-pilot-subject-analysis-worker package.json package-lock.json scripts/check-local-env.mjs
git commit -m "feat: add subject analysis CLI worker"
```

### Task 7: Extend the UI data model and API gateway

**Files:**
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`

- [ ] **Step 1: Write failing gateway and draft-reducer tests**

Test cache lookup, request, polling, reanalysis, image selection, target selection, one-appeal replacement, reference ordering, and brand-color defaulting.

```ts
expect(state.draft.selectedAppeal?.id).toBe("appeal-b");
expect(state.draft.selectedTarget?.id).toBe("target-2");
expect(state.draft.brief.selectedColor).toBe("#0057B8");
expect(state.step).toBeLessThanOrEqual(5);
```

- [ ] **Step 2: Run focused UI tests and confirm failures**

Run: `npm test -- aiContentApiGateway.test.ts aiContentWizard.test.tsx`

Workdir: `apps/customer-ui`

Expected: FAIL because the subject-analysis methods and five-step draft do not exist.

- [ ] **Step 3: Replace the wizard draft contract**

Use one persisted shape for all three content types:

```ts
export interface AiContentDraft {
  type: AiContentType | null;
  subjectType: "product" | "service" | null;
  subjectInput: {
    sourceUrl: string;
    name: string;
    promotion: string;
    description: string;
  };
  subjectAnalysisId: string | null;
  subjectAnalysisVersion: number | null;
  selectedSubjectImageIds: string[];
  selectedTarget: SubjectTarget | null;
  selectedAppeal: SubjectAppeal | null;
  referenceIds: string[];
  brief: GenerationBrief;
}
```

Normalize legacy drafts on read: map `productUrl` to `subjectInput.sourceUrl`, map `coreAppeal` to a manual `selectedAppeal`, and ignore `secondaryAppeals` in new writes.

- [ ] **Step 4: Add gateway operations**

```ts
getCachedSubjectAnalysis(brandId, subjectType, sourceUrl): Promise<SubjectAnalysis | null>;
requestSubjectAnalysis(brandId, input): Promise<SubjectAnalysis>;
getSubjectAnalysis(brandId, analysisId): Promise<SubjectAnalysis>;
reanalyzeSubject(brandId, analysisId, idempotencyKey): Promise<SubjectAnalysis>;
selectSubjectImage(brandId, analysisId, imageId): Promise<SubjectAnalysis>;
```

The mock gateway must return deterministic three-target data and two appeals per target so component tests do not need a CLI process.

- [ ] **Step 5: Run focused tests and build**

Run: `npm test -- aiContentApiGateway.test.ts aiContentWizard.test.tsx && npm run build`

Workdir: `apps/customer-ui`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/features/ai-content/useAiContentDraft.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts
git commit -m "feat: model the five-step content wizard"
```

### Task 8: Implement the five-step React experience

**Files:**
- Create: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx`
- Create: `apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/TargetAppealStep.test.tsx`
- Create: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ReferencePicker.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing subject-analysis UI tests**

Verify product/service segmented control, service fallback description, no analysis on page load, cached result display, explicit analyze/reanalyze, progress polling, candidate image selection, and inaccessible-page error copy.

```tsx
expect(gateway.requestSubjectAnalysis).not.toHaveBeenCalled();
await user.click(screen.getByRole("button", { name: "분석 시작" }));
expect(gateway.requestSubjectAnalysis).toHaveBeenCalledTimes(1);
expect(await screen.findByText("고객·시장 분석을 완료했습니다")).toBeVisible();
```

- [ ] **Step 2: Write failing target/appeal tests**

Verify exactly three recommendations, the highest-ranked default, target switching, custom target editing, one selected appeal, and replacement rather than accumulation.

```tsx
await user.click(screen.getByRole("radio", { name: /20대 자취생/ }));
await user.click(screen.getByRole("radio", { name: /보관이 쉬운/ }));
expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedAppeal: expect.objectContaining({ title: "보관이 쉬운" }) }));
```

- [ ] **Step 3: Write failing final-step tests**

Verify brand color default, editable color, per-output prompt, apply-to-all, product/person/scale image roles, output count 1-3, and direct generation from step five without a sixth confirmation screen.

- [ ] **Step 4: Run component tests and confirm failures**

Run: `npm test -- SubjectAnalysisStep.test.tsx TargetAppealStep.test.tsx GenerationPromptStep.test.tsx aiContentWizard.test.tsx`

Workdir: `apps/customer-ui`

Expected: FAIL because the components and five-step composition are absent.

- [ ] **Step 5: Implement the components and navigation**

Use these exact step labels:

```ts
export const wizardStepNames = [
  "콘텐츠 유형",
  "제품·서비스 분석",
  "타깃·소구점",
  "레퍼런스",
  "프롬프트·생성",
] as const;
```

Step-two state rendering:

- `queued`/`extracting`: skeleton plus `제품·서비스 정보를 확인하고 있습니다`.
- `researching`: skeleton plus `고객 언어와 대안을 조사하고 있습니다`.
- `ready`: full facts, VOC, alternatives, USP, target preview, image candidates.
- `partial`: ready UI plus source-gap notice.
- `failed`: reason, manual service fallback, and reanalyze action.

Do not show a global blocking overlay. Keep the selected image panel and target list within responsive width-constrained columns; collapse to one column below 900 px.

- [ ] **Step 6: Run tests and visual build checks**

Run: `npm test -- SubjectAnalysisStep.test.tsx TargetAppealStep.test.tsx GenerationPromptStep.test.tsx aiContentWizard.test.tsx && npm run build`

Workdir: `apps/customer-ui`

Expected: PASS with no overflow/type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/customer-ui/src/components/ai-content apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat: build product analysis content wizard"
```

### Task 9: Freeze the selected data into `content-generation-input.v2`

**Files:**
- Create: `apps/api/src/aiContentGenerationInput.ts`
- Create: `apps/api/src/aiContentGenerationInput.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`

- [ ] **Step 1: Write failing envelope tests**

Cover brand ownership, ready/partial analysis only, exactly one target, exactly one appeal connected to that target, selected archived images only, reference order, temporary attachment roles, edited color, output count, and immutable snapshot reuse on retry.

```ts
const envelope = await buildContentGenerationInput(dependencies, generation);
expect(envelope.contractVersion).toBe("content-generation-input.v2");
expect(envelope.message.target.id).toBe("target-1");
expect(envelope.message.appeal.targetId).toBe("target-1");
expect(envelope.creativeDirection.selectedColor).toBe("#0F766E");
expect(envelope.references.map((item) => item.id)).toEqual(["ref-2", "ref-1"]);
```

- [ ] **Step 2: Run focused API tests and confirm the failure**

Run: `npm test -- aiContentGenerationInput.test.ts aiContentRepository.test.ts server.aiContentWorker.test.ts`

Workdir: `apps/api`

Expected: FAIL because v2 assembly and snapshot validation are absent.

- [ ] **Step 3: Implement the common envelope**

```ts
export interface ContentGenerationInputV2 {
  contractVersion: "content-generation-input.v2";
  contentType: AiContentType;
  brandContext: AiContentBrandContextRecord;
  subject: {
    analysisId: string;
    analysisVersion: number;
    type: SubjectType;
    sourceUrl: string;
    facts: unknown[];
    research: Record<string, unknown>;
    selectedImages: Array<{ id: string; url: string; role: string; altText: string }>;
  };
  message: {
    target: SubjectTarget;
    appeal: SubjectAppeal;
    qualityBrief: Record<string, unknown>;
  };
  creativeDirection: {
    prompts: string[];
    brandColor: string;
    selectedColor: string;
    aspectRatio: string;
    outputCount: 1 | 2 | 3;
  };
  references: AiContentReferenceRecord[];
  attachments: AiContentAttachmentRecord[];
}
```

At the first generation request, persist `subject_analysis_snapshot` and use it for all output jobs and retries. Never rebuild an old generation from a newer analysis version.

- [ ] **Step 4: Enforce server-side selection invariants**

Reject generation with these codes before decrementing usage:

```text
ai_content_subject_analysis_required
ai_content_subject_analysis_not_ready
ai_content_subject_image_required
ai_content_target_required
ai_content_appeal_required
ai_content_appeal_target_mismatch
```

Service generation may proceed without an archived service image when a user-uploaded product/visual-reference attachment is present. Product generation requires at least one archived or uploaded product image.

- [ ] **Step 5: Run focused and complete API tests**

Run: `npm test -- aiContentGenerationInput.test.ts aiContentRepository.test.ts server.aiContentWorker.test.ts && npm run typecheck`

Workdir: `apps/api`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/aiContentGenerationInput.ts apps/api/src/aiContentGenerationInput.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/api/src/server.aiContentWorker.test.ts
git commit -m "feat: freeze AI content generation inputs"
```

### Task 10: Make all three content workers consume the common envelope

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/contracts.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/promptBuilder.test.ts`

- [ ] **Step 1: Write failing prompt contract tests for each worker**

For one shared fixture, assert all workers read:

- `subject.facts` as product/service fact evidence;
- `subject.research` only as sourced market context;
- one `message.target` and one `message.appeal`;
- selected product and user images;
- reference visual direction without copying;
- edited `selectedColor`;
- no second product-page fetch and no public-web search.

```ts
expect(prompt).toContain("content-generation-input.v2");
expect(prompt).toContain("선택된 타깃은 1개이며 변경하지 마세요");
expect(prompt).toContain("선택된 소구점은 1개이며 다른 소구점을 추가하지 마세요");
expect(prompt).toContain("웹 검색을 다시 수행하지 마세요");
```

- [ ] **Step 2: Run worker tests and confirm failures**

Run: `npm test --workspace @brand-pilot/card-news-worker -- promptBuilder.test.ts && npm test --workspace @brand-pilot/blog-worker -- promptBuilder.test.ts && npm test --workspace @brand-pilot/marketing-worker -- promptBuilder.test.ts`

Expected: FAIL because current prompts read legacy `draft.analysisSource` and `productUrl`.

- [ ] **Step 3: Update common contract parsing and Korean prompts**

Remove direct URL fetching instructions from all three generation prompts. Keep URL/source values available only for citation-aware grounding, and keep format-specific rules in each worker:

- Card news: 1-5 square pages, mobile legibility, caption, five relevant hashtags.
- Blog: semantic HTML, SEO metadata, only explanation-critical inline images.
- Marketing: one independent ad creative per requested output, one message hypothesis, visual and copy aligned to the selected appeal.

- [ ] **Step 4: Run all worker tests and builds**

Run: `npm test --workspace @brand-pilot/card-news-worker && npm test --workspace @brand-pilot/blog-worker && npm test --workspace @brand-pilot/marketing-worker && npm run build --workspace @brand-pilot/card-news-worker && npm run build --workspace @brand-pilot/blog-worker && npm run build --workspace @brand-pilot/marketing-worker`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/brand-pilot-card-news-worker workers/brand-pilot-blog-worker workers/brand-pilot-marketing-worker
git commit -m "feat: ground content workers in subject snapshots"
```

### Task 11: Verify cleanup, idempotency, E2E behavior, and operations

**Files:**
- Create: `scripts/ai-content-subject-smoke.mjs`
- Modify: `scripts/ai-content-smoke.mjs`
- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-07-18-ai-content-studio-runtime-design.md`

- [ ] **Step 1: Add an E2E test with mocked external research**

Exercise this exact path:

1. Choose marketing material.
2. Choose product.
3. Enter a URL and request analysis.
4. Observe queued/researching/ready polling.
5. Change the representative product image.
6. Select target 2.
7. Select exactly one appeal.
8. Select and reorder two references.
9. Change the brand color and upload person/scale images.
10. Request two outputs.
11. Confirm one generation request and two output jobs.
12. Confirm the archived product image remains and temporary person/scale files are deleted after completion.

- [ ] **Step 2: Add idempotency and cleanup smoke assertions**

The smoke script must request the same URL twice, assert one active analysis, force reanalysis once, then submit generation twice with the same key and assert one usage increment.

```js
assert.equal(firstAnalysis.id, cachedAnalysis.id);
assert.equal(forcedAnalysis.analysisVersion, firstAnalysis.analysisVersion + 1);
assert.equal(firstGeneration.id, duplicateGeneration.id);
assert.equal(usageAfter.generationCount - usageBefore.generationCount, 1);
```

- [ ] **Step 3: Run the complete automated suite**

Run: `npm test`

Expected: all workspace tests PASS.

Run: `npm run build`

Expected: all workspace builds PASS.

Run: `npm run test:migrations && npm run test:contract`

Expected: PASS.

Run: `npm run test:e2e -- --grep "AI content product analysis"`

Expected: PASS against the local UI/API with deterministic external mocks.

- [ ] **Step 4: Run one optional live local smoke**

Prerequisites: local API, database, subject-analysis worker, and one content worker are running with valid credentials.

Run: `node scripts/ai-content-subject-smoke.mjs --brand-id $env:DEMO_BRAND_ID --url https://www.danbammsg.co.kr/product`

Expected: one ready or partial analysis, three targets, one selected image when the page exposes an image, and one completed generation. This command must not be part of CI because it uses live public pages and Codex CLI.

- [ ] **Step 5: Update operations documentation**

Document:

- one subject-analysis CLI process initially;
- one claimed analysis at a time;
- API queue depth and oldest-job age;
- 15-minute timeout and three-attempt policy;
- archived subject images retained with analysis;
- temporary final-step attachments deleted after generation completion;
- no periodic reanalysis;
- user-triggered reanalysis only;
- public research provenance requirements;
- commands to run and stop the worker.

- [ ] **Step 6: Commit**

```bash
git add scripts/ai-content-subject-smoke.mjs scripts/ai-content-smoke.mjs apps/customer-ui/e2e/ai-content-runtime.spec.ts README.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-07-18-ai-content-studio-runtime-design.md
git commit -m "test: verify product analysis generation flow"
```

## Completion Criteria

- Opening the wizard or moving between steps never starts crawling, research, or generation.
- A cached brand/type/normalized-URL analysis is displayed immediately.
- Explicit reanalysis creates a new version while preserving prior successful generations.
- Product/service facts come from the submitted URL or manual service description.
- Public web search contributes only sourced VOC, alternatives, and market context.
- Exactly three targets are recommended; exactly one target and one appeal are submitted.
- The system recommends one archived source image and allows user replacement.
- References affect creative direction but never become factual evidence.
- The brand representative color is prefilled and the user's edit reaches all workers.
- Card-news, blog, and marketing workers receive the same immutable v2 envelope.
- Duplicate clicks do not duplicate analysis, generation jobs, or usage.
- Temporary final-step uploads are removed after generation; analysis images remain reusable.
- Automated tests, migration tests, typechecks, builds, and the deterministic E2E test pass.
