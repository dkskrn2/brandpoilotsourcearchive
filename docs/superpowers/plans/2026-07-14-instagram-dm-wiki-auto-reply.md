# Instagram DM Wiki Auto Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 자사 URL과 FAQ CSV/Excel을 브랜드별 Wiki로 만들고, Instagram DM에 근거 기반 자동답변을 발송한다.

**Architecture:** 기존 Vercel Fastify API가 Instagram Login OAuth, Webhook 수신, 채널 credential 저장, DM 발송을 담당한다. 별도 PC의 `brand-pilot-dm-worker`는 기존 `jobs` 큐에서 Wiki 갱신과 DM 답변 Job만 가져오며, 제한된 PostgreSQL 함수로 검색한 데이터와 Codex CLI를 사용해 결과를 중앙 API에 돌려준다. 기존 이미지 워커와 파일·Job type·Codex 작업 디렉터리를 분리한다.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL/Supabase, pgvector, React 18/Vite, Vitest, Codex CLI, OpenAI Embeddings API, Instagram Login/Graph API.

---

## 실행 원칙

- 검증은 구현 Task마다 가장 가까운 단위 테스트 한 번만 실행한다.
- API, UI, 워커가 모두 끝난 뒤에만 전체 build와 실제 Growthline DM 1회를 실행한다.
- Playwright 반복 실행, 화면별 수동 QA 반복, 대량 DM 부하 테스트는 이번 범위에서 하지 않는다.
- 기존 `workers/brand-pilot-image-worker/`는 수정하지 않는다. DM Job을 claim하지 않는 회귀 테스트만 추가한다.
- 생성 산출물과 로컬 `.env`는 stage/commit하지 않는다.
- 각 Task는 완료 후 지정 파일만 stage하여 작은 커밋 하나로 남긴다.

## 파일 구조와 책임

| 경로 | 책임 |
|---|---|
| `db/migrations/020_dm_wiki_core.sql` | Wiki, FAQ, DM, worker heartbeat 테이블과 Job/LLM 제약 확장 |
| `db/migrations/021_dm_wiki_pgvector.sql` | `vector` 확장, 1536차원 임베딩, 검색 함수와 인덱스 |
| `apps/api/src/dmTypes.ts` | DM/Wiki DTO, Webhook payload, CLI 결과 계약 |
| `apps/api/src/faqImport.ts` | CSV/XLSX 파싱과 질문 정규화 |
| `apps/api/src/wiki.ts` | chunking과 Wiki refresh 입력 계약 |
| `apps/api/src/instagramLoginGraph.ts` | `graph.instagram.com`과 Instagram Login OAuth 전용 호출 |
| `apps/api/src/instagramMessaging.ts` | DM Send API와 오류 분류 |
| `apps/api/src/instagramWebhook.ts` | HMAC 검증과 Meta event 파싱 |
| `apps/api/src/repository.ts` | FAQ upsert, Wiki Job, DM 수신/발송/이력 query |
| `apps/api/src/httpServer.ts` | OAuth, Webhook, DM 설정, worker API, 고객 조회 route |
| `workers/brand-pilot-dm-worker/` | DM 전용 CLI worker 패키지 |
| `apps/customer-ui/src/pages/DmAutomationPage.tsx` | 고객용 DM 자동화 기록·미답변 화면 |

## Task 1: DB 계약과 공통 타입

**Files:**

- Create: `db/migrations/020_dm_wiki_core.sql`
- Create: `db/migrations/021_dm_wiki_pgvector.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `apps/api/src/types.ts`
- Create: `apps/api/src/dmTypes.ts`
- Test: `apps/api/src/dmTypes.test.ts`

- [ ] **Step 1: DM/Wiki DTO의 failing test를 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import { parseDmWorkerResult } from "./dmTypes";

describe("parseDmWorkerResult", () => {
  it("근거 ID가 있는 answer 결과만 허용한다", () => {
    expect(parseDmWorkerResult({
      decision: "answer",
      answer: "평일 오전 9시부터 오후 6시까지 운영합니다.",
      wikiChunkIds: ["00000000-0000-4000-8000-000000000001"],
      confidence: 0.8,
      reason: "FAQ 운영시간 항목"
    })).toMatchObject({ decision: "answer" });
  });
});
```

- [ ] **Step 2: `020_dm_wiki_core.sql`을 작성한다.**

`knowledge_imports`, `knowledge_entries`, `wiki_documents`, `wiki_chunks`, `instagram_dm_settings`, `instagram_dm_conversations`, `instagram_dm_messages`, `unanswered_questions`, `worker_instances`만 추가한다. `wiki_document_versions`, `wiki_conflicts`, `dm_reply_runs`는 만들지 않는다. `wiki_chunks`에는 원문 `content`, `content_hash`, `search_vector tsvector`, `enabled`를 포함한다.

```sql
create table knowledge_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  file_name text not null,
  source_rows jsonb not null,
  result_json jsonb not null default '{}',
  status text not null default 'succeeded',
  created_at timestamptz not null default now()
);

create table knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid not null references brands(id) on delete cascade,
  normalized_question text not null,
  question text not null,
  answer text not null,
  category text null,
  keywords text[] not null default '{}',
  priority int not null default 0,
  enabled boolean not null default true,
  last_import_id uuid not null references knowledge_imports(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, normalized_question)
);

alter table jobs add column if not exists dedupe_key text null;
create unique index jobs_active_dm_reply_dedupe_unique
  on jobs(job_type, dedupe_key)
  where job_type = 'instagram_dm_reply'
    and status in ('queued', 'running');
```

`jobs_type_check`에 `wiki_refresh`, `instagram_dm_reply`를 추가한다. `llm_runs`에는 `wiki_refresh`, `embedding`, `dm_reply` purpose와 `running` status를 추가한다. 메시지 중복 방지는 `(brand_channel_id, external_message_id)` unique index로 구현한다.

- [ ] **Step 3: `021_dm_wiki_pgvector.sql`을 작성한다.**

```sql
-- requires: pgvector
create extension if not exists vector;

alter table wiki_chunks
  add column embedding vector(1536) null,
  add column embedding_model text null,
  add column embedding_version text null;

create index wiki_chunks_embedding_hnsw_idx
  on wiki_chunks using hnsw (embedding vector_cosine_ops)
  where enabled and embedding is not null;

create index wiki_chunks_search_vector_gin_idx
  on wiki_chunks using gin(search_vector);
```

같은 migration에 `search_brand_wiki`, `get_dm_conversation_history`, `get_wiki_refresh_sources`, `replace_wiki_refresh_result` 함수를 만든다. 모든 함수는 `workspace_id`, `brand_id`를 매개변수로 받고 SQL에서 범위를 검증한다.

- [ ] **Step 4: PGlite migration test의 pgvector 처리만 분리한다.**

`scripts/migrations.integration.test.mjs`에서는 `-- requires: pgvector` migration만 PGlite 실행에서 제외한다. 별도 Node assertion으로 021 파일의 extension, `vector(1536)`, HNSW index를 검사한다. 실제 Supabase에는 `npm run db:migrate`가 021을 적용한다.

- [ ] **Step 5: 타입과 Repository interface를 추가한다.**

```ts
export type DmDecision = "answer" | "fallback" | "ignore" | "error";

export interface DmWorkerResult {
  decision: DmDecision;
  answer: string | null;
  wikiChunkIds: string[];
  confidence: number | null;
  reason: string;
}

export interface InstagramDmSettingsDto {
  enabled: boolean;
  fallbackMessage: string;
  errorMessage: string;
  webhookStatus: "connected" | "needs_attention" | "unchecked";
  workerStatus: "online" | "worker_offline" | "unknown";
}
```

`ApiRepository`에 FAQ import, Wiki refresh, DM settings, Webhook 수신, DM Job claim/complete/fail, heartbeat, DM 이력 조회 메서드를 추가한다.

- [ ] **Step 6: 한 번만 검증하고 커밋한다.**

Run: `npm run test:migrations && npm run test --workspace @brand-pilot/api -- --run src/dmTypes.test.ts`

Expected: migration test와 DTO test가 통과한다.

```bash
git add db/migrations/020_dm_wiki_core.sql db/migrations/021_dm_wiki_pgvector.sql scripts/migrations.integration.test.mjs apps/api/src/types.ts apps/api/src/dmTypes.ts apps/api/src/dmTypes.test.ts
git commit -m "feat: add DM wiki schema and contracts"
```

## Task 2: FAQ 업로드와 Wiki 갱신 입력

**Files:**

- Modify: `apps/api/package.json`
- Create: `apps/api/src/faqImport.ts`
- Create: `apps/api/src/faqImport.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/repository.dmWiki.test.ts`

- [ ] **Step 1: CSV/XLSX parser test를 작성한다.**

```ts
it("같은 질문은 공백과 대소문자를 정규화해 마지막 유효 행으로 upsert한다", () => {
  const rows = parseFaqUpload({
    fileName: "faq.csv",
    bytes: Buffer.from("question,answer\n 운영 시간 ,09-18\n운영 시간,10-19\n")
  });
  expect(rows.validRows).toHaveLength(2);
  expect(rows.rows.at(-1)?.normalizedQuestion).toBe("운영 시간");
});
```

- [ ] **Step 2: `xlsx`를 API workspace dependency로 추가하고 parser를 구현한다.**

`.csv`, `.xlsx`만 허용하며 `question`, `answer` 헤더가 없으면 `faq_upload_invalid_file`을 throw한다. 개별 행 오류는 반환 배열에 남기며 유효 행 저장을 막지 않는다. 최대 파일 크기는 1 MiB로 제한한다.

```ts
export type ParsedFaqRow = {
  rowNumber: number;
  question: string;
  normalizedQuestion: string;
  answer: string;
  category: string | null;
  keywords: string[];
  priority: number;
  enabled: boolean;
  errors: string[];
};
```

- [ ] **Step 3: Repository FAQ upsert와 Wiki Job enqueue를 구현한다.**

하나의 transaction에서 `knowledge_imports`를 만들고 유효 행을 `(brand_id, normalized_question)` 기준으로 upsert한다. `source_rows`에는 이번 업로드의 원본 행과 오류를 저장해 이전 답변 이력을 보존한다. 유효 행이 하나 이상이면 `wiki_refresh` Job을 `dedupe_key = brandId`로 생성 또는 갱신한다.

```sql
insert into knowledge_entries (...)
values (...)
on conflict (brand_id, normalized_question) do update
set question = excluded.question,
    answer = excluded.answer,
    category = excluded.category,
    keywords = excluded.keywords,
    priority = excluded.priority,
    enabled = excluded.enabled,
    last_import_id = excluded.last_import_id,
    updated_at = now();
```

- [ ] **Step 4: API route를 추가한다.**

`POST /brands/:brandId/knowledge-imports`는 `{ fileName, fileBase64 }`를 받는다. `GET /brands/:brandId/knowledge-imports`는 최근 import 20건과 집계를 반환한다. `POST /brands/:brandId/wiki/refresh`는 수동 갱신 Job을 enqueue한다.

- [ ] **Step 5: 핵심 테스트만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/api -- --run src/faqImport.test.ts src/repository.dmWiki.test.ts`

Expected: CSV/XLSX 파싱, FAQ upsert, 오류 행 유지, Wiki Job 중복 방지가 통과한다.

```bash
git add apps/api/package.json package-lock.json apps/api/src/faqImport.ts apps/api/src/faqImport.test.ts apps/api/src/repository.ts apps/api/src/httpServer.ts apps/api/src/repository.dmWiki.test.ts
git commit -m "feat: import FAQ knowledge and enqueue wiki refresh"
```

## Task 3: Wiki chunk 계약과 제한된 검색 함수

**Files:**

- Create: `apps/api/src/wiki.ts`
- Create: `apps/api/src/wiki.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `README.md`

- [ ] **Step 1: deterministic chunker test를 작성한다.**

```ts
it("FAQ와 최신 owned snapshot만 Wiki chunk로 만든다", () => {
  const chunks = buildWikiChunks({
    faqEntries: [{ question: "환불", answer: "결제 후 7일 이내" }],
    sourceSnapshots: [{ sourceType: "owned", status: "succeeded", content: "서비스 소개" }]
  });
  expect(chunks.map((chunk) => chunk.sourceKind)).toEqual(["faq", "owned_snapshot"]);
});
```

- [ ] **Step 2: Wiki source와 chunk 생성 함수를 구현한다.**

활성 FAQ와 `source_type = 'owned'`, 최신 성공 snapshot만 사용한다. chunk 길이는 800자, overlap은 120자로 고정한다. `content_hash`가 같으면 기존 embedding을 재사용한다.

- [ ] **Step 3: Worker가 쓸 Wiki refresh 입력 계약을 구현한다.**

`buildWikiChunks`는 source/document/chunk payload와 이전 `content_hash`를 반환한다. 중앙 API는 OpenAI 키나 embedding API를 갖지 않으며, Worker가 이 입력으로 임베딩을 생성한다.

- [ ] **Step 4: `replace_wiki_refresh_result`와 `search_brand_wiki` 호출을 Repository에 구현한다.**

Wiki refresh가 실패하면 기존 `wiki_documents.is_active = true` 자료를 유지한다. 검색은 vector 70%, keyword 30% reciprocal-rank fusion으로 최대 8개만 반환한다.

- [ ] **Step 5: 단위 테스트와 migration test만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/api -- --run src/wiki.test.ts src/repository.dmWiki.test.ts && npm run test:migrations`

Expected: owned source 제한, hash 재사용, brand scope, 검색 상한이 통과한다.

```bash
git add apps/api/src/wiki.ts apps/api/src/wiki.test.ts apps/api/src/repository.ts README.md
git commit -m "feat: add wiki chunks and hybrid retrieval"
```

## Task 4: Instagram Login 통합과 기존 게시 경로의 단계적 전환

**Files:**

- Create: `apps/api/src/instagramLoginGraph.ts`
- Create: `apps/api/src/instagramLoginGraph.test.ts`
- Create: `apps/api/src/instagramMessaging.ts`
- Create: `apps/api/src/instagramMessaging.test.ts`
- Modify: `apps/api/src/metaGraph.ts`
- Modify: `apps/api/src/instagramPublisher.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/.env.example`
- Test: `apps/api/src/metaGraph.test.ts`, `apps/api/src/instagramPublisher.test.ts`

- [ ] **Step 1: Instagram Login account resolution test를 작성한다.**

```ts
it("Instagram Login token으로 graph.instagram.com의 user id와 username을 저장한다", async () => {
  const connection = await resolveInstagramLoginConnection({
    accessToken: "token",
    fetchImpl: mockFetchJson({ user_id: "ig-user-1", username: "growthline352" })
  });
  expect(connection).toMatchObject({ instagramUserId: "ig-user-1", username: "growthline352" });
});
```

- [ ] **Step 2: host를 명시하는 Graph client를 만든다.**

기존 `metaGraph.ts`의 공통 오류 분류는 유지한다. 새 `instagramLoginGraph.ts`는 `https://graph.instagram.com`만 사용하고 `/me/accounts`, Facebook Page token, `pageId`를 사용하지 않는다. scope는 아래 세 개만 요청한다.

```ts
const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_messages"
];
```

- [ ] **Step 3: OAuth start/callback을 중앙 API에 구현한다.**

`GET /auth/meta/start`는 로그인 세션의 brand ID를 서명된 state cookie에 저장하고 Instagram Login authorize URL로 redirect한다. `GET /auth/meta/callback`은 code를 token으로 교환하고 `saveChannelCredentials`를 호출한다. 기존 `/auth/meta/dev-complete`는 로컬 개발에서만 유지하고 Vercel에서는 404를 반환한다.

```dotenv
META_APP_ID=
META_APP_SECRET=
META_OAUTH_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=
META_GRAPH_VERSION=v23.0
```

- [ ] **Step 4: 게시 Publisher를 새 host에서 테스트한다.**

`instagramPublisher.ts`는 URL host를 주입받게 바꾸고 feed/story/reel의 `/media`, `/media_publish` path와 asset 검증은 그대로 둔다. 기존 Page token 연결을 삭제하지 말고 `credential.metadata.authMode = 'instagram_login'`일 때만 새 client를 사용한다.

- [ ] **Step 5: API test와 기존 게시 test만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/api -- --run src/instagramLoginGraph.test.ts src/metaGraph.test.ts src/instagramPublisher.test.ts`

Expected: 새 host의 OAuth/connection parsing과 기존 feed/story/reel request contract가 통과한다.

```bash
git add apps/api/src/instagramLoginGraph.ts apps/api/src/instagramLoginGraph.test.ts apps/api/src/instagramMessaging.ts apps/api/src/instagramMessaging.test.ts apps/api/src/metaGraph.ts apps/api/src/instagramPublisher.ts apps/api/src/httpServer.ts apps/api/src/types.ts apps/api/.env.example
git commit -m "feat: add Instagram Login credentials for publishing and DM"
```

## Task 5: Meta Webhook, DM 수신, debounce와 중앙 발송

**Files:**

- Modify: `apps/api/package.json`
- Create: `apps/api/src/instagramWebhook.ts`
- Create: `apps/api/src/instagramWebhook.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/server.dmWebhook.test.ts`

- [ ] **Step 1: signature와 event parser test를 작성한다.**

```ts
it("유효한 raw body HMAC만 Instagram message event로 변환한다", () => {
  const raw = Buffer.from(JSON.stringify(fixture));
  const signature = createHmac("sha256", "secret").update(raw).digest("hex");
  expect(verifyInstagramSignature(raw, `sha256=${signature}`, "secret")).toBe(true);
  expect(parseInstagramMessagingEvents(fixture)).toHaveLength(1);
});
```

- [ ] **Step 2: `fastify-raw-body`를 추가하고 Webhook route를 구현한다.**

`POST /webhooks/meta/instagram`은 Kakao auth preHandler에서 제외한다. raw body HMAC을 `timingSafeEqual`로 검증하고 성공하면 최대한 빨리 `200 { ok: true }`을 반환한다. `GET`은 `hub.mode`, `hub.verify_token`, `hub.challenge`를 검증한다.

- [ ] **Step 3: Repository의 `receiveInstagramWebhookMessage` transaction을 구현한다.**

처리 순서는 고정한다.

```text
brand_channel 식별
-> message.mid insert on conflict do nothing
-> echo/self/system event 무시
-> chatbot enabled/Wiki ready 확인
-> user 20회, account 500회 제한 확인
-> conversation의 active queued Job 갱신 또는 새 Job 생성(run_at = now + 3 seconds)
-> commit
```

텍스트가 아닌 event는 한 번만 "텍스트로 문의해 주세요."를 보내고 `unsupported_media`로 기록한다. 제한 초과는 사용자당 하루 한 번만 안내한다.

- [ ] **Step 4: worker complete/fail API와 중앙 DM Send API를 추가한다.**

`POST /worker/dm-jobs/claim`, `/:id/heartbeat`, `/:id/complete`, `/:id/fail`, `/heartbeat`를 기존 worker token 인증으로 추가한다. complete route는 `DmWorkerResult` 계약, chunk 소유권, 답변 길이를 검증하고 `instagramMessaging.ts`로 한 번 발송한다. Meta 429/5xx는 250ms 후 한 번만 재시도한다. CLI timeout/error는 설정된 오류 안내문을 발송한다.

- [ ] **Step 5: 핵심 서버 test만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/api -- --run src/instagramWebhook.test.ts src/server.dmWebhook.test.ts`

Expected: challenge, bad signature, duplicate `mid`, 3초 debounce, OFF 상태, rate limit, timeout error send가 통과한다.

```bash
git add apps/api/package.json package-lock.json apps/api/src/instagramWebhook.ts apps/api/src/instagramWebhook.test.ts apps/api/src/httpServer.ts apps/api/src/repository.ts apps/api/src/types.ts apps/api/src/server.dmWebhook.test.ts
git commit -m "feat: receive Instagram DM webhooks and enqueue replies"
```

## Task 6: DM 전용 Codex CLI worker

**Files:**

- Create: `workers/brand-pilot-dm-worker/package.json`
- Create: `workers/brand-pilot-dm-worker/tsconfig.json`
- Create: `workers/brand-pilot-dm-worker/.env.example`
- Create: `workers/brand-pilot-dm-worker/runtime/.gitkeep`
- Create: `workers/brand-pilot-dm-worker/src/client.ts`
- Create: `workers/brand-pilot-dm-worker/src/db.ts`
- Create: `workers/brand-pilot-dm-worker/src/embeddings.ts`
- Create: `workers/brand-pilot-dm-worker/src/codexRunner.ts`
- Create: `workers/brand-pilot-dm-worker/src/prompts.ts`
- Create: `workers/brand-pilot-dm-worker/src/worker.ts`
- Create: `workers/brand-pilot-dm-worker/src/index.ts`
- Create: `workers/brand-pilot-dm-worker/src/worker.test.ts`
- Create: `workers/brand-pilot-dm-worker/src/embeddings.test.ts`
- Create: `workers/brand-pilot-dm-worker/src/codexRunner.test.ts`
- Modify: `package.json`

- [ ] **Step 1: worker timeout test를 작성한다.**

```ts
it("10초 뒤 Codex 자식 프로세스를 종료하고 timeout 오류를 반환한다", async () => {
  const result = await runCodexJson({ prompt: "질문", timeoutMs: 10, spawnImpl: hangingSpawn });
  expect(result).toEqual({ ok: false, error: "codex_timeout" });
  expect(hangingSpawn.kill).toHaveBeenCalled();
});
```

- [ ] **Step 2: DM worker package와 환경변수를 만든다.**

```dotenv
BRAND_PILOT_API_URL=
WORKER_API_TOKEN=
DM_WORKER_DATABASE_URL=
WORKER_ID=dm-worker-pc-1
POLL_INTERVAL_MS=1000
HEARTBEAT_INTERVAL_MS=5000
DM_CLI_TIMEOUT_MS=10000
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

`DM_WORKER_DATABASE_URL`은 Wiki search/history/refresh SQL 함수만 실행 가능한 PostgreSQL role을 사용한다. 기존 이미지 워커 `.env`와 코드에는 이 값을 추가하지 않는다.

루트 `package.json`에는 아래 script만 추가한다.

```json
{
  "scripts": {
    "dev:dm-worker": "npm run dev --workspace @brand-pilot/dm-worker",
    "dm-worker:once": "npm run once --workspace @brand-pilot/dm-worker"
  }
}
```

- [ ] **Step 3: 전용 read-only Codex runner를 구현한다.**

```ts
const args = [
  "exec", "--skip-git-repo-check", "--ephemeral", "--json",
  "--sandbox", "read-only", "-C", runtimeDirectory, "-"
];
```

`spawn`에 AbortSignal을 연결하고 timeout에서 `child.kill()`을 호출한다. worker는 질문, 최근 대화 6개, Wiki chunk 8개만 CLI stdin으로 보낸다. CLI는 `answer`, `fallback`, `ignore` 중 하나의 JSON만 반환하게 한다.

- [ ] **Step 4: embedding과 Wiki refresh/DM reply worker 흐름을 구현한다.**

`embeddings.ts`는 OpenAI `/v1/embeddings`에 `text-embedding-3-small`, `dimensions: 1536`을 명시한다. `wiki_refresh`는 제한 DB 함수로 FAQ/owned snapshot을 읽고, CLI 정리 결과를 chunk로 만든 뒤 변경된 chunk만 embedding API를 호출하며 `replace_wiki_refresh_result` 함수로 활성 Wiki를 교체한다. `instagram_dm_reply`는 query embedding 1회, `search_brand_wiki`, conversation history, CLI 호출, 중앙 API complete 순으로 처리한다. worker가 유휴 상태에서도 5초마다 `/worker/dm-jobs/heartbeat`를 호출한다.

- [ ] **Step 5: worker test와 build만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/dm-worker && npm run build --workspace @brand-pilot/dm-worker`

Expected: timeout kill, embedding request contract, answer/fallback contract, heartbeat, image Job 미claim이 통과한다.

```bash
git add workers/brand-pilot-dm-worker package.json package-lock.json
git commit -m "feat: add isolated Instagram DM worker"
```

## Task 7: 고객 UI 연결

**Files:**

- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/pages/SourcesPage.tsx`
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Create: `apps/customer-ui/src/pages/DmAutomationPage.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Test: `apps/customer-ui/src/__tests__/sources.test.tsx`
- Test: `apps/customer-ui/src/__tests__/channels.test.tsx`
- Create: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`

- [ ] **Step 1: API client contract test를 먼저 작성한다.**

```ts
it("FAQ upload를 base64 body로 전송한다", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "import-1" }), { status: 201 }));
  await apiClient({ baseUrl: "https://api.example", fetcher }).importFaq("brand-1", {
    fileName: "faq.xlsx", fileBase64: "AA=="
  });
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.example/brands/brand-1/knowledge-imports",
    expect.objectContaining({ method: "POST" })
  );
});
```

- [ ] **Step 2: `/sources`에 FAQ/Wiki 영역을 추가한다.**

기존 자사 URL과 주제 큐 UI를 바꾸지 않는다. 소스 화면에 `FAQ 및 Wiki` 탭을 추가하여 CSV/XLSX 파일 선택, 업로드 결과(유효/갱신/오류 행), 최근 import, 마지막 Wiki 갱신 시각, `Wiki 다시 만들기`만 표시한다. 파일 내용 직접 편집기는 만들지 않는다.

- [ ] **Step 3: `/channels`에 DM 설정을 추가한다.**

Instagram 카드 안에 메시지 권한, Webhook 상태, worker 상태, 자동답변 ON/OFF, 고정 fallback/error 안내문, `Instagram 다시 연결`을 추가한다. Wiki가 없거나 메시지 권한이 없으면 ON을 막고 사유를 표시한다.

- [ ] **Step 4: `/dm-automation` 화면을 추가한다.**

최근 메시지 목록, 자동답변, decision, 근거 URL/chunk, 처리시간, 미답변 질문, 기간/상태 필터만 제공한다. 상담원 Inbox, 직접 답변, 애니메이션은 만들지 않는다.

- [ ] **Step 5: UI Vitest만 실행하고 커밋한다.**

Run: `npm run test --workspace @brand-pilot/customer-ui -- --run src/__tests__/sources.test.tsx src/__tests__/channels.test.tsx src/__tests__/dmAutomation.test.tsx`

Expected: API 실패 시 mock data가 보이지 않고, Wiki 미준비 활성화 차단과 DM 이력 렌더가 통과한다.

```bash
git add apps/customer-ui/src/types.ts apps/customer-ui/src/lib/apiClient.ts apps/customer-ui/src/pages/SourcesPage.tsx apps/customer-ui/src/pages/ChannelsPage.tsx apps/customer-ui/src/pages/DmAutomationPage.tsx apps/customer-ui/src/routes.tsx apps/customer-ui/src/components/layout/Sidebar.tsx apps/customer-ui/src/__tests__
git commit -m "feat: add customer UI for DM automation"
```

## Task 8: 최소 통합 검증과 Growthline 파일럿

**Files:**

- Modify: `README.md`
- Modify: `apps/api/.env.example`
- Modify: `workers/brand-pilot-dm-worker/.env.example`
- Modify: `docs/superpowers/specs/2026-07-14-instagram-dm-ai-auto-reply-design.md`

- [ ] **Step 1: 실행 문서를 갱신한다.**

README에 다음만 추가한다.

```bash
npm run db:migrate
npm run dev:api
npm run dev:ui
npm run dev:dm-worker
```

Vercel에는 `SUPABASE_DATABASE_URL`, `WORKER_API_TOKEN`, `CREDENTIAL_ENCRYPTION_KEY`, `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI`, `META_WEBHOOK_VERIFY_TOKEN`를 설정한다고 명시한다. DM worker PC에는 `DM_WORKER_DATABASE_URL`, `WORKER_API_TOKEN`, `OPENAI_API_KEY`를 설정한다고 명시한다.

- [ ] **Step 2: 한 번만 전체 검증한다.**

Run:

```bash
npm run test:migrations
npm run test
npm run build
```

Expected: migration, workspace unit test, build가 모두 통과한다. 실패하면 해당 Task의 실패한 테스트만 다시 실행해 수정한다.

- [ ] **Step 3: 실제 Meta 파일럿을 한 번 실행한다.**

1. Vercel API URL을 Meta Webhook callback URL로 등록한다.
2. verify token과 `messages`, `messaging_postbacks` 구독을 설정한다.
3. Growthline 계정을 Instagram Login OAuth로 재연결한다.
4. FAQ 한 건과 owned URL 하나를 업로드하고 Wiki 갱신이 완료됐는지 확인한다.
5. Growthline 계정에 FAQ 질문 한 건을 DM으로 보낸다.
6. 답변이 한 번만 도착하고 `/dm-automation`에 근거와 처리시간이 남는지 확인한다.

이 Task에서 카드뉴스, 스토리, 릴스 발행을 다시 반복 검증하지 않는다. Task 4의 자동 Publisher request contract와 기존 게시 테스트로 회귀를 막는다.

- [ ] **Step 4: 최종 커밋한다.**

```bash
git add README.md apps/api/.env.example workers/brand-pilot-dm-worker/.env.example docs/superpowers/specs/2026-07-14-instagram-dm-ai-auto-reply-design.md
git commit -m "docs: document DM automation deployment and pilot"
```

## 병렬 실행 규칙

Task 1이 끝난 뒤 Task 2와 Task 4는 병렬로 진행할 수 있다. Task 3은 Task 2의 Wiki 입력 구조에 의존한다. Task 5는 Task 1과 Task 4에 의존한다. Task 6은 Task 3과 Task 5에 의존한다. Task 7은 Task 2, Task 5의 API 계약이 고정된 뒤 진행한다. Task 8은 모든 Task가 끝난 뒤 한 번만 실행한다.

```text
Task 1
  ├─ Task 2 -> Task 3 ┐
  └─ Task 4 ----------┼-> Task 5 -> Task 6
                       └-> Task 7
                              │
                           Task 8
```

## 계획 자체 검토

- 설계 범위의 FAQ CSV/XLSX, 기존 owned URL Wiki, pgvector 검색, Instagram Login, Webhook, DM CLI worker, 고객 UI, 호출 제한, 10초 timeout, worker offline 상태를 모두 Task에 배치했다.
- Redis, 별도 큐, 별도 검색 서버, 상담원 Inbox, PDF, App Review 제출, 장기 보관·마스킹 기능은 넣지 않았다.
- 검증은 Task별 좁은 테스트와 마지막 전체 검증 한 번으로 제한했다.
- 기존 이미지 워커는 수정하지 않으며, 새 DM worker만 별도 workspace로 추가한다.
