# 자동 소스 크롤링 구현 계획

> **에이전트 작업 필수 하위 스킬:** 이 계획을 항목별로 구현할 때 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`를 사용한다. 모든 코드 변경은 `superpowers:test-driven-development`를 따른다. 현재 `.git`이 유효한 저장소로 인식되지 않으므로 커밋 단계는 Git 복구 전까지 생략하고 각 작업의 검증 결과를 기록한다.

**목표:** 신규 URL은 등록 직후 한 번 크롤링하고, 이후에는 URL별 마지막 성공 시각에서 72시간이 지난 항목을 Vercel Cron이 자동으로 크롤링한다.

**구조:** Vercel Cron은 15분마다 보안이 적용된 Fastify 내부 엔드포인트를 호출한다. API는 Supabase의 URL별 실행 이력과 잠금을 사용해 72시간 경과 대상과 재시도 대상만 최대 5개씩 처리한다. 기존 크롤링 알고리즘은 소스 한 개 단위 함수로 추출해 신규·정기·수동 실행이 공유한다.

**기술 스택:** TypeScript, Fastify, PostgreSQL/Supabase, Vercel Cron, React/Vite, Vitest, Node test

---

## 파일 구조

### 생성

- `db/migrations/012_source_crawl_runs.sql`: URL별 실행 이력, 재시도와 중복 방지 스키마
- `apps/api/src/sourceCrawlSchedule.ts`: 72시간 대상 판정, 재시도 시각, KST 실행 키 계산
- `apps/api/src/sourceCrawlSchedule.test.ts`: 순수 스케줄 규칙 단위 테스트

### 수정

- `db/smoke/001_schema_smoke.sql`: 새 테이블·인덱스 확인
- `db/README.md`: 012 적용 명령과 운영 적용 주의
- `apps/api/src/types.ts`: 크롤링 실행 DTO와 repository 계약
- `apps/api/src/repository.ts`: 단일·기한 도래·전체 크롤링과 실행 이력
- `apps/api/src/repository.test.ts`: 단일 URL, 72시간, 중복·재시도 테스트
- `apps/api/src/httpServer.ts`: Cron 인증, 신규 URL 초기 크롤링, 실행 이력 API
- `apps/api/src/server.test.ts`: API 계약 테스트
- `apps/api/src/index.ts`: `CRON_SECRET` 주입
- `apps/api/vercel.json`: 15분 Cron 등록
- `apps/api/.env.example`: Cron 및 크롤링 제한 환경 변수
- `apps/customer-ui/src/types.ts`: 초기 크롤링 결과와 실행 이력 타입
- `apps/customer-ui/src/lib/apiClient.ts`: 변경된 생성 응답과 실행 이력 API
- `apps/customer-ui/src/pages/SourcesPage.tsx`: 초기 크롤링 결과와 최근 자동 실행 표시
- `apps/customer-ui/src/__tests__/sources.test.tsx`: UI 회귀 테스트
- `scripts/repository-contract.test.mjs`: 012·Cron·환경설정 계약
- `README.md`: 자동 크롤링 운영 방법
- `docs/VERCEL_CENTRAL_API_DEPLOYMENT.md`: production Cron 설정과 검증

---

### 작업 1: 마이그레이션과 저장소 계약을 RED로 고정

**파일:**
- 수정: `scripts/repository-contract.test.mjs`
- 수정: `db/smoke/001_schema_smoke.sql`
- 생성: `db/migrations/012_source_crawl_runs.sql`
- 수정: `db/README.md`

- [ ] **1단계: 마이그레이션·Cron 계약 테스트를 먼저 추가**

`scripts/repository-contract.test.mjs`의 마이그레이션 배열을 전체 파일명 비교로 강화하고 다음 테스트를 추가한다.

```js
test("자동 크롤링 마이그레이션과 Vercel Cron을 등록한다", async () => {
  const migrations = (await readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "001_initial_schema.sql",
    "002_source_content_items.sql",
    "003_topic_rows_duplicate_policy.sql",
    "004_channel_connection_requests.sql",
    "005_content_topic_source_url_unique.sql",
    "006_image_render_jobs.sql",
    "007_kakao_auth.sql",
    "008_auto_approval_default.sql",
    "009_support_requests.sql",
    "010_remove_webflow.sql",
    "011_add_social_channels.sql",
    "012_source_crawl_runs.sql"
  ]);

  const vercel = await readJson("apps/api/vercel.json");
  assert.deepEqual(vercel.crons, [{ path: "/internal/cron/source-crawl", schedule: "*/15 * * * *" }]);

  const envExample = await readFile("apps/api/.env.example", "utf8");
  assert.match(envExample, /^CRON_SECRET=$/m);
  assert.match(envExample, /^SOURCE_CRAWL_BATCH_SIZE=5$/m);
  assert.match(envExample, /^SOURCE_CRAWL_DISCOVERY_LIMIT=20$/m);
  assert.match(envExample, /^SOURCE_CRAWL_TIME_BUDGET_MS=45000$/m);
});
```

- [ ] **2단계: 계약 테스트가 실패하는지 확인**

실행: `npm run test:contract`

예상: `012_source_crawl_runs.sql`, `vercel.crons`, `CRON_SECRET`이 없어 실패한다.

- [ ] **3단계: 마이그레이션 작성**

`db/migrations/012_source_crawl_runs.sql`:

```sql
create table source_crawl_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  source_url_id uuid not null references source_urls(id) on delete cascade,
  parent_run_id uuid null references source_crawl_runs(id) on delete set null,
  trigger text not null,
  status text not null default 'queued',
  run_key text not null,
  attempt integer not null default 0,
  processed_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  started_at timestamptz null,
  finished_at timestamptz null,
  next_retry_at timestamptz null,
  last_error text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_crawl_runs_trigger_check check (trigger in ('new_source', 'scheduled', 'manual', 'retry')),
  constraint source_crawl_runs_status_check check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'abandoned')),
  constraint source_crawl_runs_attempt_check check (attempt between 0 and 3),
  constraint source_crawl_runs_counts_check check (
    processed_count >= 0 and created_count >= 0 and updated_count >= 0 and failed_count >= 0
  )
);

create unique index source_crawl_runs_run_key_unique on source_crawl_runs(run_key);
create unique index source_crawl_runs_one_running_per_source_unique
  on source_crawl_runs(source_url_id)
  where status = 'running';
create index source_crawl_runs_brand_created_idx on source_crawl_runs(brand_id, created_at desc);
create index source_crawl_runs_retry_due_idx on source_crawl_runs(next_retry_at)
  where status in ('failed', 'partial') and next_retry_at is not null;

create trigger source_crawl_runs_set_updated_at
  before update on source_crawl_runs
  for each row execute function set_updated_at();
```

- [ ] **4단계: 스키마 smoke 목록 갱신**

`expected_tables`에 `'source_crawl_runs'`, `expected_indexes`에 다음 세 인덱스를 추가한다.

```sql
'source_crawl_runs_run_key_unique',
'source_crawl_runs_one_running_per_source_unique',
'source_crawl_runs_retry_due_idx'
```

- [ ] **5단계: DB 문서에 012 적용 명령 추가**

```powershell
docker compose exec -T postgres psql -U brand_pilot -d brand_pilot -v ON_ERROR_STOP=1 -f /migrations/012_source_crawl_runs.sql
```

운영 Supabase에는 적용 이력을 확인한 뒤 012만 한 번 적용한다는 문장을 추가한다.

- [ ] **6단계: 계약 테스트의 마이그레이션 항목 통과 확인**

실행: `npm run test:contract`

예상: 아직 Vercel 설정·환경 변수 항목만 실패한다.

---

### 작업 2: 72시간·재시도 규칙을 순수 함수로 구현

**파일:**
- 생성: `apps/api/src/sourceCrawlSchedule.ts`
- 생성: `apps/api/src/sourceCrawlSchedule.test.ts`

- [ ] **1단계: 스케줄 규칙 RED 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { isSourceCrawlDue, nextRetryAt, scheduledRunKey } from "./sourceCrawlSchedule.js";

describe("source crawl schedule", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");

  it("includes a source after 72 hours", () => {
    expect(isSourceCrawlDue("2026-07-09T00:00:00.000Z", now)).toBe(true);
    expect(isSourceCrawlDue("2026-07-09T00:00:01.000Z", now)).toBe(false);
  });

  it("does not use null as a scheduled first crawl", () => {
    expect(isSourceCrawlDue(null, now)).toBe(false);
  });

  it("uses 15 minutes, 1 hour, and 6 hours for retries", () => {
    expect(nextRetryAt(1, now).toISOString()).toBe("2026-07-12T00:15:00.000Z");
    expect(nextRetryAt(2, now).toISOString()).toBe("2026-07-12T01:00:00.000Z");
    expect(nextRetryAt(3, now).toISOString()).toBe("2026-07-12T06:00:00.000Z");
    expect(nextRetryAt(4, now)).toBeNull();
  });

  it("creates a stable KST date key per source", () => {
    expect(scheduledRunKey("source-1", new Date("2026-07-11T23:05:00.000Z")))
      .toBe("scheduled:source-1:2026-07-12");
  });
});
```

- [ ] **2단계: 테스트 실패 확인**

실행: `npm test --workspace @brand-pilot/api -- src/sourceCrawlSchedule.test.ts`

예상: 모듈이 없어 실패한다.

- [ ] **3단계: 순수 함수 구현**

```ts
const crawlIntervalMs = 72 * 60 * 60 * 1000;
const retryDelayMs = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000] as const;

export function isSourceCrawlDue(lastSuccessfulAt: string | null, now = new Date()) {
  if (!lastSuccessfulAt) return false;
  const timestamp = Date.parse(lastSuccessfulAt);
  return Number.isFinite(timestamp) && now.getTime() - timestamp >= crawlIntervalMs;
}

export function nextRetryAt(attempt: number, now = new Date()) {
  const delay = retryDelayMs[attempt - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

export function kstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function scheduledRunKey(sourceId: string, now = new Date()) {
  return `scheduled:${sourceId}:${kstDate(now)}`;
}
```

- [ ] **4단계: 스케줄 테스트 통과 확인**

실행: `npm test --workspace @brand-pilot/api -- src/sourceCrawlSchedule.test.ts`

예상: 4/4 통과.

---

### 작업 3: 크롤러를 단일 URL 실행 단위로 분리

**파일:**
- 수정: `apps/api/src/types.ts`
- 수정: `apps/api/src/repository.ts`
- 수정: `apps/api/src/repository.test.ts`

- [ ] **1단계: API 타입 계약 추가**

`apps/api/src/types.ts`에 다음 타입을 추가한다.

```ts
export type SourceCrawlTrigger = "new_source" | "scheduled" | "manual" | "retry";
export type SourceCrawlRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "abandoned";

export interface SourceCrawlRunDto extends PipelineRunResult {
  id: string;
  brandId: string;
  sourceUrlId: string;
  trigger: SourceCrawlTrigger;
  status: SourceCrawlRunStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
}

export interface AutomaticCrawlResult extends PipelineRunResult {
  brandsSelected: number;
  runsStarted: number;
  status: "succeeded" | "partial" | "failed";
}

export interface SourceCreateResult {
  source: SourceDto;
  initialCrawl: SourceCrawlRunDto;
}
```

`ApiRepository`를 다음 계약으로 확장한다.

```ts
createSourceWithInitialCrawl(brandId: string, input: SourceInput): Promise<SourceCreateResult>;
crawlSingleSource(brandId: string, sourceId: string, trigger: SourceCrawlTrigger): Promise<SourceCrawlRunDto>;
crawlDueSources(now?: Date): Promise<AutomaticCrawlResult>;
listSourceCrawlRuns(brandId: string): Promise<SourceCrawlRunDto[]>;
```

- [ ] **2단계: 단일 소스와 72시간 대상 RED 테스트 작성**

`repository.test.ts`에 다음 동작을 실제 SQL 호출 기준으로 추가한다.

```ts
it("crawls only the requested source", async () => {
  const repository = createRepository(pool as any);
  const result = await repository.crawlSingleSource("brand-1", "source-1", "new_source");
  expect(result.sourceUrlId).toBe("source-1");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("where id = $1 and brand_id = $2"), ["source-1", "brand-1"]);
});

it("selects only sources whose last successful snapshot is at least 72 hours old", async () => {
  const repository = createRepository(pool as any);
  await repository.crawlDueSources(new Date("2026-07-12T00:00:00.000Z"));
  const dueQuery = query.mock.calls.find(([sql]) => String(sql).includes("interval '72 hours'"));
  expect(dueQuery?.[0]).toContain("limit $1");
});
```

테스트의 mock은 source 조회, run 생성, snapshot 조회와 기존 크롤러 호출에 필요한 행을 명시적으로 반환한다.

- [ ] **3단계: 기존 `crawlSources` 내부 루프를 단일 소스 함수로 추출**

`createRepository` 내부에 다음 경계를 만든다.

```ts
async function crawlSourceRow(source: Record<string, any>, discoveryLimit: number): Promise<PipelineRunResult> {
  // 기존 crawlSources의 seed fetch, discoverContentUrls, snapshot 저장,
  // source_content_items 갱신, topic enqueue 로직을 이 함수로 이동한다.
  // discoverContentUrls 결과에는 slice(0, discoveryLimit)를 적용한다.
}
```

기존 SQL과 오류 처리 본문은 변경하지 않고 `sources.rows` 반복만 호출자로 이동한다.

- [ ] **4단계: 실행 이력 생성·완료 helper 구현**

```ts
async function startSourceCrawlRun(input: {
  source: Record<string, any>;
  trigger: SourceCrawlTrigger;
  runKey: string;
  attempt: number;
  parentRunId?: string;
}) {
  return pool.query(
    `insert into source_crawl_runs (
       workspace_id, brand_id, source_url_id, parent_run_id, trigger, status, run_key, attempt, started_at
     ) values ($1, $2, $3, $4, $5, 'running', $6, $7, now())
     on conflict (run_key) do nothing
     returning *`,
    [input.source.workspace_id, input.source.brand_id, input.source.id, input.parentRunId ?? null, input.trigger, input.runKey, input.attempt]
  );
}
```

완료 helper는 `PipelineRunResult`를 받아 `succeeded`, `partial`, `failed`, `abandoned`를 계산하고 `nextRetryAt`을 저장한다.

- [ ] **5단계: public repository 메서드 구현**

- `crawlSingleSource`: source 한 개 조회 → run 생성 → `crawlSourceRow` → run 완료
- `crawlDueSources`: 아래 SQL로 최대 batch size만 조회하고 순차 처리
- `crawlSources`: 기존 수동 전체 실행을 유지하되 각 source를 `manual` run으로 처리
- `createSourceWithInitialCrawl`: 기존 `createSource` 저장 후 `crawlSingleSource(..., "new_source")`
- `listSourceCrawlRuns`: 최근 50개를 `created_at desc`로 반환

기한 도래 조회의 핵심 SQL:

```sql
select su.id, su.workspace_id, su.brand_id, su.url
from source_urls su
join lateral (
  select max(ss.fetched_at) as last_success_at
  from source_snapshots ss
  where ss.source_url_id = su.id and ss.status = 'succeeded'
) latest on true
where su.enabled = true
  and su.deleted_at is null
  and su.status != 'disabled'
  and latest.last_success_at <= $1::timestamptz - interval '72 hours'
  and not exists (
    select 1 from source_crawl_runs r
    where r.source_url_id = su.id and r.status = 'running'
  )
  and not exists (
    select 1 from source_crawl_runs abandoned
    where abandoned.source_url_id = su.id
      and abandoned.status = 'abandoned'
      and abandoned.created_at > latest.last_success_at
  )
order by latest.last_success_at asc
limit $2
```

이 조회 뒤 `next_retry_at <= now()`인 실패 run의 source를 합치고 source ID 중복을 제거한다. 재시도 실행은 원본 ID를 `parent_run_id`에 저장하고 `attempt + 1`을 사용한다. 세 번째 재시도도 실패하면 그 run을 `abandoned`로 완료하고 `next_retry_at`을 null로 둔다.

Cron 시작 시 30분 이상 `running`인 행은 `failed`, `last_error = 'crawl_run_stale'`, `next_retry_at = now()`로 전환한다. URL별 running 유니크 인덱스 충돌은 이미 실행 중이라는 뜻이므로 오류로 전파하지 않고 해당 URL을 건너뛴다.

`crawlDueSources`는 호출 시작 시각과 `SOURCE_CRAWL_TIME_BUDGET_MS`를 더한 deadline을 계산한다. 각 URL을 시작하기 전에 deadline을 넘었으면 반복을 종료한다. `SOURCE_CRAWL_BATCH_SIZE`는 SQL의 `limit`, `SOURCE_CRAWL_DISCOVERY_LIMIT`은 `discoverContentUrls(...).slice(0, limit)`에 적용한다.

- [ ] **6단계: repository 테스트 통과 확인**

실행: `npm test --workspace @brand-pilot/api -- src/repository.test.ts src/sourceCrawlSchedule.test.ts`

예상: 기존 repository 테스트와 신규 스케줄 테스트 모두 통과.

---

### 작업 4: Cron 인증과 API 계약 구현

**파일:**
- 수정: `apps/api/src/httpServer.ts`
- 수정: `apps/api/src/index.ts`
- 수정: `apps/api/src/server.test.ts`

- [ ] **1단계: Cron 인증·신규 URL·실행 이력 RED 테스트 추가**

`server.test.ts`의 repository mock에 신규 메서드를 추가한 뒤 다음 테스트를 작성한다.

```ts
it("rejects cron requests when CRON_SECRET is missing or invalid", async () => {
  const repository = createRepository();
  const app = createServer({ repository, cronSecret: "cron-secret", logger: false });
  expect((await app.inject({ method: "GET", url: "/internal/cron/source-crawl" })).statusCode).toBe(401);
  expect((await app.inject({
    method: "GET",
    url: "/internal/cron/source-crawl",
    headers: { authorization: "Bearer wrong" }
  })).statusCode).toBe(401);
});

it("runs automatic source crawling with the correct cron secret", async () => {
  const repository = createRepository();
  const app = createServer({ repository, cronSecret: "cron-secret", logger: false });
  const response = await app.inject({
    method: "GET",
    url: "/internal/cron/source-crawl",
    headers: { authorization: "Bearer cron-secret" }
  });
  expect(response.statusCode).toBe(200);
  expect(repository.crawlDueSources).toHaveBeenCalledTimes(1);
});

it("creates a source and performs its first crawl", async () => {
  const repository = createRepository();
  const app = createServer({ repository, logger: false });
  const response = await app.inject({
    method: "POST",
    url: `/brands/${brandId}/sources`,
    payload: { sourceType: "owned", url: "https://example.com" }
  });
  expect(response.statusCode).toBe(201);
  expect(repository.createSourceWithInitialCrawl).toHaveBeenCalledWith(brandId, {
    sourceType: "owned",
    url: "https://example.com"
  });
});
```

- [ ] **2단계: RED 확인**

실행: `npm test --workspace @brand-pilot/api -- src/server.test.ts`

예상: `cronSecret`, 신규 repository 메서드와 route가 없어 실패한다.

- [ ] **3단계: 상수 시간 secret 비교 helper 추가**

```ts
import { timingSafeEqual } from "node:crypto";

function matchesBearerSecret(header: string | undefined, secret: string | undefined) {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const candidate = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
```

`CreateServerOptions`에 `cronSecret?: string`을 추가한다.

- [ ] **4단계: 내부 Cron route와 인증 bypass 구현**

세션 preHandler의 공개 분기에 `/internal/cron/`을 추가하되 route 자체가 secret을 검증하게 한다.

```ts
app.get("/internal/cron/source-crawl", async (request, reply) => {
  if (!matchesBearerSecret(request.headers.authorization, cronSecret)) {
    reply.code(401);
    return { error: "cron_unauthorized" };
  }
  return repository.crawlDueSources(new Date());
});
```

- [ ] **5단계: 소스 생성·실행 이력 route 변경**

```ts
const result = await repository.createSourceWithInitialCrawl(request.params.brandId, {
  sourceType,
  url: request.body.url
});
reply.code(201);
return result;
```

```ts
app.get<{ Params: { brandId: string } }>("/brands/:brandId/source-crawl-runs", async (request) => {
  return repository.listSourceCrawlRuns(request.params.brandId);
});
```

- [ ] **6단계: index wiring**

```ts
cronSecret: process.env.CRON_SECRET,
```

를 `createServer` 옵션에 추가한다.

- [ ] **7단계: 서버 테스트 통과 확인**

실행: `npm test --workspace @brand-pilot/api -- src/server.test.ts`

예상: 전체 통과.

---

### 작업 5: Vercel Cron과 환경 설정

**파일:**
- 수정: `apps/api/vercel.json`
- 수정: `apps/api/.env.example`
- 수정: `scripts/repository-contract.test.mjs`

- [ ] **1단계: Vercel Cron 설정 추가**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "fastify",
  "regions": ["bom1"],
  "crons": [
    {
      "path": "/internal/cron/source-crawl",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **2단계: 환경 예제 추가**

```dotenv
# Vercel Cron Authorization bearer secret. Required in production.
CRON_SECRET=
SOURCE_CRAWL_BATCH_SIZE=5
SOURCE_CRAWL_DISCOVERY_LIMIT=20
SOURCE_CRAWL_TIME_BUDGET_MS=45000
```

repository는 숫자 환경 변수를 파싱할 때 유효하지 않거나 1보다 작으면 각각 5, 20, 45000을 사용한다.

- [ ] **3단계: 설정 계약 테스트 통과 확인**

실행: `npm run test:contract`

예상: 12개 마이그레이션과 Cron·환경 설정 계약 통과.

---

### 작업 6: 고객 UI에 초기 크롤링과 최근 실행 표시

**파일:**
- 수정: `apps/customer-ui/src/types.ts`
- 수정: `apps/customer-ui/src/lib/apiClient.ts`
- 수정: `apps/customer-ui/src/pages/SourcesPage.tsx`
- 수정: `apps/customer-ui/src/__tests__/sources.test.tsx`

- [ ] **1단계: UI RED 테스트 작성**

`renderSourcesPage` mock에 `listSourceCrawlRuns`를 추가하고 `createSource` 반환값을 `{ source, initialCrawl }`로 바꾼다.

```ts
it("shows the initial crawl result after adding a URL", async () => {
  const api = await renderSourcesPage();
  await userEvent.type(screen.getByLabelText("자사 URL"), "https://new.example.com");
  await userEvent.click(screen.getByRole("button", { name: "추가" }));
  expect(await screen.findByText(/초기 크롤링 완료/)).toBeInTheDocument();
  expect(api.createSource).toHaveBeenCalledTimes(1);
});

it("shows recent automatic crawl status", async () => {
  await renderSourcesPage({
    listSourceCrawlRuns: vi.fn(async () => [{
      id: "run-1",
      brandId: "brand-1",
      sourceUrlId: "owned-1",
      trigger: "scheduled",
      status: "succeeded",
      attempt: 0,
      processed: 1,
      created: 1,
      updated: 1,
      failed: 0,
      startedAt: "2026-07-12T00:00:00.000Z",
      finishedAt: "2026-07-12T00:00:10.000Z",
      nextRetryAt: null,
      lastError: null
    }])
  });
  expect(await screen.findByText("자동 크롤링 성공")).toBeInTheDocument();
});
```

- [ ] **2단계: UI RED 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/sources.test.tsx`

예상: 신규 타입과 실행 목록 UI가 없어 실패한다.

- [ ] **3단계: UI 타입과 API client 구현**

API DTO와 같은 `SourceCrawlRun`, `SourceCreateResult`를 `types.ts`에 추가한다.

```ts
createSource(brandId, payload) {
  return request<SourceCreateResult>(fetcher, `${baseUrl}/brands/${brandId}/sources`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
},
listSourceCrawlRuns(brandId) {
  return request<SourceCrawlRun[]>(fetcher, `${baseUrl}/brands/${brandId}/source-crawl-runs`, { method: "GET" });
},
```

- [ ] **4단계: SourcesPage 상태와 갱신 구현**

- 초기 mount에서 source, snapshot, topic row와 함께 crawl run을 조회한다.
- URL 추가 응답의 `source`를 목록에 넣고 `initialCrawl.status`에 따라 알림을 표시한다.
- 소스 큐 상단에 최근 자동 실행 5개를 표시한다.
- 표시 문구는 `자동 크롤링 성공`, `일부 실패`, `재시도 예정`, `자동 재시도 종료`로 고정한다.
- 내부 stack trace는 표시하지 않고 `lastError`는 안전한 오류 코드만 표시한다.

- [ ] **5단계: UI 테스트 통과 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- src/__tests__/sources.test.tsx`

예상: 전체 통과.

---

### 작업 7: 운영 문서와 배포 절차

**파일:**
- 수정: `README.md`
- 수정: `docs/VERCEL_CENTRAL_API_DEPLOYMENT.md`

- [ ] **1단계: README에 자동 크롤링 동작 추가**

다음 내용을 한글로 명시한다.

- 신규 URL 등록 직후 1회
- 이후 마지막 성공 후 72시간
- Vercel Cron은 15분마다 due/retry 여부만 확인
- 수동 전체 크롤링 유지
- 재시도 15분·1시간·6시간, 최대 3회

- [ ] **2단계: Vercel 배포 문서 갱신**

환경 변수 표에 다음을 추가한다.

```text
CRON_SECRET                 필수  긴 임의 문자열, Vercel Cron Authorization 검증
SOURCE_CRAWL_BATCH_SIZE     선택  기본 5
SOURCE_CRAWL_DISCOVERY_LIMIT 선택 기본 20
SOURCE_CRAWL_TIME_BUDGET_MS 선택 기본 45000
```

production 배포 후 다음 검증 명령을 추가한다.

```powershell
$headers = @{ Authorization = "Bearer $env:CRON_SECRET" }
Invoke-RestMethod -Headers $headers https://<api-domain>/internal/cron/source-crawl
```

secret 값은 문서나 셸 기록에 저장하지 않는다고 경고한다.

- [ ] **3단계: 문서 계약 확인**

실행: `npm run test:contract`

예상: 링크·스크립트·Cron 설정 계약 전체 통과.

---

### 작업 8: 전체 검증과 배포 전 게이트

**파일:**
- 검증만 수행

- [ ] **1단계: 전체 계약 테스트**

실행: `npm run test:contract`

예상: 실패 0.

- [ ] **2단계: 전체 단위 테스트**

실행: `npm test`

예상: API, UI, 이미지 워커 전체 통과.

- [ ] **3단계: 전체 빌드**

실행: `npm run build`

예상: 세 workspace 통과, API `dist/index.js` 생성.

- [ ] **4단계: API ESM 확인**

실행: `node --check apps/api/dist/index.js`

예상: 종료 코드 0.

- [ ] **5단계: 로컬 Cron 인증 확인**

API를 `CRON_SECRET=local-cron-test`로 실행한 뒤 다음 두 요청을 확인한다.

```powershell
Invoke-WebRequest http://localhost:4000/internal/cron/source-crawl -SkipHttpErrorCheck
Invoke-WebRequest http://localhost:4000/internal/cron/source-crawl -Headers @{ Authorization = "Bearer local-cron-test" }
```

예상: 첫 요청 401, 두 번째 요청 200.

- [ ] **6단계: Supabase 적용 전 데이터 안전 확인**

`012_source_crawl_runs.sql`은 새 테이블·인덱스·트리거만 생성하며 기존 데이터의 update/delete가 없음을 재검토한다. 적용 이력을 확인한 뒤 운영 Supabase에 012만 실행한다.

- [ ] **7단계: production 배포 후 확인**

- Vercel Cron 등록 확인
- 15분마다 2xx 응답 확인
- 신규 URL 최초 실행 확인
- 테스트 URL의 마지막 성공 시각을 72시간 이전으로 조정한 격리 환경에서 scheduled 실행 확인
- 동일 run key 중복 행이 생기지 않는지 확인
- 실패 URL의 `next_retry_at`과 attempt 증가 확인

production 배포와 실제 Supabase 마이그레이션은 별도 사용자 승인 후 수행한다.
