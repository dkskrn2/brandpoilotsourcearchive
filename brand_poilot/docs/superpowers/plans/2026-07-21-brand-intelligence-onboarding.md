# Brand Intelligence Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URL 1개와 TXT·MD·PDF·CSV·XLSX 문서 최대 5개를 CLI로 분석하고, 사용자가 수정·확정한 브랜드 정보를 온보딩·브랜드 설정·AI 콘텐츠·Wiki에서 공통으로 사용한다.

**Architecture:** 기존 URL 안전 크롤러와 작업 임대 패턴을 재사용하되 제품 분석 계약과 분리된 `brand-intelligence` 계약·저장소·CLI 워커를 추가한다. 분석 실행은 버전으로 보관하고 확정 트랜잭션만 기존 `brand_profiles` 호환 필드와 Wiki 요청을 갱신한다. 프론트는 3단계 전용 화면을 제공하고 모든 텍스트 분석값을 수정한 뒤 확정한다.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Supabase, React, Vitest, Vite, `@vercel/blob`, ExcelJS, `pdf-parse`, Codex CLI worker

---

## File Map

- `db/migrations/049_brand_intelligence_onboarding.sql`: 분석 실행, 업로드, 활성 버전 스키마와 제약조건
- `apps/api/src/brandIntelligenceContracts.ts`: API·워커 입력과 결과의 엄격한 런타임 검증
- `apps/api/src/brandDocumentExtractor.ts`: TXT·MD·PDF·CSV·XLSX를 공통 증거 문서로 정규화
- `apps/api/src/brandAnalysisUpload.ts`: 업로드 정책, Blob 경로, 원본 검증과 정리
- `apps/api/src/brandIntelligenceRepository.ts`: 실행 생성·임대·완료·실패·수정·확정 트랜잭션
- `apps/api/src/brandIntelligenceProvider.ts`: 확정 브랜드 정보를 소비 기능에 제공하는 단일 조회 경계
- `apps/api/src/httpServer.ts`, `apps/api/src/types.ts`, `apps/api/src/index.ts`: 고객·워커 HTTP 엔드포인트와 의존성 조립
- `workers/brand-pilot-brand-intelligence-worker/*`: 전용 Codex CLI 워커와 한국어 분석 스킬
- `apps/customer-ui/src/features/brand-intelligence/*`: API gateway와 3단계 상태 관리
- `apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx`: 자료 입력·분석·확정 화면
- `apps/customer-ui/src/pages/OnboardingPage.tsx`, `BrandSettingsPage.tsx`, `routes.tsx`: 진입점과 확정 정보 표시
- `apps/api/src/aiContentRepository.ts`: 자사 정보 요청 시 확정 브랜드 정보 사용
- `scripts/check-local-env.mjs`, root `package.json`: 워커 실행·ENV 검증

### Task 1: Database and contracts

**Files:**
- Create: `db/migrations/049_brand_intelligence_onboarding.sql`
- Create: `apps/api/src/brandIntelligenceContracts.ts`
- Create: `apps/api/src/brandIntelligenceContracts.test.ts`
- Modify: `db/smoke/001_schema_smoke.sql`

- [ ] **Step 1: Write failing contract tests**

Test strict acceptance of `brand-intelligence.v1` and `brand-intelligence-result.v1`, including editable fields, competitors with source URLs, evidence references, and rejection of unknown fields or missing public-search sources.

```ts
expect(parseBrandIntelligenceResult(validResult())).toMatchObject({
  contractVersion: "brand-intelligence-result.v1",
  companyOverview: "회사 개요",
  primaryTarget: "핵심 고객",
});
expect(() => parseBrandIntelligenceResult({ ...validResult(), extra: true }))
  .toThrow("brand_intelligence_result_invalid");
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceContracts.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add migration 049**

Create `brand_analysis_runs` with statuses `queued|extracting|analyzing|review_ready|confirmed|failed`, JSONB input/evidence/result/edited result fields, lease columns, attempt/availability/error timestamps, and unique `(brand_id, idempotency_key)`. Create `brand_analysis_uploads` with filename, MIME, bytes, checksum, Blob path/URL, parsing status and cleanup timestamp. Add `active_brand_analysis_id` to `brand_profiles` with a deferred FK and a partial unique index that permits one confirmed active run per brand.

- [ ] **Step 4: Implement strict contracts**

Define these core shapes and parsers:

```ts
export interface BrandEvidenceDocument {
  sourceId: string;
  sourceType: "owned_url" | "text" | "markdown" | "pdf" | "csv" | "xlsx";
  title: string;
  sourceUrl: string | null;
  textBlocks: Array<{ heading: string | null; text: string }>;
  tables: Array<{ sheet: string | null; headers: string[]; rows: string[][] }>;
  contentHash: string;
}

export interface BrandIntelligenceResultV1 {
  contractVersion: "brand-intelligence-result.v1";
  companyOverview: string;
  businessDescription: string;
  primaryCategory: { code: string | null; name: string };
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string;
  differentiators: string;
  coreAppeal: string;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  evidence: Array<{ field: string; claim: string; sourceId: string; sourceUrl: string | null }>;
  sourceGaps: string[];
}
```

Apply bounded string, array, nested node and URL budgets consistent with `aiContentSubjectContracts.ts`.

- [ ] **Step 5: Run contract and schema tests**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceContracts.test.ts && npm run test:migrations`

Expected: PASS.

### Task 2: Document normalization and secure uploads

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/api/src/brandDocumentExtractor.ts`
- Create: `apps/api/src/brandDocumentExtractor.test.ts`
- Create: `apps/api/src/brandAnalysisUpload.ts`
- Create: `apps/api/src/brandAnalysisUpload.test.ts`

- [ ] **Step 1: Install the PDF parser**

Run: `npm install pdf-parse@2.4.5 --workspace @brand-pilot/api`

Expected: `apps/api/package.json` and lockfile contain `pdf-parse@2.4.5`.

- [ ] **Step 2: Write failing extraction tests**

Cover UTF-8 TXT/MD headings, quoted CSV cells, multi-sheet XLSX, text PDF, scanned PDF rejection, five-file limit, per-file 10 MB limit, and total normalized character/table budgets.

```ts
const document = await extractBrandDocument({
  sourceId: "upload-1",
  fileName: "company.md",
  mimeType: "text/markdown",
  bytes: Buffer.from("# 회사\n사업 소개"),
});
expect(document.textBlocks).toEqual([
  { heading: "회사", text: "사업 소개" },
]);
```

- [ ] **Step 3: Run extraction tests and verify RED**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandDocumentExtractor.test.ts src/brandAnalysisUpload.test.ts`

Expected: FAIL because extractors do not exist.

- [ ] **Step 4: Implement parsers and upload policy**

Use `TextDecoder("utf-8", { fatal: true })` for TXT/MD/CSV, ExcelJS for XLSX and `PDFParse` for text PDF. Return `scanned_pdf_not_supported` when extracted text is below 30 non-whitespace characters. Validate MIME plus extension, SHA-256, UUID path segments and Blob metadata. Use paths `brands/{brandId}/brand-analysis/{analysisId}/uploads/{checksum}-{safeName}` and client upload tokens with a 10-minute lifetime.

- [ ] **Step 5: Run extraction tests**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandDocumentExtractor.test.ts src/brandAnalysisUpload.test.ts`

Expected: PASS.

### Task 3: Analysis repository and customer API

**Files:**
- Create: `apps/api/src/brandIntelligenceRepository.ts`
- Create: `apps/api/src/brandIntelligenceRepository.test.ts`
- Create: `apps/api/src/brandIntelligenceProvider.ts`
- Create: `apps/api/src/brandIntelligenceProvider.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/index.ts`
- Create: `apps/api/src/server.brandIntelligenceCustomer.test.ts`

- [ ] **Step 1: Write repository and route tests**

Test upload confirmation, analysis creation with URL or upload IDs, workspace scoping, polling, draft PATCH, idempotent confirm, legacy profile synchronization, active version switching and one Wiki rebuild request.

```ts
const confirmed = await repository.confirmBrandAnalysis({
  workspaceId, brandId, analysisId, editedResult, idempotencyKey: "confirm-1",
});
expect(confirmed.status).toBe("confirmed");
expect(sqlCalls.filter(({ sql }) => sql.includes("wiki_build_requests"))).toHaveLength(1);
```

- [ ] **Step 2: Verify repository tests fail**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts src/server.brandIntelligenceCustomer.test.ts`

Expected: FAIL because repository/API are missing.

- [ ] **Step 3: Implement repository lifecycle**

Use `FOR UPDATE SKIP LOCKED`, random lease token, lease expiry, max three attempts and delayed retry. Analysis creation must snapshot the current owned URL and selected uploads. Draft updates are allowed only in `review_ready`. Confirm in one transaction: lock run, validate edited result, mark previous active version inactive, set current confirmed, update `brand_profiles.description`, `primary_customer`, category relations and `active_brand_analysis_id`, and upsert one Wiki rebuild request.

- [ ] **Step 4: Implement customer routes**

Add the seven endpoints from the design with current session/workspace guards. Upload token and confirmation must use existing Blob token patterns. Return `409 brand_analysis_not_review_ready` for early confirmation and return the existing confirmed intelligence while a new run is processing.

- [ ] **Step 5: Run API tests**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts src/brandIntelligenceProvider.test.ts src/server.brandIntelligenceCustomer.test.ts`

Expected: PASS.

### Task 4: Worker API and dedicated Codex CLI worker

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Create: `apps/api/src/server.brandIntelligenceWorker.test.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/package.json`
- Create: `workers/brand-pilot-brand-intelligence-worker/tsconfig.json`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/contracts.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/client.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/result.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/promptBuilder.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/worker.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/index.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`
- Create: `workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- Create: `workers/brand-pilot-brand-intelligence-worker/.agents/skills/brand-intelligence/SKILL.md`

- [ ] **Step 1: Write failing worker tests**

Test claim, heartbeat, timeout termination, contract failure as non-retryable, API/CLI failure as retryable, Korean prompt contents and child environment allowlist.

```ts
expect(buildBrandIntelligencePrompt(job)).toContain("기업 개요");
expect(buildBrandIntelligencePrompt(job)).toContain("공개 웹검색");
expect(buildBrandIntelligencePrompt(job)).toContain("근거 URL");
```

- [ ] **Step 2: Verify worker tests fail**

Run: `npm test --workspace @brand-pilot/brand-intelligence-worker`

Expected: workspace/module missing.

- [ ] **Step 3: Implement worker endpoints and worker**

Add `/worker/brand-analyses/claim|:id/heartbeat|:id/complete|:id/fail` guarded by `WORKER_API_TOKEN`. The API performs URL crawl and document extraction before leasing an `analyzing` job so the CLI receives only normalized evidence. The worker copies the skill into a temporary read-only work directory, executes the configured Codex command with public web search, validates `result.json`, and removes the runtime directory in `finally`.

- [ ] **Step 4: Run worker and API worker tests**

Run: `npm test --workspace @brand-pilot/brand-intelligence-worker && npm test --workspace @brand-pilot/api -- --run src/server.brandIntelligenceWorker.test.ts`

Expected: PASS.

### Task 5: Common provider and consumer migration

**Files:**
- Modify: `apps/api/src/brandIntelligenceProvider.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/automatedCardNews.ts`
- Modify: `apps/api/src/repository.ts`
- Create: `apps/api/src/brandIntelligenceConsumers.test.ts`

- [ ] **Step 1: Write failing consumer tests**

Assert that AI content `자사 정보 사용`, automated card news and Wiki compilation receive the same confirmed `analysisId` and edited snapshot, and that no consumer requests CLI analysis. Assert product/service URL analysis still calls the subject-analysis repository.

- [ ] **Step 2: Run consumer tests and verify RED**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceConsumers.test.ts src/aiContentRepository.test.ts`

Expected: FAIL because consumers still assemble legacy context.

- [ ] **Step 3: Route consumers through the provider**

Return `{ versionId, confirmedAt, profile, evidenceDocuments }` from `BrandIntelligenceProvider`. Record `versionId` and immutable profile snapshot in AI content generation payloads. If no confirmed profile exists, return `brand_intelligence_required` rather than starting analysis. Keep product/service URL analysis unchanged and append confirmed brand context to its worker input.

- [ ] **Step 4: Run consumer tests**

Run: `npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceConsumers.test.ts src/aiContentRepository.test.ts`

Expected: PASS.

### Task 6: React onboarding and brand settings integration

**Files:**
- Create: `apps/customer-ui/src/features/brand-intelligence/types.ts`
- Create: `apps/customer-ui/src/features/brand-intelligence/brandIntelligenceGateway.ts`
- Create: `apps/customer-ui/src/features/brand-intelligence/useBrandIntelligenceFlow.ts`
- Create: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
- Create: `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisProgressStep.tsx`
- Create: `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx`
- Create: `apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx`
- Create: `apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/pages/OnboardingPage.tsx`
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing UI tests**

Cover URL-only, files-only, mixed input, unsupported/scanned PDF errors, state polling, refresh restoration, textarea edits for all narrative fields, evidence links, confirm, brand settings rendering, and missing-profile redirect from AI content.

```tsx
await user.clear(screen.getByRole("textbox", { name: "핵심 타깃" }));
await user.type(screen.getByRole("textbox", { name: "핵심 타깃" }), "수정한 고객");
await user.click(screen.getByRole("button", { name: "확인하고 저장" }));
expect(gateway.confirm).toHaveBeenCalledWith(expect.objectContaining({
  editedResult: expect.objectContaining({ primaryTarget: "수정한 고객" }),
}));
```

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx`

Expected: FAIL because route/components do not exist.

- [ ] **Step 3: Implement three-step flow**

Add `/onboarding/brand-intelligence`. Step 1 accepts URL and up to five files; Step 2 polls every two seconds and resumes from the analysis ID in the route/query; Step 3 renders company overview, business description, target, differentiators, appeal and competitor descriptions as textareas, category controls using the existing category catalog, and evidence links. Disable confirm until required narrative fields and a category are present.

- [ ] **Step 4: Integrate entry points**

Change onboarding actions from generic `URL 추가` to `브랜드 정보 만들기`. Brand settings shows the confirmed sections and `브랜드 정보 다시 분석`; preserve logo, color, tone, CTA, approval and Instagram format controls. AI content shows a link to the onboarding analysis when intelligence is absent and performs no analysis at that point.

- [ ] **Step 5: Run UI tests and build**

Run: `npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx src/__tests__/onboarding.test.tsx src/__tests__/brandSettings.test.tsx src/__tests__/aiContentWizard.test.tsx && npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS and Vite build succeeds.

### Task 7: Runtime integration and focused E2E

**Files:**
- Modify: `package.json`
- Modify: `scripts/check-local-env.mjs`
- Create: `workers/brand-pilot-brand-intelligence-worker/.env.example`
- Modify: `apps/api/.env.example`
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`
- Create: `scripts/brand-intelligence-smoke.mjs`
- Modify: `docs/architecture/WORKER_ARCHITECTURE.md` or the existing worker architecture document found by `rg --files docs | rg "WORKER.*ARCHITECTURE|worker.*architecture"`

- [ ] **Step 1: Add runtime scripts and env validation**

Add `predev:brand-intelligence-worker`, `dev:brand-intelligence-worker`, and `brand-intelligence-worker:once`. Register env file and require `BRAND_PILOT_API_URL`, `WORKER_API_TOKEN`, `BRAND_INTELLIGENCE_CODEX_COMMAND`. Include the worker in API base URL and token equality checks.

- [ ] **Step 2: Add E2E and smoke coverage**

Mock Blob upload in customer UI E2E and cover mixed URL+CSV onboarding through confirmation. The smoke script creates a URL-only analysis, runs one worker cycle, edits the target, confirms, then verifies `/brand-intelligence` and AI content context use the same version.

- [ ] **Step 3: Run focused verification**

Run:

```powershell
npm run env:check -- --process=brand-intelligence-worker
npm run test:migrations
npm test --workspace @brand-pilot/api -- --run src/brandIntelligenceContracts.test.ts src/brandDocumentExtractor.test.ts src/brandIntelligenceRepository.test.ts src/server.brandIntelligenceCustomer.test.ts src/server.brandIntelligenceWorker.test.ts src/brandIntelligenceConsumers.test.ts
npm test --workspace @brand-pilot/brand-intelligence-worker
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx src/__tests__/onboarding.test.tsx src/__tests__/brandSettings.test.tsx src/__tests__/aiContentWizard.test.tsx
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
```

Expected: all commands pass. Existing non-blocking chunk-size or React Router future warnings may remain, but no new test warning is accepted.

- [ ] **Step 4: Run one real local vertical smoke test**

Start API, customer UI and brand intelligence worker. Use a public URL plus one TXT or CSV document, confirm edited fields, then verify Brand Settings and AI Content show the same saved profile. Do not trigger image generation or social publishing in this smoke test.
