# D Hybrid Content Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 AI 콘텐츠 생성 파이프라인을 보존하면서 정보성·마케팅성 콘텐츠를 구분하고, 제품·주제·전략·형식 선택 후 레퍼런스와 아바타를 정확히 한 번 선택하는 D 하이브리드 B형 생성 흐름을 구현한다.

**Architecture:** `ai_content_generations`에 제품 분류와 orchestration snapshot을 추가하지만 기존 `type in ('card_news','blog','marketing')`과 `content-generation-input.v2`는 유지한다. 새 `ContentOrchestrationV1`은 API에서 검증·snapshot한 뒤 기존 worker type으로 결정적으로 매핑된다. 사용자 흐름은 `콘텐츠 생성(3개 순차 accordion) → 구현안 선택 → 생성 → 변경·검토·보완`의 4개 상위 phase로 구성한다. AI 구현안은 승인 브랜드 정보와 실제 크롤링 snapshot을 요약해 2–3개 생성하며, 실제 콘텐츠 레퍼런스와 아바타는 구현안 선택 phase에서 한 번만 지연 로드한다.

**Tech Stack:** PostgreSQL, Fastify, TypeScript, React, Vitest, Testing Library, Playwright, card-news/blog/marketing workers.

---

**Prerequisite:** Brand Center·libraries 계획과 `2026-07-24-d-hybrid-channel-capability-implementation-plan.md`를 완료한다. accordion 3은 mock fallback 없이 실제 channel capability API를 소비한다.

## Task 1: 기존 생성 계약과 사용량 동작을 회귀 테스트로 고정

**Files:**

- Modify: `apps/api/src/aiContentGenerationInput.test.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.test.ts`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`

- [ ] 기존 `card_news | blog | marketing` create/update/start/list/get/retry 계약을 fixture로 고정한다.
- [ ] `content-generation-input.v2` snapshot을 retry 시 재사용하는 동작을 고정한다.
- [ ] subject analysis facts에서 raw HTML/visible text를 worker fact로 보내지 않는 테스트를 유지한다.
- [ ] 생성 일일 10회, 신규 다운로드 20회, 같은 output 재다운로드 비차감을 고정한다.
- [ ] attachment 총 5개, 이미지 5MB, 문서별 제한을 고정한다.
- [ ] 현재 reference STEP이 한 번만 렌더링되는 regression assertion을 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentGenerationInput.test.ts aiContentRepository.test.ts server.aiContentCustomer.test.ts aiContentDownload.test.ts
npm run test --workspace @brand-pilot/customer-ui -- useAiContentDraft.test.ts aiContentWizard.test.tsx aiContentGeneration.test.tsx
```

예상 결과: 기존 기준선이 통과한다.

## Task 2: 콘텐츠 orchestration·구현안·URL 용도 스키마 추가

**Files:**

- Create: `db/migrations/060_content_orchestration.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Create: `apps/api/src/contentOrchestrationRepository.pglite.test.ts`

- [ ] `ai_content_generations`에 다음 열을 추가한다.

```sql
alter table ai_content_generations
  add column content_family text,
  add column output_format text,
  add column subject_mode text,
  add column product_service_id uuid,
  add column orchestration_snapshot jsonb,
  add column avatar_snapshot jsonb;
```

- [ ] check constraint를 추가한다.
  - `content_family in ('informational', 'marketing')`
  - `output_format in ('card_news', 'blog', 'single_image', 'channel_text')`
  - `subject_mode in ('brand_topic', 'product_service', 'new_subject')`
  - snapshot은 null 또는 JSON object
- [ ] 기존 행은 `type`으로 family/format을 백필한다.
  - `card_news` → informational/card_news
  - `blog` → informational/blog
  - `marketing` → marketing/single_image
- [ ] `ai_content_generation_references`에 nullable `reference_item_id`와 `roles_json`을 추가한다.
- [ ] roles는 `planning | copy_pattern | visual_composition` 중 1개 이상, 최대 3개를 repository에서 검증한다.
- [ ] 먼저 기존 generation별 reference 개수를 감사한다. 역사 데이터는 자르거나 migration을 실패시키지 않고, `reference_item_id is not null`인 신규 canonical row와 신규 API 요청에만 position 1–5와 한 generation 내 reference item 중복 금지를 강제한다.
- [ ] migration 058에서 추가한 `source_urls.content_purpose`와 `reference_items.content_purpose`를 기존 crawler query와 generation recommendation query가 사용하도록 인덱스·repository 계약을 검증한다.
- [ ] AI 구현안을 검토 가능한 독립 자원으로 저장한다.

```sql
create table ai_content_proposal_batches (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  origin text not null check (origin in ('manual', 'scheduled_crawl')),
  content_family text not null check (content_family in ('informational', 'marketing')),
  request_json jsonb not null check (jsonb_typeof(request_json) = 'object'),
  source_snapshot_json jsonb not null check (jsonb_typeof(source_snapshot_json) = 'array'),
  status text not null check (status in ('queued', 'building', 'ready', 'failed')),
  idempotency_key text not null,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id),
  unique (workspace_id, brand_id, idempotency_key)
);

create table ai_content_proposals (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  batch_id uuid not null,
  position integer not null check (position between 1 and 3),
  proposal_json jsonb not null check (jsonb_typeof(proposal_json) = 'object'),
  status text not null check (status in ('suggested', 'selected', 'dismissed')),
  generation_id uuid,
  selected_by_user_id uuid references app_users(id) on delete set null,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id),
  unique (batch_id, position)
);
```

- [ ] batch/proposal/generation/product/reference/avatar 관계는 모두 `(id, workspace_id, brand_id)` 복합 FK를 사용한다.
- [ ] batch당 `status='selected'` proposal은 하나만 허용하는 partial unique index를 둔다. select transaction은 batch row를 잠그고 선택 항목에 actor/시각을 기록하며 나머지 suggested proposal을 원자적으로 dismiss한다.
- [ ] 비동기 proposal build를 위한 `ai_content_proposal_jobs`를 추가한다. job은 batch 복합 FK, queued/processing/completed/failed 상태, lease owner/token/expiry, bounded attempt와 error code를 가지며 사용자 입력 원문 대신 검증된 request/source snapshot을 참조한다.
- [ ] source snapshot에는 URL, crawl 시각, content hash, 요약, 출처 ID를 저장해 나중에 URL 내용이 바뀌어도 제안 근거를 재현한다.
- [ ] generation orchestration snapshot에는 정확한 `brandCoreVersionId`, `ruleSetId`, `productServiceVersionId`, `wikiVersionId`, proposal ID, reference/version snapshots, avatar/image snapshots를 저장한다.
- [ ] product service FK와 avatar snapshot은 같은 brand의 승인/활성 원본에서 시작했는지 start transaction에서 검증한다.
- [ ] 기존 retry snapshot은 백필 후에도 그대로 parse된다.
- [ ] draft/archived/cross-brand library ID와 승인되지 않은 Core/product/Wiki 버전을 거절하고 retry가 현재 active 데이터를 재조회하지 않는 invariant를 테스트한다.
- [ ] 060 migration의 빈 DB, 기존 fixture upgrade, idempotent backfill, cross-tenant FK, 동시 proposal select/start와 repository-contract 목록/schema smoke를 같은 task에서 검증한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api -- contentOrchestrationRepository.pglite.test.ts
```

예상 결과: 기존 generation을 읽을 수 있고 새 generation만 추가 메타데이터를 요구한다.

## Task 3: orchestration·AI 구현안 계약과 결정적 worker mapping 구현

**Files:**

- Create: `apps/api/src/contentOrchestration.ts`
- Create: `apps/api/src/contentOrchestration.test.ts`
- Modify: `apps/api/src/aiContentContracts.ts`
- Modify: `apps/api/src/aiContentGenerationInput.ts`
- Modify: `apps/api/src/aiContentGenerationInput.test.ts`

- [ ] 새 계약을 정의한다.

```ts
export type ContentFamily = "informational" | "marketing";
export type OutputFormat = "card_news" | "blog" | "single_image" | "channel_text";
export type ContentChannelTarget =
  | "instagram"
  | "threads"
  | "x"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "blog_export";
export type MessageStrategy =
  | "problem_solution"
  | "how_to"
  | "comparison"
  | "faq"
  | "insight"
  | "benefit"
  | "social_proof"
  | "brand_story"
  | "cta";

export interface ContentOrchestrationV1 {
  contractVersion: "content-orchestration.v1";
  contentFamily: ContentFamily;
  subject:
    | { mode: "brand_topic"; topic: string; wikiItemIds: string[] }
    | { mode: "product_service"; productServiceId: string }
    | { mode: "new_subject"; subjectAnalysisId: string };
  target: { id: string | null; snapshot: Record<string, unknown> };
  strategy: MessageStrategy;
  outputFormat: OutputFormat;
  channelTargets: ContentChannelTarget[];
  brief: Record<string, unknown>;
  references: Array<{
    referenceItemId: string;
    roles: Array<"planning" | "copy_pattern" | "visual_composition">;
  }>;
  avatar: null | { mode: "library" | "one_time"; id: string; snapshot: Record<string, unknown> };
}
```

- [ ] 완성 콘텐츠가 아닌 제작 설계안을 표현하는 계약을 추가한다.

```ts
export interface ContentProposalV1 {
  contractVersion: "content-proposal.v1";
  title: string;
  reasonToCreateNow: string;
  contentFamily: ContentFamily;
  topic: string;
  target: Record<string, unknown>;
  messageStrategy: MessageStrategy;
  hook: string;
  keyMessage: string;
  evidence: Array<{ sourceSnapshotId: string; summary: string }>;
  outline: Array<{ heading: string; purpose: string }>;
  outputFormat: OutputFormat;
  channelTargets: ContentChannelTarget[];
  recommendedReferenceQuery: {
    strategies: MessageStrategy[];
    formats: OutputFormat[];
    tags: string[];
  };
}
```

- [ ] proposal batch 요청의 근거를 versioned 계약으로 정의한다.

```ts
export interface ContentProposalRequestV1 {
  contractVersion: "content-proposal-request.v1";
  contentFamily: ContentFamily;
  subjectInput: Record<string, unknown>;
  channelTargets: string[];
  outputFormats: OutputFormat[];
  sourceSnapshotIds: string[];
  performanceSnapshotIds: string[];
}
```

- [ ] `구성안` 또는 `구현안`은 위 계약을 뜻하며 완성 이미지·본문·게시물을 뜻하지 않는다.
- [ ] proposal builder는 선택한 family와 일치하는 `content_purpose` URL snapshot만 우선 사용하고 `both`를 보조로 사용한다.
- [ ] 크롤링 실패 URL은 마지막 성공 snapshot을 stale 표시와 함께 사용할 수 있지만, snapshot이 전혀 없으면 근거 목록에서 제외한다.
- [ ] 제안마다 어떤 URL 요약을 사용했는지 evidence로 표시하고 원문에 없는 제품 사실을 만들지 않는다.
- [ ] mapping을 한 함수에 고정한다.

```ts
export function mapOrchestrationToWorkerType(
  input: Pick<ContentOrchestrationV1, "contentFamily" | "outputFormat">
): AiContentType {
  if (input.outputFormat === "card_news") return "card_news";
  if (input.outputFormat === "blog") return "blog";
  return "marketing";
}
```

- [ ] `single_image`와 `channel_text`는 marketing worker에 전달하되 `creativeDirection.outputFormat`과 `contentFamily`를 추가해 정적 이미지 또는 text-only 결과를 구분한다.
- [ ] `content-generation-input.v2`의 version string과 기존 필수 필드는 유지하고 nullable `orchestration` envelope만 추가한다.
- [ ] 기존 worker parser가 unknown field를 허용하는 회귀 테스트를 먼저 추가한다.
- [ ] brand topic은 product analysis를 가짜로 생성하지 않는다. 승인 Brand Core, 선택 Wiki, 직접 topic을 `subject` snapshot으로 조합한다.
- [ ] product service는 active approved version snapshot을 사용한다.
- [ ] new subject는 기존 analysis snapshot 경로를 사용한다.
- [ ] 신규 caller는 `approvedBrandContextProvider`와 승인 product/Wiki selector만 사용한다. legacy `brand_profiles`와 synthetic brand-intelligence Wiki row를 직접 읽지 않는다.
- [ ] channel target은 여섯 catalog와 blog export를 읽을 수 있지만 capability의 `generationFormats/exportModes/publishModes`가 허용한 조합만 start할 수 있다. YouTube/TikTok은 현재 generation start에서 거절한다.
- [ ] 외부 references는 `references`에만 들어가고 `subject.facts`나 `brandContext`로 승격되지 않는다.
- [ ] invalid strategy/family/format 조합, reference 6개, avatar 2개를 거절한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- contentOrchestration.test.ts aiContentGenerationInput.test.ts
```

예상 결과: 모든 지원 조합이 기존 worker type으로 결정적으로 매핑되고 신뢰 경계가 유지된다.

## Task 4: 구현안 생성 API와 generation start transaction 확장

**Files:**

- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Create: `apps/api/src/contentProposalJobs.ts`
- Create: `apps/api/src/contentProposalJobs.test.ts`
- Create: `apps/api/src/server.contentProposalWorker.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/aiContentManifest.ts`

- [ ] create input은 기존 `type` caller를 계속 받고, 새 caller는 `orchestration`을 전달할 수 있게 한다.
- [ ] 다음 proposal API를 추가한다.

| Method | Path | 책임 |
|---|---|---|
| POST | `/brands/:brandId/ai-content/proposal-batches` | 3개 accordion 입력으로 구현안 생성 요청 |
| GET | `/brands/:brandId/ai-content/proposal-batches/:batchId` | 진행·실패·2–3개 구현안 조회 |
| GET | `/brands/:brandId/ai-content/proposals?status=suggested` | 자동 크롤링·예약 제안 검토함 |
| POST | `/brands/:brandId/ai-content/proposals/:proposalId/select` | 선택 snapshot을 generation draft에 연결 |
| POST | `/brands/:brandId/ai-content/proposals/:proposalId/dismiss` | 제안 보관 제외 |

- [ ] proposal POST는 저장된 최신 성공 crawl snapshot으로 즉시 요청을 만들고, 오래됐거나 없는 URL의 재수집은 별도 crawl job으로 enqueue한다.
- [ ] proposal POST는 HTTP request 안에서 LLM을 호출하지 않는다. 검증된 snapshot으로 batch와 proposal job을 한 transaction에 만들고 `202 Accepted + batchId`를 반환한다.
- [ ] performance 화면에서 전달한 snapshot ID는 현재 brand 소유권과 관측 완료 상태를 검증한 뒤 evidence로 snapshot한다.
- [ ] 사용자는 모든 재수집이 끝날 때까지 기다리지 않는다. 새 snapshot이 나중에 도착해도 이미 생성된 proposal batch를 자동 변경하지 않는다.
- [ ] 기존 `automatedCardNews.ts`와 scheduler는 기능 플래그가 켜졌을 때 `origin='scheduled_crawl'` proposal batch를 만들도록 고도화한다.
- [ ] 예약 자동화는 proposal을 사용자 승인 없이 generation/publish로 넘기지 않는다.
- [ ] 첫 Ubuntu 배포 환경값은 `AUTOMATED_CONTENT_ENABLED=false`, 향후 활성화 시 기본 mode는 `proposal`로 한다.
- [ ] 새 caller의 `type`은 서버가 mapping 결과와 동일한지 검증하고 다르면 `ai_content_type_mapping_mismatch`를 반환한다.
- [ ] proposal create/select/dismiss와 generation create/update/start는 authenticated `actorUserId`를 저장하고 같은 workspace/brand의 active membership을 repository에서 검증한다.
- [ ] proposal select는 batch row를 잠근 뒤 하나만 selected로 만들고 나머지를 dismiss한다. 다른 brand, draft/failed batch, 이미 다른 proposal이 선택된 경우를 명시적 404/409로 거절한다.
- [ ] update draft는 orchestration draft와 reference role을 저장하되 usage를 차감하지 않는다.
- [ ] avatar/reference archive API가 사용할 `GET /brands/:brandId/ai-content/draft-references?assetType=&assetId=`를 추가해 058 이후의 실제 미완료 draft 참조만 반환한다. Libraries UI는 이 계약이 배포된 뒤에만 archive 경고를 켠다.
- [ ] start transaction은 다음을 한 번에 수행한다.
  1. usage 10회 한도 확인
  2. Brand Core active version 확인
  3. subject source snapshot
  4. Wiki item snapshot
  5. reference 0–5 snapshot과 role 저장
  6. avatar 0–1 snapshot
  7. 정확한 Core/rule/product/Wiki/proposal/reference/avatar version ID를 포함한 orchestration snapshot 저장
  8. output/job 생성과 usage ledger 기록
- [ ] 실패 시 snapshot, output, usage ledger가 일부만 남지 않게 rollback한다.
- [ ] retry는 원본 snapshot을 사용하고 current library 변경을 다시 읽지 않는다.
- [ ] 기존 `listReferences(type)` endpoint는 호환용으로 유지하고 새 library endpoint를 위저드가 사용한다.
- [ ] manifest에 family/strategy/output format을 optional metadata로 남긴다.
- [ ] worker endpoint를 추가한다.
  - `POST /worker/content-proposal-jobs/claim`
  - `POST /worker/content-proposal-jobs/:jobId/heartbeat`
  - `POST /worker/content-proposal-jobs/:jobId/complete`
  - `POST /worker/content-proposal-jobs/:jobId/fail`
- [ ] worker route는 전용 token, lease owner/token, bounded attempt, idempotent complete를 검증하고 client가 제출한 workspace/brand를 신뢰하지 않는다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- aiContentRepository.test.ts contentProposalJobs.test.ts server.contentProposalWorker.test.ts server.aiContentCustomer.test.ts aiContentManifest.test.ts aiContentDownload.test.ts
npm run build --workspace @brand-pilot/api
```

예상 결과: start가 원자적이고 기존 클라이언트·worker 계약이 통과한다.

- [ ] 구현 커밋:

```bash
git add db/migrations/060_content_orchestration.sql apps/api/src/contentOrchestration* apps/api/src/contentProposalJobs* apps/api/src/server.contentProposalWorker.test.ts apps/api/src/aiContentContracts.ts apps/api/src/aiContentGenerationInput* apps/api/src/aiContentRepository* apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/aiContentManifest.ts scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs
git commit -m "feat(content): add content family orchestration"
```

## Task 5: AI 구성안 전용 비동기 worker 구현

**Files:**

- Create: `workers/brand-pilot-content-proposal-worker/package.json`
- Create: `workers/brand-pilot-content-proposal-worker/tsconfig.json`
- Create: `workers/brand-pilot-content-proposal-worker/src/contracts.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/contracts.test.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/promptBuilder.test.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/client.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/worker.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/worker.test.ts`
- Create: `workers/brand-pilot-content-proposal-worker/src/main.ts`
- Modify: `package-lock.json`

- [ ] 구성안 LLM 호출의 소유자는 Fastify HTTP handler나 기존 card/blog/marketing worker가 아니라 이 전용 worker 하나로 고정한다.
- [ ] worker는 lease된 job의 `ContentProposalRequestV1`과 서버가 이미 고정한 Core/rule/product/Wiki/URL/performance snapshot만 입력으로 받는다. 외부 URL을 다시 fetch하거나 현재 active 데이터를 재조회하지 않는다.
- [ ] prompt는 2–3개의 서로 구별되는 `ContentProposalV1`을 요구하고 topic, target, hook, key message, outline/card structure, format, channel, source evidence를 빠짐없이 반환하게 한다.
- [ ] 외부 reference/crawl 문장은 영감·근거 요약으로만 사용하고 자사 제품 사실로 승격하지 않는다. prompt injection으로 보이는 source text는 quoted untrusted data boundary 안에 둔다.
- [ ] worker는 strict parser를 통과한 결과만 complete한다. 일부 proposal만 유효하면 전체를 실패시켜 사용자가 동일 snapshot으로 재시도하게 하고 임의 보정값을 만들지 않는다.
- [ ] heartbeat, graceful shutdown, bounded retry, lease loss, duplicate complete를 기존 worker 패턴과 동일하게 구현한다.
- [ ] scheduled와 manual batch는 같은 worker를 사용하되 scheduled origin도 proposal까지만 만들고 generation/publish를 호출하지 않는다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/content-proposal-worker
npm run test --workspace @brand-pilot/api -- contentProposalJobs.test.ts server.contentProposalWorker.test.ts
```

예상 결과: HTTP 응답을 오래 막지 않고, 고정된 snapshot에서만 재현 가능한 구성안 2–3개가 생성된다.

- [ ] 구현 커밋:

```bash
git add workers/brand-pilot-content-proposal-worker package-lock.json
git commit -m "feat(content): add asynchronous proposal worker"
```

## Task 6: 생성 worker가 family와 output format을 안전하게 사용

**Files:**

- Modify: `workers/brand-pilot-card-news-worker/src/contracts.ts`
- Create: `workers/brand-pilot-card-news-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/contracts.ts`
- Create: `workers/brand-pilot-blog-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-blog-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/contracts.ts`
- Create: `workers/brand-pilot-marketing-worker/src/contracts.test.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-marketing-worker/src/promptBuilder.test.ts`

- [ ] 모든 worker parser가 optional `orchestration`을 검증해 전달하고 없는 기존 payload는 현재처럼 처리한다.
- [ ] prompt 우선순위를 고정한다.

```text
승인 Brand Core/규칙
  > 승인 제품·서비스 또는 선택 Wiki 사실
  > 사용자가 확정한 target/strategy/brief
  > 레퍼런스의 패턴 영감
```

- [ ] informational은 교육·문제 해결·가이드 톤, marketing은 효익·신뢰·CTA 톤을 사용한다.
- [ ] 레퍼런스의 원문 문장을 그대로 복제하라는 지시는 prompt에 넣지 않는다.
- [ ] `outputFormat='channel_text'`이면 marketing worker가 text artifact만 만들고 이미지 job을 생성하지 않는다.
- [ ] `outputFormat='single_image'`이면 정적 이미지와 copy를 생성한다.
- [ ] avatar snapshot은 visual prompt에만 들어가고 제품 fact나 copy fact로 들어가지 않는다.
- [ ] `reel`, `video`, `voice`, `face swap` 요청이 brief에 있어도 user-facing video job을 만들지 않고 validation error로 반환한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/card-news-worker
npm run test --workspace @brand-pilot/blog-worker
npm run test --workspace @brand-pilot/marketing-worker
npm run build --workspaces --if-present
```

예상 결과: 기존 v2 fixture와 새 orchestration fixture가 모두 통과한다.

- [ ] 구현 커밋:

```bash
git add workers/brand-pilot-card-news-worker workers/brand-pilot-blog-worker workers/brand-pilot-marketing-worker
git commit -m "feat(workers): honor content family and output format"
```

## Task 7: 고객 UI draft와 4개 상위 phase state machine 정의

**Files:**

- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.test.ts`
- Create: `apps/customer-ui/src/features/ai-content/contentWizardMachine.ts`
- Create: `apps/customer-ui/src/features/ai-content/contentWizardMachine.test.ts`

- [ ] 화면 상태를 accordion step과 상위 phase로 분리한다.

```ts
export type ContentCreationPhase =
  | "setup"
  | "proposal_selection"
  | "generating"
  | "reviewing";

export type ContentSetupSection = "intent" | "sources" | "delivery";
```

- [ ] 기존 `AiContentWizardStep`은 API read compatibility를 위해 유지하고 UI에서는 phase/section adapter를 사용한다.
- [ ] gateway에 proposal batch create/get, suggested list, select/dismiss, draft-reference 조회 메서드를 먼저 추가하고 모든 poll request에 abort/stale-response 방지를 적용한다.
- [ ] draft에 orchestration field를 추가하되 deprecated field를 한 릴리스 유지한다.
- [ ] 상위 phase 책임을 고정한다.

| 상위 phase | 책임 |
|---|---|
| 콘텐츠 생성 | 3개 accordion에서 구현안 생성에 필요한 조건 입력 |
| 구현안 선택 | AI 제안 2–3개 비교, 실제 레퍼런스 0–5개와 아바타 0–1개 선택 |
| 생성 | worker 진행 상태와 취소 불가 구간 안내 |
| 변경·검토·보완 | 기획·카피·완성본 검토, 수정·부분 재생성·승인 |

- [ ] `setup`의 accordion 책임을 고정한다.

| accordion | 필수 결정 | 열리는 시점 |
|---|---|---|
| 1. 목적 | 정보성/마케팅성, 목적 | 최초 |
| 2. 주제·자료 | brand topic, 저장 제품·서비스 또는 새 분석, family별 URL snapshot | 1 완료 후 |
| 3. 채널·형식 | target, channel, output format, 제작 조건 | 2 완료 후 |

- [ ] accordion을 완료하면 다음 section을 열고 이전 section은 요약 상태로 접는다. 사용자는 이전 section을 다시 열어 수정할 수 있다.
- [ ] 제품·Wiki·채널·레퍼런스를 최초 진입에서 전부 요청하지 않는다.
  - 1 완료 후 family별 topic/source 요약 요청
  - 2 완료 후 channel capability/target/format 요청
  - proposal ready 후 실제 reference content와 avatar 요청
- [ ] state machine은 건너뛴 필수 section이나 phase로 직접 이동하지 못하게 한다.
- [ ] `/ai-content/new?proposalBatch=<uuid>` 진입은 batch 소유권/status를 확인한 뒤 `proposal_selection`을 복원한다. 다른 brand, invalid UUID, failed batch는 setup으로 돌아가며 사용 가능한 입력을 잃지 않는다.
- [ ] 이전 단계 수정 시 의존 selection만 무효화한다.
  - family 변경 → strategy 추천과 format validity 재검증
  - subject 변경 → target/appeal reset
  - target 변경 → appeal reset
  - reference filter 변경 → 선택값 유지
- [ ] local draft restore 시 library item이 archived이면 사용자에게 교체/제거를 요구한다.
- [ ] reference/avatar는 setup accordion에 나타나지 않고 `proposal_selection`에서만 한 번 나타나는 테스트를 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts useAiContentDraft.test.ts contentWizardMachine.test.ts
```

예상 결과: 선택 무효화와 resume 동작이 결정적이다.

## Task 8: 콘텐츠 생성 phase의 3개 순차 accordion 구현

**Files:**

- Create: `apps/customer-ui/src/components/ai-content/ContentFamilyStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentSubjectStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentStrategyStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentProposalInbox.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/GenerationPromptStep.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentHomePage.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Create: `apps/customer-ui/src/styles/content-wizard.css`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] 상단 progress는 `콘텐츠 생성 → 구현안 선택 → 생성 → 변경·검토·보완`을 표시한다.
- [ ] `/ai-content` 홈에 `검토할 AI 제안` 영역을 두고 scheduled crawl proposal의 실제 topic/evidence/status를 보여준다. 선택하면 `/ai-content/new?proposalBatch=<uuid>`로 이동하고, dismiss는 확인 후 서버 상태를 갱신한다.
- [ ] setup은 main accordion + sticky 입력 요약 2열, 1080px 이하 1열로 구현한다.
- [ ] accordion 1은 정보성/마케팅성 카드와 실제 설명만 표시한다.
- [ ] accordion 2는 다음 세 진입을 제공한다.
  - 브랜드 주제: 직접 topic + 추천 Wiki
  - 저장 제품·서비스: 승인 active item 검색/선택
  - 새 제품·서비스 분석: 기존 URL/첨부/직접 입력 flow
- [ ] accordion 2에서 등록된 reference URL을 `정보성`, `마케팅성`, `둘 다`로 filter하고 실제 crawl 제목·요약·마지막 성공 시각을 표시한다.
- [ ] URL 용도 변경·추가는 레퍼런스 보관함 API를 사용하며 활성 URL 10개 제한을 유지한다.
- [ ] 새 분석 완료 후 `이번 생성만 사용`과 `제품·서비스 보관함에 저장`을 명확히 분리한다.
- [ ] accordion 3은 subject에 맞는 target, output format, channel, brief를 한 화면에 둔다. 구체적인 AI message strategy와 outline은 다음 proposal phase가 제안한다.
- [ ] 채널 선택은 `/channels`의 capability 응답을 사용한다.
  - 등록·연결은 별도 `/channels` 화면에서 수행한다.
  - 생성/변환, 내보내기, API 게시 capability를 구분한다.
  - Instagram, Threads, X, LinkedIn, YouTube, TikTok 카탈로그는 보존한다.
  - 영상이 필요한 YouTube/TikTok 선택은 현재 정적·텍스트 생성 형식에서 비활성화하고 사유를 표시한다.
- [ ] 정보성에 product가 필수라는 validation을 제거하고 brand topic 근거를 요구한다.
- [ ] marketing에서 제품 없이 진행할 경우 Brand Core에 근거한 brand story만 허용하고 제품 주장을 만들지 않는다.
- [ ] format 선택에서 video, Reel, Shorts, TikTok은 표시하지 않는다.
- [ ] static Story는 channel format 옵션으로만 유지한다.
- [ ] accordion 3의 CTA 문구는 `AI 구성안 만들기`이며 성공 시 `proposal_selection`으로 이동한다.
- [ ] proposal 생성 중에는 현재 입력 요약, 사용 중인 crawl snapshot 수, skeleton, 취소/재시도 상태를 보여준다.
- [ ] `/ai-content`, `/ai-content/new`의 setup/proposal-loading help guide와 coachmark anchor를 같은 commit에 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- aiContentWizard.test.tsx aiContentHome.test.tsx SubjectAnalysisStep.test.tsx TargetAppealStep.test.tsx GenerationPromptStep.test.tsx helpGuidance.test.tsx
```

예상 결과: 3개 accordion을 순서대로 완료하고 레퍼런스·아바타를 미리 불러오지 않은 상태에서 AI 구현안 생성을 요청한다.

## Task 9: AI 구현안 비교와 단일 레퍼런스·아바타 선택 phase 구현

**Files:**

- Create: `apps/customer-ui/src/components/ai-content/ReferenceAvatarStep.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ReferenceAvatarStep.test.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentProposalCard.tsx`
- Create: `apps/customer-ui/src/components/ai-content/ContentProposalComparison.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/ReferencePicker.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/pages/ReferenceLibraryPage.tsx`
- Modify: `apps/customer-ui/src/components/brand-center/AvatarLibraryPanel.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/referenceLibrary.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/avatarLibrary.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] 구현안 2–3개를 다음 항목으로 실제 비교한다.
  - 지금 만들 이유
  - topic/target/message strategy/hook
  - 사용한 URL 요약과 crawl 시각
  - outline 또는 카드 구성
  - output format/channel
- [ ] 구현안 하나를 선택하기 전에는 reference library의 전체 미디어를 요청하지 않는다.
- [ ] 구현안 선택 후 recommended query로 실제 reference content와 avatar를 지연 로드한다.
- [ ] reference UI에는 mockup HTML placeholder가 아니라 origin별 실제 내용을 표시한다.
  - 저장 Instagram: 실제 media preview와 caption snapshot
  - reference URL: OG image, crawl title, 실제 요약
  - 자사 우수 콘텐츠: 실제 artifact preview와 성과
  - 직접 upload: 실제 thumbnail/file metadata
  - 접근 불가: `미리보기 없음`, 마지막 snapshot, 원본 링크
- [ ] 가짜 썸네일·샘플 caption·하드코딩 성과 수치는 사용하지 않는다.
- [ ] 이 phase에만 다음 reference tabs를 제공한다.
  - AI 추천
  - 브랜드별
  - 전략별
  - 보관함
  - 최근 사용
  - 직접 추가
- [ ] reference 0–5개를 선택하고 각 항목에 planning/copy pattern/visual composition 역할을 하나 이상 지정한다.
- [ ] role은 toggle group으로 keyboard 조작 가능하고 `aria-pressed`를 사용한다.
- [ ] avatar slot은 같은 화면 오른쪽/하단에 하나만 둔다.
  - 기존 avatar
  - 업로드 후 저장
  - 이번 생성에만 사용
  - 사용 안 함
- [ ] 사람 이미지를 기존 attachment role `person`으로 중복 선택하는 UI는 제거하고 legacy draft read만 유지한다.
- [ ] reference 필터가 바뀌어도 선택 drawer는 유지한다.
- [ ] 레퍼런스 보관함의 `콘텐츠로 사용`은 `/ai-content/new?reference=<referenceId>`로 이동한다.
  - gateway가 같은 brand의 active reference인지 검증한다.
  - query는 draft의 `seedReferenceId`로만 저장하고 setup phase에서는 큰 미디어를 요청하지 않는다.
  - proposal을 하나 선택해 reference 목록을 지연 로드한 뒤 해당 seed item을 최초 선택 상태로 표시한다.
  - 잘못되거나 archived인 ID는 non-blocking 안내 후 제거한다.
- [ ] archived/missing asset은 최종 생성 전에 교체 또는 제거를 요구한다.
- [ ] 058의 draft-reference API를 사용해 avatar/reference archive dialog에 실제 미완료 draft 참조를 경고한다. 조회 실패 시 참조 없음으로 간주하지 않고 archive를 중단하거나 명시적 재시도를 제공한다.
- [ ] 선택 요약에 family, subject, target, strategy, format, channels, refs, avatar, usage를 표시한다.
- [ ] 생성 버튼은 usage 확인과 start를 한 번만 호출하고 double-click을 막는다.
- [ ] 버튼 문구는 `이 구현안으로 생성`이고 클릭 후 상위 phase를 `generating`으로 바꾼다.
- [ ] proposal selection/reference/avatar 선택 상태에 맞는 help guide를 추가하고 dialog가 닫힐 때 guide/trigger focus를 복원한다.
- [ ] 테스트에 0개 허용, 5개 허용, 6번째 차단, 중복 차단, role 없음 차단, avatar 2개 차단, 직접 upload 실패 후 입력 보존을 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- ReferenceAvatarStep.test.tsx aiContentWizard.test.tsx referenceLibrary.test.tsx avatarLibrary.test.tsx AiContentAttachmentUploader.test.tsx helpGuidance.test.tsx
```

예상 결과: 실제 콘텐츠 기반 reference/avatar 선택 영역이 구현안 선택 phase에 정확히 한 번 렌더링되고 초기 페이지 로딩을 막지 않는다.

- [ ] UI 커밋:

```bash
git add apps/customer-ui/src/features/ai-content apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/components/ai-content apps/customer-ui/src/components/brand-center/AvatarLibraryPanel.tsx apps/customer-ui/src/pages/AiContentHomePage.tsx apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/pages/ReferenceLibraryPage.tsx apps/customer-ui/src/styles/content-wizard.css apps/customer-ui/src/__tests__/aiContentHome.test.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx apps/customer-ui/src/__tests__/referenceLibrary.test.tsx apps/customer-ui/src/__tests__/avatarLibrary.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx
git commit -m "feat(content): build four-phase proposal flow"
```

## Task 10: 생성 phase와 변경·검토·보완 phase 연결

**Files:**

- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/pages/AiContentGenerationPage.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`

- [ ] create/update/start payload가 orchestration을 포함하고 legacy type을 mapping한 값으로 전송한다.
- [ ] generating phase는 batch/proposal/generation ID와 output별 상태만 poll하고 library API를 다시 호출하지 않는다.
- [ ] 서버 validation field error를 단계와 field로 다시 연결한다.
- [ ] 완료 후 phase를 `reviewing`으로 바꾸고 결과 상세를 `기획 근거`, `카피`, `완성본`, `게시` tabs로 구성한다.
- [ ] 기획 근거에 family, selected proposal, strategy, format, subject, URL evidence, reference roles, avatar snapshot을 표시한다.
- [ ] 변경·검토·보완은 전체 재생성 외에 hook/copy/개별 카드 등 지원되는 범위의 부분 재생성을 제공한다.
- [ ] 원본 library가 변경·archive돼도 generation snapshot을 표시한다.
- [ ] 실패 output만 retry하고 성공 output은 교체하지 않는다.
- [ ] 개별, 선택 ZIP, 전체 ZIP과 신규 다운로드 비차감 안내를 유지한다.
- [ ] dynamic `/ai-content/:generationId`의 generating/reviewing 상태별 help guide를 이 task에서 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- aiContentApiGateway.test.ts aiContentGeneration.test.tsx AiContentArtifactPreview.test.tsx ArtifactCarousel.test.tsx helpGuidance.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: 새 metadata가 보이면서 기존 preview/download/retry가 유지된다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/features/ai-content apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/pages/AiContentGenerationPage.tsx apps/customer-ui/src/__tests__/aiContentGeneration.test.tsx apps/customer-ui/src/__tests__/helpGuidance.test.tsx
git commit -m "feat(content): connect generation review and revision"
```

## Task 11: 생성 E2E, 계약, 제외 기능 검증

**Files:**

- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`
- Create: `apps/customer-ui/e2e/d-hybrid-content-wizard.spec.ts`
- Modify: `scripts/ai-content-smoke.mjs`
- Modify: `scripts/ai-content-subject-smoke.mjs`
- Modify: `scripts/repository-contract.test.mjs`

- [ ] 다음 E2E를 구현한다.
  1. 3개 accordion lazy load와 이전 section 수정
  2. 정보성 URL만 사용한 구현안 2–3개와 evidence 표시
  3. 마케팅성 URL만 사용한 구현안과 실제 reference preview
  4. 정보성 + brand topic + card news + reference 0개
  5. 정보성 + 저장 제품 + blog + reference roles 2개
  6. 마케팅성 + 새 제품 분석 + single image + avatar 1개
  7. marketing + channel text + image job 없음
  8. reload/resume 후 proposal/reference/avatar 선택 유지
  9. usage limit 도달과 double submit 차단
  10. `/channels`에서 등록 상태를 바꾸면 accordion 3 capability가 갱신됨
  11. `/references`의 실제 item에서 시작해 reload 후 proposal 선택 시 seed reference가 선택됨
  12. 성과 화면에서 만든 `proposalBatch`가 reload 후 같은 구현안 선택 phase로 복원되고 다른 brand ID는 거절됨
  13. scheduled crawl proposal이 `/ai-content` 검토함에 나타나고 선택/dismiss 후 새로고침 상태가 유지됨
- [ ] contract test는 기존 v2 payload와 새 optional orchestration payload를 모두 검증한다.
- [ ] UI와 API에서 Reel/video job 생성 시도가 차단되는 negative test를 추가한다.
- [ ] reference unsupported claim이 subject fact에 없음을 smoke로 확인한다.
- [ ] 기존 자동 crawl scheduler가 기능 플래그 OFF일 때 proposal/generation을 만들지 않고, ON+proposal mode에서 검토할 proposal만 만드는지 검증한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test:contract
npm run smoke:ai-content
npm run smoke:ai-content-subject
npm run e2e --workspace @brand-pilot/customer-ui -- d-hybrid-content-wizard.spec.ts ai-content-runtime.spec.ts
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/content-proposal-worker
npm run test --workspace @brand-pilot/customer-ui
npm run build
```

예상 결과: 신규 세 흐름과 기존 생성 회귀가 통과하고 사용자 영상 작업은 생성되지 않는다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/e2e scripts/ai-content-smoke.mjs scripts/ai-content-subject-smoke.mjs scripts/repository-contract.test.mjs
git commit -m "test(content): verify d-hybrid generation compatibility"
```
