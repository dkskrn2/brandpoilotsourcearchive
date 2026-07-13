# Instagram Story and Reel Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브랜드당 하루 최대 4개 주제를 생성하고, 브랜드가 활성화한 Instagram 카드뉴스·Story·Reel 형식을 순환 선택해 워커 생성부터 고객 검토와 Meta 게시까지 안정적으로 처리한다.

**Architecture:** 중앙 API는 주제 선택, Instagram 형식 순환, 공용 게시 슬롯, 작업 계약만 소유한다. 별도 PC의 워커가 대표 URL을 직접 안전하게 조회하고 형식별 프롬프트로 카드 수 또는 Reel 장면 수를 결정하며, 산출물을 Blob에 저장한다. 게시 계층은 `delivery_format`으로 Meta 어댑터를 분기하고, 고객 UI는 주제 그룹 기준으로 검토와 게시 상태를 표시한다.

**Tech Stack:** Node.js 20+, TypeScript, Fastify, PostgreSQL/Supabase, React 18, Vite, Vitest, Playwright, `sharp`, `cheerio`, `ipaddr.js`, Python 3.11+, FFmpeg/ffprobe, Vercel Blob, Meta Instagram Graph API

---

## 실행 전제와 릴리스 원칙

- 작업 루트는 `C:\Users\dkskr\OneDrive\111\brand_poilot`이다.
- 현재 이 폴더는 `git rev-parse --show-toplevel`에 실패한다. `.git`을 새로 만들거나 다른 저장소를 덮어쓰지 않는다. 각 Task의 커밋 명령은 저장소 메타데이터가 복구된 뒤에만 실행한다.
- 기존 카드뉴스를 먼저 `instagram_feed_carousel` 계약으로 이관하고 회귀 테스트를 통과시킨 뒤 Story, Reel 순서로 활성화한다.
- Story와 Reel은 기본 비활성이다. Story는 capability check가 `available`일 때만 켤 수 있고, Reel은 워커 환경 검증과 비공개 계정 E2E가 통과한 뒤 켠다.
- 중앙 API는 카드 수, Reel 장면 수, Instagram storyboard를 생성하지 않는다.
- 데이터 마이그레이션은 기존 카드뉴스 산출물과 게시 이력을 보존해야 한다.

## 파일 경계

### 새 파일

- `db/migrations/014_instagram_delivery_formats.sql`: 형식 설정, 회전 상태, 주제 게시 그룹, 산출물 형식, 새 작업/아티팩트 타입을 추가하고 기존 데이터를 이관한다.
- `apps/api/src/instagramFormats.ts`: 형식 상수, 활성 형식 순환, 작업 타입 매핑을 담당한다.
- `apps/api/src/instagramFormats.test.ts`: 순환과 기본 형식 규칙을 검증한다.
- `apps/api/src/topicPublishGroups.ts`: 주제 그룹 readiness와 슬롯 배정용 순수 함수를 담당한다.
- `apps/api/src/topicPublishGroups.test.ts`: 하루 4개 주제 제한과 그룹 스케줄 규칙을 검증한다.
- `apps/api/src/instagramCapabilities.ts`: 고객 Meta 연결의 Story capability 상태를 계산한다.
- `apps/api/src/instagramCapabilities.test.ts`: 권한·계정 상태별 capability 결과를 검증한다.
- `workers/brand-pilot-image-worker/src/sourceReader.ts`: 대표 URL SSRF 방어, 제한 조회, 본문 추출을 담당한다.
- `workers/brand-pilot-image-worker/src/sourceReader.test.ts`: 차단 주소, redirect, 크기, MIME, timeout을 검증한다.
- `workers/brand-pilot-image-worker/src/promptBuilder.ts`: `worker-card.v4`, `worker-story.v1`, `worker-reel.v1` 프롬프트를 생성한다.
- `workers/brand-pilot-image-worker/src/promptBuilder.test.ts`: 형식별 계약과 제한된 사실 정책을 검증한다.
- `workers/brand-pilot-image-worker/src/manifest.ts`: 형식별 manifest 파싱과 중복/filler 검증을 담당한다.
- `workers/brand-pilot-image-worker/src/manifest.test.ts`: 장수, 크기, 해시태그, distinct role 검증을 담당한다.
- `workers/brand-pilot-image-worker/src/reelRenderer.ts`: Python renderer 실행과 ffprobe 결과 파싱을 담당한다.
- `workers/brand-pilot-image-worker/src/reelRenderer.test.ts`: 명령 인자와 영상 검증 실패를 담당한다.
- `workers/brand-pilot-image-worker/scripts/render-reel.py`: 세로 이미지 1-5장을 H.264/AAC MP4로 변환한다.
- `workers/brand-pilot-image-worker/scripts/verify-reel.mjs`: 실제 FFmpeg 통합 검증을 수행한다.
- `apps/customer-ui/src/components/ui/VerticalImagePreview.tsx`: Story 9:16 미리보기를 제공한다.
- `apps/customer-ui/src/components/ui/ReelVideoPreview.tsx`: Reel MP4와 길이를 표시한다.
- `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`: 하나의 주제 슬롯 아래 채널·형식 행을 표시한다.

### 주요 수정 파일

- `apps/api/src/types.ts`: delivery format, format settings, topic publish group, worker manifest DTO를 정의한다.
- `apps/api/src/contentGenerator.ts`: Instagram storyboard 생성을 제거하고 Threads·master draft만 중앙에서 생성한다.
- `apps/api/src/imageRenderJobs.ts`: 형식별 작업 payload/result 계약을 검증한다.
- `apps/api/src/repository.ts`: 회전 선택, 일일 4주제 생성, 작업 생성·완료, 그룹 스케줄링을 트랜잭션으로 구현한다.
- `apps/api/src/httpServer.ts`: 형식 설정 및 capability API를 추가한다.
- `apps/api/src/instagramPublisher.ts`: Carousel, Story, Reel 어댑터 dispatcher로 확장한다.
- `workers/brand-pilot-image-worker/src/worker.ts`: 형식별 source→prompt→render→upload 흐름을 조정한다.
- `workers/brand-pilot-image-worker/src/renderer.ts`: 정방형·세로 이미지·Reel scene 출력 계약을 지원한다.
- `workers/brand-pilot-image-worker/src/storage.ts`: MP4, cover, 형식별 manifest 업로드를 지원한다.
- `workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs`: 형식별 프롬프트와 출력 크기를 적용한다.
- `apps/customer-ui/src/types.ts`: 형식 설정, source mode, 주제 그룹 타입을 추가한다.
- `apps/customer-ui/src/lib/apiClient.ts`: 형식 설정과 그룹 API를 연결한다.
- `apps/customer-ui/src/pages/BrandSettingsPage.tsx`: 브랜드 컬러와 전체 Instagram 형식 토글을 제공한다.
- `apps/customer-ui/src/pages/ContentPage.tsx`: 형식별 미리보기와 source mode를 표시한다.
- `apps/customer-ui/src/pages/PublishQueuePage.tsx`: 채널 탭 없이 주제 그룹 테이블을 표시한다.

## Task 0: 기준선과 도구 전제 확인

**Files:**
- Verify: `package.json`
- Verify: `workers/brand-pilot-image-worker/package.json`

- [ ] **Step 1: 현재 기준선 테스트 실행**

Run:

```powershell
cd C:\Users\dkskr\OneDrive\111\brand_poilot
npm test
npm run build
npm run test:contract
```

Expected: 모든 기존 Vitest, TypeScript build, repository contract test가 PASS한다. 기존 실패가 있으면 결과를 기록하고 이 기능 변경과 섞지 않는다.

- [ ] **Step 2: 워커 PC 런타임 확인**

Run:

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
```

Expected: Node.js 20 이상, Python 3.11 이상, FFmpeg와 ffprobe가 모두 exit code 0을 반환한다.

- [ ] **Step 3: Git 상태 확인**

Run: `git rev-parse --show-toplevel`

Expected in current environment: FAIL with `not a git repository`. 구현과 테스트는 진행할 수 있지만 아래 커밋 체크포인트는 저장소 메타데이터가 복구될 때까지 실행하지 않는다.

## Task 1: 데이터베이스 계약과 기존 데이터 이관

**Files:**
- Create: `db/migrations/014_instagram_delivery_formats.sql`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] **Step 1: 실패하는 migration contract test 작성**

`scripts/repository-contract.test.mjs`에 다음 계약을 추가한다.

```js
test("migration 014 defines delivery formats and topic publish groups", async () => {
  const sql = await readFile("db/migrations/014_instagram_delivery_formats.sql", "utf8");
  assert.match(sql, /create table brand_content_formats/i);
  assert.match(sql, /create table brand_format_rotation_states/i);
  assert.match(sql, /create table topic_publish_groups/i);
  assert.match(sql, /add column if not exists delivery_format/i);
  assert.match(sql, /add column if not exists topic_publish_group_id/i);
  assert.match(sql, /instagram_feed_render/);
  assert.match(sql, /instagram_story_render/);
  assert.match(sql, /instagram_reel_render/);
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test:contract`

Expected: FAIL because `014_instagram_delivery_formats.sql` does not exist.

- [ ] **Step 3: migration 작성**

Migration에 다음 계약을 구현한다.

```sql
alter table brand_profiles add column if not exists brand_color text null;

create table brand_content_formats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  format text not null,
  enabled boolean not null default false,
  rotation_order int not null,
  capability_status text not null default 'unchecked',
  capability_checked_at timestamptz null,
  capability_metadata jsonb not null default '{}'::jsonb,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_content_formats_format_check check (format in (
    'instagram_feed_carousel', 'instagram_story', 'instagram_reel'
  )),
  constraint brand_content_formats_capability_check check (capability_status in (
    'available', 'unavailable', 'unchecked', 'needs_attention'
  )),
  constraint brand_content_formats_rotation_check check (rotation_order between 1 and 3),
  constraint brand_content_formats_brand_format_unique unique (brand_id, format)
);

create table brand_format_rotation_states (
  brand_id uuid primary key references brands(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  last_selected_format text null,
  updated_at timestamptz not null default now(),
  constraint brand_format_rotation_last_check check (
    last_selected_format is null or last_selected_format in (
      'instagram_feed_carousel', 'instagram_story', 'instagram_reel'
    )
  )
);

alter table content_topics add column if not exists selected_instagram_format text null;
alter table channel_outputs add column if not exists delivery_format text null;

create table topic_publish_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  content_topic_id uuid not null references content_topics(id) on delete cascade,
  status text not null default 'waiting',
  slot_date date null,
  slot_number int null,
  scheduled_for timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_publish_groups_topic_unique unique (content_topic_id),
  constraint topic_publish_groups_status_check check (
    status in ('waiting', 'ready', 'scheduled', 'partially_published', 'published', 'failed', 'cancelled')
  ),
  constraint topic_publish_groups_slot_check check (slot_number is null or slot_number between 1 and 4)
);

alter table publish_queue
  add column if not exists topic_publish_group_id uuid null references topic_publish_groups(id) on delete cascade;
```

같은 migration 안에서 다음을 수행한다.

1. 기존 브랜드마다 세 형식 행을 삽입하고 feed만 `enabled=true`, `capability_status='available'`로 설정한다.
2. 기존 Instagram output의 `delivery_format`을 `instagram_feed_carousel`, Threads output을 `threads_text`로 backfill한다.
3. 기존 content topic마다 `topic_publish_groups`를 만들고 기존 `publish_queue`를 연결한다.
4. 기존 `instagram_render` job을 `instagram_feed_render`로 변경한다.
5. `jobs_type_check`에 세 render job을 허용하고 기존 `instagram_render`를 제거한다.
6. `storage_artifacts_type_check`에 `rendered_video`, `reel_cover`를 추가한다.
7. 활성 render job unique index를 세 render job 전체에 적용한다.
8. active slot에 대해 `(brand_id, slot_date, slot_number)`가 중복되지 않도록 partial unique index를 만든다.
9. backfill 후 `channel_outputs.delivery_format`을 NOT NULL로 바꾸고 `instagram_feed_carousel`, `instagram_story`, `instagram_reel`, `threads_text`만 허용하는 check constraint를 추가한다.
10. `content_topics.selected_instagram_format`에는 세 Instagram 형식 또는 NULL만 허용하는 check constraint를 추가한다.

- [ ] **Step 4: migration과 보존 검증**

Run:

```powershell
npm run db:migrate
npm run db:migrate
npm run test:contract
```

Expected: 두 번째 migrate도 오류 없이 종료하고 contract test가 PASS한다. 기존 Instagram output 개수와 migration 후 `instagram_feed_carousel` 개수가 같다.

- [ ] **Step 5: Commit checkpoint**

```powershell
git add db/migrations/014_instagram_delivery_formats.sql scripts/repository-contract.test.mjs
git commit -m "feat: add instagram delivery format schema"
```

## Task 2: 공용 형식 타입과 순환 선택 규칙

**Files:**
- Create: `apps/api/src/instagramFormats.ts`
- Create: `apps/api/src/instagramFormats.test.ts`
- Modify: `apps/api/src/types.ts`

- [ ] **Step 1: 순환 규칙의 실패 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { chooseNextInstagramFormat } from "./instagramFormats.js";

describe("chooseNextInstagramFormat", () => {
  it("rotates enabled formats in fixed order", () => {
    const enabled = ["instagram_feed_carousel", "instagram_reel"] as const;
    expect(chooseNextInstagramFormat(enabled, null)).toBe("instagram_feed_carousel");
    expect(chooseNextInstagramFormat(enabled, "instagram_feed_carousel")).toBe("instagram_reel");
    expect(chooseNextInstagramFormat(enabled, "instagram_reel")).toBe("instagram_feed_carousel");
  });

  it("returns null when instagram has no enabled format", () => {
    expect(chooseNextInstagramFormat([], null)).toBeNull();
  });
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- instagramFormats.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: 타입과 순수 함수 구현**

```ts
export const instagramFormats = [
  "instagram_feed_carousel",
  "instagram_story",
  "instagram_reel",
] as const;

export type InstagramDeliveryFormat = (typeof instagramFormats)[number];
export type DeliveryFormat = InstagramDeliveryFormat | "threads_text";

export function chooseNextInstagramFormat(
  enabled: readonly InstagramDeliveryFormat[],
  lastSelected: InstagramDeliveryFormat | null,
): InstagramDeliveryFormat | null {
  const ordered = instagramFormats.filter((format) => enabled.includes(format));
  if (ordered.length === 0) return null;
  const lastIndex = lastSelected ? ordered.indexOf(lastSelected) : -1;
  return ordered[(lastIndex + 1) % ordered.length];
}
```

`types.ts`에는 `BrandContentFormatDto`, `InstagramFormatSettingsDto`, `TopicPublishGroupDto`, 형식별 `ImageRenderJobPayload` union을 추가한다. union의 discriminant는 `deliveryFormat`으로 고정한다.

- [ ] **Step 4: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/api -- instagramFormats.test.ts && npm run build --workspace @brand-pilot/api`

Expected: tests와 TypeScript build가 PASS한다.

- [ ] **Step 5: Commit checkpoint**

```powershell
git add apps/api/src/instagramFormats.ts apps/api/src/instagramFormats.test.ts apps/api/src/types.ts
git commit -m "feat: define instagram format rotation"
```

## Task 3: 브랜드 컬러·형식 설정·Story capability API

**Files:**
- Create: `apps/api/src/instagramCapabilities.ts`
- Create: `apps/api/src/instagramCapabilities.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`

- [ ] **Step 1: API 실패 테스트 작성**

`server.test.ts`에 다음 흐름을 추가한다.

```ts
it("updates brand color and instagram formats", async () => {
  const response = await app.inject({
    method: "PUT",
    url: `/brands/${brandId}/instagram-formats`,
    payload: {
      brandColor: "파란색",
      formats: [
        { format: "instagram_feed_carousel", enabled: true },
        { format: "instagram_story", enabled: false },
        { format: "instagram_reel", enabled: true },
      ],
    },
  });
  expect(response.statusCode).toBe(200);
});

it("rejects story enablement when capability is unavailable", async () => {
  const response = await app.inject({
    method: "PUT",
    url: `/brands/${brandId}/instagram-formats`,
    payload: { formats: [{ format: "instagram_story", enabled: true }] },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe("story_capability_required");
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- server.test.ts instagramCapabilities.test.ts`

Expected: FAIL because repository methods and routes do not exist.

- [ ] **Step 3: capability 계산 구현**

`checkInstagramStoryCapability`는 다음 조건을 모두 만족할 때만 `available`을 반환한다.

```ts
type StoryCapabilityInput = {
  channelStatus: string;
  externalAccountId: string | null;
  credentialStatus: string | null;
  scopes: string[];
  apiVersion: string;
};

const requiredScopes = ["instagram_basic", "instagram_content_publish"];
```

- channel status가 `connected`
- Instagram professional account ID가 존재
- credential status가 `active`
- 두 required scope가 존재

실제 Story 게시 지원은 파일럿 계정에서 비게시 연결 검증과 격리 게시 테스트를 통과한 뒤 `capability_metadata.storyPublishVerified=true`로 저장한다. enabled 조건은 이 값까지 포함한다.

- [ ] **Step 4: repository와 route 구현**

다음 repository 계약을 구현한다.

```ts
listInstagramFormats(brandId: string): Promise<InstagramFormatSettingsDto>;
updateInstagramFormats(brandId: string, input: InstagramFormatSettingsInput): Promise<InstagramFormatSettingsDto>;
checkInstagramCapability(brandId: string, format: InstagramDeliveryFormat): Promise<BrandContentFormatDto>;
```

Route는 다음으로 고정한다.

- `GET /brands/:brandId/instagram-formats`
- `PUT /brands/:brandId/instagram-formats`
- `POST /brands/:brandId/instagram-formats/:format/check`

`brandColor`은 trim 후 최대 30자, 빈 문자열은 `null`로 저장한다. rotation order는 API 입력으로 받지 않는다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/api -- server.test.ts instagramCapabilities.test.ts repository.test.ts`

Expected: format API, capability 차단, 기존 profile API 테스트가 모두 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/api/src/instagramCapabilities.ts apps/api/src/instagramCapabilities.test.ts apps/api/src/repository.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts
git commit -m "feat: manage instagram delivery formats"
```

## Task 4: 브랜드당 하루 4주제와 트랜잭션형 형식 회전

**Files:**
- Create: `apps/api/src/topicPublishGroups.ts`
- Create: `apps/api/src/topicPublishGroups.test.ts`
- Modify: `apps/api/src/contentGenerator.ts`
- Modify: `apps/api/src/contentGenerator.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/scheduler.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
it("generates at most four topics per brand per policy day", async () => {
  repository.generateContent
    .mockResolvedValueOnce({ processed: 1 })
    .mockResolvedValueOnce({ processed: 1 })
    .mockResolvedValueOnce({ processed: 1 })
    .mockResolvedValueOnce({ processed: 1 });
  await repository.runDailyGeneration(new Date("2026-07-13T01:00:00.000Z"));
  expect(repository.generateContent).toHaveBeenCalledTimes(4);
});

it("stops when no usable topic remains", async () => {
  repository.generateContent.mockResolvedValueOnce({ processed: 1 }).mockResolvedValueOnce({ processed: 0 });
  await repository.runDailyGeneration(new Date("2026-07-13T01:00:00.000Z"));
  expect(repository.generateContent).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- scheduler.test.ts repository.test.ts topicPublishGroups.test.ts`

Expected: FAIL because current daily generation calls once per brand and no group helper exists.

- [ ] **Step 3: `generateContent` transaction 변경**

한 transaction 안에서 다음 순서를 지킨다.

1. 브랜드의 오늘 생성된 `content_topics` 수를 `FOR UPDATE` 기준으로 확인하고 4 이상이면 `{ processed: 0, reason: 'daily_topic_limit' }`을 반환한다.
2. 사용 가능한 topic row 또는 crawl topic을 잠근다.
3. `brand_format_rotation_states`를 `SELECT ... FOR UPDATE`로 잠근다.
4. enabled Instagram 형식과 연결된 Threads 상태를 읽는다.
5. 생성 가능한 채널이 없으면 topic row를 소비하지 않고 종료한다.
6. 다음 Instagram 형식을 선택해 `content_topics.selected_instagram_format`에 기록한다.
7. rotation state를 갱신한다.
8. `topic_publish_groups` waiting 행을 즉시 만든다.
9. Instagram output은 빈 storyboard가 아니라 worker input을 참조하는 최소 placeholder로 만들고 render job을 생성한다.
10. Threads output은 기존 중앙 생성 경로로 만든다.

동시 scheduler 두 개가 실행돼도 하나의 topic row와 회전 cursor가 두 번 사용되지 않아야 한다.

- [ ] **Step 4: 중앙 Instagram storyboard 생성 제거**

먼저 `contentGenerator.test.ts`에 다음 회귀 계약을 추가한다.

```ts
it("does not create instagram cards or reel scenes in the central generator", async () => {
  const result = await generateMasterDraftAndTextChannels(input);
  expect(result).toHaveProperty("masterDraft");
  expect(result.channelOutputs.map((output) => output.channel)).toEqual(["threads"]);
  expect(JSON.stringify(result)).not.toMatch(/slides|cards|scenes|assetCount/);
});
```

Run: `npm run test --workspace @brand-pilot/api -- contentGenerator.test.ts`

Expected: FAIL because current `buildChannelOutputs()` creates Instagram slides.

`contentGenerator.ts`에서 Instagram hook/insight/info/evidence slide 배열과 5장 slice를 제거한다. 이 모듈은 master draft와 중앙 텍스트 채널만 반환하고, Instagram output placeholder와 render job payload는 repository가 topic/brand context로 구성한다. worker payload에는 중앙 crawl snapshot의 `extracted_text`, `summary`, `raw_text`를 넣지 않는다.

Run: `npm run test --workspace @brand-pilot/api -- contentGenerator.test.ts`

Expected: central result에 Instagram storyboard 필드가 없고 기존 Threads 생성 테스트가 PASS한다.

- [ ] **Step 5: 일일 반복 구현**

```ts
for (let index = 0; index < 4; index += 1) {
  const result = await this.generateContent(brand.id);
  if (result.processed === 0) break;
  processed += result.processed;
}
```

날짜 경계는 브랜드의 `timezone`을 사용하고, `Asia/Seoul` 기준 정책일 계산을 기존 schedule helper와 공유한다.

- [ ] **Step 6: GREEN과 동시성 검증**

Run: `npm run test --workspace @brand-pilot/api -- contentGenerator.test.ts scheduler.test.ts repository.test.ts topicPublishGroups.test.ts`

Expected: 4주제 제한, 조기 종료, feed→story→reel 회전, 비활성 skip, 동시 호출 중복 방지가 PASS한다.

- [ ] **Step 7: Commit checkpoint**

```powershell
git add apps/api/src/topicPublishGroups.ts apps/api/src/topicPublishGroups.test.ts apps/api/src/contentGenerator.ts apps/api/src/contentGenerator.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/scheduler.test.ts
git commit -m "feat: schedule four topic groups per brand"
```

## Task 5: 형식별 워커 작업 계약과 중앙 manifest 검증

**Files:**
- Modify: `apps/api/src/imageRenderJobs.ts`
- Modify: `apps/api/src/imageRenderJobs.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.imageWorker.test.ts`

- [ ] **Step 1: discriminated union 실패 테스트 작성**

```ts
it("rejects a reel result without video and cover", () => {
  expect(() => parseImageRenderJobResult({
    deliveryFormat: "instagram_reel",
    promptVersion: "worker-reel.v1",
    sourceMode: "direct_url",
    selectedAssetCount: 2,
    scenes: [{ url: "https://blob/1.png", role: "hook" }, { url: "https://blob/2.png", role: "proof" }],
  })).toThrow("reel_video_required");
});

it("rejects more than five carousel cards", () => {
  expect(() => parseImageRenderJobResult(feedResultWith(6))).toThrow("asset_count_out_of_range");
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- imageRenderJobs.test.ts repository.imageWorker.test.ts`

Expected: FAIL because current result contract is image-only.

- [ ] **Step 3: payload 계약 구현**

모든 Instagram render job payload는 아래 공통 필드를 가진다.

```ts
type WorkerSourceMode = "direct_url" | "topic_only" | "url_unavailable";

type InstagramWorkerJobPayload = {
  deliveryFormat: InstagramDeliveryFormat;
  promptVersion: "worker-card.v4" | "worker-story.v1" | "worker-reel.v1";
  topic: {
    title: string;
    angle: string;
    targetCustomer: string | null;
    region: string | null;
    season: string | null;
    notes: string | null;
  };
  brand: {
    name: string;
    industry: string | null;
    primaryCustomer: string | null;
    description: string | null;
    tone: string | null;
    brandColor: string | null;
  };
  representativeUrl: string | null;
  maxImages: 5;
};
```

대표 URL 선택은 crawl topic의 `source_content_items.content_url`을 우선하고, 없으면 topic row `reference_url`을 사용한다. 유효한 HTTP(S) URL 한 개만 payload에 넣는다.

- [ ] **Step 4: result 재검증 구현**

중앙 API는 worker result를 수락하기 전에 다음을 검증한다.

- feed: PNG 1-5개, 모두 1080x1080, caption 존재, hashtag 정확히 5개
- story: PNG 정확히 1개, 1080x1920
- reel: scene PNG 1-5개, cover PNG, MP4, width 1080, height 1920, H.264, AAC, 30fps
- 모든 형식: `sourceMode`, `fetchStatus`, `selectedAssetCount`, 고유 role, `validation.passed=true`

검증 실패 시 job만 `failed`로 기록하고 다른 형식 작업을 만들지 않는다.

`reviewContentOutput(outputId, "regenerate")`는 기존 output의 `delivery_format`을 읽어 같은 format의 새 output과 job만 만든다. feed 실패를 Story/Reel로, Story/Reel 실패를 feed로 바꾸지 않는 repository test를 추가한다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/api -- imageRenderJobs.test.ts repository.imageWorker.test.ts`

Expected: 형식별 정상/실패 manifest와 job type별 claim/complete가 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/api/src/imageRenderJobs.ts apps/api/src/imageRenderJobs.test.ts apps/api/src/repository.ts apps/api/src/repository.imageWorker.test.ts
git commit -m "feat: add format-specific worker contracts"
```

## Task 6: 워커의 안전한 대표 URL 직접 조회

**Files:**
- Create: `workers/brand-pilot-image-worker/src/sourceReader.ts`
- Create: `workers/brand-pilot-image-worker/src/sourceReader.test.ts`
- Modify: `workers/brand-pilot-image-worker/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: dependencies 설치**

Run:

```powershell
npm install cheerio ipaddr.js --workspace @brand-pilot/image-worker
```

Expected: worker package와 root lockfile에 두 dependency가 추가된다.

- [ ] **Step 2: SSRF 실패 테스트 작성**

Test cases를 정확히 포함한다.

```ts
it.each([
  "http://127.0.0.1/admin",
  "http://localhost/admin",
  "http://169.254.169.254/latest/meta-data",
  "http://10.0.0.1/private",
  "http://[::1]/private",
])("blocks non-public address %s", async (url) => {
  await expect(readRepresentativeSource(url, deps)).resolves.toMatchObject({
    sourceMode: "url_unavailable",
    fetchStatus: "source_url_blocked",
  });
});
```

추가 cases: public→private redirect, DNS가 private IP를 반환, redirect 4회, 3MB 초과, `image/png`, timeout, 정상 HTML, 정상 `text/plain`.

- [ ] **Step 3: RED 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- sourceReader.test.ts`

Expected: FAIL because source reader does not exist.

- [ ] **Step 4: source reader 구현**

제약을 상수로 고정한다.

```ts
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ACCEPTED_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];
```

각 최초 URL과 redirect마다 protocol, hostname, DNS resolved IPv4/IPv6를 검증한다. `ipaddr.js` range가 `unicast`가 아니면 차단한다. HTML은 `cheerio`로 `script`, `style`, `nav`, `footer`, form을 제거하고 title, description, main/article/body text를 공백 정규화하여 최대 20,000자로 반환한다. source reader는 form submit, JavaScript 실행, cookie 저장을 하지 않는다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- sourceReader.test.ts`

Expected: 정상 URL은 `direct_url`, URL 없음은 `topic_only`, 차단/실패 URL은 `url_unavailable`로 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add workers/brand-pilot-image-worker/src/sourceReader.ts workers/brand-pilot-image-worker/src/sourceReader.test.ts workers/brand-pilot-image-worker/package.json package-lock.json
git commit -m "feat: fetch worker source urls safely"
```

## Task 7: 포맷별 프롬프트와 adaptive asset count

**Files:**
- Create: `workers/brand-pilot-image-worker/src/promptBuilder.ts`
- Create: `workers/brand-pilot-image-worker/src/promptBuilder.test.ts`
- Create: `workers/brand-pilot-image-worker/src/manifest.ts`
- Create: `workers/brand-pilot-image-worker/src/manifest.test.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs`
- Modify: `workers/brand-pilot-image-worker/src/codexImageOutput.mjs`

- [ ] **Step 1: 프롬프트 계약 실패 테스트 작성**

```ts
it("does not force five feed cards", () => {
  const prompt = buildWorkerPrompt(feedInput);
  expect(prompt).toContain("smallest useful number from 1 to 5");
  expect(prompt).not.toContain("exactly 5 cards");
});

it("uses restricted fact policy without a source", () => {
  const prompt = buildWorkerPrompt({ ...reelInput, sourceMode: "topic_only", sourceText: null });
  expect(prompt).toContain("Do not invent prices, specifications, results, statistics, rankings, or guarantees");
});

it("treats brand color as a hint", () => {
  const prompt = buildWorkerPrompt({ ...storyInput, brand: { ...storyInput.brand, brandColor: "파란색" } });
  expect(prompt).toContain("파란색");
  expect(prompt).toContain("neutral colors are allowed for contrast");
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- promptBuilder.test.ts manifest.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: 세 prompt version 구현**

공통 금지 규칙:

- in-image CTA button, QR, watermark, fake UI chrome 금지
- 원문 문장 복제 금지
- 읽을 수 없는 작은 텍스트 금지
- 같은 hook/summary/CTA-only asset 반복 금지
- URL이 없거나 실패한 경우 검증 가능한 수치·우월성 주장 금지

형식별 출력:

- `worker-card.v4`: `assetCount` 1-5, 1080x1080, distinct `role`, caption, 정확히 5 hashtags
- `worker-story.v1`: `assetCount=1`, 1080x1920, 짧은 embedded copy, interactive sticker 가정 없음
- `worker-reel.v1`: `assetCount` 1-5, 독립된 1080x1920 ordered scenes, caption, 정확히 5 hashtags

- [ ] **Step 4: manifest validator 구현**

role은 빈 문자열을 허용하지 않고 case-insensitive unique여야 한다. 동일 파일 checksum, 동일 normalized text, `cta`만 존재하는 마지막 asset을 reject한다. Story는 한 장 외 결과를 reject한다.

- [ ] **Step 5: Codex image runner 연결**

`run-codex-image-render.mjs`는 job의 `deliveryFormat`을 읽고 prompt builder 결과를 사용한다. 중앙에서 전달받은 `maxImages=5`는 상한으로만 쓰고, 실제 `assetCount`는 worker 결과 manifest가 정한다. 출력 파일명은 feed `card-01.png`, Story `story.png`, Reel `scene-01.png` 형식으로 고정한다.

- [ ] **Step 6: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- promptBuilder.test.ts manifest.test.ts codexImageOutput.test.ts`

Expected: 1장 feed, 3장 feed, 1장 Story, 2장 Reel, 5장 Reel이 PASS하고 6장/중복/filler 결과는 FAIL한다.

- [ ] **Step 7: Commit checkpoint**

```powershell
git add workers/brand-pilot-image-worker/src/promptBuilder.ts workers/brand-pilot-image-worker/src/promptBuilder.test.ts workers/brand-pilot-image-worker/src/manifest.ts workers/brand-pilot-image-worker/src/manifest.test.ts workers/brand-pilot-image-worker/scripts/run-codex-image-render.mjs workers/brand-pilot-image-worker/src/codexImageOutput.mjs
git commit -m "feat: generate adaptive instagram assets"
```

## Task 8: 형식별 렌더링·업로드와 워커 orchestration

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/renderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/renderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/storage.ts`
- Modify: `workers/brand-pilot-image-worker/src/storage.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.ts`
- Modify: `workers/brand-pilot-image-worker/src/worker.test.ts`

- [ ] **Step 1: 형식 dispatcher 실패 테스트 작성**

```ts
it.each([
  ["instagram_feed_carousel", 1080, 1080],
  ["instagram_story", 1080, 1920],
  ["instagram_reel", 1080, 1920],
])("normalizes %s assets to the required dimensions", async (format, width, height) => {
  const result = await renderJob(jobFor(format));
  expect(result.assets.every((asset) => asset.width === width && asset.height === height)).toBe(true);
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- renderer.test.ts storage.test.ts worker.test.ts`

Expected: vertical formats fail against current square-only renderer.

- [ ] **Step 3: worker 흐름 구현**

```text
claim
 -> read representative URL
 -> build format prompt
 -> render images
 -> validate manifest
 -> when Reel, render and verify MP4
 -> upload assets and manifest
 -> complete job with lease token
```

heartbeat은 URL 조회, 이미지 생성, 영상 생성 중에도 유지한다. source fetch 실패는 job 실패가 아니며 manifest에 `url_unavailable`을 기록한다. 이미지 모델 호출 실패, manifest 실패, ffprobe 실패만 기존 retry 정책을 사용한다.

- [ ] **Step 4: Blob 저장 경로 구현**

```text
brands/{brandId}/topics/{contentTopicId}/{deliveryFormat}/{jobId}/
  card-01.png ... manifest.json
  story.png manifest.json
  scene-01.png ... cover.png reel.mp4 manifest.json
```

manifest에는 promptVersion, representativeUrl, sourceMode, fetchStatus, selectedAssetCount, asset roles, dimensions, checksums, validation 결과를 저장한다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- renderer.test.ts storage.test.ts worker.test.ts`

Expected: 세 형식의 claim→render→upload→complete가 mock Blob/API 환경에서 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add workers/brand-pilot-image-worker/src/renderer.ts workers/brand-pilot-image-worker/src/renderer.test.ts workers/brand-pilot-image-worker/src/storage.ts workers/brand-pilot-image-worker/src/storage.test.ts workers/brand-pilot-image-worker/src/worker.ts workers/brand-pilot-image-worker/src/worker.test.ts
git commit -m "feat: dispatch worker rendering by format"
```

## Task 9: Python·FFmpeg Reel 생성과 ffprobe 검증

**Files:**
- Create: `workers/brand-pilot-image-worker/scripts/render-reel.py`
- Create: `workers/brand-pilot-image-worker/scripts/verify-reel.mjs`
- Create: `workers/brand-pilot-image-worker/src/reelRenderer.ts`
- Create: `workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/package.json`

- [ ] **Step 1: wrapper 실패 테스트 작성**

```ts
it("rejects a reel without h264 video and aac audio", async () => {
  const runner = createReelRenderer({
    runPython: vi.fn().mockResolvedValue(undefined),
    probe: vi.fn().mockResolvedValue({ width: 1080, height: 1920, videoCodec: "vp9", audioCodec: null, fps: 30, duration: 6 }),
  });
  await expect(runner.render(input)).rejects.toThrow("invalid_reel_codec");
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/image-worker -- reelRenderer.test.ts`

Expected: FAIL because Reel renderer does not exist.

- [ ] **Step 3: Python renderer 구현**

`render-reel.py` 인자:

```text
--input-dir <absolute path>
--manifest <absolute path>
--output <absolute path/reel.mp4>
--cover <absolute path/cover.png>
--seconds-per-scene 3
--fade-seconds 0.25
--fps 30
```

manifest 순서대로 1-5개 scene을 읽는다. 첫 scene을 cover로 복사한다. FFmpeg filter graph로 각 이미지를 3초 유지하고 인접 장면에 0.25초 `xfade`를 적용한다. `anullsrc=channel_layout=stereo:sample_rate=48000`로 영상 길이와 같은 무음 트랙을 만들고 `libx264`, `yuv420p`, `aac`, `+faststart`, 1080x1920, 30fps로 출력한다.

예상 길이는 `3 * sceneCount - 0.25 * (sceneCount - 1)`이며 ±0.20초만 허용한다.

- [ ] **Step 4: Node wrapper와 probe 구현**

`reelRenderer.ts`는 `python` 프로세스를 shell 없이 argument array로 실행한다. 이어 `ffprobe -v error -show_streams -show_format -of json`을 실행하고 다음을 검증한다.

- width 1080, height 1920
- video codec `h264`
- audio codec `aac`
- 30fps
- 계산된 duration 허용 범위
- MP4 file size > 0

- [ ] **Step 5: 실제 통합 검증 script 추가**

`verify-reel.mjs`는 FFmpeg의 `color` source로 서로 다른 3개 1080x1920 PNG를 만든 뒤 Python renderer를 호출하고 ffprobe 결과를 assert한다. package script를 추가한다.

```json
"verify:reel": "node scripts/verify-reel.mjs"
```

- [ ] **Step 6: GREEN 확인**

Run:

```powershell
npm run test --workspace @brand-pilot/image-worker -- reelRenderer.test.ts
npm run verify:reel --workspace @brand-pilot/image-worker
```

Expected: unit test PASS, 실제 1080x1920 H.264/AAC MP4 생성, 약 8.5초 duration 확인.

- [ ] **Step 7: Commit checkpoint**

```powershell
git add workers/brand-pilot-image-worker/scripts/render-reel.py workers/brand-pilot-image-worker/scripts/verify-reel.mjs workers/brand-pilot-image-worker/src/reelRenderer.ts workers/brand-pilot-image-worker/src/reelRenderer.test.ts workers/brand-pilot-image-worker/package.json
git commit -m "feat: render reel videos with ffmpeg"
```

## Task 10: Meta Carousel·Story·Reel 게시 어댑터

**Files:**
- Modify: `apps/api/src/instagramPublisher.ts`
- Modify: `apps/api/src/instagramPublisher.test.ts`
- Modify: `apps/api/src/metaGraph.ts`
- Modify: `apps/api/src/metaGraph.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.regression-1.test.ts`

- [ ] **Step 1: 형식별 요청 실패 테스트 작성**

```ts
it("creates a reel container without feed sharing", async () => {
  await publishInstagramOutput(reelInput, deps);
  expect(graph.post).toHaveBeenCalledWith(expect.stringContaining("/media"), expect.objectContaining({
    media_type: "REELS",
    video_url: reelInput.videoUrl,
    share_to_feed: false,
  }));
});

it("creates a story container only after capability passes", async () => {
  await expect(publishInstagramOutput(storyInput, { ...deps, storyCapability: "unavailable" }))
    .rejects.toThrow("story_capability_required");
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- instagramPublisher.test.ts metaGraph.test.ts repository.regression-1.test.ts`

Expected: Story/Reel cases fail because only carousel exists.

- [ ] **Step 3: dispatcher와 adapters 구현**

```ts
switch (input.deliveryFormat) {
  case "instagram_feed_carousel":
    return publishInstagramCarousel(input, deps);
  case "instagram_story":
    return publishInstagramStory(input, deps);
  case "instagram_reel":
    return publishInstagramReel(input, deps);
}
```

- Carousel: 기존 children→carousel container→`media_publish` 흐름 유지
- Story: capability verified 확인 후 `media_type=STORIES`, public `image_url`, container status 확인, `media_publish`
- Reel: `media_type=REELS`, public `video_url`, caption, `share_to_feed=false`, container `FINISHED` polling, `media_publish`

polling은 5초 간격, 최대 5분이며 `ERROR` 또는 timeout이면 publish attempt를 실패 처리하고 pending container를 publish하지 않는다.

- [ ] **Step 4: 게시 오류 분류 구현**

token/permission 오류는 channel을 `needs_attention`으로 바꾼다. transient 5xx/429만 기존 retry 대상으로 둔다. invalid media, capability, codec, public URL 오류는 non-retryable safe code를 `publish_attempts.error_code`에 저장한다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/api -- instagramPublisher.test.ts metaGraph.test.ts repository.regression-1.test.ts`

Expected: Carousel 회귀, Story capability gate, Reel polling/timeout/`share_to_feed=false`가 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/api/src/instagramPublisher.ts apps/api/src/instagramPublisher.test.ts apps/api/src/metaGraph.ts apps/api/src/metaGraph.test.ts apps/api/src/repository.ts apps/api/src/repository.regression-1.test.ts
git commit -m "feat: publish instagram stories and reels"
```

## Task 11: 주제 그룹 단위 게시 슬롯과 독립 실패 처리

**Files:**
- Modify: `apps/api/src/publishSchedule.ts`
- Modify: `apps/api/src/publishSchedule.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/server.test.ts`

- [ ] **Step 1: 그룹 슬롯 실패 테스트 작성**

```ts
it("assigns one slot to all ready outputs in a topic group", async () => {
  const scheduled = await repository.schedulePublishQueue(brandId, now);
  const rows = scheduled.items.filter((item) => item.topicPublishGroupId === groupId);
  expect(new Set(rows.map((row) => row.scheduledFor)).size).toBe(1);
  expect(new Set(rows.map((row) => row.slotNumber)).size).toBe(1);
});

it("counts four topic groups rather than channel queue rows", async () => {
  expect(await countScheduledTopicGroups(brandId, policyDate)).toBe(4);
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/api -- publishSchedule.test.ts repository.test.ts`

Expected: FAIL because current scheduler assigns slots per channel queue row.

- [ ] **Step 3: readiness와 스케줄 구현**

그룹의 output이 다음 중 하나가 되면 결정 완료로 본다.

- 승인됐고 게시 queue가 생성됨
- rejected
- render_failed 또는 publish 불가능한 terminal failure

`pending_review`, `rendering`, `regenerating`이 하나라도 있으면 그룹은 waiting이다. ready 그룹에만 다음 공용 slot을 배정한다. 승인된 각 queue row는 동일 `topic_publish_group_id`, `slot_date`, `slot_number`, `scheduled_for`를 받는다. 실패·거절 output은 다른 승인 output을 막지 않는다.

- [ ] **Step 4: overflow와 재시도 구현**

한 정책일에 active topic group 4개만 허용한다. 초과 그룹은 다음날 첫 빈 슬롯으로 이월한다. Story/Reel publish 실패는 동일 형식으로만 재시도하고 feed로 변경하지 않는다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/api -- publishSchedule.test.ts repository.test.ts scheduler.test.ts server.test.ts`

Expected: 같은 주제의 Instagram/Threads가 같은 시간, 4개 그룹 제한, overflow 이월, 한 output 실패 시 나머지 게시가 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/api/src/publishSchedule.ts apps/api/src/publishSchedule.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/types.ts apps/api/src/server.test.ts
git commit -m "feat: schedule publishing by topic group"
```

## Task 12: 고객 UI 형식 설정과 미리보기

**Files:**
- Create: `apps/customer-ui/src/components/ui/VerticalImagePreview.tsx`
- Create: `apps/customer-ui/src/components/ui/ReelVideoPreview.tsx`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Modify: `apps/customer-ui/src/pages/ContentPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/content.test.tsx`

- [ ] **Step 1: UI 실패 테스트 작성**

```tsx
it("saves one brand color and global instagram format toggles", async () => {
  renderPage();
  await user.type(screen.getByLabelText("브랜드 주색"), "파란색");
  await user.click(screen.getByRole("switch", { name: "Reel" }));
  await user.click(screen.getByRole("button", { name: "저장" }));
  expect(api.updateInstagramFormats).toHaveBeenCalledWith(brandId, expect.objectContaining({
    brandColor: "파란색",
  }));
});

it("shows why Story cannot be enabled", async () => {
  renderPageWithStoryCapability("unavailable");
  expect(screen.getByRole("switch", { name: "Story" })).toBeDisabled();
  expect(screen.getByText(/Meta 연결 확인이 필요합니다/)).toBeVisible();
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx content.test.tsx`

Expected: FAIL because format setting and vertical/video preview do not exist.

- [ ] **Step 3: Brand Settings 구현**

- 주색 text input 한 개, 최대 30자
- Card News, Story, Reel 세 Switch
- 고정 순환 순서 표시
- Story capability가 available이 아니면 disabled와 원인 표시
- 적어도 하나의 Instagram 형식을 강제하지 않는다. Threads만 연결된 브랜드도 허용한다.
- 채널별 자동 승인 switch는 추가하지 않는다. 기존 브랜드 전체 auto approval on/off만 유지한다.

- [ ] **Step 4: Content Review 구현**

- feed: 기존 `SquareCarouselPreview`
- Story: `aspect-ratio: 9 / 16`의 image preview
- Reel: controls가 있는 `<video preload="metadata">`, duration 표시
- format badge와 source mode 표시
- regenerate 요청은 현재 `deliveryFormat`을 유지

- [ ] **Step 5: GREEN과 build 확인**

Run:

```powershell
npm run test --workspace @brand-pilot/customer-ui -- brandSettings.test.tsx content.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: UI tests와 TypeScript/Vite build가 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/customer-ui/src/components/ui/VerticalImagePreview.tsx apps/customer-ui/src/components/ui/ReelVideoPreview.tsx apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/pages/BrandSettingsPage.tsx apps/customer-ui/src/pages/ContentPage.tsx apps/customer-ui/src/__tests__/brandSettings.test.tsx apps/customer-ui/src/__tests__/content.test.tsx
git commit -m "feat: configure and review instagram formats"
```

## Task 13: 게시관리의 주제 그룹 테이블

**Files:**
- Create: `apps/customer-ui/src/components/publish/TopicPublishGroup.tsx`
- Modify: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/__tests__/publishQueue.test.tsx`

- [ ] **Step 1: 그룹 테이블 실패 테스트 작성**

```tsx
it("shows one scheduled time per topic and child channel formats", async () => {
  renderPageWith([topicGroupWith("instagram_reel", "threads_text")]);
  expect(screen.getAllByText("7월 14일 11:30")).toHaveLength(1);
  expect(screen.getByText("Instagram · Reel")).toBeVisible();
  expect(screen.getByText("Threads · 텍스트")).toBeVisible();
});
```

- [ ] **Step 2: RED 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx`

Expected: FAIL because the page renders flat channel rows.

- [ ] **Step 3: API 응답과 UI 구현**

`GET /brands/:brandId/publish-queue` 응답을 `TopicPublishGroupDto[]`로 바꾼다. 각 group은 topic title, shared scheduled time, slot status와 child outputs를 가진다. 화면에는 채널 탭을 추가하지 않고 전체 그룹을 시간순 표로 표시한다. child row에는 형식, 독립 status, artifact download, external URL, failure reason을 표시한다.

- [ ] **Step 4: 완료 결과 일괄 다운로드 유지**

기존 완료 결과 다운로드는 group UI 상단의 전체 선택과 함께 유지한다. 선택 대상은 published child output이며 MP4, PNG package, caption manifest를 모두 포함한다.

- [ ] **Step 5: GREEN 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- publishQueue.test.tsx && npm run build --workspace @brand-pilot/customer-ui`

Expected: group rendering, 독립 실패, 일괄 다운로드, build가 PASS한다.

- [ ] **Step 6: Commit checkpoint**

```powershell
git add apps/customer-ui/src/components/publish/TopicPublishGroup.tsx apps/customer-ui/src/pages/PublishQueuePage.tsx apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/types.ts apps/customer-ui/src/__tests__/publishQueue.test.tsx
git commit -m "feat: group publish management by topic"
```

## Task 14: 통합 검증과 단계별 활성화

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md`
- Modify: `apps/customer-ui/e2e` tests matching the existing Playwright layout

- [ ] **Step 1: 전체 자동 검증**

Run:

```powershell
cd C:\Users\dkskr\OneDrive\111\brand_poilot
npm run db:migrate
npm test
npm run build
npm run test:contract
npm run verify:reel --workspace @brand-pilot/image-worker
```

Expected: 모든 명령 exit code 0.

- [ ] **Step 2: adaptive 카드 수 품질 검증**

서로 다른 정보 밀도의 5개 topic으로 feed job을 실행한다. acceptance:

- 적어도 한 결과가 1-4장
- 어떤 결과도 5장을 채우기 위한 반복 card가 없음
- caption 줄바꿈 정상
- hashtag 정확히 5개
- 브랜드 주색이 시각 참고값으로 보이되 중립색 대비가 유지됨
- CTA 버튼 모양이나 `자세히 확인하기` 문구가 이미지에 없음

- [ ] **Step 3: Story 격리 검증**

파일럿 테스트 브랜드에서 capability check를 실행하고 available을 확인한다. Story 한 건을 생성해 1080x1920 public PNG, worker manifest, 검토 preview를 확인한 뒤 비공개 테스트 계정에 한 건만 게시한다. 게시 성공 전 고객 브랜드의 Story toggle은 활성화하지 않는다.

- [ ] **Step 4: Reel 격리 E2E**

대표 URL이 있는 주제와 없는 주제를 각각 한 건 실행한다. acceptance:

- source mode가 각각 `direct_url`, `topic_only`
- 1-5 scene
- 1080x1920, H.264, AAC, 30fps
- 각 scene 3초, fade 0.25초
- 첫 scene cover
- `share_to_feed=false`
- Meta container가 `FINISHED` 후 publish
- Reels 탭 게시 성공

- [ ] **Step 5: 하루 4주제 정책 검증**

Instagram 세 형식과 Threads를 활성화한 테스트 브랜드에서 daily generation을 실행한다. content topic은 정확히 최대 4개이고, Instagram output 최대 4개와 Threads output 최대 4개가 생겨도 topic group과 slot은 최대 4개여야 한다. Instagram 형식은 `feed_carousel → story → reel → feed_carousel` 순서여야 한다.

- [ ] **Step 6: 문서 갱신**

README에 worker prerequisites, format job types, FFmpeg 확인 명령, Story capability gate를 기록한다. MVP 문서의 “채널별 하루 최대 4개” 표현을 “브랜드당 전체 채널 공용 주제 큐 하루 최대 4개”로 교체한다.

- [ ] **Step 7: 최종 Commit checkpoint**

```powershell
git add README.md docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md apps/customer-ui/e2e
git commit -m "docs: document instagram multi-format delivery"
```

## 완료 조건

- 브랜드별 주제 생성이 정책일 기준 최대 4개로 제한된다.
- 활성 Instagram 형식이 고정 순서로 순환하고 disabled 형식은 건너뛴다.
- 중앙 API가 Instagram card/scene 수와 storyboard를 결정하지 않는다.
- 워커가 대표 URL 최대 한 개를 직접 안전하게 조회하고 세 source mode를 기록한다.
- 카드뉴스와 Reel은 내용에 맞춰 1-5개 asset을 사용하며 filler asset을 거부한다.
- Story는 한 장의 9:16 이미지이고 capability gate 없이는 자동 게시되지 않는다.
- Reel은 별도 prompt로 생성한 1-5개 세로 scene을 Python/FFmpeg로 무음 MP4로 만들고 `share_to_feed=false`로 게시한다.
- 브랜드 주색은 하나의 선택적 시각 참고값으로 전달된다.
- 같은 주제의 승인된 채널 결과물은 하나의 공용 슬롯을 공유하고 각 게시 결과는 독립 기록된다.
- 기존 Instagram carousel 게시와 완료 결과 다운로드에 회귀가 없다.

## 공식 API 확인 기준

- Meta 공식 Instagram API collection의 [Reels Publishing](https://www.postman.com/meta/instagram/folder/23987686-8cdc2637-eebc-4770-aa59-7b0a0bba5a64)은 public `video_url`, `media_type=REELS`, container `FINISHED` 확인, `media_publish`, `share_to_feed=false` 흐름을 명시한다.
- Meta 공식 Instagram API collection의 [Create a video container](https://www.postman.com/meta/instagram/request/23987686-8d93f052-4c50-4cef-b23e-57732bf370f3)은 `media_type=STORIES`와 public `image_url` 또는 `video_url` container 생성을 명시한다.
- 실제 구현 시 앱이 사용하는 Facebook Login/Instagram Login 방식과 Graph host를 현재 `metaGraph.ts` 설정에 맞춰 하나로 유지하고, 같은 브랜드 요청 안에서 두 로그인 방식의 endpoint를 혼용하지 않는다.
