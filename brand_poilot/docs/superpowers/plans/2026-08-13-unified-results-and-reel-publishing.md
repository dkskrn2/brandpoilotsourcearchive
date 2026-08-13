# Unified AI-Content Results and Direct Reel Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the planning/final/publish tabs from card-news, Reel, and blog result pages, preserve each format's current result actions, and publish an already-generated Reel MP4 directly through the existing Instagram publish queue without re-rendering it.

**Architecture:** All three formats share one result-page shell. Format-specific preview and supported action components stay inside that shell. The API uses an explicit output-format-to-publish-target matrix, adapts the canonical AI Reel manifest into the existing `channel_outputs` and `publish_queue` records, and lets the existing Instagram publisher post the final MP4. The obsolete AI-content card-image-to-Reel render handoff is deleted; generic non-AI Reel rendering and publishing remain untouched.

**Tech Stack:** React 18, TypeScript, Vitest/Testing Library, Fastify, PostgreSQL repository transactions, `@brand-pilot/content-contracts`, existing Meta Graph Instagram publisher.

---

## File Structure and Ownership

- `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`: one common result shell for card-news, Reel, and blog; no review tabs or visible planning evidence.
- `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx`: format-specific previews; Reel owns the bounded 9:16 video frame.
- `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`: output states, downloads, retry controls, and supported publishing panel placement.
- `apps/customer-ui/src/styles/ai-content-flow.css`: shared result layout and responsive Reel frame.
- `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`: marks completed card-news and Reel manifests publishable; blog remains false.
- `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`: exact UI matrix: card-news -> feed/Story, Reel -> Reel, blog -> none.
- `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`: common publish states and controls; no caption editor.
- `apps/api/src/aiContentPublishTargets.ts`: authoritative output-format-to-target matrix.
- `apps/api/src/aiContentPublish.ts`: validates canonical AI manifests, creates common publish records, and removes the obsolete Reel-render job handoff.
- `apps/api/src/repository.ts`: lets the existing common publisher read a canonical AI manifest's `assets[]` MP4 in addition to the existing top-level generic Reel video.
- `apps/api/src/httpServer.ts`: existing route orchestration remains; route tests prove target isolation and stored queue-state reporting.

No migration, content contract, image worker, Reel worker, automatic generation, or unrelated publish-screen file changes are required.

---

### Task 1: Lock the Unified Result Page for All Three Formats

**Files:**
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/styles/ai-content-flow.css`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Test: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Test: `apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.test.tsx`
- Test: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] **Step 1: Write or retain failing assertions for a tab-free common result shell**

Use the existing completed card-news, completed blog, completed Reel, partial-failure, and total-failure fixtures. Add these assertions to each applicable state:

```tsx
expect(screen.queryByRole("tablist", { name: "콘텐츠 검토" })).not.toBeInTheDocument();
expect(screen.queryByRole("tab", { name: "기획 근거" })).not.toBeInTheDocument();
expect(screen.queryByRole("tab", { name: "완성본" })).not.toBeInTheDocument();
expect(screen.queryByRole("tab", { name: "게시" })).not.toBeInTheDocument();
expect(screen.getByRole("heading", { name: "생성 결과 상세" })).toBeVisible();
```

Assert that hidden evidence strings are absent while the generation gateway response, URL, download controls, ZIP selection, retries, loading, empty state, partial failure, total failure, and completed states remain unchanged.

- [ ] **Step 2: Run the UI tests and confirm the old tabbed implementation fails the new assertions**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/aiContentGeneration.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/__tests__/helpGuidance.test.tsx
```

Expected before implementation: failures on visible tab roles and the old square/unbounded Reel frame.

- [ ] **Step 3: Implement the common result shell without changing handlers or API data**

Render `AiGenerationOutputList` once inside the result layout:

```tsx
<section className="ai-content-review ai-content-review--unified" aria-label="결과 확인">
  <div className="ai-content-result-layout">
    <div className="ai-content-result-primary">
      <p className="small muted">
        결과 확인, 다운로드와 지원되는 게시 작업을 한 화면에서 진행할 수 있습니다.
      </p>
      {outputList}
    </div>
    <aside className="ai-content-result-summary" aria-label="결과 정보">
      <span className="ai-content-result-summary__eyebrow">RESULT DETAILS</span>
      <h2>결과 정보</h2>
      <dl>
        <div><dt>상태</dt><dd>{generationStatusLabels[generation.status]}</dd></div>
        <div><dt>형식</dt><dd>{displayFormat}</dd></div>
        <div><dt>완료 결과</dt><dd>{completedOutputIds.length} / {generation.outputs.length}</dd></div>
        <div><dt>콘텐츠 제목</dt><dd>{generation.title}</dd></div>
        <div><dt>생성 ID</dt><dd><code>{generation.id}</code></dd></div>
      </dl>
    </aside>
  </div>
</section>
```

Delete only review-tab state, labels, and visible evidence rendering. Do not change polling, route parameters, gateway calls, action locks, download handlers, retry handlers, publish callbacks, or evidence fields returned by the API.

- [ ] **Step 4: Apply the bounded 9:16 Reel frame while preserving card and blog previews**

```tsx
<div className="ai-content-artifact ai-content-artifact--reel ai-content-artifact--reel-frame">
  <video className="ai-content-artifact__reel-video" src={video.url} poster={artifact.posterUrl ?? undefined} controls muted playsInline preload="metadata" />
</div>
```

```css
.ai-content-flow .ai-content-artifact--reel-frame {
  width: min(100%, 420px);
  aspect-ratio: 9 / 16;
  overflow: hidden;
  background: #0d1512;
}

.ai-content-flow .ai-content-artifact__reel-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

- [ ] **Step 5: Run focused UI tests and build**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/__tests__/aiContentGeneration.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/__tests__/helpGuidance.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: all selected tests pass and the Vite production build exits 0.

- [ ] **Step 6: Commit only the unified result-page files**

```powershell
git add apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.tsx apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx apps/customer-ui/src/styles/ai-content-flow.css apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx apps/customer-ui/src/components/ai-content/AiContentArtifactPreview.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx
git commit -m "feat(ui): unify AI content result pages"
```

### Task 2: Make the Publish Target Matrix Exact

**Files:**
- Modify: `apps/api/src/aiContentPublishTargets.ts`
- Test: `apps/api/src/aiContentPublishTargets.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`
- Test: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.test.ts`

- [ ] **Step 1: Replace permissive type/asset tests with exact format matrix RED tests**

```ts
it.each([
  ["card_news", "instagram_feed_carousel", true],
  ["card_news", "instagram_story", true],
  ["card_news", "instagram_reel", false],
  ["reel", "instagram_reel", true],
  ["reel", "instagram_feed_carousel", false],
  ["reel", "instagram_story", false],
  ["blog", "instagram_reel", false],
] as const)("resolves %s -> %s", (outputFormat, deliveryFormat, supported) => {
  expect(resolveAiContentPublishTarget(
    { outputFormat, assetCount: 3 },
    { channel: "instagram", deliveryFormat },
  ).supported).toBe(supported);
});
```

```ts
expect(buildAiContentPublishOptions({ outputFormat: "reel", assetCount: 1, channels })[0].formats)
  .toEqual([expect.objectContaining({ deliveryFormat: "instagram_reel", label: "릴스", enabled: true })]);
```

- [ ] **Step 2: Run both target suites and observe the current card-to-Reel allowance and Reel UI omission**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentPublishTargets.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentPublishTargets.test.ts
```

- [ ] **Step 3: Implement exact matrices**

API:

```ts
const supportedTargets = {
  card_news: new Set(["instagram_feed_carousel", "instagram_story"]),
  reel: new Set(["instagram_reel"]),
  blog: new Set(),
} as const;
```

Keep stale single-feed-to-carousel normalization only for card-news if current clients still send it. Never normalize between output formats.

UI:

```ts
if (outputFormat === "reel") {
  return [{ deliveryFormat: "instagram_reel", label: "릴스", enabled: assetCount >= 1, reason: assetCount >= 1 ? null : "완성된 영상 필요" }];
}
if (outputFormat === "blog") return [];
return [cardCarousel, story];
```

- [ ] **Step 4: Re-run target suites and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentPublishTargets.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentPublishTargets.test.ts
git add apps/api/src/aiContentPublishTargets.ts apps/api/src/aiContentPublishTargets.test.ts apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts apps/customer-ui/src/features/ai-content/aiContentPublishTargets.test.ts
git commit -m "feat(ai-content): define direct publish format matrix"
```

### Task 3: Adapt the Canonical Reel Manifest and Delete AI Re-rendering

**Files:**
- Modify: `apps/api/src/aiContentPublish.ts`
- Test: `apps/api/src/aiContentPublish.test.ts`
- Test: `apps/api/src/aiContentPublish.pglite.test.ts`

- [ ] **Step 1: Add failing repository tests for direct MP4 publishing**

```ts
const reelManifest = {
  version: "ai-content.v3",
  outputFormat: "reel",
  purpose: "marketing",
  title: "완성 릴스",
  assets: [
    sceneAsset,
    { role: "video", index: 1, url: reelUrl, fileName: "reel.mp4", mimeType: "video/mp4", width: 1080, height: 1920, durationSeconds: 12, videoCodec: "h264", fps: 30, audioCodec: null },
  ],
  content: { caption: "완성된 릴스 캡션", hashtags: ["#브랜드"], cta: "확인" },
};
```

Assert a scheduled `instagram_reel` target, one `channel_outputs` row with canonical video/caption/hashtags, one publish queue, and zero `jobs` inserts. Add missing video, duplicate video, card-news-to-Reel, and Reel-to-feed/Story cases. Every negative case must roll back before channel-output, queue, or job writes.

- [ ] **Step 2: Run the repository test and confirm direct Reel currently fails**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentPublish.test.ts
```

Expected RED: `ai_content_publish_type_not_supported` for canonical Reel.

- [ ] **Step 3: Split card-news and Reel manifest adaptation**

```ts
function socialContent(manifest: AiContentManifestV3): SocialManifestContent {
  if (!("caption" in manifest.content)) throw new Error("ai_content_publish_type_not_supported");
  return manifest.content;
}

function reelVideo(manifest: AiContentManifestV3) {
  const videos = manifest.assets.filter((asset) => asset.role === "video" && asset.mimeType === "video/mp4");
  if (videos.length !== 1) throw new Error("ai_content_publish_reel_video_invalid");
  return videos[0];
}
```

Use `manifest.outputFormat` when resolving targets. For Reel, put the existing video descriptor in `channel_outputs.output_json`; for card-news, retain the existing cards/story output shape and copy values.

- [ ] **Step 4: Delete only the obsolete AI-content render handoff**

Remove `enqueueReelRenderJob`, its render-payload imports, its `jobs` insertion, and AI-content `rendering` return branches. Do not edit generic render workers, `imageRenderJobs.ts`, or non-AI Reel completion.

- [ ] **Step 5: Verify API tests and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentPublish.test.ts src/aiContentPublish.pglite.test.ts src/aiContentPublishTargets.test.ts
npm run typecheck --workspace @brand-pilot/api
git add apps/api/src/aiContentPublish.ts apps/api/src/aiContentPublish.test.ts apps/api/src/aiContentPublish.pglite.test.ts
git commit -m "feat(ai-content): publish completed Reel artifacts directly"
```

### Task 4: Let the Common Publisher Read Canonical AI Reel Assets

**Files:**
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/repository.regression-1.test.ts`
- Test: `apps/api/src/instagramPublisher.test.ts`

- [ ] **Step 1: Add a failing canonical-assets Reel publisher test**

Supply a fetched manifest in the canonical AI shape:

```ts
{
  outputFormat: "reel",
  assets: [
    { role: "scene", mimeType: "image/png", url: sceneUrl },
    { role: "video", mimeType: "video/mp4", url: videoUrl },
  ],
  content: { caption: "릴스 캡션", hashtags: ["#릴스"], cta: "확인" },
}
```

Assert:

```ts
expect(publishInstagramOutput).toHaveBeenCalledWith(expect.objectContaining({
  deliveryFormat: "instagram_reel",
  videoUrl,
  caption: "릴스 캡션\n\n#릴스",
}));
```

Add missing and duplicate `role=video` cases and assert Meta is not called.

- [ ] **Step 2: Run the focused publisher tests and observe the canonical AI manifest failure**

```powershell
npm test --workspace @brand-pilot/api -- src/repository.regression-1.test.ts src/instagramPublisher.test.ts
```

Expected RED: the current top-level-only extraction throws `reel_video_required`.

- [ ] **Step 3: Add a strict fallback video extractor**

```ts
function extractManifestVideoUrl(manifest: Record<string, unknown>) {
  const topLevel = extractManifestAssetUrl(manifest.video);
  if (topLevel) return topLevel;
  const videos = Array.isArray(manifest.assets)
    ? manifest.assets.map(recordValue).filter((asset) => asset.role === "video" && asset.mimeType === "video/mp4")
    : [];
  if (videos.length !== 1) return null;
  return extractManifestAssetUrl(videos[0]);
}
```

Keep top-level generic Reel support first so existing non-AI publish jobs do not change. Use the strict canonical fallback only when the top-level video is absent.

- [ ] **Step 4: Re-run publisher and repository regression suites and commit**

```powershell
npm test --workspace @brand-pilot/api -- src/repository.regression-1.test.ts src/instagramPublisher.test.ts
npm run typecheck --workspace @brand-pilot/api
git add apps/api/src/repository.ts apps/api/src/repository.regression-1.test.ts apps/api/src/instagramPublisher.test.ts
git commit -m "fix(publish): read canonical AI Reel video assets"
```

### Task 5: Expose Direct Reel Publishing in the Unified Result Page

**Files:**
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Test: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Test: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`
- Test: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.test.tsx`
- Test: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`

- [ ] **Step 1: Add failing UI contract tests for completed Reel publishing**

Gateway:

```ts
expect(mappedReel.outputs[0]).toMatchObject({ outputFormat: "reel", publishSupported: true });
expect(mappedBlog.outputs[0].publishSupported).toBe(false);
```

Panel:

```tsx
render(<AiContentPublishPanel manifestVersion="ai-content.v3" outputFormat="reel" assetCount={1} channels={channels} publishing={false} results={[]} onPublish={onPublish} />);
await user.click(screen.getByRole("checkbox", { name: "릴스" }));
await user.click(screen.getByRole("button", { name: "선택한 1개 유형 게시" }));
expect(onPublish).toHaveBeenCalledWith([{ channel: "instagram", deliveryFormat: "instagram_reel" }]);
expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
```

Page:

```tsx
expect(screen.getByRole("region", { name: "SNS에 바로 게시" })).toBeVisible();
expect(screen.queryByText(/다운로드만 지원/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run focused UI tests and confirm Reel is currently unsupported**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentApiGateway.test.ts src/features/ai-content/aiContentPublishTargets.test.ts src/components/ai-content/AiContentPublishPanel.test.tsx src/__tests__/aiContentGeneration.test.tsx
```

- [ ] **Step 3: Mark only card-news and Reel manifests publishable**

```ts
publishSupported: manifest?.outputFormat === "card_news" || manifest?.outputFormat === "reel",
```

Keep blog false. Use only the parsed canonical manifest, never stale metadata or a filename heuristic.

- [ ] **Step 4: Render the common panel for Reel and remove the temporary download-only message**

Remove the Reel-specific unsupported paragraph from `AiGenerationOutputList`. The existing `output.publishSupported` guard must place the common panel below the 9:16 video. Keep the panel's manifest-version guard, support card-news and Reel, and return no direct-publish region for blog.

- [ ] **Step 5: Cover all existing queue result states for Reel**

Use existing result rendering for scheduled, publishing, published, failed, retry, and reconciliation states. Map `ai_content_publish_reel_video_invalid` to a clear pre-queue message and keep the common publisher's `reel_video_required` as the stored post-queue failure. Assert `게시 큐에서 확인` appears only with a queue ID and reconciliation never offers a blind retry.

Add a separate completed Reel fixture with one successful output and `publishSupported: true`. Keep `generation-partial` exclusively for partial-failure coverage; do not relabel it as completed.

- [ ] **Step 6: Run focused UI tests and build, then commit**

```powershell
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentApiGateway.test.ts src/features/ai-content/aiContentPublishTargets.test.ts src/components/ai-content/AiContentPublishPanel.test.tsx src/components/ai-content/AiGenerationOutputList.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/__tests__/aiContentGeneration.test.tsx src/__tests__/helpGuidance.test.tsx
npm run build --workspace @brand-pilot/customer-ui
git add apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts apps/customer-ui/src/features/ai-content/aiContentPublishTargets.test.ts apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx apps/customer-ui/src/components/ai-content/AiGenerationOutputList.test.tsx apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx
git commit -m "feat(ui): publish completed Reel results"
```

### Task 6: Verify the Existing HTTP Route and Cross-Format Isolation

**Files:**
- Test: `apps/api/src/server.aiContentCustomer.test.ts`
- Test: `apps/api/src/aiContentPublish.test.ts`

- [ ] **Step 1: Add route tests for direct Reel and unsupported cross-format targets**

Use this valid request:

```json
{
  "idempotencyKey": "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
  "targets": [{ "channel": "instagram", "deliveryFormat": "instagram_reel" }]
}
```

Assert a queue ID and a publish state rather than `rendering`. Add card-news-to-Reel and Reel-to-Story cases that fail before `publishQueueItem` is called.

- [ ] **Step 2: Add provider-failure isolation and stored-state assertions**

When Meta fails, assert the route reads `getAiContentPublishQueueResult`, returns the stored target failure, logs `ai_content_publish_target_failed`, and does not mutate a successful sibling target.

- [ ] **Step 3: Run route plus repository suites**

```powershell
npm test --workspace @brand-pilot/api -- src/server.aiContentCustomer.test.ts src/aiContentPublish.test.ts src/aiContentPublish.pglite.test.ts src/aiContentPublishTargets.test.ts src/repository.regression-1.test.ts src/instagramPublisher.test.ts
npm run build --workspace @brand-pilot/api
```

- [ ] **Step 4: Commit route coverage**

```powershell
git add apps/api/src/server.aiContentCustomer.test.ts apps/api/src/aiContentPublish.test.ts
git commit -m "test(ai-content): cover direct Reel publish route"
```

### Task 7: Whole-Scope Regression, Source Cleanup, and Deployment Gate

**Files:**
- Verify only; modify a source file only when an in-scope failing test identifies a concrete defect.

- [ ] **Step 1: Prove obsolete AI-content Reel rendering is absent**

```powershell
rg -n "enqueueReelRenderJob|세로형 영상으로 변환 후 게시|현재 릴스 결과는 다운로드만 지원|status:\s*\"rendering\"" apps/api/src/aiContentPublish.ts apps/customer-ui/src/features/ai-content apps/customer-ui/src/components/ai-content
```

Expected: no obsolete AI-content handoff or download-only UI string. Generic `instagram_reel_render` references elsewhere remain because they serve current non-AI publishing.

- [ ] **Step 2: Run all affected tests sequentially**

```powershell
npm test --workspace @brand-pilot/api -- src/aiContentPublishTargets.test.ts src/aiContentPublish.test.ts src/aiContentPublish.pglite.test.ts src/instagramPublisher.test.ts src/repository.regression-1.test.ts src/server.aiContentCustomer.test.ts
npm test --workspace @brand-pilot/customer-ui -- src/features/ai-content/aiContentApiGateway.test.ts src/features/ai-content/aiContentPublishTargets.test.ts src/components/ai-content/AiContentPublishPanel.test.tsx src/components/ai-content/AiGenerationOutputList.test.tsx src/components/ai-content/AiContentArtifactPreview.test.tsx src/__tests__/aiContentGeneration.test.tsx src/__tests__/helpGuidance.test.tsx
```

Expected: zero failures. Report timeout, ENOSPC, Docker-off, and other environment failures separately from code failures.

- [ ] **Step 3: Build only affected deployables**

```powershell
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
```

No worker build is needed. A worker change is outside the approved plan and must stop for review.

- [ ] **Step 4: Check scope, protected paths, and whitespace**

```powershell
git diff --check
git status --short
git diff --name-only origin/main...HEAD
git diff --exit-code origin/main...HEAD -- db/migrations workers/brand-pilot-image-worker workers/brand-pilot-reel-worker apps/api/src/automatedCardNews.ts
```

Expected: no migration, image/Reel worker, or automatic-card source diff. Existing unrelated user files must not be staged or committed.

- [ ] **Step 5: Perform local browser verification using completed fixtures**

- Card-news completed: no tabs, image preview, ZIP, feed/Story publishing.
- Reel completed: no tabs, 9:16 final MP4, ZIP, Instagram Reel publishing.
- Blog completed: no tabs, HTML preview, ZIP, no direct social publishing.
- Partial failure: completed output remains usable and failed output keeps retry controls.
- Full failure, loading, and empty states retain their messages.

Do not use the two-output `partial_failed` fixture as the screenshot representing a completed Reel.

- [ ] **Step 6: Commit remaining test-only verification changes if any**

```powershell
git add apps/api/src/server.aiContentCustomer.test.ts apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx
git diff --cached --check
git commit -m "test(ai-content): lock unified result publishing regressions"
```

Skip this commit when no remaining in-scope changes exist.

- [ ] **Step 7: Apply the production deployment gate only after explicit deployment approval**

```text
read actual production SHA/digests and preserve rollback
  -> build immutable API artifact
  -> deploy API canary
  -> health/ready + card-news prepare + Reel prepare verification
  -> promote API primary
  -> build/deploy customer UI
  -> verify card-news, Reel, and blog result screens
  -> publish one production Reel
  -> verify queue, Meta result, revisions, digests, restart count, recent errors
```

Never deploy UI before API. Do not deploy migrations or workers. If a running production hotfix differs from the branch base, stop before replacement and reconcile it explicitly.

---

## Failure-Mode Coverage

| Code path | Realistic failure | Test | Handling | User-visible result |
|---|---|---|---|---|
| Unified result shell | Tab removal accidentally removes download/retry handlers | UI generation tests | Existing callbacks retained | Existing controls remain visible |
| Reel preview | Container crops video or stays square | Artifact test + browser check | `aspect-ratio` + `object-fit: contain` | Correct 9:16 player |
| Target resolution | Card-news submitted as Reel or Reel as Story | API/UI matrix tests | Reject before writes | Safe unsupported error |
| Manifest adaptation | Missing/duplicate MP4 | Repository negative tests | Rollback | No partial publish records |
| Queue creation | Repeated click | Idempotency tests | Reuse target/queue | One publish operation |
| Common publisher | Canonical MP4 lives in `assets[]` | Repository publisher test | Strict fallback extractor | Existing MP4 reaches Meta |
| Meta processing | Timeout/provider failure | Publisher tests | Existing failed queue state | Actionable failure |
| Delivery uncertainty | Meta accepted before response loss | Queue-result tests | Reconciliation; no blind retry | No duplicate post |
| Rolling deployment | UI exposes Reel before API accepts it | Deployment-order gate | API first | No mixed-version failure |

No failure mode is intentionally silent.

## NOT in Scope

- Caption or hashtag editing: generated copy remains the source of truth.
- Re-rendering or transcoding: the final MP4 is published as-is.
- Blog social publishing: no approved artifact-to-social contract exists.
- New database schema, status, or queue: current records are sufficient.
- Worker or automatic-generation changes: unrelated to completed manual Reel publishing.
- Restoring old AI-content card-to-Reel jobs: the obsolete path is deleted, not kept as fallback.

## Parallelization

Sequential implementation, no parallelization opportunity. The UI target matrix depends on the API contract, and the API adapter plus common publisher share publishing state and regression suites. Sequential RED/GREEN work keeps each behavior change attributable and avoids conflicting assumptions.
