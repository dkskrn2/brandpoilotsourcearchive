# Publish Result Detail Preview And Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the publish-result JSON dialog with an extensible media preview, upload metadata, and per-result ZIP download.

**Architecture:** The API converts provider-specific manifests and channel output into a normalized artifact descriptor keyed by artifact `kind`, not channel. React renders that descriptor through a registry-like preview component. A separate queue-scoped download endpoint builds one ZIP and leaves a stable entitlement check boundary for future billing.

**Tech Stack:** TypeScript, Fastify, PostgreSQL repository, React, Vitest, Testing Library, existing ZIP builder and CSS system.

---

### Task 1: Normalize publish artifacts

**Files:**
- Create: `apps/api/src/publishArtifacts.ts`
- Create: `apps/api/src/publishArtifacts.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: Write failing parser tests**

Cover carousel `cards`, Story `story`, Reel/video `video` and `cover`, HTML, text, and unknown output. Assert the stable response shape:

```ts
expect(normalizePublishArtifact({ manifest, outputJson, fallbackTitle: "Result" })).toEqual({
  kind: "image_gallery",
  deliveryFormat: "instagram_feed_carousel",
  assets: [expect.objectContaining({ url: "https://cdn/card-01.png", mimeType: "image/png" })],
  posterUrl: null,
  html: null,
  text: null
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `npm test --workspace @brand-pilot/api -- publishArtifacts.test.ts --run`

Expected: failure because `normalizePublishArtifact` does not exist.

- [ ] **Step 3: Implement the generic normalizer**

Define `PublishArtifactKind`, `PublishArtifactAssetDto`, and `PublishArtifactDto`. Detect assets by data shape and MIME/file extension, with channel-specific delivery formats used only as hints. Keep the returned contract independent from Instagram.

- [ ] **Step 4: Run the parser test and verify GREEN**

Run: `npm test --workspace @brand-pilot/api -- publishArtifacts.test.ts --run`

Expected: all artifact parser tests pass.

### Task 2: Add queue-scoped artifact and ZIP APIs

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/downloadPackage.ts`
- Modify: `apps/api/src/downloadPackage.test.ts`

- [ ] **Step 1: Write failing repository and route tests**

Add tests for:

```text
GET /publish-queue/:queueId/artifacts
GET /publish-queue/:queueId/download
```

Assert a normalized descriptor is returned, only the selected queue item enters the ZIP, missing queue IDs return 404, and partial missing assets produce a usable ZIP with a missing-files note.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm test --workspace @brand-pilot/api -- repository.test.ts server.test.ts downloadPackage.test.ts --run`

Expected: route/repository methods are missing.

- [ ] **Step 3: Implement repository lookup and manifest loading**

Query `publish_queue`, `channel_outputs`, `storage_artifacts`, and latest `publish_attempts` by queue ID. Load the trusted artifact manifest with a bounded timeout, normalize it through Task 1, and fall back to `output_json` when no manifest exists.

- [ ] **Step 4: Implement the individual ZIP package**

Reuse `buildPublishedResultsPackage` with one record. Fetch remote assets referenced by the trusted manifest when local files are unavailable, cap each fetch, preserve available files, and include `missing-files.txt` when needed.

- [ ] **Step 5: Register HTTP routes**

Return JSON for artifacts and `application/zip` with `content-disposition` for downloads. Translate `publish_queue_not_found` to 404.

- [ ] **Step 6: Run API tests and verify GREEN**

Run: `npm test --workspace @brand-pilot/api -- repository.test.ts server.test.ts downloadPackage.test.ts publishArtifacts.test.ts --run`

Expected: all selected API tests pass.

### Task 3: Add frontend artifact contracts and client methods

**Files:**
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`

- [ ] **Step 1: Write failing client tests**

Assert:

```ts
await client.getPublishArtifact("queue-1");
await client.downloadPublishResult("queue-1");
```

use the new queue-scoped URLs and preserve ZIP filenames from `content-disposition`.

- [ ] **Step 2: Run the client test and verify RED**

Run: `npm test --workspace @brand-pilot/customer-ui -- apiClient.test.ts --run`

Expected: methods are undefined.

- [ ] **Step 3: Add DTOs and API methods**

Add the six artifact kinds and normalized asset fields to `types.ts`, then add JSON and blob methods to the API client.

- [ ] **Step 4: Run the client test and verify GREEN**

Run: `npm test --workspace @brand-pilot/customer-ui -- apiClient.test.ts --run`

Expected: client tests pass.

### Task 4: Build extensible artifact preview components

**Files:**
- Create: `apps/customer-ui/src/components/publish/PublishArtifactPreview.tsx`
- Create: `apps/customer-ui/src/components/publish/PublishArtifactPreview.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing component tests**

Cover image gallery selection, single image, video with `controlsList="nodownload"`, sandboxed HTML, text, unknown fallback, long-content scrolling, `contextmenu` prevention, and `draggable=false` images.

- [ ] **Step 2: Run component tests and verify RED**

Run: `npm test --workspace @brand-pilot/customer-ui -- PublishArtifactPreview.test.tsx --run`

Expected: component does not exist.

- [ ] **Step 3: Implement kind-based renderer**

Use one `switch (artifact.kind)` boundary. New upload channels can reuse existing kinds; genuinely new media behavior requires one new kind and one renderer branch. Do not branch on channel names.

- [ ] **Step 4: Add restrained preview styling**

Use stable aspect ratios, `object-fit: contain`, scroll containers, selected thumbnail borders, and responsive width constraints. Do not nest decorative cards.

- [ ] **Step 5: Run component tests and verify GREEN**

Run: `npm test --workspace @brand-pilot/customer-ui -- PublishArtifactPreview.test.tsx --run`

Expected: preview tests pass.

### Task 5: Replace the publish result dialog

**Files:**
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: Write failing dialog tests**

Open a published result and assert the dialog loads actual artifact content, hides `저장된 채널 출력`, displays only populated upload metadata, downloads the selected queue ZIP, retains the modal on failure, and shows loading/error states.

- [ ] **Step 2: Run page tests and verify RED**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx --run`

Expected: old JSON output is still visible and artifact API is not called.

- [ ] **Step 3: Implement the media-first split dialog**

Use sticky header/footer, a scrollable `65% / 35%` body, mobile one-column layout, `PublishArtifactPreview`, upload metadata, `원본 게시물 열기`, and `저장`.

- [ ] **Step 4: Implement current and future save states**

Download is enabled now. Treat future `403 download_entitlement_required` as a billing notice without changing the component contract.

- [ ] **Step 5: Run page tests and verify GREEN**

Run: `npm test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx --run`

Expected: dialog tests pass.

### Task 6: Verify the complete change

**Files:**
- Modify only if verification identifies a defect in files already listed above.

- [ ] **Step 1: Run API tests and build**

Run:

```powershell
npm test --workspace @brand-pilot/api -- --run
npm run build --workspace @brand-pilot/api
```

- [ ] **Step 2: Run customer UI tests and build**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run
npm run build --workspace @brand-pilot/customer-ui
```

- [ ] **Step 3: Run repository checks**

Run:

```powershell
git diff --check
git status --short
```

- [ ] **Step 4: Verify in the running browser**

Open `http://localhost:5243/publish-queue`, view an image result and a video result, verify body-only scrolling, verify right-click suppression, and trigger an individual ZIP download.

