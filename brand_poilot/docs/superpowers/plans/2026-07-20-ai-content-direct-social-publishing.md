# AI Content Direct Social Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 콘텐츠 결과물별로 SNS 채널과 게시 유형을 체크해 즉시 게시하고, 모든 채널 표시에서 저장된 공식 로고를 일관되게 사용한다.

**Architecture:** AI 콘텐츠 결과를 대상별 `channel_outputs`와 `publish_queue`로 투영한 뒤 큐를 먼저 커밋하고 기존 `publishQueueItem`을 순차 호출한다. 결과물·채널·게시 유형 조합을 DB 고유키와 멱등성 키로 보호하며, 요청 중단 시 기존 로컬 스케줄러가 남은 `scheduled` 큐를 복구한다. 프론트는 채널 카탈로그와 실제 연결 상태를 합쳐 모든 채널을 표시하고, 호환되는 대상만 체크 가능하게 한다.

**Tech Stack:** TypeScript, Node.js 20, Fastify, PostgreSQL, React 18, Vitest, Testing Library, Playwright, Meta Graph API

---

## File Structure

### API and database

- Create `db/migrations/048_ai_content_direct_social_publishing.sql`: AI 결과물별 다중 채널 출력 고유키를 적용한다.
- Create `apps/api/src/aiContentPublishTargets.ts`: 요청 파싱, 중복 검사, 콘텐츠·게시 유형 호환성 판단을 담당한다.
- Create `apps/api/src/aiContentPublishTargets.test.ts`: 호환성 행렬과 요청 검증을 고정한다.
- Modify `apps/api/src/aiContentPublish.ts`: 한 결과물에서 공통 topic/master/group과 대상별 output/queue를 원자적으로 생성한다.
- Modify `apps/api/src/aiContentPublish.test.ts`: 다중 대상, 멱등성, 부분 재사용을 검증한다.
- Modify `apps/api/src/instagramPublisher.ts`: 단일 피드 이미지 게시를 지원한다.
- Modify `apps/api/src/instagramPublisher.test.ts`: 단일 이미지 컨테이너 요청을 검증한다.
- Modify `apps/api/src/repository.ts`: AI manifest에서 피드·스토리 자산을 읽고 즉시 게시 큐 상태를 조회한다.
- Modify `apps/api/src/repository.test.ts`: AI manifest 게시 투영과 큐 복구를 검증한다.
- Modify `apps/api/src/httpServer.ts`: 다중 대상 API와 순차 즉시 게시 orchestration을 제공한다.
- Modify `apps/api/src/server.aiContentCustomer.test.ts`: 인증, 요청 계약, 부분 실패 응답을 검증한다.
- Modify `apps/api/src/types.ts`: 게시 요청·대상 결과와 repository 메서드 타입을 반영한다.

### Customer UI

- Create `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`: 결과물 manifest와 채널 상태를 UI 게시 옵션으로 변환한다.
- Create `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.test.ts`: 체크 가능 여부와 비활성 사유를 검증한다.
- Create `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`: 결과물별 채널·게시 유형 체크박스와 게시 상태를 렌더링한다.
- Create `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`: 연결/미연결/복수 선택/재시도 UI를 검증한다.
- Create `apps/customer-ui/src/components/channels/ChannelLogo.tsx`: 채널 코드와 저장된 로고를 매핑한다.
- Create `apps/customer-ui/src/components/channels/ChannelLogo.test.tsx`: 로고 경로, 접근성, fallback을 검증한다.
- Create `apps/customer-ui/src/features/channels/channelConnectionUrls.ts`: 채널별 OAuth 시작 URL 또는 준비 중 상태를 공통 제공한다.
- Create `apps/customer-ui/public/assets/channels/*.svg`: 6개 SNS 로고를 저장한다.
- Create `apps/customer-ui/public/assets/channels/NOTICE.md`: 자산 출처와 상표 고지를 기록한다.
- Modify `apps/customer-ui/src/features/ai-content/types.ts`: 다중 게시 계약과 채널 연결 조회를 추가한다.
- Modify `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`: 채널 목록 조회와 다중 게시 요청을 연결한다.
- Modify `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`: 테스트용 채널 상태와 게시 결과를 제공한다.
- Modify `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`: 결과물별 선택·게시·재시도 상태를 관리한다.
- Modify `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`: 기존 `게시 관리로 보내기`를 새 패널로 교체한다.
- Modify `apps/customer-ui/src/styles/prototype.css`: 반응형 채널 행과 상태 UI를 추가한다.
- Modify `apps/customer-ui/src/pages/ChannelsPage.tsx`, `apps/customer-ui/src/pages/AdminChannelsPage.tsx`, `apps/customer-ui/src/pages/OnboardingPage.tsx`, `apps/customer-ui/src/pages/PublishQueuePage.tsx`, `apps/customer-ui/src/pages/DashboardPage.tsx`, `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`, `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`, `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx`: 공통 채널 로고를 적용한다.
- Modify related tests under `apps/customer-ui/src/__tests__` and `apps/customer-ui/src/components/publish`: 텍스트와 로고가 함께 유지되는지 검증한다.

### E2E

- Modify `apps/customer-ui/e2e/ai-content-runtime.spec.ts`: 결과물별 게시 대상 선택과 즉시 게시 흐름을 검증한다.
- Modify `scripts/ai-content-smoke.mjs`: 실제 Instagram 테스트 계정으로 게시글과 스토리 smoke를 선택 실행할 수 있게 한다.

---

### Task 1: Change the database identity from one output to one output-target

**Files:**
- Create: `db/migrations/048_ai_content_direct_social_publishing.sql`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write the failing migration assertion**

Add assertions after migrations run:

```js
const indexes = await client.query(`
  select indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'uq_channel_outputs_ai_content_generation_target',
      'channel_outputs_current_master_channel_format_unique'
    )
  order by indexname
`);
assert.equal(indexes.rowCount, 2);
assert.match(indexes.rows[0].indexdef + indexes.rows[1].indexdef, /ai_content_generation_output_id, channel, delivery_format/);
assert.match(indexes.rows[0].indexdef + indexes.rows[1].indexdef, /master_draft_id, channel, delivery_format/);
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `npm run test:migrations`  
Expected: FAIL because the two composite indexes do not exist.

- [ ] **Step 3: Add migration 048**

```sql
begin;

drop index if exists uq_channel_outputs_ai_content_generation_output;
create unique index uq_channel_outputs_ai_content_generation_target
  on channel_outputs (ai_content_generation_output_id, channel, delivery_format)
  where ai_content_generation_output_id is not null;

drop index if exists channel_outputs_current_master_channel_unique;
create unique index channel_outputs_current_master_channel_format_unique
  on channel_outputs (master_draft_id, channel, delivery_format)
  where status != 'regenerated';

alter table channel_outputs
  drop constraint if exists channel_outputs_delivery_format_check;
alter table channel_outputs
  add constraint channel_outputs_delivery_format_check check (
    delivery_format in (
      'instagram_feed_single',
      'instagram_feed_carousel',
      'instagram_story',
      'instagram_reel',
      'threads_text',
      'tiktok_video',
      'youtube_video',
      'youtube_short',
      'x_post',
      'linkedin_post'
    )
  );

commit;
```

- [ ] **Step 4: Run the migration test and verify it passes**

Run: `npm run test:migrations`  
Expected: PASS with all migrations through `048` applied.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/048_ai_content_direct_social_publishing.sql scripts/migrations.integration.test.mjs
git commit -m "feat: support multiple AI content publish targets"
```

### Task 2: Define and test publish-target contracts

**Files:**
- Create: `apps/api/src/aiContentPublishTargets.ts`
- Create: `apps/api/src/aiContentPublishTargets.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/customer-ui/src/types.ts`

- [ ] **Step 1: Write failing compatibility tests**

```ts
it.each([
  ["card_news", 3, "instagram_feed_carousel", true],
  ["card_news", 1, "instagram_feed_single", true],
  ["card_news", 3, "instagram_story", true],
  ["card_news", 3, "instagram_reel", false],
  ["marketing", 1, "instagram_feed_single", true],
  ["marketing", 1, "instagram_story", true],
  ["blog", 0, "instagram_feed_single", false],
] as const)("resolves %s with %s assets for %s", (type, assetCount, deliveryFormat, supported) => {
  expect(resolveAiContentPublishTarget({ type, assetCount }, { channel: "instagram", deliveryFormat }).supported).toBe(supported);
});

it("rejects duplicate channel and format targets", () => {
  expect(() => parseAiContentPublishRequest({
    idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
    targets: [
      { channel: "instagram", deliveryFormat: "instagram_story" },
      { channel: "instagram", deliveryFormat: "instagram_story" },
    ],
  })).toThrow("duplicate_publish_target");
});
```

- [ ] **Step 2: Run the target test and verify it fails**

Run: `npm exec --workspace @brand-pilot/api vitest run src/aiContentPublishTargets.test.ts`  
Expected: FAIL because the target module does not exist.

- [ ] **Step 3: Implement strict request parsing and compatibility**

Define these exact public types:

```ts
export type AiContentPublishDeliveryFormat =
  | "instagram_feed_single"
  | "instagram_feed_carousel"
  | "instagram_story"
  | "instagram_reel"
  | "threads_text"
  | "x_post"
  | "linkedin_post"
  | "youtube_short"
  | "tiktok_video";

export interface AiContentPublishTarget {
  channel: Channel;
  deliveryFormat: AiContentPublishDeliveryFormat;
}

export interface AiContentPublishRequest {
  idempotencyKey: string;
  targets: AiContentPublishTarget[];
}
```

Implement `parseAiContentPublishRequest(value: unknown)` with these rules:

```ts
if (!UUID_PATTERN.test(idempotencyKey)) throw new Error("ai_content_publish_idempotency_key_invalid");
if (targets.length === 0 || targets.length > 12) throw new Error("ai_content_publish_targets_invalid");
const key = `${target.channel}:${target.deliveryFormat}`;
if (seen.has(key)) throw new Error("duplicate_publish_target");
```

Implement `resolveAiContentPublishTarget` so only the compatibility table in the design spec returns `{ supported: true }`. Unsupported combinations return `{ supported: false, reason: "ai_content_publish_target_unsupported" }` or `{ supported: false, reason: "delivery_format_asset_mismatch" }`.

- [ ] **Step 4: Add `instagram_feed_single` to the general delivery-format unions**

Add the literal to `DeliveryFormat` in API and customer UI types. Do not add it to `instagramFormats` in `instagramFormats.ts`; automatic operation must continue rotating only carousel, story, and reel.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm exec --workspace @brand-pilot/api vitest run src/aiContentPublishTargets.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/aiContentPublishTargets.ts apps/api/src/aiContentPublishTargets.test.ts apps/api/src/types.ts apps/customer-ui/src/types.ts
git commit -m "feat: define AI content publish targets"
```

### Task 3: Prepare multiple queue items atomically

**Files:**
- Modify: `apps/api/src/aiContentPublish.ts`
- Modify: `apps/api/src/aiContentPublish.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: Replace single-handoff tests with multi-target tests**

Cover these exact expectations:

```ts
await expect(repository.prepareAiContentPublish({
  ...input,
  idempotencyKey: "b4b74082-8a44-46d6-91b6-3e3bd7e26be0",
  targets: [
    { channel: "instagram", deliveryFormat: "instagram_feed_carousel" },
    { channel: "instagram", deliveryFormat: "instagram_story" },
  ],
})).resolves.toMatchObject({
  publishGroupId: "publish-group-1",
  targets: [
    { deliveryFormat: "instagram_feed_carousel", queueId: "queue-feed", status: "scheduled" },
    { deliveryFormat: "instagram_story", queueId: "queue-story", status: "scheduled" },
  ],
});
expect(statements.filter((sql) => sql.includes("insert into content_topics"))).toHaveLength(1);
expect(statements.filter((sql) => sql.includes("insert into channel_outputs"))).toHaveLength(2);
expect(statements.filter((sql) => sql.includes("insert into publish_queue"))).toHaveLength(2);
```

Add a second test where the feed target exists and the story target does not. Assert that feed is reused and only story is inserted.

- [ ] **Step 2: Run the repository test and verify it fails**

Run: `npm exec --workspace @brand-pilot/api vitest run src/aiContentPublish.test.ts`  
Expected: FAIL because `prepareAiContentPublish` and queue IDs do not exist.

- [ ] **Step 3: Refactor the repository contract**

Use this return shape:

```ts
export interface PreparedAiContentPublish {
  publishGroupId: string;
  targets: Array<{
    channel: Channel;
    deliveryFormat: AiContentPublishDeliveryFormat;
    channelOutputId: string;
    queueId: string;
    status: "scheduled" | "publishing" | "published" | "failed";
    publishedUrl: string | null;
    errorCode: string | null;
  }>;
}
```

Rename `sendAiContentToPublish` to `prepareAiContentPublish`. Inside one transaction:

1. Lock the AI output.
2. Parse its manifest and validate every target.
3. Find or create one topic, master draft, and topic publish group using `source_context->>'aiContentOutputId'`.
4. For each target, find or create `channel_outputs` by `(ai_content_generation_output_id, channel, delivery_format)`.
5. Find or create `publish_queue` with `status='scheduled'`, `scheduled_for=now()`, `approval_type='manual'` and idempotency key `ai-content:${outputId}:${channel}:${deliveryFormat}`.
6. Commit and return all targets.

The user clicking `지금 게시` is the manual approval action. Create `channel_outputs` with `status='approved'` and `approved_at=now()`. Create or update the topic publish group with `status='scheduled'` and `scheduled_for=now()` so it does not return to the normal approval scheduler.

Set the target output JSON without altering original assets:

```ts
const outputJson = {
  deliveryFormat: target.deliveryFormat,
  promptVersion: "ai-content.v1",
  generationState: "completed",
  artifactStatus: "ready",
  caption: content.caption,
  hashtags: content.hashtags,
  cta: content.cta,
  cards: legacyCards,
  aiContentManifestVersion: manifest.version,
};
```

- [ ] **Step 4: Preserve the manifest storage artifact once**

Reuse the same `storage_artifacts` row for all target outputs. Use `on conflict (bucket, path) do update` and assign its ID to every `channel_outputs.rendered_artifact_id`.

Add `getAiContentPublishQueueResult` to the repository contract and implement a brand-scoped query:

```sql
select pq.id as queue_id, pq.channel, co.delivery_format, pq.status,
       pq.last_error,
       (select pa.external_url
          from publish_attempts pa
         where pa.publish_queue_id = pq.id and pa.status = 'succeeded'
         order by pa.attempt_number desc limit 1) as published_url
  from publish_queue pq
  join channel_outputs co on co.id = pq.channel_output_id
 where pq.id = $1 and pq.workspace_id = $2 and pq.brand_id = $3
```

Map this row to the target result contract. Throw `publish_queue_not_found` when it is absent.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm exec --workspace @brand-pilot/api vitest run src/aiContentPublish.test.ts src/aiContentPublishTargets.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/aiContentPublish.ts apps/api/src/aiContentPublish.test.ts apps/api/src/types.ts
git commit -m "feat: prepare direct AI content publish queues"
```

### Task 4: Publish AI image manifests as feed or story

**Files:**
- Modify: `apps/api/src/instagramPublisher.ts`
- Modify: `apps/api/src/instagramPublisher.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`

- [ ] **Step 1: Add failing single-feed publisher test**

```ts
await publishInstagramOutput({
  deliveryFormat: "instagram_feed_single",
  accessToken: "token",
  instagramBusinessAccountId: "ig-1",
  imageUrl: "https://cdn.example.com/asset.png",
  caption: "본문",
}, dependencies);

expect(postedBodies[0]).toMatchObject({
  image_url: "https://cdn.example.com/asset.png",
  caption: "본문",
});
expect(postedBodies[0]).not.toHaveProperty("media_type", "CAROUSEL");
```

- [ ] **Step 2: Add failing AI story-manifest repository test**

Create a queue fixture with `delivery_format='instagram_story'` and an `ai-content.v1` manifest containing only `assets`. Assert the publisher receives `imageUrl` equal to `assets[0].url`, without `story` in the manifest.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm exec --workspace @brand-pilot/api vitest run src/instagramPublisher.test.ts src/repository.test.ts
```

Expected: FAIL on unsupported `instagram_feed_single` and missing story asset.

- [ ] **Step 4: Add single-feed publishing**

Extend `InstagramPublishInput`:

```ts
| {
  deliveryFormat: "instagram_feed_single";
  imageUrl: string;
  caption: string;
}
```

Add the switch branch:

```ts
case "instagram_feed_single":
  requirePublicUrl(input.imageUrl);
  return publishContainer(input, {
    image_url: input.imageUrl,
    caption: input.caption,
  }, deps);
```

- [ ] **Step 5: Extend repository manifest projection**

When `rendered_manifest_url` contains `version: "ai-content.v1"`:

```ts
const aiImageUrls = extractManifestImageUrls(manifestRecord);
const firstAiImage = aiImageUrls[0] ?? null;
```

Use all URLs for carousel, the first URL for single feed, and the first URL as fallback for story:

```ts
const storyUrl = extractManifestAssetUrl(manifestRecord.story) ?? firstAiImage;
if (!storyUrl) throw new Error("instagram_rendered_story_required");
```

Keep automatic-operation story manifests unchanged; their explicit `story` asset still takes precedence.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
npm exec --workspace @brand-pilot/api vitest run src/instagramPublisher.test.ts src/repository.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/instagramPublisher.ts apps/api/src/instagramPublisher.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts
git commit -m "feat: publish AI image outputs to Instagram"
```

### Task 5: Orchestrate immediate publishing in the HTTP API

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: Write failing API tests**

Test a request body with feed and story targets. Assert:

```ts
expect(repository.prepareAiContentPublish).toHaveBeenCalledWith({
  workspaceId,
  brandId,
  outputId,
  idempotencyKey,
  targets,
});
expect(repository.publishQueueItem).toHaveBeenNthCalledWith(1, "queue-feed");
expect(repository.publishQueueItem).toHaveBeenNthCalledWith(2, "queue-story");
expect(response.json().targets).toEqual([
  expect.objectContaining({ queueId: "queue-feed", status: "published" }),
  expect.objectContaining({ queueId: "queue-story", status: "scheduled" }),
]);
```

Mock the second `publishQueueItem` to reject and `getAiContentPublishQueueResult` to return `scheduled`. Also test invalid body returns HTTP 400 and disconnected OAuth returns HTTP 409.

- [ ] **Step 2: Run API test and verify it fails**

Run: `npm exec --workspace @brand-pilot/api vitest run src/server.aiContentCustomer.test.ts`  
Expected: FAIL because the route ignores the body and does not publish queues.

- [ ] **Step 3: Implement sequential immediate attempts**

Change the route body type to `unknown`, parse it with `parseAiContentPublishRequest`, and execute:

```ts
const prepared = await repository.prepareAiContentPublish({
  ...aiContentScope(request, request.params.brandId),
  outputId: request.params.outputId,
  ...input,
});
const targets = [];
for (const target of prepared.targets) {
  try {
    const published = await repository.publishQueueItem(target.queueId);
    targets.push({ ...target, status: published.status, publishedUrl: published.publishedUrl, errorCode: null });
  } catch {
    targets.push(await repository.getAiContentPublishQueueResult({
      ...aiContentScope(request, request.params.brandId),
      queueId: target.queueId,
    }));
  }
}
return { outputId: request.params.outputId, targets };
```

Map parser errors to 400, OAuth/asset compatibility errors to 409, and unknown errors to the existing Fastify error path.

- [ ] **Step 4: Run API tests and typecheck**

Run:

```bash
npm exec --workspace @brand-pilot/api vitest run src/server.aiContentCustomer.test.ts src/aiContentPublish.test.ts
npm run typecheck --workspace @brand-pilot/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/types.ts
git commit -m "feat: publish AI content targets immediately"
```

### Task 6: Add versioned local SNS logo assets and `ChannelLogo`

**Files:**
- Create: `apps/customer-ui/public/assets/channels/instagram.svg`
- Create: `apps/customer-ui/public/assets/channels/threads.svg`
- Create: `apps/customer-ui/public/assets/channels/x.svg`
- Create: `apps/customer-ui/public/assets/channels/linkedin.svg`
- Create: `apps/customer-ui/public/assets/channels/tiktok.svg`
- Create: `apps/customer-ui/public/assets/channels/youtube.svg`
- Create: `apps/customer-ui/public/assets/channels/NOTICE.md`
- Create: `apps/customer-ui/src/components/channels/ChannelLogo.tsx`
- Create: `apps/customer-ui/src/components/channels/ChannelLogo.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
render(<ChannelLogo channel="instagram" decorative />);
expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("src", "/assets/channels/instagram.svg");
expect(screen.getByRole("img", { hidden: true })).toHaveAttribute("alt", "");

rerender(<ChannelLogo channel="youtube" label="YouTube" />);
expect(screen.getByRole("img", { name: "YouTube" })).toHaveAttribute("src", "/assets/channels/youtube.svg");
```

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npm exec --workspace @brand-pilot/customer-ui vitest run src/components/channels/ChannelLogo.test.tsx`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Download and commit pinned Simple Icons fallbacks**

Use Simple Icons `16.27.0` only where an official downloadable SVG is not available. Save assets locally:

```powershell
$version = '16.27.0'
$icons = 'instagram','threads','x','linkedin','tiktok','youtube'
New-Item -ItemType Directory -Force 'apps/customer-ui/public/assets/channels' | Out-Null
foreach ($icon in $icons) {
  Invoke-WebRequest "https://cdn.jsdelivr.net/npm/simple-icons@$version/icons/$icon.svg" -OutFile "apps/customer-ui/public/assets/channels/$icon.svg"
}
```

In `NOTICE.md`, record Simple Icons version `16.27.0`, retrieval date `2026-07-20`, and official brand-resource links from the design spec. Do not recolor or redraw the SVG paths.

- [ ] **Step 4: Implement the common component**

```tsx
const logoPaths: Record<ChannelType, string> = {
  instagram: "/assets/channels/instagram.svg",
  threads: "/assets/channels/threads.svg",
  x: "/assets/channels/x.svg",
  linkedin: "/assets/channels/linkedin.svg",
  tiktok: "/assets/channels/tiktok.svg",
  youtube: "/assets/channels/youtube.svg",
};

export function ChannelLogo({ channel, decorative = false, label, size = 20 }: {
  channel: ChannelType;
  decorative?: boolean;
  label?: string;
  size?: number;
}) {
  return <img className={`channel-logo channel-logo--${channel}`} src={logoPaths[channel]}
    alt={decorative ? "" : (label ?? channel)} width={size} height={size} />;
}
```

- [ ] **Step 5: Run the test**

Run: `npm exec --workspace @brand-pilot/customer-ui vitest run src/components/channels/ChannelLogo.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/customer-ui/public/assets/channels apps/customer-ui/src/components/channels/ChannelLogo.tsx apps/customer-ui/src/components/channels/ChannelLogo.test.tsx
git commit -m "feat: add local social channel logos"
```

### Task 7: Build the result-level publish target UI

**Files:**
- Create: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.ts`
- Create: `apps/customer-ui/src/features/ai-content/aiContentPublishTargets.test.ts`
- Create: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx`
- Create: `apps/customer-ui/src/components/ai-content/AiContentPublishPanel.test.tsx`
- Create: `apps/customer-ui/src/features/channels/channelConnectionUrls.ts`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/mockAiContentGateway.ts`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiGenerationOutputList.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`

- [ ] **Step 1: Write failing target-builder tests**

Test that six channel rows are always returned, connected Instagram exposes compatible formats, and unconnected channels expose no checkboxes:

```ts
expect(buildAiContentPublishOptions({ type: "card_news", assetCount: 3, channels })).toEqual(expect.arrayContaining([
  expect.objectContaining({ channel: "instagram", connected: true, accountLabel: "@growthline352", formats: [
    expect.objectContaining({ deliveryFormat: "instagram_feed_carousel", enabled: true }),
    expect.objectContaining({ deliveryFormat: "instagram_story", enabled: true }),
    expect.objectContaining({ deliveryFormat: "instagram_reel", enabled: false, reason: "영상 결과 필요" }),
  ] }),
  expect.objectContaining({ channel: "threads", connected: false, statusLabel: "OAuth 게시 계정 미연결", formats: [] }),
]));
```

- [ ] **Step 2: Write failing panel interaction tests**

Assert that clicking feed and story changes the button to `선택한 2곳에 지금 게시`, clicking the button calls `onPublish` once with two targets, no dialog appears, and a failed target alone exposes `다시 시도`.

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
npm exec --workspace @brand-pilot/customer-ui vitest run src/features/ai-content/aiContentPublishTargets.test.ts src/components/ai-content/AiContentPublishPanel.test.tsx
```

Expected: FAIL because the helper and panel do not exist.

- [ ] **Step 4: Add gateway contracts**

```ts
export interface AiContentPublishTargetInput {
  channel: ChannelType;
  deliveryFormat: DeliveryFormat;
}

export interface AiContentPublishTargetResult extends AiContentPublishTargetInput {
  queueId: string;
  status: "scheduled" | "publishing" | "published" | "failed";
  publishedUrl: string | null;
  errorCode: string | null;
}

publishOutput(brandId: string, outputId: string, input: {
  idempotencyKey: string;
  targets: AiContentPublishTargetInput[];
}): Promise<{ outputId: string; targets: AiContentPublishTargetResult[] }>;
listChannels(brandId: string): Promise<ChannelConnection[]>;
```

Use `crypto.randomUUID()` once per button click and preserve it for retrying the same client request.

- [ ] **Step 5: Implement `AiContentPublishPanel`**

Render one row per channel with `ChannelLogo`. Connected rows show account and checkboxes. Unconnected rows show `OAuth 게시 계정 미연결` and `연결하기`.

Create the shared URL resolver:

```ts
export function channelConnectionUrl(channel: ChannelType) {
  if (channel !== "instagram") return null;
  return import.meta.env.VITE_META_OAUTH_START_URL
    ?? `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000"}/auth/meta/start`;
}
```

Instagram `연결하기` navigates to this URL. For channels whose resolver returns `null`, `연결하기` calls `onConnectionPending(channel)` and displays inline `연결 준비 중`; it must not navigate. Update `ChannelsPage.tsx` to use the same resolver so OAuth URL construction is not duplicated.

Do not render a confirmation dialog. Submit selected targets directly.

- [ ] **Step 6: Replace the legacy publish-management handoff**

Remove these props and states:

```ts
instagramConnected
publishingOutputId
publishedOutputIds
sendToPublish
isInstagramConnected
```

Load channels once in `AiContentGenerationPage`, keep target results keyed by output ID and `channel:deliveryFormat`, and pass a panel to every completed image output. Blog output renders no publish checkbox and displays `현재 HTML 결과는 SNS 직접 게시를 지원하지 않습니다.`

- [ ] **Step 7: Add responsive styles**

Use stable rows without nested cards:

```css
.ai-publish-panel { display: grid; gap: 12px; border-top: 1px solid var(--line); padding-top: 16px; }
.ai-publish-channel { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(260px, 2fr) auto; gap: 16px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
.ai-publish-channel__identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ai-publish-formats { display: flex; flex-wrap: wrap; gap: 12px; }
.channel-logo { display: block; flex: 0 0 auto; object-fit: contain; }
@media (max-width: 760px) { .ai-publish-channel { grid-template-columns: 1fr; } }
```

- [ ] **Step 8: Run frontend tests and build**

Run:

```bash
npm exec --workspace @brand-pilot/customer-ui vitest run src/features/ai-content/aiContentPublishTargets.test.ts src/components/ai-content/AiContentPublishPanel.test.tsx src/__tests__/aiContentGeneration.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/customer-ui/src/features/ai-content apps/customer-ui/src/features/channels/channelConnectionUrls.ts apps/customer-ui/src/components/ai-content apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx
git commit -m "feat: publish AI content from result details"
```

### Task 8: Apply `ChannelLogo` to existing channel representations

**Files:**
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Modify: `apps/customer-ui/src/pages/AdminChannelsPage.tsx`
- Modify: `apps/customer-ui/src/pages/OnboardingPage.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Modify: `apps/customer-ui/src/pages/InstagramTrendsPage.tsx`
- Modify: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
- Modify: `apps/customer-ui/src/components/publish/ContentArtifactDialog.tsx`
- Modify: corresponding tests in `apps/customer-ui/src/__tests__` and `apps/customer-ui/src/components/publish`

- [ ] **Step 1: Add failing logo-presence assertions**

For each major screen, assert the adjacent text remains and the decorative logo exists:

```tsx
expect(screen.getByText("Instagram")).toBeVisible();
expect(document.querySelector('img[src="/assets/channels/instagram.svg"]')).not.toBeNull();
```

Add at least one assertion for Threads, X, LinkedIn, TikTok and YouTube in the channel page test.

- [ ] **Step 2: Run focused UI tests and verify they fail**

Run:

```bash
npm exec --workspace @brand-pilot/customer-ui vitest run src/__tests__/channels.test.tsx src/__tests__/publishQueue.test.tsx src/__tests__/dashboard.test.tsx src/__tests__/onboarding.test.tsx
```

Expected: FAIL because current views render text only.

- [ ] **Step 3: Replace duplicated channel labels with logo-plus-label UI**

Keep existing `channelLabels` for text and formatting. Wrap each visual label as:

```tsx
<span className="channel-identity">
  <ChannelLogo channel={channel} decorative size={18} />
  <span>{channelLabels[channel]}</span>
</span>
```

Do not add logos to prose sentences, screen-reader-only text, select option text, or chart SVG `<title>` content.

- [ ] **Step 4: Run tests and build**

Run:

```bash
npm exec --workspace @brand-pilot/customer-ui vitest run src/__tests__/channels.test.tsx src/__tests__/adminChannels.test.tsx src/__tests__/publishQueue.test.tsx src/__tests__/dashboard.test.tsx src/__tests__/onboarding.test.tsx src/__tests__/instagramTrends.test.tsx src/components/publish/TopicPublishGroup.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/customer-ui/src/pages apps/customer-ui/src/components/publish apps/customer-ui/src/__tests__
git commit -m "feat: show channel logos across customer UI"
```

### Task 9: Verify recovery, E2E behavior, and real smoke boundaries

**Files:**
- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`
- Modify: `scripts/ai-content-smoke.mjs`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add E2E tests for direct publishing**

Mock the channel and publish APIs. Complete these flows:

1. Open a completed card-news result.
2. Verify six channel rows.
3. Select Instagram 게시글 and 스토리.
4. Click `선택한 2곳에 지금 게시`.
5. Verify no confirmation dialog exists.
6. Verify feed is `게시 완료` and story is `게시 준비 중`.
7. Verify a failed target exposes `다시 시도` without resetting the successful target.

- [ ] **Step 2: Run the E2E test**

Run: `npm run e2e --workspace @brand-pilot/customer-ui -- ai-content-runtime.spec.ts`  
Expected: PASS.

- [ ] **Step 3: Extend the smoke script without publishing by default**

Add explicit flags:

```text
--output-id=60c64d80-9c80-4d63-a5a8-5627cedbf116
--target=instagram_feed_single|instagram_feed_carousel|instagram_story
--latest-completed
--execute
```

With `--latest-completed`, resolve the newest completed image output for the configured smoke-test brand. Without `--execute`, print the resolved account, output, target, and asset URLs only. With `--execute`, call the direct publish endpoint once with a fresh UUID idempotency key and print target statuses and external URLs. Reject execution when more than one target is supplied.

- [ ] **Step 4: Document runtime ownership**

In `docs/ARCHITECTURE.md`, add:

```text
AI 콘텐츠 직접 게시: 중앙 API가 큐 생성 후 1차 게시를 순차 시도한다. 요청 중단 시 로컬 스케줄러의 runDuePublishing이 scheduled 큐를 복구한다. 별도 게시 워커 프로세스는 두지 않는다.
```

- [ ] **Step 5: Run the complete verification set**

Run:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
npm run e2e --workspace @brand-pilot/customer-ui -- ai-content-runtime.spec.ts
node scripts/ai-content-smoke.mjs --latest-completed --target=instagram_feed_carousel
```

Expected:

- all automated tests PASS;
- both builds PASS;
- dry-run smoke prints one connected Instagram account and valid public image URLs;
- no external post is created without `--execute`.

- [ ] **Step 6: Review the final diff for secrets and generated artifacts**

Run:

```bash
git diff --check
git status --short
git diff -- . ':!package-lock.json' | rg -n "sk-|META_APP_SECRET=|access_token|BEGIN PRIVATE KEY"
```

Expected: `git diff --check` has no output and the secret scan has no credential values.

- [ ] **Step 7: Commit**

```bash
git add apps/customer-ui/e2e/ai-content-runtime.spec.ts scripts/ai-content-smoke.mjs docs/ARCHITECTURE.md
git commit -m "test: verify direct AI content publishing"
```
