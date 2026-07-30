# Brand URL Single Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirmed brand intelligence the only user-facing place to enter the owned brand URL while synchronizing that URL to the operational source record only on confirmation.

**Architecture:** Keep `brand_analysis_runs.input_json.ownedUrl` as an immutable analysis snapshot. Extend the existing confirmation transaction in `brandIntelligenceRepository` to create or update the single active owned `source_urls` row, then remove the standalone editor from brand settings and show the confirmed URL read-only in the intelligence summary.

**Tech Stack:** TypeScript, React 18, Fastify, PostgreSQL/PGlite, Vitest, Testing Library

---

### Task 1: Synchronize the owned URL on brand analysis confirmation

**Files:**
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Test: `apps/api/src/brandIntelligenceRepository.test.ts`

- [ ] **Step 1: Extend the PGlite fixture and write failing confirmation tests**

Add `source_urls` to the test schema and assertions covering creation, replacement, unchanged URLs, and document-only analyses:

```ts
create table source_urls (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
  source_type text not null, url text not null, url_hash text not null, domain text,
  title text, meta_description text, status text not null default 'active', enabled boolean not null default true,
  last_crawled_at timestamptz, last_error text, disabled_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index source_owned_single on source_urls(brand_id) where source_type = 'owned' and deleted_at is null;
```

Assert that confirmation creates one owned source, changing the input URL updates the same row and resets crawl metadata, and `ownedUrl: null` preserves an existing source.

- [ ] **Step 2: Run the repository test and verify failure**

Run:

```powershell
npm run test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts --maxWorkers=1 --no-file-parallelism
```

Expected: URL synchronization assertions fail because confirmation does not write `source_urls`.

- [ ] **Step 3: Add focused URL normalization helpers**

Reuse `normalizeSourceUrl`, `normalizeDomain`, and `hashSourceUrl` from the existing source implementation. Inside the confirmation transaction, lock the active owned source and apply:

```ts
if (current.input.ownedUrl) {
  const normalizedUrl = normalizeSourceUrl(current.input.ownedUrl);
  const existingSource = await client.query(
    `select id, url from source_urls
      where workspace_id = $1 and brand_id = $2 and source_type = 'owned' and deleted_at is null
      for update`,
    [input.workspaceId, input.brandId],
  );
  // Insert when missing; update the existing row only when the normalized URL changed.
}
```

On replacement update `url`, `url_hash`, `domain`, set `enabled = true`, `status = 'active'`, and clear title, metadata, crawl time, crawl error, and disabled timestamp. Do not modify sources when `ownedUrl` is null.

- [ ] **Step 4: Run the repository test and verify pass**

Run the Task 1 command again. Expected: all brand intelligence repository tests pass.

### Task 2: Remove the duplicate editor and show the confirmed URL

**Files:**
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Test: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`

- [ ] **Step 1: Write failing UI assertions**

Mock current brand intelligence with `input.ownedUrl = "https://example.com"` and assert:

```ts
expect(screen.getByText("https://example.com")).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "자사 URL" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "자사 URL 추가" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the UI test and verify failure**

Run:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandSettings.test.tsx
```

Expected: the separate URL panel is still present and the confirmed URL is absent.

- [ ] **Step 3: Update brand settings presentation**

Remove the `OwnedSourceSettings` import and render. Add a read-only summary item before company overview:

```tsx
<div>
  <dt>대표 URL</dt>
  <dd>{brandIntelligence.input.ownedUrl ?? "첨부 문서로 분석"}</dd>
</div>
```

Keep `브랜드 정보 다시 분석` as the sole URL-editing entry point.

- [ ] **Step 4: Run the UI test and verify pass**

Run the Task 2 command again. Expected: all brand settings tests pass.

### Task 3: Explain confirmation timing in the analysis form

**Files:**
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
- Test: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx`

- [ ] **Step 1: Add a failing copy assertion**

Assert that the input step states the existing operational URL remains unchanged until confirmation:

```ts
expect(screen.getByText(/확인하고 저장할 때 대표 URL로 반영/)).toBeInTheDocument();
```

- [ ] **Step 2: Run the component test and verify failure**

Run:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- --run src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx
```

- [ ] **Step 3: Add concise help text**

Replace the current URL help text with:

```tsx
<small>회사나 서비스의 대표 사이트를 입력하세요. 분석 결과를 확인하고 저장할 때 대표 URL로 반영됩니다.</small>
```

- [ ] **Step 4: Run the component test and verify pass**

Run the Task 3 command again. Expected: all evidence input tests pass.

### Task 4: Regression verification

**Files:**
- Verify only; no production files added

- [ ] **Step 1: Run focused API and UI tests**

```powershell
npm run test --workspace @brand-pilot/api -- --run src/brandIntelligenceRepository.test.ts src/server.brandIntelligenceCustomer.test.ts --maxWorkers=2
npm run test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandSettings.test.tsx src/components/brand-intelligence/BrandEvidenceInputStep.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run builds and formatting checks**

```powershell
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
git diff --check
```

Expected: both builds and diff check pass.

- [ ] **Step 3: Browser-check brand settings**

Open `http://localhost:5173/brand-settings` with an authenticated session. Verify the confirmed information shows one read-only representative URL, no separate owned URL editor is visible, and `브랜드 정보 다시 분석` opens the prefilled analysis input.
