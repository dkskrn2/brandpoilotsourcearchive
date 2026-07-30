# Content Performance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 최근 30일 콘텐츠 운영 현황과 조회·노출 성과를 보여주는 고객 대시보드를 만들고, 로컬 중앙 API가 매일 03:00 KST에 성과를 수집하게 한다.

**Architecture:** PostgreSQL에 날짜별 누적 성과 스냅샷과 채널별 실행 이력을 저장한다. 기존 로컬 API 스케줄러가 매분 idempotent 수집 진입점을 호출하며, 저장소가 KST 03:00 이후 당일 실행 여부를 DB에서 판정해 재시작 보충 실행과 중복 방지를 함께 처리한다. React는 하나의 집계 API를 호출하며 실제 값이 없는 채널에 샘플 수치를 만들지 않는다.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/Supabase, React 18, React Router, Vitest, CSS

---

## File Map

- Create `db/migrations/031_content_performance_dashboard.sql`: 성과 스냅샷과 동기화 실행 이력.
- Create `apps/api/src/contentPerformance.ts`: KST 실행일, 누적값 파싱, Instagram Insights 호출, 공통 어댑터.
- Create `apps/api/src/contentPerformance.test.ts`: 순수 계산과 Meta 응답 파싱 테스트.
- Modify `apps/api/src/types.ts`: 대시보드 DTO와 저장소 인터페이스.
- Modify `apps/api/src/repository.ts`: 일일 수집 트랜잭션과 최근 30일 집계.
- Modify `apps/api/src/repository.test.ts`: 중복 실행, 부분 실패, 집계 쿼리 테스트.
- Modify `apps/api/src/scheduler.ts` and `scheduler.test.ts`: 기존 로컬 스케줄러에 성과 수집 진입점 추가.
- Modify `apps/api/src/httpServer.ts` and `server.test.ts`: 대시보드 GET API.
- Create `apps/customer-ui/src/pages/DashboardPage.tsx`: 운영 현황 중심 A안.
- Create `apps/customer-ui/src/__tests__/dashboard.test.tsx`: 정상·빈 상태·부분 실패 화면.
- Modify `apps/customer-ui/src/types.ts`: 대시보드 UI 타입.
- Modify `apps/customer-ui/src/lib/apiClient.ts` and `apiClient.test.ts`: 집계 API 클라이언트.
- Modify `apps/customer-ui/src/routes.tsx`, `components/layout/Sidebar.tsx`, `__tests__/navigation.test.tsx`: 기본 진입과 메뉴.
- Modify `apps/customer-ui/src/styles/prototype.css`: 대시보드 반응형 레이아웃.
- Modify `db/smoke/001_schema_smoke.sql` and `scripts/migrations.integration.test.mjs`: 마이그레이션 계약.
- Modify `apps/api/.env.example` and `README.md`: 로컬 스케줄러 실행 조건.

## Task 1: 성과 스키마와 마이그레이션 계약

**Files:**
- Create: `db/migrations/031_content_performance_dashboard.sql`
- Modify: `db/smoke/001_schema_smoke.sql`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: 실패하는 마이그레이션 계약 테스트 작성**

`scripts/migrations.integration.test.mjs`에 다음 계약을 추가한다.

```js
assert.match(schema, /create table content_performance_snapshots/i);
assert.match(schema, /unique \(publish_queue_id, snapshot_date\)/i);
assert.match(schema, /create table performance_sync_runs/i);
assert.match(schema, /unique \(brand_id, channel, run_date\)/i);
```

- [ ] **Step 2: 계약 테스트 실패 확인**

Run: `npm run test:migrations`

Expected: `content_performance_snapshots` 또는 `performance_sync_runs`가 없어 FAIL.

- [ ] **Step 3: 마이그레이션 작성**

`031_content_performance_dashboard.sql`은 아래 핵심 계약을 포함한다.

```sql
create table content_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id),
  channel text not null check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok')),
  publish_queue_id uuid not null references publish_queue(id) on delete cascade,
  channel_output_id uuid not null references channel_outputs(id) on delete cascade,
  external_post_id text not null,
  snapshot_date date not null,
  exposure_count bigint null check (exposure_count is null or exposure_count >= 0),
  raw_metrics jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publish_queue_id, snapshot_date)
);

create index content_performance_brand_channel_date_idx
  on content_performance_snapshots (brand_id, channel, snapshot_date desc);

create table performance_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  brand_id uuid not null references brands(id),
  channel text not null check (channel in ('instagram', 'threads', 'x', 'linkedin', 'youtube', 'tiktok')),
  run_date date not null,
  status text not null check (status in ('running', 'completed', 'partially_failed', 'failed', 'not_configured')),
  target_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  error_summary text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, channel, run_date)
);
```

- [ ] **Step 4: smoke SQL에 테이블·제약 확인 추가**

두 테이블 존재, 두 유일 제약, 채널/date 인덱스를 검증한다.

- [ ] **Step 5: 마이그레이션 테스트 통과 확인**

Run: `npm run test:migrations`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add db/migrations/031_content_performance_dashboard.sql db/smoke/001_schema_smoke.sql scripts/migrations.integration.test.mjs
git commit -m "feat: add content performance schema"
```

## Task 2: 성과 어댑터와 누적값 계산

**Files:**
- Create: `apps/api/src/contentPerformance.ts`
- Create: `apps/api/src/contentPerformance.test.ts`

- [ ] **Step 1: 실패하는 순수 함수 테스트 작성**

```ts
expect(performanceRunDate(new Date("2026-07-15T18:00:00.000Z"))).toBe("2026-07-16");
expect(isPerformanceSyncDue(new Date("2026-07-15T17:59:00.000Z"))).toBe(false);
expect(isPerformanceSyncDue(new Date("2026-07-15T18:00:00.000Z"))).toBe(true);
expect(exposureDelta(120, 100)).toBe(20);
expect(exposureDelta(90, 100)).toBe(0);
expect(exposureDelta(120, null)).toBeNull();
```

Meta 응답은 `values[0].value`와 `total_value.value` 두 형태를 모두 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test --workspace @brand-pilot/api -- contentPerformance.test.ts`

Expected: 모듈이 없어 FAIL.

- [ ] **Step 3: 공통 타입과 계산 함수 구현**

```ts
export type PerformanceChannel = "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok";

export interface PerformanceCollectRequest {
  channel: PerformanceChannel;
  accessToken: string | null;
  graphHost?: "graph.facebook.com" | "graph.instagram.com";
  externalPostId: string;
}

export interface PerformanceCollectResult {
  status: "collected" | "not_configured" | "failed";
  exposureCount: number | null;
  rawMetrics: Record<string, unknown>;
  error?: string;
}

export function exposureDelta(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  return Math.max(0, current - previous);
}
```

KST 날짜와 03:00 판정은 `Intl.DateTimeFormat`의 `Asia/Seoul` 파트를 사용하고 서버 로컬 타임존에 의존하지 않는다.

- [ ] **Step 4: Instagram Insights 수집기 구현**

`GET https://{graphHost}/{apiVersion}/{mediaId}/insights?metric=views&access_token=...` 호출을 구현한다. 응답의 `views`를 `exposureCount`로 매핑하며 토큰을 오류 로그나 `rawMetrics`에 넣지 않는다. 현재 Meta 공식 Instagram API 컬렉션의 Insights `views` 지표를 기준으로 한다.

나머지 채널 어댑터는 `not_configured`를 반환한다. 인증되지 않은 채널에 외부 HTTP 호출을 하지 않는다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/api -- contentPerformance.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/contentPerformance.ts apps/api/src/contentPerformance.test.ts
git commit -m "feat: add content performance adapters"
```

## Task 3: 저장소 수집과 최근 30일 집계

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.test.ts`

- [ ] **Step 1: DTO와 저장소 계약 테스트 작성**

`ApiRepository`에 다음 메서드를 추가하는 테스트부터 작성한다.

```ts
runDailyPerformanceSync(now?: Date): Promise<PerformanceSyncSummaryDto>;
getDashboard(brandId: string): Promise<DashboardDto>;
```

동일 브랜드·채널·KST 날짜 실행이 이미 완료됐으면 다시 외부 수집하지 않는 경우, 한 콘텐츠 실패 후 나머지 콘텐츠를 계속 수집하는 경우, 최신 스냅샷만 요약에 합산하는 경우를 검증한다.

- [ ] **Step 2: 저장소 테스트 실패 확인**

Run: `npm run test --workspace @brand-pilot/api -- repository.test.ts`

Expected: 신규 메서드가 없어 FAIL.

- [ ] **Step 3: 일일 수집 구현**

03:00 KST 이전이면 `status: "not_due"`를 반환한다. 이후에는 활성 브랜드와 `enabled=true` 채널을 조회하고 `performance_sync_runs`를 `on conflict do nothing`으로 선점한다.

각 선점된 실행은 최근 30일의 `publish_queue.status='published'`, 실제 `external_post_id`, 활성 credential을 조회한다. Instagram은 복호화 토큰으로 Task 2 어댑터를 호출하고 결과를 아래처럼 upsert한다.

```sql
insert into content_performance_snapshots (...)
values (...)
on conflict (publish_queue_id, snapshot_date)
do update set exposure_count = excluded.exposure_count,
              raw_metrics = excluded.raw_metrics,
              collected_at = excluded.collected_at,
              updated_at = now();
```

채널별 최종 상태는 모두 성공 `completed`, 일부 실패 `partially_failed`, 전부 실패 `failed`, 어댑터 미설정 `not_configured`로 기록한다.

- [ ] **Step 4: 대시보드 집계 구현**

최근 30일 KST 경계 안에서 다음을 한 저장소 메서드로 반환한다.

```ts
interface DashboardDto {
  period: "30d";
  generatedAt: string;
  lastCollectedAt: string | null;
  summary: {
    publishedCount: number;
    exposureCount: number | null;
    pendingReviewCount: number;
    failedPublishCount: number;
  };
  workflow: { queuedTopics: number; generating: number; pendingReview: number; scheduledOrPublished: number };
  dailyExposure: Array<{ date: string; channels: Partial<Record<Channel, number>> }>;
  channelPerformance: Array<{
    channel: Channel;
    connectionStatus: ChannelStatus;
    publishedCount: number;
    exposureCount: number | null;
    lastCollectedAt: string | null;
    syncStatus: string | null;
  }>;
  topContents: Array<{
    publishQueueId: string;
    title: string;
    channel: Channel;
    deliveryFormat: DeliveryFormat | null;
    publishedAt: string;
    exposureCount: number | null;
    externalUrl: string | null;
  }>;
  attentionItems: Array<{ type: "publish_failed" | "channel_error" | "sync_failed" | "stale_sync"; channel: Channel | null; message: string }>;
}
```

일별 추이는 콘텐츠별 당일값과 직전 스냅샷의 차이를 합산한다. 첫 스냅샷은 기준점이며 증가량에서 제외한다.

- [ ] **Step 5: 저장소 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/api -- repository.test.ts contentPerformance.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add apps/api/src/types.ts apps/api/src/repository.ts apps/api/src/repository.test.ts
git commit -m "feat: collect and aggregate content performance"
```

## Task 4: 로컬 스케줄러와 대시보드 API

**Files:**
- Modify: `apps/api/src/scheduler.ts`
- Modify: `apps/api/src/scheduler.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/.env.example`
- Modify: `README.md`

- [ ] **Step 1: 스케줄러·HTTP 실패 테스트 작성**

`runSchedulerTick`이 매 틱 `runDailyPerformanceSync(now)`을 한 번 호출하는지 확인한다. 저장소가 03:00 이전과 중복 실행을 no-op 처리하므로 스케줄러에는 별도 메모리 플래그를 추가하지 않는다.

`GET /brands/:brandId/dashboard?period=30d`가 저장소 DTO를 반환하고 다른 `period`는 400을 반환하는 테스트를 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test --workspace @brand-pilot/api -- scheduler.test.ts server.test.ts`

Expected: 신규 메서드와 route가 없어 FAIL.

- [ ] **Step 3: 기존 스케줄러에 성과 수집 추가**

```ts
export async function runSchedulerTick(repository: ApiRepository, now = new Date()) {
  const minute = now.getUTCMinutes();
  const result: Record<string, unknown> = {};
  if (minute % 15 === 0) result.sourceCrawl = await repository.crawlDueSources(now);
  if (isDailyGenerationMinute(now)) result.dailyGeneration = await repository.runDailyGeneration(now);
  result.performance = await repository.runDailyPerformanceSync(now);
  result.publishing = await repository.runDuePublishing(now);
  return result;
}
```

기존 `running` 잠금으로 같은 API 프로세스 내 틱 중첩을 막고 DB 유일 키로 다중 프로세스·재시작 중복을 막는다.

- [ ] **Step 4: 대시보드 route 구현**

```ts
app.get<{ Params: { brandId: string }; Querystring: { period?: string } }>(
  "/brands/:brandId/dashboard",
  async (request, reply) => {
    if (request.query.period && request.query.period !== "30d") {
      reply.code(400);
      return { error: "dashboard_period_invalid" };
    }
    return repository.getDashboard(request.params.brandId);
  }
);
```

- [ ] **Step 5: 로컬 실행 문서화**

`apps/api/.env.example`과 README에 아래를 명시한다.

```dotenv
LOCAL_SCHEDULER_ENABLED=true
```

Vercel 인스턴스에서는 `process.env.VERCEL` 분기 때문에 로컬 스케줄러가 시작되지 않는다. 운영 로컬 중앙 API는 항상 하나 이상의 지속 실행 프로세스로 유지한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm run test --workspace @brand-pilot/api -- scheduler.test.ts server.test.ts`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add apps/api/src/scheduler.ts apps/api/src/scheduler.test.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/api/.env.example README.md
git commit -m "feat: schedule daily performance sync locally"
```

## Task 5: React 대시보드와 기본 진입 경로

**Files:**
- Create: `apps/customer-ui/src/pages/DashboardPage.tsx`
- Create: `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.test.ts`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: API 클라이언트와 화면 실패 테스트 작성**

다음을 검증한다.

- `/brands/brand-1/dashboard?period=30d` 요청
- 요약 4개 표시
- 최근 30일 기준일 표시
- 연결 전 채널에 샘플 숫자 대신 `연결 전` 표시
- `exposureCount=null`이면 `데이터 없음`
- 부분 실패 시 정상 채널 성과와 확인 필요 항목 동시 표시
- 사이드바 첫 메뉴가 대시보드
- `/`가 `/dashboard`로 이동

- [ ] **Step 2: UI 테스트 실패 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx apiClient.test.ts navigation.test.tsx`

Expected: 페이지와 API 메서드가 없어 FAIL.

- [ ] **Step 3: 타입과 API 클라이언트 구현**

Task 3의 `DashboardDto`와 동일한 camelCase 타입을 UI에 추가하고 클라이언트에 구현한다.

```ts
getDashboard(brandId: string) {
  return request<Dashboard>(fetcher, `${baseUrl}/brands/${brandId}/dashboard?period=30d`, { method: "GET" });
}
```

- [ ] **Step 4: 운영 현황 중심 A안 구현**

`DashboardPage`는 다음 순서를 유지한다.

1. `전체 현황`과 `최근 30일 · 기준일`
2. 발행 완료, 조회·노출, 검토 필요, 게시 실패
3. 현재 콘텐츠 운영 흐름
4. 일별 조회·노출 추이
5. 채널별 성과와 상위 콘텐츠
6. 확인 필요

차트 의존성을 새로 추가하지 않는다. 일별 데이터는 CSS 높이 기반 막대 또는 접근 가능한 단순 SVG로 표시하고 각 값에 텍스트/`aria-label`을 제공한다.

- [ ] **Step 5: 라우팅과 사이드바 변경**

`DashboardPage` route를 추가하고 index redirect를 `/dashboard`로 변경한다. 사이드바 `navItems` 첫 항목을 `{ label: "대시보드", path: "/dashboard" }`로 둔다. 기존 테스트명 `without dashboard`를 새 IA 계약에 맞게 바꾼다.

- [ ] **Step 6: 반응형 스타일 구현**

데스크톱은 요약 4열과 본문 2열, 좁은 화면은 요약 2열과 본문 1열이다. 기존 색상·간격·카드 반경 토큰을 재사용하고 페이지 섹션을 중첩 카드로 만들지 않는다.

- [ ] **Step 7: UI 테스트와 빌드 통과 확인**

Run: `npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx apiClient.test.ts navigation.test.tsx`

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: PASS.

- [ ] **Step 8: 커밋**

```bash
git add apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/lib/apiClient.test.ts apps/customer-ui/src/routes.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/__tests__/navigation.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat: add customer performance dashboard"
```

## Task 6: 통합 검증과 로컬 스케줄러 활성화

**Files:**
- Modify only if verification exposes a dashboard regression.

- [ ] **Step 1: 정적 검사와 집중 테스트 실행**

```powershell
npm run test:migrations
npm run test --workspace @brand-pilot/api -- contentPerformance.test.ts scheduler.test.ts repository.test.ts server.test.ts
npm run test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx apiClient.test.ts navigation.test.tsx
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/customer-ui
```

Expected: 모두 PASS.

- [ ] **Step 2: 실제 로컬 환경 활성화 확인**

비밀값을 출력하지 않고 `apps/api/.env`에 `LOCAL_SCHEDULER_ENABLED=true`가 있는지만 확인한다. 없으면 로컬 전용 파일에 추가한다. 이 파일은 커밋하지 않는다.

- [ ] **Step 3: 로컬 smoke 확인**

API를 시작해 로그에 `Brand Pilot local scheduler enabled`가 한 번 출력되는지 확인한다. 로그인 세션으로 `/dashboard`를 열어 샘플 숫자 없이 DB 집계 또는 빈 상태가 표시되는지 확인한다.

- [ ] **Step 4: 데스크톱·모바일 화면 확인**

Playwright로 1440×900과 390×844에서 겹침, 잘림, 가로 스크롤, 빈 상태를 확인한다. 시각 문제만 수정하고 기능 범위를 확대하지 않는다.

- [ ] **Step 5: 최종 커밋**

검증에서 수정이 발생한 경우에만 아래 대시보드 관련 파일 중 실제로 변경된 파일을 커밋한다. 수정이 없으면 이 단계는 건너뛴다.

```bash
git add apps/api/src/contentPerformance.ts apps/api/src/contentPerformance.test.ts apps/api/src/scheduler.ts apps/api/src/scheduler.test.ts apps/api/src/repository.ts apps/api/src/repository.test.ts apps/customer-ui/src/pages/DashboardPage.tsx apps/customer-ui/src/__tests__/dashboard.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "fix: harden performance dashboard"
```

## Self-Review

- 설계의 최근 30일 단일 기준, 공통 발행·조회 지표, 추천 제외를 Task 3과 Task 5가 구현한다.
- 03:00 KST, 로컬 API 내부 스케줄러, 재시작 보충 실행, DB 중복 방지를 Task 1·3·4가 구현한다.
- 미연결 채널의 `not_configured`, `NULL`과 `0` 구분, 샘플 금지를 Task 2·3·5가 구현한다.
- 누적 스냅샷 단순 합산 방지와 일별 증가량을 Task 2·3이 검증한다.
- 외부 인증이 없는 다섯 채널은 실제 API를 호출하지 않으며, 개발자 정보가 들어오면 Task 2 어댑터만 확장하면 된다.
- Vercel Cron이나 별도 스케줄러 프로세스를 추가하지 않는다.
