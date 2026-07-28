# D Hybrid Brand Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온보딩에서 수집·분석한 자료를 브랜드 센터에서 `원본 자료 → AI 제안 → 사용자 승인 Brand Core → 실행 규칙`으로 명확히 분리하고, 사용자가 AI 자동 입력값을 검토·수정·승인할 수 있게 한다.

**Architecture:** 기존 `brand_analysis_runs`와 `brand_profiles.active_brand_analysis_id`는 분석 이력과 호환 포인터로 유지한다. 새 versioned `brand_core_versions`와 `brand_rule_sets`를 추가해 승인 데이터의 권한을 분리하고, 기존 confirm endpoint가 최초 Brand Core를 원자적으로 생성하게 한다. React의 `/brand-center`는 readiness summary와 B형 탭 구조를 제공하며 기존 `/sources`, `/brand-settings`, 온보딩 화면을 재사용 가능한 panel로 분해한다.

**Tech Stack:** PostgreSQL migrations, Fastify, TypeScript, PGlite/Vitest, React, Testing Library, Playwright.

---

## Task 1: 기존 브랜드 분석·확정 계약을 회귀 테스트로 고정

**Files:**

- Modify: `apps/api/src/brandIntelligenceContracts.test.ts`
- Modify: `apps/api/src/brandIntelligenceRepository.test.ts`
- Modify: `apps/api/src/server.brandIntelligenceCustomer.test.ts`
- Modify: `apps/customer-ui/src/__tests__/brandIntelligenceOnboarding.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.regression-1.test.tsx`

- [ ] 현재 `result_json`, `edited_result_json`, `confirmed`, `active_brand_analysis_id`의 읽기·쓰기 동작을 fixture로 고정한다.
- [ ] AI 분석을 다시 실행해도 기존 확정 프로필이 즉시 바뀌지 않는 테스트를 추가한다.
- [ ] confirm이 brand profile과 Wiki build request를 함께 갱신하는 기존 동작을 고정한다.
- [ ] 업로드 5개, 파일당 10MB, 지원 형식 검증 회귀를 유지한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- brandIntelligenceContracts.test.ts brandIntelligenceRepository.test.ts server.brandIntelligenceCustomer.test.ts
npm run test --workspace @brand-pilot/customer-ui -- brandIntelligenceOnboarding.test.tsx brandSettings.regression-1.test.tsx
```

예상 결과: 현재 기준선이 통과한다. 실패하면 새 설계 전에 기존 오류를 별도 수정한다.

## Task 2: Brand Core와 실행 규칙 버전 스키마 추가

**Files:**

- Create: `db/migrations/055_brand_core_and_rules.sql`
- Modify: `scripts/migrations.integration.test.mjs`
- Modify: `scripts/repository-contract.test.mjs`
- Create: `apps/api/src/brandCoreRepository.pglite.test.ts`

- [ ] 다음 책임을 갖는 테이블을 추가한다.

```sql
create table brand_core_versions (
  id uuid primary key,
  workspace_id uuid not null,
  brand_id uuid not null,
  source_analysis_id uuid,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded')),
  core_json jsonb not null check (jsonb_typeof(core_json) = 'object'),
  evidence_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_json) = 'array'),
  review_state_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_state_json) = 'object'),
  created_by text not null check (created_by in ('analysis_confirm', 'user', 'migration')),
  created_by_user_id uuid references app_users(id) on delete set null,
  approved_by_user_id uuid references app_users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id, brand_id),
  unique (workspace_id, brand_id, version),
  foreign key (brand_id, workspace_id)
    references brands(id, workspace_id) on delete cascade
);

create unique index brand_core_one_approved
  on brand_core_versions (workspace_id, brand_id)
  where status = 'approved';
```

- [ ] `brand_rule_sets`는 `requiredPhrases`, `forbiddenPhrases`, `exaggerationRules`, `ctaRules`, `channelRules`, `designRules`, `autoApprovalRules`를 `rules_json`에 versioned 저장하고 `UNIQUE(id, workspace_id, brand_id)`, creator/approver actor와 승인 시각을 갖는다.
- [ ] `brand_profiles`에 `active_brand_core_id`, `active_brand_rule_set_id` nullable FK를 추가한다.
- [ ] `brand_analysis_runs`에 `UNIQUE(id, workspace_id, brand_id)`를 추가하고 `source_analysis_id`를 포함한 모든 FK가 반드시 `(id, workspace_id, brand_id)` 범위를 검증하게 한다.
- [ ] profile의 active pointer FK도 동일 복합 키를 사용하고 approved 상태만 pointer가 될 수 있다는 invariant를 repository transaction으로 강제한다.
- [ ] `review_state_json`은 `fieldPath -> { decision: 'ai_suggested' | 'user_edited' | 'approved', reviewerUserId, reviewedAt }`만 허용한다. 화면의 필드별 상태는 이 값에서 읽고 버전 전체 승인 상태와 혼동하지 않는다.
- [ ] 기존 확정 분석을 최초 approved Brand Core로 백필한다.
  - `edited_result_json`이 있으면 우선한다.
  - 없으면 `result_json`을 사용한다.
  - 이미 active Brand Core가 있으면 건너뛴다.
  - 기존 `active_brand_analysis_id`는 유지한다.
- [ ] 기존 `knowledge_entries.__confirmed_brand_intelligence__`는 Brand Core backfill 근거로만 읽고 `legacy_projection`/inactive로 표시해 Wiki compiler와 직접 편집에서 제외한다. 이후 Brand Core가 유일한 편집 가능한 원본이다.
- [ ] migration test에 빈 DB, 기존 확정 분석 1개, synthetic Wiki 중복 배제, 재실행 안전성, 타 브랜드 FK 거절을 추가한다.
- [ ] 이 task 안에서 repository-contract의 migration 목록과 schema smoke를 055까지 갱신한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run test --workspace @brand-pilot/api -- brandCoreRepository.pglite.test.ts
```

예상 결과: 백필 후 브랜드마다 active approved core가 최대 1개이고 기존 분석 행은 변경되지 않는다.

- [ ] 구현 커밋:

```bash
git add db/migrations/055_brand_core_and_rules.sql scripts/migrations.integration.test.mjs scripts/repository-contract.test.mjs apps/api/src/brandCoreRepository.pglite.test.ts
git commit -m "feat(brand): add versioned brand core and rules schema"
```

## Task 3: Brand Core 계약과 validation 구현

**Files:**

- Create: `apps/api/src/brandCoreContracts.ts`
- Create: `apps/api/src/brandCoreContracts.test.ts`
- Modify: `apps/api/src/brandIntelligenceContracts.ts`

- [ ] 승인 필드를 명시적 계약으로 정의한다.

```ts
export interface BrandCoreV1 {
  contractVersion: "brand-core.v1";
  summary: { oneLine: string; description: string };
  audiences: Array<{ name: string; problem: string; desiredOutcome: string }>;
  valueProposition: { primary: string; differentiators: string[]; proofPoints: string[] };
  messaging: {
    appeals: string[];
    tone: string[];
    preferredPhrases: string[];
    brandDirection: string;
    priorityMessages: string[];
  };
}
```

- [ ] 길이, 배열 최대 수, 빈 값, URL/evidence 구조를 field path와 함께 validation한다.
- [ ] AI 분석 결과를 `BrandCoreV1` draft로 매핑하는 `mapAnalysisToBrandCoreDraft`를 만든다.
- [ ] 매핑 함수는 분석에 없는 내용을 만들어내지 않고 빈 값 또는 `needsReview`로 둔다.
- [ ] evidence item은 `fieldPath`, `sourceType`, `sourceId`, `sourceUrl`, `excerpt`, `confidence`를 갖는다.
- [ ] `review_state_json` validator는 계약에 존재하는 field path만 허용하고, AI 제안 → 사용자 수정 → 승인 전이를 검증한다.
- [ ] 테스트는 누락 필드, 과도한 배열, 잘못된 confidence, 알 수 없는 field path, AI draft 매핑을 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- brandCoreContracts.test.ts brandIntelligenceContracts.test.ts
```

예상 결과: 승인 가능한 core와 수정이 필요한 draft가 결정적으로 구분된다.

## Task 4: Brand Core repository와 승인 transaction 구현

**Files:**

- Create: `apps/api/src/brandCoreRepository.ts`
- Create: `apps/api/src/brandCoreRepository.test.ts`
- Create: `apps/api/src/approvedBrandContextProvider.ts`
- Create: `apps/api/src/approvedBrandContextProvider.test.ts`
- Modify: `apps/api/src/brandIntelligenceRepository.ts`
- Modify: `apps/api/src/brandIntelligenceProvider.ts`
- Modify: `apps/api/src/repository.ts`

- [ ] repository 메서드를 구현한다.

```ts
interface BrandCoreRepository {
  getActive(scope: BrandScope): Promise<BrandCoreVersion | null>;
  listVersions(scope: BrandScope): Promise<BrandCoreVersion[]>;
  createDraft(scope: BrandScope & { actorUserId: string }, input: CreateBrandCoreDraft): Promise<BrandCoreVersion>;
  updateDraft(scope: BrandScope & { actorUserId: string; versionId: string }, input: UpdateBrandCoreDraft): Promise<BrandCoreVersion>;
  approve(scope: BrandScope & { actorUserId: string; versionId: string }): Promise<BrandCoreVersion>;
  getActiveRules(scope: BrandScope): Promise<BrandRuleSet | null>;
  saveRuleDraft(scope: BrandScope & { actorUserId: string }, input: BrandRulesV1): Promise<BrandRuleSet>;
  approveRules(scope: BrandScope & { actorUserId: string; ruleSetId: string }): Promise<BrandRuleSet>;
}
```

- [ ] draft 생성·수정은 active workspace member가 할 수 있지만 Core/규칙 승인·대체는 `owner | admin`만 할 수 있다. repository가 HTTP layer의 주장만 믿지 않고 membership을 확인한다.
- [ ] approve transaction은 brand/profile row를 잠그고 기존 approved를 `superseded`로 바꾸고 target draft를 approved로 바꾼 뒤 actor와 승인 시각, profile pointer를 갱신한다.
- [ ] version 승인 시 validation을 통과한 모든 review field를 같은 actor/시각의 `approved`로 원자 전환한다. 일부 필드가 `needsReview`이거나 unknown path이면 version 승인을 거절한다.
- [ ] 새 분석 confirm은 동일 transaction에서 다음을 수행한다.
  1. 분석 edited result 확정
  2. Brand Core draft 매핑
  3. 최초 또는 새 approved core 생성
  4. 기존 brand profile 호환 필드 동기화
  5. Wiki build request 생성
- [ ] `approvedBrandContextProvider`는 active approved Core와 rules만 반환한다. legacy `brand_profiles`와 `brandIntelligenceProvider`는 과도기 호환 projection을 읽을 수 있지만 신규 소비자가 사용할 canonical provider는 이 파일 하나다.
- [ ] 기존 profile update endpoint는 logo, color, link 같은 presentation 필드만 직접 수정한다. summary/tone/CTA/forbidden phrase 등 Core·규칙 필드는 draft 생성으로 변환하거나 `brand_core_update_required`로 거절한다.
- [ ] `autoApprovalRules`는 콘텐츠 검토 제안 조건으로만 저장하고 자동 게시·DM 자동답변 runtime flag를 켜지 않는다.
- [ ] `source_analysis_id`가 다른 브랜드이면 거절한다.
- [ ] approved 버전은 PATCH할 수 없고 새 draft를 fork해야 한다.
- [ ] member 승인 거절, admin 승인 허용, cross-brand actor/resource 거절, 동시 approve 두 건 중 하나만 active가 되는 테스트를 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- brandCoreRepository.test.ts approvedBrandContextProvider.test.ts brandIntelligenceRepository.test.ts
```

예상 결과: 승인 이력이 보존되고 재분석이 기존 approved core를 덮어쓰지 않는다.

## Task 5: Brand Center API 추가

**Files:**

- Create: `apps/api/src/brandCenterHttp.ts`
- Create: `apps/api/src/server.brandCenterCustomer.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`

- [ ] 아래 고객 API를 추가한다.

| Method | Path | 책임 |
|---|---|---|
| GET | `/brands/:brandId/brand-center` | readiness와 영역별 요약 |
| GET | `/brands/:brandId/brand-core` | active core, draft, version history |
| POST | `/brands/:brandId/brand-core/drafts` | active 또는 analysis에서 draft 생성 |
| PATCH | `/brands/:brandId/brand-core/drafts/:versionId` | 사용자 수정 저장 |
| POST | `/brands/:brandId/brand-core/drafts/:versionId/approve` | 사용자 승인 |
| GET | `/brands/:brandId/brand-rules` | active와 draft 규칙 |
| PUT | `/brands/:brandId/brand-rules/draft` | 규칙 draft 저장 |
| POST | `/brands/:brandId/brand-rules/:ruleSetId/approve` | 규칙 승인 |

- [ ] summary 응답은 `source`, `analysis`, `brandCore`, `rules`, `products`, `wiki`, `avatars`의 상태만 제공하며 상세 데이터를 중복 포함하지 않는다.
- [ ] 055만 적용된 이 릴리스에서는 아직 테이블이 없는 `products`, `wiki`, `avatars`를 조회하지 않고 명시적 `{ state: "unavailable" }`로 반환한다. Libraries Tasks 3/4/6이 각 저장소 도입과 동시에 aggregate와 test를 확장한다.
- [ ] HTTP error code를 안정적으로 매핑한다.
  - `brand_core_not_found` → 404
  - `brand_core_not_draft` → 409
  - `brand_core_validation_failed` → 400 with field errors
  - `brand_core_version_conflict` → 409
- [ ] ETag 또는 `updatedAt` optimistic concurrency를 사용해 오래된 브라우저 탭의 덮어쓰기를 막는다.
- [ ] handler는 인증 사용자 ID를 `actorUserId`로 repository에 전달하고, Core/규칙 승인은 owner/admin만 허용한다.
- [ ] 테스트에 auth, member 승인 거절, admin 승인 허용, workspace/brand 격리, empty state, unavailable future sections, conflict, approve를 포함한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/api -- server.brandCenterCustomer.test.ts server.brandIntelligenceCustomer.test.ts
npm run build --workspace @brand-pilot/api
```

예상 결과: 새 endpoint가 기존 분석 endpoint를 깨지 않고 build와 테스트를 통과한다.

- [ ] 구현 커밋:

```bash
git add apps/api/src/brandCore* apps/api/src/approvedBrandContextProvider* apps/api/src/brandIntelligenceProvider.ts apps/api/src/brandIntelligenceRepository.ts apps/api/src/brandCenterHttp.ts apps/api/src/server.brandCenterCustomer.test.ts apps/api/src/httpServer.ts apps/api/src/repository.ts apps/api/src/types.ts
git commit -m "feat(brand): expose brand center approval api"
```

## Task 6: 온보딩 컴포넌트를 재사용 가능한 panel로 분해

**Files:**

- Create: `apps/customer-ui/src/features/brand-center/types.ts`
- Create: `apps/customer-ui/src/features/brand-center/brandCenterGateway.ts`
- Create: `apps/customer-ui/src/features/brand-center/brandCenterGateway.test.ts`
- Create: `apps/customer-ui/src/features/sources/useSourceWorkspace.ts`
- Create: `apps/customer-ui/src/features/sources/useSourceWorkspace.test.ts`
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandEvidenceInputStep.tsx`
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx`
- Create: `apps/customer-ui/src/components/brand-center/SourceLibraryPanel.tsx`
- Create: `apps/customer-ui/src/components/brand-center/BrandCoreReviewPanel.tsx`
- Modify: `apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx`
- Modify: `apps/customer-ui/src/pages/SourcesPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/sources.test.tsx`

- [ ] 온보딩 step이 page navigation을 직접 소유하지 않게 하고 `value`, `status`, `onChange`, `onSubmit` props로 분리한다.
- [ ] `SourcesPage`의 owned/reference URL CRUD·manual crawl·snapshot·run history 상태와 요청 로직을 `useSourceWorkspace`로 먼저 추출한다. `SourceLibraryPanel`과 기존 page가 같은 hook/presentational components를 사용하고 로직을 복제하지 않는다.
- [ ] Brand Center의 `SourceLibraryPanel`은 브랜드 사실 근거인 owned URL·문서만 편집한다. 기존 `SourcesPage`는 Libraries plan이 `/references`를 만들 때까지 reference URL CRUD를 계속 제공해 중간 커밋에서도 기능이 사라지지 않게 한다.
- [ ] 이 릴리스의 reference count 옆 CTA는 disabled 상태와 `레퍼런스 보관함 준비 중` 안내를 보여준다. Libraries Task 9에서 `/references?view=external-urls`가 생기는 같은 commit에 CTA를 활성화한다.
- [ ] `BrandCoreReviewPanel`은 AI 제안값을 미리 채운 form으로 보여주고 사용자가 수정한다.
- [ ] 각 field에 `AI 제안`, `사용자 수정`, `승인됨` 상태와 evidence drawer를 표시한다.
- [ ] confidence는 제품 사실처럼 강조하지 않고 참고 신호로만 보여준다.
- [ ] unsaved edit가 있는 상태에서 탭 이동·새 분석 실행 시 확인 dialog를 제공한다.
- [ ] gateway test에서 API error, conflict, stale data 유지, retry를 검증한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenterGateway.test.ts useSourceWorkspace.test.ts brandIntelligenceOnboarding.test.tsx sources.test.tsx
```

예상 결과: 기존 온보딩 흐름은 유지되고 panel을 브랜드 센터에서도 재사용할 수 있다.

## Task 7: B형 브랜드 센터 페이지 구현

**Files:**

- Create: `apps/customer-ui/src/pages/BrandCenterPage.tsx`
- Create: `apps/customer-ui/src/components/brand-center/BrandCenterHeader.tsx`
- Create: `apps/customer-ui/src/components/brand-center/BrandReadinessJourney.tsx`
- Create: `apps/customer-ui/src/components/brand-center/BrandRulesPanel.tsx`
- Create: `apps/customer-ui/src/styles/brand-center.css`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/features/navigation/navigationModel.ts`
- Modify: `apps/customer-ui/src/lib/brandSetup.ts`
- Modify: `apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx`
- Modify: `apps/customer-ui/src/features/help/helpGuides.ts`
- Modify: `apps/customer-ui/src/main.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`
- Create: `apps/customer-ui/src/__tests__/brandCenter.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/brandSetupGate.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/helpGuidance.test.tsx`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] `/brand-center`에 다음 구조를 구현한다.
  - header: 브랜드명, 준비도, 마지막 승인 시각, `AI 재분석`, `변경 검토`
  - journey: `원본 자료 → AI 분석 → 사용자 검토 → 실행 규칙`
  - tabs: `브랜드 이해`, `제품·서비스`, `Wiki`, `모델·아바타`
  - 브랜드 이해 내부 subnav: `원본 자료`, `AI 분석`, `Brand Core`, `실행 규칙`, `버전 이력`
- [ ] query string `tab`과 `section`으로 새로고침 가능한 상태를 유지한다.
  - top-level key: `understanding | products | wiki | avatars`
  - understanding section key: `sources | analysis | core | rules | versions`
  - 기본값: `tab=understanding&section=core`
- [ ] `AI 재분석`은 새 draft만 만들고 active Brand Core는 그대로 둔다.
- [ ] 055 단계에서는 `제품·서비스`, `Wiki`, `모델·아바타` 탭을 disabled/unavailable 상태로 표시하고 해당 API를 호출하지 않는다. Libraries UI가 추가되는 각 commit에서만 실제 panel과 route state를 활성화한다.
- [ ] approved 상태와 unsaved draft를 동시에 명확히 보여준다.
- [ ] Brand Core 승인 버튼은 validation 오류가 있으면 첫 오류 필드로 focus한다.
- [ ] rules는 반드시 포함, 금지, 과장 제한, CTA, 채널, 디자인, 자동 승인 조건을 섹션별 저장한다.
- [ ] `초상권 사용 동의` 필드는 어디에도 추가하지 않는다.
- [ ] loading/empty/error/stale/retry를 테스트한다.
- [ ] legacy `/brand-settings` redirect 후 의도한 tab이 보이는지 테스트한다.
- [ ] 같은 commit에서 sidebar의 `브랜드 센터` 경로를 `/brand-center`로 전환하고 별도 `원본 자료` 항목은 제거한다. 다만 reference URL CRUD 보존을 위해 `/sources` route 자체는 Libraries Task 9까지 기존 page로 유지한다.
- [ ] Release A의 조건부 `시작 준비 > 브랜드 분석` 항목은 incomplete 사용자에게 `/brand-center?tab=understanding&section=sources`를 가리키도록 전환한다. 기존 `/onboarding/brand-intelligence`는 journey의 `새 분석 시작/이어서 검토` action과 legacy route로 계속 접근 가능하다.
- [ ] brand setup allowlist와 `SidebarBrandProfile` 링크를 `/brand-center`로 전환해 incomplete brand도 원본·분석·승인 화면에 들어갈 수 있게 한다.
- [ ] legacy redirect가 기존 query 중 충돌하지 않는 값을 보존하고 canonical `tab/section`만 정규화하는지 검증한다.
  - 예: `/brand-settings?brandIntelligence=confirmed` → `/brand-center?tab=understanding&section=core&brandIntelligence=confirmed`
- [ ] Libraries Task 9에서 `/sources?from=onboarding` → `/brand-center?tab=understanding&section=sources&from=onboarding` 전환을 소유하며, reference 전용 query는 `/references?view=external-urls`로 보낸다.
- [ ] `/brand-center` help guide와 동적 section guide를 같은 commit에 추가한다.
- [ ] 실행:

```bash
npm run test --workspace @brand-pilot/customer-ui -- brandCenter.test.tsx brandSettings.test.tsx brandSettings.regression-1.test.tsx sources.test.tsx useSourceWorkspace.test.ts brandSetupGate.test.tsx helpGuidance.test.tsx navigation.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

예상 결과: 기존 기능이 새 페이지에 보존되고 사용자는 승인 데이터와 AI 초안을 구분할 수 있다.

- [ ] 구현 커밋:

```bash
git add apps/customer-ui/src/pages/BrandCenterPage.tsx apps/customer-ui/src/pages/BrandIntelligenceOnboardingPage.tsx apps/customer-ui/src/pages/SourcesPage.tsx apps/customer-ui/src/components/brand-center apps/customer-ui/src/components/brand-intelligence apps/customer-ui/src/components/layout/SidebarBrandProfile.tsx apps/customer-ui/src/features/brand-center apps/customer-ui/src/features/sources apps/customer-ui/src/features/navigation/navigationModel.ts apps/customer-ui/src/features/help/helpGuides.ts apps/customer-ui/src/lib/brandSetup.ts apps/customer-ui/src/styles/brand-center.css apps/customer-ui/src/routes.tsx apps/customer-ui/src/main.tsx apps/customer-ui/src/__tests__
git commit -m "feat(brand): build d-hybrid brand center"
```

## Task 8: 브랜드 센터 통합·E2E 검증

**Files:**

- Create: `apps/customer-ui/e2e/brand-center.spec.ts`
- Modify: `scripts/brand-intelligence-smoke.mjs`
- Modify: `docs/prd/brand-pilot-feature-preservation-ledger.md`

- [ ] E2E 시나리오를 구현한다.
  1. 원본 URL과 문서 등록
  2. 분석 완료 fixture 수신
  3. AI 자동 입력값 확인
  4. 한 필드 수정
  5. Brand Core 승인
  6. 규칙 draft 저장·승인
  7. 재분석 후 이전 승인값 유지 확인
  8. version history 확인
- [ ] field별 AI 제안/사용자 수정 review state와 승인 actor가 reload 후 유지되는지 검증한다.
- [ ] member 계정은 draft를 저장할 수 있지만 approve가 거절되고 owner/admin 계정은 승인할 수 있는지 검증한다.
- [ ] smoke가 active Brand Core와 legacy brand profile의 호환 값을 함께 검증하게 한다.
- [ ] 기능 보존표의 해당 행을 구현 완료/검증 명령과 연결한다.
- [ ] 실행:

```bash
npm run test:migrations
npm run smoke:brand-intelligence
npm run e2e --workspace @brand-pilot/customer-ui -- brand-center.spec.ts
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/customer-ui
```

예상 결과: 데이터 권한 경계와 기존 온보딩 회귀가 모두 통과한다.

- [ ] 최종 커밋:

```bash
git add apps/customer-ui/e2e/brand-center.spec.ts scripts/brand-intelligence-smoke.mjs docs/prd/brand-pilot-feature-preservation-ledger.md
git commit -m "test(brand): verify brand center approval lifecycle"
```
