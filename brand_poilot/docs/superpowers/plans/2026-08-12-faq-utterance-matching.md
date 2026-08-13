# FAQ 표현 예시 및 DM 안전 매칭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 중인 브랜드 센터 FAQ 제안에 사용자 표현 예시를 함께 생성·수정하고 FAQ를 승인할 때 질문·답변·표현 예시를 한 번에 저장하며, Instagram DM에서 완전일치가 아니어도 안전한 후보를 찾아 한 번 확인한 뒤 FAQ 답변을 전송한다.

**Architecture:** PostgreSQL은 FAQ와 표현 예시, 제안 실행, 확인 대기 상태의 영속 저장소로 유지한다. API webhook 경로에서 결정론적 정규화와 경량 후보 검색만 수행하고, 기존 exact와 확장 exact만 즉시 FAQ 작업으로 보내며 fuzzy 후보는 점수가 높아도 별도 `faq_clarification` 작업으로 보낸다. LLM은 FAQ 제안 생성과 Wiki 답변에만 사용하며 FAQ 매칭 판정에는 사용하지 않는다. 모든 신규 동작은 서버 플래그와 브랜드 allowlist 뒤에 두고, 기존 완전일치·수동응답·Wiki 답변 경로를 기본값 그대로 유지한다.

**Tech Stack:** PostgreSQL migrations, Node.js 22, TypeScript, Fastify API, React/Vite customer UI, Vitest, PGlite/Testcontainers, existing `@brand-pilot/dm-worker`, Docker Compose schema-3 release workflow.

---

## 0. 운영 기준선과 변경 경계

이 계획은 2026-08-12에 읽기 전용으로 확인한 실제 운영 기준을 사용한다.

- Git source/release SHA: `fc49a05eacaa49bc5b4431c76f6f47f2bbb5d622`
- API runtime digest: `sha256:d5c91c7e2e3f745d1e5f86f5e74d8f8a90e26927c7fc1904576344974eea3f04`
- API primary/canary: revision `fc49a05eacaa49bc5b4431c76f6f47f2bbb5d622`, healthy, restart count 0
- release schema: `3`
- release manifest DM/Wiki digest: `sha256:dd19776a756a7bac070f6c63e723fd8a640d1be48fcb54aa1fced92b5f7a44e4`
- 실제 DM worker runtime digest: `sha256:5ac51b771af9fc87235b12fe8424956c05cc1b8f7db77fa91bb074a2ed674219`
- 실제 Wiki worker runtime digest: `sha256:33227142392e645731933693aa7ed66d8fc1f4d0b97a31ce3bffc7eb20b629df`
- 실제 DM/Wiki worker revision label: `5748eea09ab0bd9509ed2df91d51e01a5a429e44`
- `5748eea09ab0bd9509ed2df91d51e01a5a429e44`와 `fc49a05eacaa49bc5b4431c76f6f47f2bbb5d622` 사이 DM worker 소스 차이: 없음
- 운영 Compose의 실행 서비스: API, DM worker, Wiki worker. FAQ worker 서비스는 없음.
- GitHub `PRODUCTION_RELEASE_SHA`: `fc49a05eacaa49bc5b4431c76f6f47f2bbb5d622`

보호할 기존 동작:

1. 완전일치 FAQ는 현재와 동일하게 직접 FAQ 답변으로 처리한다.
2. FAQ에 해당하지 않으면 현재 `knowledge`/Wiki 답변 또는 기존 fallback으로 간다.
3. 자동응답 설정과 무관하게 수동응답 송신은 유지한다.
4. `fixed_fallback`의 상담 필요 처리 의미는 변경하지 않는다.
5. onboarding worker, content worker, Wiki worker, 콘텐츠 생성, DB의 기존 데이터는 이번 기능에서 변경하지 않는다.
6. 신규 기능은 플래그가 꺼진 상태로 먼저 배포하며, 플래그가 꺼져 있으면 현재 운영과 같은 SQL 함수와 분기만 실행한다.

배포 대상은 migration, API, customer UI, DM worker, 신규 FAQ worker profile이다. Wiki worker 이미지는 workflow에서 함께 빌드될 수 있지만 실제 운영 컨테이너는 교체하지 않는다.

## 1. 구현 순서와 출시 단계

```text
A0 현재 기준 테스트 복구
  -> A1 FAQ 제안에 표현 예시 생성/수정 후 FAQ와 함께 승인
  -> A2 확장 완전일치(정규화 후 exact)
  -> B 후보 매칭 shadow 기록만 수행
  -> C 중간확신 확인 질문
  -> D 측정 후 임계값 조정
```

한 PR에서 코드를 완성할 수 있지만 운영 활성화는 반드시 A1 → A2 → B → C 순서로 나눈다. C를 켜기 전에는 확인 질문을 고객에게 보내지 않는다.

## Task 1: 현재 운영 기준 테스트의 PGlite 초기화 실패를 먼저 고정

**Files:**

- Modify: `apps/api/src/faqSuggestionRepository.pglite.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts`
- Read only/reference: `db/migrations/072_faq_suggestion_worker.sql`
- Test: `apps/api/src/faqSuggestionRepository.pglite.test.ts`
- Test: `workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts`

- [ ] 두 스위트를 각각 단독 실행해 현재 `query returned no rows`가 테스트 본문 전 fixture/bootstrap에서 발생하는지 확인한다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/faqSuggestionRepository.pglite.test.ts --maxWorkers=1
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/faqSuggestionDb.test.ts --maxWorkers=1
```

Expected before fix: 두 스위트 모두 test body가 skip되고 suite setup에서 `query returned no rows`.

- [ ] fixture가 단일 행 반환을 강제하는 SQL/`one()` 또는 존재하지 않는 seed row를 전제하는 부분을 찾아, seed insert 결과를 명시적으로 검증하고 테스트별 고유 workspace/brand/user를 생성하도록 수정한다.
- [ ] 제품 repository/worker 구현은 이 단계에서 수정하지 않는다.
- [ ] 두 스위트를 다시 실행한다.

Expected after fix: API 8 tests, worker 5 tests 모두 통과하며 skip 0.

- [ ] 기준 테스트 전체를 재실행한다.

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/faqSuggestionContracts.test.ts src/faqSuggestionRepository.pglite.test.ts src/repository.dmWebhook.test.ts src/repository.dmDelivery.test.ts src/runtimeConfig.test.ts --maxWorkers=2
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/faqSuggestionContracts.test.ts src/faqSuggestionWorker.test.ts src/faqSuggestionDb.test.ts src/worker.test.ts --maxWorkers=2
npm exec --workspace @brand-pilot/customer-ui -- vitest run src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/__tests__/wikiLibrary.test.tsx src/features/libraries/libraryGateway.test.ts --maxWorkers=2
```

Expected: API 95, worker 33, UI 28 tests pass.

## Task 2: 표현 예시와 확인 상태를 tenant-safe 스키마로 추가

**Files:**

- Create: `db/migrations/078_faq_utterance_matching.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Test: `scripts/migrations.integration.test.mjs`

- [ ] 마이그레이션 적용 전 실패하는 contract assertions를 추가한다. 다음 스키마를 모두 요구한다.

```sql
alter table knowledge_entries
  add column manual_aliases text[] not null default '{}';

alter table faq_suggestion_items
  add column example_utterances text[] not null default '{}';

alter table faq_suggestion_runs
  add column run_kind text not null default 'full_faq',
  add column target_knowledge_entry_id uuid null,
  add column target_knowledge_entry_updated_at timestamptz null;
```

- [ ] `knowledge_entries`에 `(id, workspace_id, brand_id)` unique constraint를 추가한 뒤 `faq_suggestion_runs`의 target FK를 세 열 모두로 묶는다. 다른 tenant의 FAQ ID를 참조할 수 없어야 한다.
- [ ] `run_kind`는 `full_faq | alias_only`만 허용하고, `alias_only`일 때만 target 두 열이 필수이며 `full_faq`일 때는 둘 다 null이어야 하는 check를 추가한다.
- [ ] 별도 결과 테이블을 추가한다.

```sql
create table faq_alias_suggestion_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  run_id uuid not null,
  knowledge_entry_id uuid not null,
  example_utterances text[] not null,
  created_at timestamptz not null default now(),
  unique (run_id),
  foreign key (run_id, workspace_id, brand_id)
    references faq_suggestion_runs(id, workspace_id, brand_id) on delete cascade,
  foreign key (knowledge_entry_id, workspace_id, brand_id)
    references knowledge_entries(id, workspace_id, brand_id) on delete cascade,
  check (cardinality(example_utterances) between 1 and 8)
);
```

- [ ] 확인 질문 상태 테이블을 추가한다. 사용자에게 같은 질문을 반복하지 않고 수동응답과 충돌을 판정할 최소 데이터만 저장한다.

```sql
create table dm_faq_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  conversation_id uuid not null,
  inbound_message_id text not null,
  knowledge_entry_id uuid not null,
  prompt_job_id uuid null,
  status text not null default 'pending_prompt',
  confidence double precision not null,
  expires_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, brand_id, inbound_message_id),
  foreign key (knowledge_entry_id, workspace_id, brand_id)
    references knowledge_entries(id, workspace_id, brand_id) on delete cascade,
  check (status in ('pending_prompt','awaiting_answer','confirmed','rejected','expired','cancelled')),
  check (confidence between 0 and 1)
);
```

- [ ] `conversation_id`와 `prompt_job_id`는 실제 운영 테이블의 tenant identity constraint를 확인해 가능한 경우 composite FK로 연결한다. 현재 테이블에 composite unique가 없으면 이번 migration 안에서 필요한 unique만 추가한다.
- [ ] `example_utterances`, `manual_aliases`에 공백 문자열과 중복 정규형을 허용하지 않는 DB helper/check를 추가하지 않는다. PostgreSQL check만으로 애플리케이션과 같은 Unicode 정규화를 재현하지 말고, API/worker validator를 단일 쓰기 경계로 사용한다.
- [ ] 기존 `aliases`는 import/source-managed 값으로 그대로 보존한다. 유효 매칭 표현은 읽을 때 `aliases || manual_aliases`로 합친다.
- [ ] migration integration test에 upgrade, tenant FK 위반, 잘못된 run_kind, 빈/9개 alias 결과, confirmation 중복을 추가한다.

Run:

```bash
npm run test:migrations
npm run test:contract
```

Expected: migration/contract suites pass; migration 077 is append-only and no existing row rewrite occurs.

## Task 3: 표현 예시의 공통 정규화·검증 정책을 고정

**Files:**

- Create: `scripts/fixtures/faq-utterance-policy.json`
- Create: `apps/api/src/faqUtterancePolicy.ts`
- Create: `apps/api/src/faqUtterancePolicy.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionContracts.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionContracts.test.ts`

- [ ] API와 worker가 같은 fixture를 읽어 동일한 결과를 내는 실패 테스트를 먼저 작성한다.
- [ ] fixture에 한글/영문 혼합, 전각 문자, 연속 공백, 문장부호, 자모/악센트, 대소문자, 중복, 빈 문자열, 81자 표현을 포함한다.
- [ ] 다음 public API를 구현한다.

```ts
export const FAQ_UTTERANCE_MAX_ITEMS = 8;
export const FAQ_UTTERANCE_MAX_LENGTH = 80;

export function normalizeFaqUtterance(value: string): string;
export function parseFaqUtterances(value: unknown): string[];
export function effectiveFaqAliases(sourceAliases: string[], manualAliases: string[]): string[];
```

정규화 순서:

1. `NFKC`
2. lower-case
3. 앞뒤 공백 제거
4. 내부 whitespace를 한 칸으로 축소
5. 한글/영문/숫자 사이의 의미 있는 문자만 남기되 `?!.~` 등 종결 문장부호는 제거
6. 정규화 결과 기준 stable dedupe

- [ ] 원문을 저장할 때도 trim/whitespace 축소된 표시 문자열을 보존하고, 비교용 normalize 결과로 중복을 제거한다.
- [ ] 최대 8개, 개별 1~80자, 배열만 허용한다. 문자열 한 개를 배열로 암묵 변환하지 않는다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/faqUtterancePolicy.test.ts
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/faqSuggestionContracts.test.ts
```

Expected: 두 package가 공통 fixture의 모든 expected normalization/validation을 동일하게 통과.

## Task 4: FAQ 제안 worker contract를 mode-discriminated v2로 확장

**Files:**

- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionContracts.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionContracts.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/prompts.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionWorker.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionWorker.test.ts`
- Modify: `workers/brand-pilot-dm-worker/src/db.ts`
- Modify: `workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts`

- [ ] 기존 v1만 허용하는 테스트를 보존하고, v2의 두 input/result union 테스트를 실패 상태로 추가한다.

```ts
type FaqSuggestionWorkerInputV2 =
  | {
      contractVersion: "faq-suggestion-input.v2";
      mode: "full_faq";
      runId: string;
      workspaceId: string;
      brandId: string;
      leaseToken: string;
      sources: FaqSuggestionWorkerSource[];
      existingFaqs: ExistingFaq[];
    }
  | {
      contractVersion: "faq-suggestion-input.v2";
      mode: "alias_only";
      runId: string;
      workspaceId: string;
      brandId: string;
      leaseToken: string;
      targetFaq: ExistingFaq & { updatedAt: string };
    };
```

- [ ] `full_faq` 결과의 각 suggestion에 `exampleUtterances: string[]`를 필수로 추가한다.
- [ ] `alias_only` 결과는 `faq-alias-suggestion-result.v1`과 `exampleUtterances`만 허용한다. 질문·답변·category를 다시 생성하지 않는다.
- [ ] unknown field, raw URL in answer, 잘못된 evidence, 빈 utterance, 9개 utterance, 정규화 중복, 다른 mode의 result를 모두 reject한다.
- [ ] prompt에 각 표현이 고객이 실제 보낼 법한 짧은 질문이어야 하고 답변 내용을 새로 만들지 말라는 지시를 추가한다. full mode는 3~8개, alias-only는 기존 title/content만 근거로 3~8개를 요청한다.
- [ ] claim query가 `run_kind`를 읽고 v2 input을 만들도록 변경한다. alias-only는 source snapshot 전체를 다시 보내지 않는다.
- [ ] complete transaction에서 full 결과는 `faq_suggestion_items.example_utterances`에, alias-only 결과는 `faq_alias_suggestion_results`에 저장한다.
- [ ] target FAQ의 `updated_at`이 run 생성 시점 값과 다르면 `faq_suggestion_source_changed`로 실패시키고 alias를 덮지 않는다.
- [ ] 현재 max attempts=3, lease/heartbeat, source fingerprint 로직은 변경하지 않는다.

Run:

```bash
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/faqSuggestionContracts.test.ts src/faqSuggestionWorker.test.ts src/faqSuggestionDb.test.ts
```

Expected: v1 regression과 v2 full/alias-only success, stale target rejection이 모두 통과.

## Task 5: FAQ 승인 한 번으로 질문·답변·표현 예시를 함께 저장

**Files:**

- Modify: `apps/api/src/faqSuggestionContracts.ts`
- Modify: `apps/api/src/faqSuggestionContracts.test.ts`
- Modify: `apps/api/src/faqSuggestionRepository.ts`
- Modify: `apps/api/src/faqSuggestionRepository.pglite.test.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.faqSuggestionsCustomer.test.ts`

- [ ] DTO와 update parser의 실패 테스트를 먼저 추가한다.

```ts
interface FaqSuggestionItemDto {
  // existing fields
  exampleUtterances: string[];
}

interface FaqSuggestionItemUpdate {
  category: FaqSuggestionCategory;
  question: string;
  answer: string;
  exampleUtterances: string[];
  expectedUpdatedAt: string;
}
```

- [ ] create run은 명시적으로 `run_kind='full_faq'`를 저장한다.
- [ ] map/list/update가 `example_utterances`를 round-trip하도록 구현한다.
- [ ] `exampleUtterances`는 FAQ suggestion item의 편집 필드이며 별도 승인 상태나 별도 승인 endpoint를 만들지 않는다. 기존 FAQ item update endpoint로 질문·답변과 함께 수정한다.
- [ ] 기존 FAQ 승인 endpoint의 한 transaction에서 새 `knowledge_entries` row를 만들고, 질문·답변을 저장하며, source-managed `aliases`는 빈 배열로 두고 검토된 `example_utterances`를 `manual_aliases`에 저장한다.
- [ ] FAQ 승인 성공 응답은 하나만 반환한다. 표현 예시 저장이 실패하면 FAQ 생성도 rollback하고, FAQ 생성이 실패하면 표현 예시만 남기지 않는다.
- [ ] `FaqSuggestionReviewAction`에는 `expectedUpdatedAt`만 유지한다. 표현 예시 전용 `approve`, `approved`, `reviewedAt` 필드는 추가하지 않는다.
- [ ] duplicate 판정 시 질문뿐 아니라 현재 FAQ의 effective aliases와 새 표현의 정규형 충돌도 검사한다. 하나의 표현이 여러 FAQ와 충돌하면 자동승인하지 않고 item을 `duplicate`로 표시한다.
- [ ] 기존 optimistic concurrency인 `expectedUpdatedAt`를 유지한다.
- [ ] 기존 endpoint URL과 응답 shape의 기존 필드는 제거하지 않는다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/faqSuggestionContracts.test.ts src/faqSuggestionRepository.pglite.test.ts src/server.faqSuggestionsCustomer.test.ts
```

Expected: 기존 생성/수정/승인/기각 테스트와 표현 예시 round-trip·충돌 테스트 통과.

## Task 6: 기존 FAQ에 대한 표현 예시 제안 API를 별도 실행으로 추가

**Files:**

- Modify: `apps/api/src/wikiManagementContracts.ts`
- Modify: `apps/api/src/wikiManagementContracts.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWiki.pglite.test.ts`
- Modify: `apps/api/src/faqSuggestionContracts.ts`
- Modify: `apps/api/src/faqSuggestionRepository.ts`
- Modify: `apps/api/src/faqSuggestionRepository.pglite.test.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.faqSuggestionsCustomer.test.ts`
- Modify: `apps/api/src/server.wikiManagementCustomer.test.ts`

- [ ] 이 Task의 `apply`는 이미 승인되어 운영 중인 FAQ에 표현 예시를 나중에 보강하는 경우에만 사용한다. Task 5의 신규 FAQ 제안 검토에는 이 endpoint나 별도 적용 절차를 사용하지 않는다.
- [ ] 다음 tenant-scoped endpoint의 auth/validation 실패 테스트를 먼저 작성한다.

```text
POST /brands/:brandId/wiki/items/:itemId/alias-suggestions
GET  /brands/:brandId/wiki/items/:itemId/alias-suggestions/latest
POST /brands/:brandId/wiki/items/:itemId/alias-suggestions/:runId/apply
```

- [ ] FAQ item만 허용하고 product/service/policy/read-only item에는 `409 faq_alias_suggestion_not_supported`를 반환한다.
- [ ] `WikiManagementItem`과 UI DTO에 `sourceAliases`, `manualAliases`, `effectiveAliases`, `updatedAt`을 추가하고 `listWikiItems`가 FAQ row에서만 세 배열을 반환하도록 한다. product/service row에는 빈 배열을 반환한다.
- [ ] `UpdateWikiItemInput`에 `manualAliases?: string[]`, `expectedUpdatedAt?: string`을 추가한다. `manualAliases`가 있으면 `expectedUpdatedAt`을 필수로 하고, FAQ/manual-origin row에만 optimistic update를 허용한다. 기존 title/content/status update 요청은 그대로 허용한다.
- [ ] 수동 alias 저장은 `manual_aliases`만 변경하며 `aliases`, title, content, status는 건드리지 않는다.
- [ ] POST는 target FAQ `updated_at`을 저장한 `alias_only` run을 만든다. 같은 브랜드의 full run과 alias-only run이 동시에 필요한 경우 현재 partial unique index를 `(workspace_id, brand_id, run_kind, coalesce(target_knowledge_entry_id, '00000000-0000-0000-0000-000000000000'::uuid))` 전략으로 교체해 서로 막지 않게 한다.
- [ ] 같은 FAQ의 active alias-only run은 하나만 허용하고 기존 run을 idempotently 반환한다.
- [ ] apply는 run target과 현재 item이 같고 updated_at도 같을 때만 `manual_aliases`를 교체한다. source-managed `aliases`는 절대 수정하지 않는다.
- [ ] apply 완료 후 run status를 `completed`로 원자적으로 바꾼다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/wikiManagementContracts.test.ts src/repository.dmWiki.pglite.test.ts src/server.wikiManagementCustomer.test.ts src/faqSuggestionRepository.pglite.test.ts src/server.faqSuggestionsCustomer.test.ts
```

Expected: tenant isolation, idempotency, stale FAQ, wrong item type, successful apply 통과.

## Task 7: 브랜드 센터 FAQ UI에서 표현 예시를 제안·편집

**Files:**

- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.ts`
- Modify: `apps/customer-ui/src/features/libraries/libraryGateway.test.ts`
- Create: `apps/customer-ui/src/components/brand-center/FaqUtteranceEditor.tsx`
- Create: `apps/customer-ui/src/components/brand-center/FaqUtteranceEditor.test.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/WikiItemEditor.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/WikiLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/__tests__/wikiLibrary.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] gateway DTO를 다음처럼 확장하고 API endpoint 호출 테스트를 먼저 추가한다.

```ts
interface WikiItem {
  // existing fields
  sourceAliases: string[];
  manualAliases: string[];
  effectiveAliases: string[];
  updatedAt: string;
}

interface FaqSuggestionItem {
  // existing fields
  exampleUtterances: string[];
}
```

- [ ] `FaqUtteranceEditor`는 textarea 한 덩어리가 아니라 한 줄 한 표현의 row로 보여준다. 추가, 삭제, 중복 경고, 8개 제한, 80자 제한, 저장 전 dirty 상태를 제공한다.
- [ ] FAQ 제안 카드에서 category/question/answer 아래에 표현 예시 편집 영역을 넣는다. 사용자가 `FAQ 승인`을 누르면 먼저 현재 question/answer/exampleUtterances draft를 기존 item update endpoint에 저장한 뒤, 갱신된 `updatedAt`으로 기존 FAQ approve endpoint를 한 번 호출한다.
- [ ] 표현 예시 영역에는 별도 `승인` 버튼이나 승인 배지를 만들지 않는다. FAQ 카드의 기존 `FAQ 승인`과 `기각`이 검토 단위다.
- [ ] 기존 FAQ editor에는 source aliases를 읽기 전용으로, manual aliases를 편집 가능으로 분리한다. 사용자는 최종 `effectiveAliases` 미리보기를 볼 수 있어야 한다.
- [ ] `표현 예시 제안받기` 버튼은 alias-only POST 후 latest를 polling하고, 결과를 바로 저장하지 않고 editor draft에 넣는다. 사용자가 `적용`을 눌러야 DB가 변경된다.
- [ ] loading, empty, partial, stale conflict, failure, retry 상태를 현재 카드 위계 안에서 표시한다.
- [ ] FAQ가 아닌 item에서는 버튼과 alias editor를 렌더하지 않는다.
- [ ] 기존 URL `/brand-center?tab=faq`, 선택 상태, question/answer 편집, 승인/기각, Wiki build 상태는 그대로 유지한다.

Run:

```bash
npm exec --workspace @brand-pilot/customer-ui -- vitest run src/features/libraries/libraryGateway.test.ts src/components/brand-center/FaqUtteranceEditor.test.tsx src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/__tests__/wikiLibrary.test.tsx
```

Expected: keyboard editing, validation, approve/apply, stale error, non-FAQ regression 포함 전부 통과.

## Task 8: 서버 플래그와 capability 응답을 먼저 추가

**Files:**

- Modify: `apps/api/src/runtimeConfig.ts`
- Modify: `apps/api/src/runtimeConfig.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/brandCenterHttp.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`
- Modify: `deploy/env/api.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `scripts/deployment-contract.test.mjs`

- [ ] 다음 환경 변수를 strict boolean/number로 parse하는 실패 테스트를 작성한다.

```text
FAQ_UTTERANCE_SUGGESTIONS_ENABLED=false
FAQ_EXPANDED_EXACT_ENABLED=false
FAQ_MATCH_SHADOW_ENABLED=false
FAQ_CLARIFICATION_ENABLED=false
FAQ_MATCH_BRAND_ALLOWLIST=
FAQ_CLARIFY_THRESHOLD=0.78
FAQ_CONFIRMATION_TTL_SECONDS=300
```

- [ ] production default는 모두 false로 둔다. allowlist가 비어 있으면 어떤 브랜드도 신규 매칭 동작을 사용하지 않는다.
- [ ] clarify threshold는 0~1 범위여야 한다. TTL은 30~900초만 허용한다. fuzzy 후보를 곧바로 답변하는 direct threshold는 만들지 않는다.
- [ ] 기존 `/brands/:brandId/channels/capabilities` 응답을 변경하지 말고, FAQ UI/운영 진단용 별도 endpoint를 추가한다.

```text
GET /brands/:brandId/faq-capabilities
```

응답은 `suggestions`, `expandedExact`, `shadowMatching`, `clarification` 네 boolean과 현재 threshold만 포함하며 secret/allowlist 전체는 노출하지 않는다.

- [ ] repository options에 immutable runtime policy를 주입해 webhook transaction 안에서 `process.env`를 직접 읽지 않게 한다.
- [ ] 플래그가 모두 false인 regression test에서 기존 `find_direct_faq_exact` 호출과 job payload가 byte-equivalent인지 확인한다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/runtimeConfig.test.ts src/server.faqSuggestionsCustomer.test.ts src/server.dmOperations.test.ts src/repository.dmWebhook.test.ts
npm run test:deployment
```

Expected: invalid config fail-fast, defaults false, no behavior change regression 통과.

## Task 9: LLM 없는 경량 FAQ 후보 matcher를 순수 함수로 구현

**Files:**

- Create: `apps/api/src/faqMatcher.ts`
- Create: `apps/api/src/faqMatcher.test.ts`
- Create: `scripts/fixtures/faq-matcher-evaluation.json`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWebhook.test.ts`

- [ ] 먼저 evaluation fixture를 만든다. 최소 60개 발화를 포함한다.

구성:

- 20개 exact/expanded exact
- 15개 안전한 오탈자·띄어쓰기 변형
- 10개 중간확신 확인 대상
- 10개 전혀 다른 질문
- 5개 둘 이상의 FAQ와 비슷한 conflict

- [ ] pure matcher 테스트를 실패 상태로 작성한다.

```ts
export interface FaqMatchCandidate {
  knowledgeEntryId: string;
  question: string;
  aliases: string[];
}

export type FaqMatchResult =
  | { kind: "none" }
  | { kind: "conflict"; candidateIds: string[] }
  | { kind: "candidate"; knowledgeEntryId: string; score: number; matchedExpression: string };

export function rankFaqCandidates(query: string, candidates: FaqMatchCandidate[]): FaqMatchResult;
```

- [ ] 점수는 결정론적으로 계산한다.

```text
normalized exact                     1.00
Dice bigram similarity               0.00..1.00
NFKD OSA edit similarity             0.00..1.00
final score = max(exact, 0.65 * dice + 0.35 * osa)
```

- [ ] 길이 2 미만, URL, 이모지만 있는 발화는 fuzzy 후보를 만들지 않는다.
- [ ] top-1과 top-2 차이가 0.04 미만이면 `conflict`로 반환한다. conflict는 직접응답/확인질문 모두 금지한다. candidate score가 높아도 이 함수는 직접답변 결정을 반환하지 않는다.
- [ ] repository에 tenant/brand/active/direct_reply 조건으로 FAQ question과 `aliases || manual_aliases`를 최대 200개 읽는 query를 추가한다. 원문 answer/content는 matcher에 넘기지 않는다.
- [ ] `FAQ_MATCH_SHADOW_ENABLED=true`일 때만 기존 routing 결과를 바꾸지 않고 점수와 예상 kind를 운영 로그/telemetry에 기록한다. 고객 메시지·이름 같은 원문은 로그에 남기지 않고 message ID, FAQ ID, score, kind만 남긴다.
- [ ] API webhook 처리 추가 시간 p95 목표를 25ms로 둔 micro benchmark test를 추가하되 CI에서는 200 FAQ × 100 query의 총 실행시간 상한으로 검증한다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/faqMatcher.test.ts src/repository.dmWebhook.test.ts
```

Expected: evaluation fixture의 direct/clarify/none/conflict 분류와 성능 상한 통과.

## Task 10: 확장 exact와 확인 질문 상태 머신을 webhook transaction에 연결

**Files:**

- Modify: `apps/api/src/dmTypes.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmWebhook.test.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`

- [ ] 신규 route/reason을 type에 추가한다.

```ts
export type DmJobRoute = "fixed_fallback" | "knowledge" | "ignore" | "faq_clarification";
export type DmReasonCode = /* existing */ | "faq_clarification";
```

- [ ] 플래그가 꺼진 테스트, expanded exact, clarification candidate, none, conflict를 각각 먼저 작성한다.
- [ ] 라우팅 순서는 고정한다.

```text
1. 현재 정책 차단/complaint/restricted action
2. 기존 find_direct_faq_exact
3. FAQ_EXPANDED_EXACT: normalize 후 effective aliases exact
4. FAQ_MATCH_SHADOW: 계산/기록만
5. clarify threshold 이상: confirmation 생성 + faq_clarification job
6. 기존 knowledge/fallback
```

- [ ] expanded exact만 기존 `exactFaqId` 실행 경로를 재사용한다. fuzzy candidate는 `exactFaqId`를 가진 direct knowledge job으로 만들지 않는다.
- [ ] clarification candidate는 confirmation row와 prompt job을 같은 transaction에서 생성한다. prompt 문구는 저장된 FAQ question으로 만든 고정 템플릿이다.

```text
“{FAQ 질문}”에 대해 문의하신 게 맞을까요? 맞으면 “네”, 아니면 질문을 다시 보내주세요.
```

- [ ] 고객에게 두 번째 inbound가 오면 pending confirmation을 먼저 lock한다. `네/예/맞아/맞아요/응` 정규형이면 confirmed 후 해당 FAQ job을 만들고, `아니/아니요/아님`이면 rejected 후 현재 발화를 새 질문으로 다시 라우팅하지 않고 기존 knowledge/fallback으로 보낸다. 그 외 발화는 confirmation을 cancelled하고 그 발화를 일반 신규 질문으로 라우팅한다.
- [ ] TTL 초과 상태는 expired로 바꾸고 일반 신규 질문으로 처리한다.
- [ ] 동일 inbound message 재전송은 기존 message/job dedupe와 confirmation unique로 한 번만 처리한다.
- [ ] 동일 conversation의 confirmation은 하나만 active하게 partial unique index 또는 transaction lock으로 보장한다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/repository.dmWebhook.test.ts src/repository.dmOperations.test.ts
```

Expected: 기존 exact, expanded exact, confirm yes/no/free-text, TTL, duplicate, conflict, flags-off 통과.

## Task 11: 빠른 고객 후속응답과 수동응답 충돌을 claim 시점에 해결

**Files:**

- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmDelivery.test.ts`
- Modify: `apps/api/src/repository.dmOperations.test.ts`
- Modify: `apps/api/src/server.dmOperations.test.ts`

- [ ] confirmation prompt job은 기존 `instagram_dm_reply` queue에 `available_at = now() + interval '5 seconds'`로 넣는다. webhook request에서 sleep하거나 외부 Meta 전송을 하지 않는다.
- [ ] 다음 race test를 먼저 작성한다.

```text
T0 clarification job queued for +5s
T1 customer sends “네” before +5s
T2 API marks confirmation confirmed and cancels prompt job
T3 DM worker claim must not see the cancelled prompt
```

- [ ] `claimDmReplyJob`이 `faq_confirmation_deferred` payload를 발견하면 confirmation 상태를 `for update skip locked`로 확인한다. `pending_prompt`만 claim하고, confirmed/rejected/cancelled/expired이면 job을 cancelled 처리한 뒤 다음 job을 claim한다.
- [ ] 수동응답이 성공하면 해당 conversation의 active confirmation을 cancelled하고 아직 claim되지 않은 prompt job을 취소한다.
- [ ] 이미 claim된 prompt와 수동응답이 경쟁하면 delivery attempt의 기존 idempotency 키와 confirmation 상태를 통해 하나만 고객에게 전송되게 한다.
- [ ] 수동응답 endpoint, Meta delivery 결과, attention item 처리 의미는 변경하지 않는다.

Run:

```bash
npm exec --workspace @brand-pilot/api -- vitest run src/repository.dmDelivery.test.ts src/repository.dmOperations.test.ts src/server.dmOperations.test.ts
```

Expected: fast yes, fast free-text, manual reply, worker claim race, duplicate delivery 테스트 통과.

## Task 12: DM worker가 `faq_clarification`을 LLM 없이 전송

**Files:**

- Modify: `workers/brand-pilot-dm-worker/src/client.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.ts`
- Modify: `workers/brand-pilot-dm-worker/src/worker.test.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/repository.dmDelivery.test.ts`

- [ ] claimed payload에 `fixedReplyText?: string`과 `confirmationId?: string`을 추가하고 unknown/missing field validation test를 작성한다.
- [ ] route가 `faq_clarification`이면 `runCodex`, Wiki search, conversation history를 호출하지 않고 다음 result를 complete한다.

```ts
{
  decision: "answer",
  answer: job.payload.fixedReplyText,
  wikiChunkIds: [],
  knowledgeEntryId: job.payload.exactFaqId ?? null,
  reason: "faq_clarification_prompt"
}
```

- [ ] API `completeDmReplyJob`은 이 route를 `fixed_fallback`으로 취급하지 않는다. delivery 성공 시 confirmation을 `awaiting_answer`로 바꾸고 `dm_attention_items`를 만들지 않는다.
- [ ] delivery 실패는 기존 retry/delivery_unknown 경로를 재사용하고 confirmation은 retry 가능 상태로 둔다.
- [ ] 기존 fixed fallback은 계속 `needsAttention=true` 의미를 유지한다.

Run:

```bash
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/worker.test.ts
npm exec --workspace @brand-pilot/api -- vitest run src/repository.dmDelivery.test.ts
```

Expected: clarification does not call Codex, no attention item; fixed_fallback regression unchanged.

## Task 13: 운영 FAQ worker profile과 안전한 worker rollout을 추가

**Files:**

- Modify: `deploy/compose.production.yml`
- Create: `deploy/env/faq-worker.env.example`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/rollout-workers.sh`
- Modify: `deploy/scripts/lib.sh`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/worker-cli-only-contract.test.mjs`
- Modify: `docs/operations/instagram-dm-operations-runbook.md`
- Create: `docs/operations/faq-utterance-matching-rollout.md`

- [ ] 현재 package의 실제 command `node dist/index.js watch faq faq-worker-1`을 사용하는 Compose profile을 추가한다. 새 image key를 만들지 않고 현재 `DM_WORKER_IMAGE` immutable digest를 재사용한다.

```yaml
faq-worker-1:
  profiles: ["faq-worker-1"]
  image: ${DM_WORKER_IMAGE:?DM_WORKER_IMAGE is required}
  env_file:
    - ${FAQ_WORKER_1_ENV_FILE:-/opt/brand-pilot/shared/env/faq-worker-1.env}
  environment:
    CODEX_HOME: /codex
    WORKER_ID: faq-worker-1
    WORKER_MODE: faq
```

- [ ] 보안 옵션은 `dm-worker-1`과 동일한 read-only filesystem, UID/GID, tmpfs, cap_drop, no-new-privileges를 사용한다.
- [ ] preflight는 FAQ env file의 API URL/token/worker mode를 검증하되 신규 기능 플래그가 꺼진 배포에서는 파일 부재 때문에 기존 release를 막지 않는다. FAQ worker profile을 활성화할 때만 필수로 검증한다.
- [ ] `rollout-workers.sh`에서 `DM_WORKER_IMAGE`의 service mapping에 `faq-worker-1`을 추가한다. inactive profile은 현재처럼 자동 시작하지 않으며, 최초 시작은 명시적 명령으로만 수행한다.
- [ ] worker heartbeat verifier가 workload `faq`, worker id `faq-worker-1`을 검증하도록 runbook과 contract를 추가한다.
- [ ] 현재 운영 worker runtime이 release manifest보다 오래된 상태이므로 기존 `previous release manifest`만 rollback 근거로 사용하지 않는다. rollout 직전에 각 실제 container의 immutable digest를 별도 기록하고 DM/FAQ 각각 그 digest로 복구하는 명령을 runbook에 적는다.
- [ ] Wiki worker는 이번 rollout 대상에서 제외한다. workflow가 새 Wiki image digest를 만들더라도 `wiki-worker-1` 컨테이너를 교체하지 않는다.

Run:

```bash
npm run test:deployment
npm run test:contract
docker compose -f deploy/compose.production.yml --env-file deploy/release.env.example --profile faq-worker-1 config --quiet
```

Expected: compose config, immutable image mapping, security contract, rollout/rollback contract 통과.

## Task 14: 전체 회귀, 관측성, 운영 활성화 검증

**Files:**

- Create: `scripts/faq-matcher-evaluation.mjs`
- Create: `scripts/faq-matcher-evaluation.test.mjs`
- Modify: `scripts/verify-regression-matrix.mjs`
- Modify: `scripts/verify-regression-matrix.test.mjs`
- Modify: `docs/operations/faq-utterance-matching-rollout.md`

- [ ] evaluation script가 fixture 기준으로 다음 지표를 출력하게 한다.

```text
expanded-exact precision
clarification precision
false expanded-exact count
conflict count
none count
p50/p95 matcher latency
```

- [ ] 출시 gate를 코드와 runbook에 고정한다.

```text
expanded-exact false positive = 0 in curated fixture
expanded-exact precision = 1.00
clarification precision >= 0.90
matcher p95 <= 25ms on 200 FAQ candidates
flags-off webhook regression = pass
manual reply race regression = pass
```

- [ ] 전체 정적/단위/계약 테스트를 실행한다.

```bash
npm run build
npm run test --workspaces --if-present
npm run test:contract
npm run test:deployment
npm run test:migrations
npm run test:regression-matrix
node --test scripts/faq-matcher-evaluation.test.mjs
node scripts/faq-matcher-evaluation.mjs
```

Expected: 모든 명령 exit 0, evaluation gate 만족.

- [ ] 로컬에서 UI를 띄워 `/brand-center?tab=faq`의 full proposal, alias-only proposal, editing, stale conflict, mobile layout을 확인한다.
- [ ] staging에서 flags=false 상태로 기존 exact FAQ, Wiki 답변, fallback, 수동응답을 확인한다.
- [ ] migration을 먼저 적용하고 API primary/canary, customer UI, DM worker image, FAQ worker profile 순서로 준비하되 flags는 모두 false로 유지한다.
- [ ] API canary에서 health/ready/restart/log를 확인한 뒤 primary를 승격한다.
- [ ] FAQ worker를 `faq-worker-1` profile로 시작하고 heartbeat와 실제 full/alias-only run 한 건씩 확인한다.
- [ ] allowlist 한 브랜드에 `FAQ_UTTERANCE_SUGGESTIONS_ENABLED`만 켜서 A1을 검증한다.
- [ ] 그 다음 `FAQ_EXPANDED_EXACT_ENABLED`를 켜 A2를 검증한다.
- [ ] `FAQ_MATCH_SHADOW_ENABLED`만 켜 24시간 이상 지표를 수집하고 고객 응답이 바뀌지 않았음을 확인한다.
- [ ] gate를 충족한 경우에만 `FAQ_CLARIFICATION_ENABLED`를 켠다. fuzzy 후보는 점수가 높아도 직접 FAQ 답변으로 보내지 않고 반드시 확인 질문을 거친다.

## 배포 및 rollback 명세

배포 전 반드시 다시 확인할 값:

```text
/opt/brand-pilot/state/current
GitHub PRODUCTION_RELEASE_SHA
API primary/canary image digest and revision label
DM worker actual digest and revision label
Wiki worker actual digest and revision label
release schema and release.env checksum
dirty main / remote main / hotfix status
```

배포하지 않을 대상:

- onboarding worker
- content proposal/subject/image/card/blog/reel workers
- Wiki worker runtime
- Meta 설정과 OAuth secret
- 자동응답 기존 설정값의 강제 변경

rollback 단위:

1. UI 문제: 이전 UI digest만 복구한다.
2. API 문제: 직전 검증 API digest로 primary/canary만 복구한다.
3. DM worker 문제: rollout 직전 기록한 실제 DM digest로 DM worker만 복구한다.
4. FAQ worker 문제: profile을 중지하고 기능 플래그를 false로 되돌린다.
5. matcher 오판: migration/data rollback 없이 `FAQ_EXPANDED_EXACT_ENABLED`, `FAQ_MATCH_SHADOW_ENABLED`, `FAQ_CLARIFICATION_ENABLED`를 false로 돌린다.
6. migration 077은 컬럼/테이블을 삭제하지 않는다. 신규 쓰기를 중단하고 기존 코드가 신규 필드를 무시하도록 유지한다.

## 완료 조건

- FAQ 제안에 3~8개 표현 예시가 생성되고 사용자가 FAQ 승인 전에 수정할 수 있다.
- 신규 FAQ는 `FAQ 승인` 한 번으로 질문·답변·표현 예시가 원자적으로 저장되며 표현 예시의 별도 승인 절차가 없다.
- 기존 FAQ에서도 표현 예시만 별도로 제안받고 적용할 수 있다.
- source-managed aliases와 user-managed manual aliases가 서로 덮어쓰지 않는다.
- 완전일치 기존 경로는 flags-off와 flags-on 모두 유지된다.
- 경량 matcher는 LLM을 호출하지 않고, fuzzy 후보를 직접 답변하지 않으며, conflict에서는 확인 질문도 보내지 않는다.
- 중간확신은 한 번만 확인하며 빠른 후속응답/수동응답과 중복 전송하지 않는다.
- clarification은 attention item을 만들지 않고 fixed fallback의 기존 의미를 바꾸지 않는다.
- FAQ worker가 운영에서 실제 heartbeat와 작업 완료를 증명한다.
- Wiki worker와 무관 worker는 교체되지 않는다.
- 운영 활성화는 A1 → A2 → shadow → clarification 순서를 지킨다.
