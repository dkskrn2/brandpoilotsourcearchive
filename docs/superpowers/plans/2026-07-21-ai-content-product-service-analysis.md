# AI Content Product and Service Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품과 무형 서비스가 서로 다른 CLI 분석·소구점 프롬프트를 사용하고, 사용자가 URL·문서·이미지·직접 설명을 한 번 제출하면 분석 결과 화면 없이 타깃·소구점 선택 단계로 이동하게 한다.

**Architecture:** 기존 `ai_content_subject_analyses` 큐와 `brand-pilot-subject-analysis-worker` 프로세스를 유지하되, 생성 건에 귀속되는 v2 상태 머신을 `자료 추출 → 유형별 분석 → 유형별 소구점 생성`으로 분리한다. 프론트는 초안 생성 건을 먼저 만든 뒤 첨부를 업로드하고 하나의 분석 요청을 보내며, API가 같은 분석 레코드에서 두 CLI 단계를 연쇄 실행한다. 기존 v1 레코드는 읽기 호환을 유지하고 v2만 교차 생성 URL 캐시를 사용하지 않는다.

**Tech Stack:** React 18, TypeScript, Fastify, PostgreSQL, Vitest, Playwright, Node child process 기반 Codex CLI worker, Vercel Blob

---

## 구현 원칙

- 새 워커 프로세스를 추가하지 않는다. 기존 subject-analysis worker가 `analysis`와 `appeal` 작업을 순차 처리한다.
- 새 생성 건은 반드시 `generationId`에 귀속된다. 같은 URL이라도 다른 생성 건의 v2 분석을 재사용하지 않는다.
- 제품·서비스 모두 확정된 브랜드 정보를 기본 컨텍스트로 받는다.
- 제품·서비스 URL은 모두 선택값이다. URL, 첨부, 이름·설명 중 하나 이상의 실질 근거가 있어야 한다.
- 분석 결과는 UI에 노출하지 않는다. 사용자는 진행 상태와 타깃·소구점만 본다.
- 소구점 수정·추가·삭제는 초안 로컬 상태만 바꾸고 CLI를 호출하지 않는다. 재생성만 appeal 작업을 다시 큐에 넣는다.
- 첨부 원본은 기존 생성 첨부 테이블과 Blob 수명 정책을 재사용한다.
- v1 API와 저장 레코드는 읽을 수 있게 유지하되 새 UI에서는 캐시 조회 endpoint를 호출하지 않는다.

## Task 1: v2 DB 상태와 계약 추가

**Files:**
- Create: `db/migrations/051_ai_content_subject_pipeline_v2.sql`
- Modify: `db/README.md`
- Modify: `db/smoke/001_schema_smoke.sql`
- Modify: `apps/api/src/aiContentSubjectContracts.ts`
- Modify: `apps/api/src/aiContentSubjectContracts.test.ts`
- Modify: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: v2 계약 실패 테스트 작성**

`apps/api/src/aiContentSubjectContracts.test.ts`에 다음 사례를 추가한다.

```ts
it("accepts a generation-scoped product pipeline with optional URL and attachments", () => {
  expect(parseCreateSubjectPipelineInput({
    generationId: "22222222-2222-4222-8222-222222222222",
    subjectType: "product",
    sourceUrl: null,
    attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    manualInput: { name: "제품명", promotionOrTerms: "", description: "" },
    idempotencyKey: "subject-pipeline-1",
  })).toMatchObject({ subjectType: "product", sourceUrl: null });
});

it("rejects a v2 pipeline without URL, attachments, name, or description", () => {
  expect(() => parseCreateSubjectPipelineInput({
    generationId: "22222222-2222-4222-8222-222222222222",
    subjectType: "service",
    sourceUrl: null,
    attachmentIds: [],
    manualInput: { name: "", promotionOrTerms: "", description: "" },
    idempotencyKey: "subject-pipeline-empty",
  })).toThrow("subject_analysis_evidence_required");
});
```

- [ ] **Step 2: 계약 테스트가 실패하는지 확인**

Run:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectContracts.test.ts
```

Expected: `parseCreateSubjectPipelineInput`과 v2 타입이 없어 FAIL.

- [ ] **Step 3: v2 타입과 엄격 파서 구현**

`apps/api/src/aiContentSubjectContracts.ts`에 다음 계약을 추가한다. 기존 v1 export는 삭제하지 않는다.

```ts
export type SubjectPipelineStatus =
  | "queued"
  | "extracting"
  | "analyzing"
  | "generating_appeals"
  | "ready"
  | "partial"
  | "failed";

export type ServiceSubtype =
  | "saas"
  | "consulting"
  | "education"
  | "agency"
  | "subscription"
  | "professional"
  | "other_service";

export interface CreateSubjectPipelineInput {
  generationId: string;
  subjectType: SubjectType;
  sourceUrl: string | null;
  attachmentIds: string[];
  manualInput: {
    name: string;
    promotionOrTerms: string;
    description: string;
  };
  idempotencyKey: string;
}
```

추가로 다음 worker 계약을 구현한다.

- `SubjectAnalysisInputV2`: `phase: "analysis"`, 전체 브랜드 컨텍스트, 추출 문서·이미지, 출처 우선순위
- `SubjectAnalysisResultV2`: 분석 요약, 확인 사실, VOC, 대안, 장벽, 제품/서비스 프로필, 서비스 subtype, source gaps
- `SubjectAppealInputV2`: `phase: "appeal"`, 저장된 분석 결과
- `SubjectAppealResultV2`: 타깃 정확히 3개, 타깃별 소구점 최소 2개

v2 파서는 알 수 없는 키를 거부하고, URL은 값이 있을 때만 HTTPS를 요구하며, attachment ID는 UUID·중복 없음·최대 10개로 제한한다.

- [ ] **Step 4: DB 마이그레이션 작성**

`051_ai_content_subject_pipeline_v2.sql`에서 다음을 적용한다.

```sql
alter table ai_content_subject_analyses
  add column if not exists generation_id uuid null,
  add column if not exists contract_version text not null default 'subject-analysis.v1',
  add column if not exists attachment_ids_json jsonb not null default '[]'::jsonb,
  add column if not exists analysis_result_json jsonb not null default '{}'::jsonb;

alter table ai_content_subject_analyses
  alter column source_url drop not null,
  alter column normalized_url drop not null;

alter table ai_content_subject_analyses
  add constraint ai_content_subject_generation_ownership_fk
  foreign key (generation_id, workspace_id, brand_id)
  references ai_content_generations(id, workspace_id, brand_id)
  on delete cascade;

drop index if exists ai_content_subject_active_cache_uq;

create unique index ai_content_subject_legacy_active_cache_uq
  on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
  where generation_id is null and superseded_at is null;

create unique index ai_content_subject_generation_active_uq
  on ai_content_subject_analyses (generation_id)
  where generation_id is not null and superseded_at is null;
```

상태 check에는 기존 `researching`을 보존하고 `analyzing`, `generating_appeals`를 추가한다. JSON object/array check와 `generation_id` 조회 인덱스도 추가한다.

- [ ] **Step 5: 마이그레이션 계약과 스모크 갱신**

`scripts/migrations.integration.test.mjs`에서 다음을 검증한다.

- v1 행은 `generation_id = null`, `contract_version = subject-analysis.v1`로 유지
- 같은 URL의 서로 다른 generation에 v2 행 2개 삽입 가능
- 한 generation에 활성 v2 행 2개 삽입 불가
- generation 삭제 시 v2 analysis가 cascade 삭제

- [ ] **Step 6: Task 1 검증**

Run:

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectContracts.test.ts
npm run test:migrations
```

Expected: PASS.

- [ ] **Step 7: Task 1 커밋**

```powershell
git add db/migrations/051_ai_content_subject_pipeline_v2.sql db/README.md db/smoke/001_schema_smoke.sql apps/api/src/aiContentSubjectContracts.ts apps/api/src/aiContentSubjectContracts.test.ts scripts/migrations.integration.test.mjs
git commit -m "feat: add generation scoped subject pipeline contracts"
```

## Task 2: 분석 첨부 업로드와 문서 추출 재사용

**Files:**
- Modify: `apps/api/src/aiContentUpload.ts`
- Modify: `apps/api/src/aiContentUpload.test.ts`
- Create: `apps/api/src/aiContentSubjectEvidence.ts`
- Create: `apps/api/src/aiContentSubjectEvidence.test.ts`
- Reuse: `apps/api/src/brandDocumentExtractor.ts`
- Modify: `apps/api/src/aiContentSubjectHttp.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`

- [ ] **Step 1: 문서 MIME·확장자 정책 실패 테스트 작성**

허용 형식을 다음으로 고정한다.

| 형식 | MIME | 최대 크기 |
| --- | --- | --- |
| PNG/JPEG | `image/png`, `image/jpeg` | 5MB |
| PDF | `application/pdf` | 10MB |
| TXT/MD/CSV | `text/plain`, `text/markdown`, `text/csv` | 5MB |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | 10MB |

`aiContentUpload.test.ts`에서 document role에 위 형식을 허용하고, 이미지 role에 문서를 거부하는 테스트를 먼저 작성한다.

- [ ] **Step 2: 첨부 근거 조합 실패 테스트 작성**

`aiContentSubjectEvidence.test.ts`에 다음을 검증한다.

- generation 소유 첨부 ID만 읽음
- 삭제된 첨부 제외
- PDF/TXT/MD/CSV/XLSX는 `extractBrandDocument`로 정규화
- 이미지는 image candidate로 전달
- 한 파일 실패 시 성공 자료와 `sourceGaps`를 함께 반환
- 요청한 첨부가 모두 타 브랜드이면 `subject_analysis_attachment_not_found`

- [ ] **Step 3: 테스트 실패 확인**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentUpload.test.ts aiContentSubjectEvidence.test.ts
```

Expected: 새 MIME과 evidence loader가 없어 FAIL.

- [ ] **Step 4: 업로드 정책과 evidence loader 구현**

`aiContentSubjectEvidence.ts`는 다음 입력을 받는다.

```ts
export interface LoadSubjectEvidenceInput {
  workspaceId: string;
  brandId: string;
  generationId: string;
  attachmentIds: string[];
}
```

Blob URL을 서버에서 제한된 크기로 읽고, 문서는 `extractBrandDocument`, 이미지는 기존 메타데이터를 사용한다. 정규화 출력은 `documents`, `images`, `sourceGaps`로 분리한다. 직접 입력과 URL 추출의 우선순위 조합은 Task 3에서 수행한다.

- [ ] **Step 5: subject HTTP 준비 단계에 첨부 근거 연결**

`claimAndPrepareSubjectAnalysis`가 v2 analysis phase를 준비할 때만 generation attachments를 로드한다. v1 경로는 기존 URL extractor 동작을 유지한다.

- [ ] **Step 6: Task 2 검증**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentUpload.test.ts aiContentSubjectEvidence.test.ts server.aiContentWorker.test.ts
```

Expected: PASS.

- [ ] **Step 7: Task 2 커밋**

```powershell
git add apps/api/src/aiContentUpload.ts apps/api/src/aiContentUpload.test.ts apps/api/src/aiContentSubjectEvidence.ts apps/api/src/aiContentSubjectEvidence.test.ts apps/api/src/aiContentSubjectHttp.ts apps/api/src/server.aiContentWorker.test.ts
git commit -m "feat: load subject evidence from generation attachments"
```

## Task 3: 생성 건별 API 상태 머신 구현

**Files:**
- Modify: `apps/api/src/aiContentSubjectRepository.ts`
- Modify: `apps/api/src/aiContentSubjectRepository.test.ts`
- Modify: `apps/api/src/aiContentSubjectRepository.postgres.integration.test.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/server.aiContentCustomer.test.ts`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`

- [ ] **Step 1: repository 상태 전이 실패 테스트 작성**

다음 전이를 테스트한다.

```text
queued -> extracting -> analyzing -> generating_appeals -> ready|partial
```

필수 사례:

- 같은 generation + 같은 idempotency key는 같은 분석 반환
- 같은 URL + 다른 generation은 새 분석 생성
- analysis 완료 시 결과를 `analysis_result_json`에 저장하고 lease/attempt를 초기화한 뒤 `generating_appeals`로 전환
- appeal 완료 시 `targets_json`, `appeals_json` 저장 후 `ready` 또는 `partial`
- appeal 실패 재시도는 analysis 결과를 보존
- subject type/input 변경 후 새 분석 요청은 기존 행을 supersede
- v1 `getCachedSubjectAnalysis` 동작은 유지

- [ ] **Step 2: customer API 실패 테스트 작성**

기존 POST route를 v2 입력도 받게 하거나 명확한 pipeline route를 추가한다. 이 계획에서는 기존 route를 확장한다.

```http
POST /brands/:brandId/ai-content/subject-analyses
GET  /brands/:brandId/ai-content/subject-analyses/:analysisId
POST /brands/:brandId/ai-content/subject-analyses/:analysisId/appeals/regenerate
```

GET 응답에는 `status`, `analysisVersion`, `targets`, `appealsByTarget`, `sourceGaps`만 UI에 필요한 형태로 반환한다. 내부 분석 상세는 생성 worker 입력에는 사용하지만 고객 응답에서 제외한다.

- [ ] **Step 3: 테스트 실패 확인**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.test.ts aiContentSubjectRepository.postgres.integration.test.ts server.aiContentCustomer.test.ts
```

Expected: v2 generation scope와 phase 전이가 없어 FAIL.

- [ ] **Step 4: repository 구현**

`SubjectAnalysisRecord`에 다음을 추가한다.

```ts
generationId: string | null;
contractVersion: "subject-analysis.v1" | "subject-analysis.v2";
attachmentIds: string[];
analysisResult: SubjectAnalysisResultV2 | null;
sourceGaps: string[];
```

claim SQL은 `queued/extracting/analyzing/generating_appeals`를 처리하고, `phase`를 claim 결과에 계산해 반환한다. 분석 phase 성공 시 새 행을 만들지 않고 같은 행의 상태를 appeal phase로 전환한다.

- [ ] **Step 5: 확정 브랜드 컨텍스트 로더 연결**

`aiContentRepository.ts`의 기존 brand intelligence provider를 재사용해 다음 필드를 v2 worker 입력에 넣는다.

- 기업 개요
- 사업 소개
- 대표·세부 분야
- 핵심 타깃
- 차별점
- 기존 핵심 소구점
- 브랜드 색상
- 분석 ID 또는 버전

브랜드 컨텍스트가 없으면 빈 객체로 만들지 말고 `subject_analysis_brand_context_required`를 반환한다.

- [ ] **Step 6: appeal 재생성 endpoint 구현**

선택된 분석이 ready/partial일 때만 `generating_appeals`로 되돌리고 기존 analysis 결과를 보존한다. 같은 재생성 멱등성 키는 중복 큐 작업을 만들지 않는다.

- [ ] **Step 7: Task 3 검증**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentSubjectRepository.test.ts aiContentSubjectRepository.postgres.integration.test.ts server.aiContentCustomer.test.ts aiContentRepository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Task 3 커밋**

```powershell
git add apps/api/src/aiContentSubjectRepository.ts apps/api/src/aiContentSubjectRepository.test.ts apps/api/src/aiContentSubjectRepository.postgres.integration.test.ts apps/api/src/httpServer.ts apps/api/src/server.aiContentCustomer.test.ts apps/api/src/types.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts
git commit -m "feat: orchestrate subject analysis and appeal phases"
```

## Task 4: 제품·서비스 분석 프롬프트 분리

**Files:**
- Modify: `workers/brand-pilot-subject-analysis-worker/src/contracts.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/productAnalysisPrompt.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/serviceAnalysisPrompt.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/analysisPrompt.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/result.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/result.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/.agents/skills/subject-analysis/SKILL.md`

- [ ] **Step 1: 프롬프트 분기 실패 테스트 작성**

제품 프롬프트는 다음 문구와 구조를 검증한다.

- version `product-analysis.v2-ko`
- 기능 → 효익 → 구매 이유
- 규격·소재·옵션·배송·환불·사용 상황·구매 장벽
- 공개 검색으로 가격·효능·성과를 확정하지 않음

서비스 프롬프트는 다음을 검증한다.

- version `service-analysis.v2-ko`
- 문제 → 제공 과정 → 이용 후 변화 → 신뢰·도입 부담
- 7개 service subtype 자동 판별
- 사용자와 구매 결정권자 구분
- 계약·갱신·해지·지원·산출물·도입 장벽

- [ ] **Step 2: 결과 파서 실패 테스트 작성**

제품 result는 `productProfile`, 서비스 result는 `serviceProfile`과 유효한 `serviceSubtype`을 요구한다. 서로의 profile을 섞으면 계약 오류가 나야 한다.

- [ ] **Step 3: 실패 확인**

```powershell
npm run test --workspace @brand-pilot/subject-analysis-worker -- analysisPrompt.test.ts result.test.ts
```

Expected: 새 prompt builder와 v2 parser가 없어 FAIL.

- [ ] **Step 4: 제품 분석 프롬프트 구현**

입력은 브랜드 컨텍스트, 직접 입력, 문서, URL 추출, 공개 검색 정책 순으로 명시한다. 충돌 우선순위는 `직접 입력 > 첨부 > URL > 브랜드 > 공개 검색`으로 고정한다.

- [ ] **Step 5: 서비스 분석 프롬프트 구현**

서비스 subtype 판별 기준을 프롬프트에 포함하되 UI 표시용 설명을 생성하지 않는다. 교육·컨설팅·대행·구독·전문 서비스가 SaaS 기능 목록으로 잘못 분석되지 않도록 각 subtype별 필수 관점을 넣는다.

- [ ] **Step 6: v2 결과 파서 구현**

출처가 필요한 사실은 HTTPS 또는 `attachment://<uuid>` 출처를 허용한다. 확인되지 않은 가격·효능·성과 수치는 parser 이전 프롬프트 정책으로 차단하고, 빈 근거는 `sourceGaps`에 기록한다.

- [ ] **Step 7: Task 4 검증**

```powershell
npm run test --workspace @brand-pilot/subject-analysis-worker -- analysisPrompt.test.ts result.test.ts
npm run build --workspace @brand-pilot/subject-analysis-worker
```

Expected: PASS.

- [ ] **Step 8: Task 4 커밋**

```powershell
git add workers/brand-pilot-subject-analysis-worker/src/contracts.ts workers/brand-pilot-subject-analysis-worker/src/productAnalysisPrompt.ts workers/brand-pilot-subject-analysis-worker/src/serviceAnalysisPrompt.ts workers/brand-pilot-subject-analysis-worker/src/analysisPrompt.test.ts workers/brand-pilot-subject-analysis-worker/src/result.ts workers/brand-pilot-subject-analysis-worker/src/result.test.ts workers/brand-pilot-subject-analysis-worker/.agents/skills/subject-analysis/SKILL.md
git commit -m "feat: split product and service analysis prompts"
```

## Task 5: 제품·서비스 소구점 프롬프트와 워커 연쇄 실행

**Files:**
- Create: `workers/brand-pilot-subject-analysis-worker/src/productAppealPrompt.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/serviceAppealPrompt.ts`
- Create: `workers/brand-pilot-subject-analysis-worker/src/appealPrompt.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/worker.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/worker.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/client.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/client.test.ts`
- Modify: `workers/brand-pilot-subject-analysis-worker/src/contracts.ts`
- Modify: `apps/api/src/aiContentSubjectHttp.ts`
- Modify: `apps/api/src/server.aiContentWorker.test.ts`

- [ ] **Step 1: 소구점 프롬프트 실패 테스트 작성**

제품 appeal은 다음 순서를 요구한다.

```text
고객 상황 -> 제품 기능 -> 얻는 변화 -> 확인 가능한 근거
```

서비스 appeal은 다음 순서를 요구한다.

```text
현재 병목 -> 기존 방식 한계 -> 제공 과정 -> 운영상 변화 -> 신뢰·부담 해소
```

두 결과 모두 타깃 정확히 3개, 타깃별 소구점 최소 2개, 전역 appeal ID 중복 금지를 검증한다.

- [ ] **Step 2: phase dispatcher 실패 테스트 작성**

```ts
expect(buildSubjectPrompt(productAnalysisJob)).toContain("product-analysis.v2-ko");
expect(buildSubjectPrompt(serviceAnalysisJob)).toContain("service-analysis.v2-ko");
expect(buildSubjectPrompt(productAppealJob)).toContain("product-appeal.v2-ko");
expect(buildSubjectPrompt(serviceAppealJob)).toContain("service-appeal.v2-ko");
```

- [ ] **Step 3: 실패 확인**

```powershell
npm run test --workspace @brand-pilot/subject-analysis-worker -- appealPrompt.test.ts promptBuilder.test.ts worker.test.ts client.test.ts
```

Expected: appeal prompt와 phase client가 없어 FAIL.

- [ ] **Step 4: appeal prompt와 dispatcher 구현**

`promptBuilder.ts`는 v1 job은 기존 builder, v2 job은 `phase + subject.type`으로 4개 builder 중 하나를 선택한다. 파일명은 유지해 기존 import의 변경 범위를 줄인다.

- [ ] **Step 5: runner 결과 분기 구현**

worker runner는 job phase에 따라 `parseSubjectAnalysisResultV2` 또는 `parseSubjectAppealResultV2`를 호출한다. 임시 디렉터리, timeout, heartbeat, process tree 종료 정책은 그대로 유지한다.

- [ ] **Step 6: API worker complete 분기 구현**

complete endpoint는 lease가 가리키는 현재 phase와 결과 contract를 일치시킨다. analysis 결과를 appeal complete endpoint에 보내거나 반대로 보내면 400을 반환한다.

- [ ] **Step 7: Task 5 검증**

```powershell
npm run test --workspace @brand-pilot/subject-analysis-worker
npm run test --workspace @brand-pilot/api -- server.aiContentWorker.test.ts
npm run build --workspace @brand-pilot/subject-analysis-worker
```

Expected: PASS.

- [ ] **Step 8: Task 5 커밋**

```powershell
git add workers/brand-pilot-subject-analysis-worker/src/productAppealPrompt.ts workers/brand-pilot-subject-analysis-worker/src/serviceAppealPrompt.ts workers/brand-pilot-subject-analysis-worker/src/appealPrompt.test.ts workers/brand-pilot-subject-analysis-worker/src/promptBuilder.ts workers/brand-pilot-subject-analysis-worker/src/promptBuilder.test.ts workers/brand-pilot-subject-analysis-worker/src/worker.ts workers/brand-pilot-subject-analysis-worker/src/worker.test.ts workers/brand-pilot-subject-analysis-worker/src/client.ts workers/brand-pilot-subject-analysis-worker/src/client.test.ts workers/brand-pilot-subject-analysis-worker/src/contracts.ts apps/api/src/aiContentSubjectHttp.ts apps/api/src/server.aiContentWorker.test.ts
git commit -m "feat: generate product and service appeals in a second phase"
```

## Task 6: 2단계 입력·진행 UI로 교체

**Files:**
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentWizardPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/aiContentWizard.test.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 제품·서비스 공통 입력 UI 실패 테스트 작성**

다음을 검증한다.

- 제품과 서비스 모두 URL 입력을 표시하며 선택값으로 안내
- 이름, 이용 조건/프로모션, 설명 입력
- 이미지와 PDF/TXT/MD/CSV/XLSX 첨부
- 제품/서비스 전환 시 이전 분석·타깃·소구점 초기화
- 분석 결과 카드·확인 사실·타깃 미리보기를 렌더링하지 않음
- CTA 이름은 `분석하고 소구점 만들기`

- [ ] **Step 2: 진행 상태·자동 이동 실패 테스트 작성**

poll 응답에 따라 다음 텍스트가 정확히 하나씩 표시되어야 한다.

```text
extracting          -> 제품·서비스 자료 확인 중
analyzing           -> 고객과 시장 분석 중
generating_appeals  -> 타깃·소구점 생성 중
ready|partial       -> onAnalysis 호출 후 step 3 자동 이동
```

페이지의 `다음` 버튼으로 분석 결과 없이 넘어갈 수 없어야 한다.

- [ ] **Step 3: 실패 확인**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- SubjectAnalysisStep.test.tsx AiContentAttachmentUploader.test.tsx aiContentApiGateway.test.ts aiContentWizard.test.tsx
```

Expected: 서비스 URL 숨김, v1 cache 호출, 결과 UI 때문에 FAIL.

- [ ] **Step 4: 초안 생성 시점을 분석 실행 시점으로 이동**

첨부는 generation ID가 필요하므로 CTA 클릭 시 다음 순서로 처리한다.

1. generation이 없으면 `createAnalysis`로 draft generation 생성
2. 로컬 첨부 업로드
3. uploaded attachments가 포함된 draft로 generation PATCH
4. `requestSubjectAnalysis`에 generation ID와 attachment ID 전달
5. 한 endpoint만 poll

최종 생성 버튼은 이미 만들어진 generation을 재사용한다.

- [ ] **Step 5: v2 gateway와 draft 구현**

`SubjectAnalysisInput`을 다음 형태로 바꾼다.

```ts
export interface SubjectAnalysisInput {
  generationId: string;
  subjectType: SubjectType;
  sourceUrl: string | null;
  attachmentIds: string[];
  manualInput: {
    name: string;
    promotionOrTerms: string;
    description: string;
  };
  idempotencyKey: string;
}
```

기존 `getCachedSubjectAnalysis` method는 v1 복원용으로 남기되 새 `SubjectAnalysisStep`에서는 호출하지 않는다.

- [ ] **Step 6: 첨부 UI 확장**

2단계에서는 분석용 업로더를 다음 두 그룹으로 표시한다.

- 제품·서비스 이미지
- 설명 문서

기존 프롬프트 단계의 인물·크기·시각 참고 이미지 역할은 그대로 유지한다. 공통 컴포넌트에는 `allowedRoles` prop을 추가해 화면별 역할만 노출한다.

- [ ] **Step 7: 결과 UI 제거와 진행 UI 구현**

`SubjectAnalysisStep`에서 `분석 결과`, `확인된 사실`, `고객 언어·대안`, `타깃 미리보기`를 제거한다. 처리 중에는 안정된 높이의 loader와 단계 텍스트만 표시하고, ready/partial이면 `onComplete`를 통해 wizard step 3으로 이동한다.

- [ ] **Step 8: Task 6 검증**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- SubjectAnalysisStep.test.tsx AiContentAttachmentUploader.test.tsx aiContentApiGateway.test.ts aiContentWizard.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: PASS.

- [ ] **Step 9: Task 6 커밋**

```powershell
git add apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/features/ai-content/useAiContentDraft.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.tsx apps/customer-ui/src/components/ai-content/AiContentAttachmentUploader.test.tsx apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.tsx apps/customer-ui/src/components/ai-content/SubjectAnalysisStep.test.tsx apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/pages/AiContentWizardPage.tsx apps/customer-ui/src/__tests__/aiContentWizard.test.tsx apps/customer-ui/src/styles/prototype.css
git commit -m "feat: run subject pipeline from the content wizard"
```

## Task 7: 소구점 편집·삭제·재생성 구현

**Files:**
- Modify: `apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/TargetAppealStep.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx`
- Modify: `apps/customer-ui/src/features/ai-content/useAiContentDraft.ts`
- Modify: `apps/customer-ui/src/features/ai-content/types.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 편집·삭제 실패 테스트 작성**

다음을 검증한다.

- 소구점 제목과 설명을 input/textarea에서 수정하면 selected appeal snapshot도 즉시 갱신
- 소구점 직접 추가 후 자동 선택
- 선택하지 않은 소구점 삭제
- 선택한 소구점 삭제 시 선택 해제
- 타깃은 한 개, 소구점은 한 개만 선택

- [ ] **Step 2: 재생성 실패 테스트 작성**

`소구점 다시 만들기` 클릭 시 appeal regenerate endpoint를 한 번 호출하고, 처리 중 중복 클릭을 막으며, 완료 응답으로 목록을 교체한다. 현재 분석 결과와 타깃은 유지한다.

- [ ] **Step 3: 실패 확인**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- TargetAppealStep.test.tsx
```

Expected: 편집·삭제·재생성 API가 없어 FAIL.

- [ ] **Step 4: draft appeal 목록 override 구현**

사용자 편집을 분석 원본에 직접 덮어쓰지 않는다. `AiContentDraft`에 `appealOverridesByTarget`을 추가하고 최종 선택은 override 목록에서 가져온다. 오래된 저장 draft는 빈 override로 normalize한다.

- [ ] **Step 5: UI와 재생성 구현**

각 appeal row에 편집과 삭제 아이콘 버튼을 제공하고 tooltip/aria-label을 넣는다. 재생성은 gateway method를 호출한 뒤 해당 타깃 override를 초기화하고 새 추천 목록을 표시한다.

- [ ] **Step 6: 레퍼런스 순서 회귀 테스트**

wizard step 이름과 이동 순서가 `타깃·소구점 → 레퍼런스 → 프롬프트·생성`인지 `aiContentWizard.test.tsx`에서 확인한다.

- [ ] **Step 7: Task 7 검증**

```powershell
npm run test --workspace @brand-pilot/customer-ui -- TargetAppealStep.test.tsx aiContentWizard.test.tsx
npm run build --workspace @brand-pilot/customer-ui
```

Expected: PASS.

- [ ] **Step 8: Task 7 커밋**

```powershell
git add apps/customer-ui/src/components/ai-content/TargetAppealStep.tsx apps/customer-ui/src/components/ai-content/TargetAppealStep.test.tsx apps/customer-ui/src/components/ai-content/AiContentWizardSteps.tsx apps/customer-ui/src/features/ai-content/useAiContentDraft.ts apps/customer-ui/src/features/ai-content/types.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/styles/prototype.css apps/customer-ui/src/__tests__/aiContentWizard.test.tsx
git commit -m "feat: edit and regenerate AI content appeals"
```

## Task 8: 최종 생성 입력·v1 호환·첨부 수명 정리

**Files:**
- Modify: `apps/api/src/aiContentGenerationInput.ts`
- Modify: `apps/api/src/aiContentGenerationInput.test.ts`
- Modify: `apps/api/src/aiContentRepository.ts`
- Modify: `apps/api/src/aiContentRepository.test.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts`
- Modify: `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`
- Modify: `scripts/ai-content-subject-smoke.mjs`

- [ ] **Step 1: v2 snapshot 실패 테스트 작성**

최종 worker envelope에 다음이 들어가는지 검증한다.

- v2 분석 ID와 version
- subject type
- 확정 브랜드 컨텍스트 snapshot
- 제품/서비스 분석 result snapshot
- 사용자가 선택·수정한 최종 target/appeal
- reference 순서
- 최종 프롬프트 단계의 색상·이미지·문서

v1 분석 record를 사용하는 기존 generation도 계속 envelope를 만들 수 있어야 한다.

- [ ] **Step 2: 첨부 정리 실패 테스트 작성**

다음을 검증한다.

- `completed`, `partial_failed`, `failed`의 모든 terminal generation에서 임시 원본 삭제 시도
- Blob 삭제 실패 시 DB deleted_at을 찍지 않고 다음 정리에서 재시도 가능
- 최종 manifest 자산 URL은 삭제 대상에서 제외
- 분석 중 generation은 삭제하지 않음

- [ ] **Step 3: 실패 확인**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentGenerationInput.test.ts aiContentRepository.test.ts
```

Expected: v2 snapshot과 partial/failed 정리 정책이 없어 FAIL.

- [ ] **Step 4: generation input builder 구현**

v2는 `analysisResult`와 draft의 appeal override를 합쳐 immutable snapshot을 만든다. 이후 사용자가 원본 분석을 재생성해도 이미 시작한 generation worker 입력은 바뀌지 않아야 한다.

- [ ] **Step 5: terminal attachment cleanup 확장**

기존 `deleteCompletedGenerationAttachments`를 terminal 전용 함수로 바꾸고, final manifest에서 실제 보존해야 하는 결과 자산과 업로드 원본을 구분한다.

- [ ] **Step 6: smoke 갱신**

`scripts/ai-content-subject-smoke.mjs`가 v2 product와 v2 service fixture를 각각 큐에 넣고 phase 전이를 확인하도록 갱신한다. 실제 Codex 호출 없이 API fixture mode에서 계약·상태만 검증한다.

- [ ] **Step 7: Task 8 검증**

```powershell
npm run test --workspace @brand-pilot/api -- aiContentGenerationInput.test.ts aiContentRepository.test.ts
npm run smoke:ai-content-subject
```

Expected: PASS.

- [ ] **Step 8: Task 8 커밋**

```powershell
git add apps/api/src/aiContentGenerationInput.ts apps/api/src/aiContentGenerationInput.test.ts apps/api/src/aiContentRepository.ts apps/api/src/aiContentRepository.test.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts scripts/ai-content-subject-smoke.mjs
git commit -m "feat: snapshot v2 subject context for content generation"
```

## Task 9: 브라우저 E2E와 운영 문서 검증

**Files:**
- Modify: `apps/customer-ui/e2e/ai-content-runtime.spec.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/PRE_LAUNCH_REQUIRED.md`
- Modify: `workers/brand-pilot-subject-analysis-worker/README.md`
- Modify: `README.md`

- [ ] **Step 1: E2E fixture 추가**

아래 케이스를 API fixture와 브라우저로 각각 한 번 실행한다.

1. 제품 URL만 사용한 카드뉴스
2. 제품 PDF와 이미지 첨부를 사용한 마케팅 소재
3. SaaS URL과 소개 문서를 사용한 블로그
4. 컨설팅 직접 설명과 PDF를 사용한 카드뉴스
5. URL 실패 + 유효 첨부로 partial 완료
6. appeal 재생성 실패 후 재시도

각 케이스에서 분석 결과 화면이 나타나지 않고, 타깃·소구점 이후 레퍼런스 단계가 나타나며, 최종 generation draft에 수정된 appeal이 저장되는지 확인한다.

- [ ] **Step 2: E2E 실패 확인**

```powershell
npm run test:e2e -- --grep "product and service subject pipeline"
```

Expected: 새 fixture와 UI flow 구현 전에는 FAIL.

- [ ] **Step 3: 접근성·레이아웃 회귀 확인**

Playwright에서 1440×900, 390×844 두 viewport를 확인한다.

- 진행 loader가 레이아웃을 밀지 않음
- 긴 파일명이 컨테이너를 넘지 않음
- textarea와 버튼 텍스트가 잘리지 않음
- 키보드만으로 제품/서비스, 타깃, 소구점, 레퍼런스를 선택 가능
- 로딩·오류는 `role=status`/`role=alert`로 전달

- [ ] **Step 4: 운영 문서 갱신**

다음을 명시한다.

- subject-analysis worker 한 프로세스가 analysis/appeal 두 phase를 처리
- 프롬프트 버전 4종
- 지원 첨부 형식과 크기
- lease/timeout/retry 정책
- 로컬 및 실제 서버에서 필요한 동일 환경변수
- v1 읽기 호환과 v2 무캐시 정책

- [ ] **Step 5: 전체 검증**

```powershell
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/subject-analysis-worker
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/subject-analysis-worker
npm run build --workspace @brand-pilot/customer-ui
npm run test:migrations
npm run test:e2e -- --grep "product and service subject pipeline"
```

Expected: 모두 PASS.

- [ ] **Step 6: 민감정보·임시 산출물 점검**

```powershell
git diff --check
git status --short
git diff -- . ':!package-lock.json' | Select-String -Pattern 'META_APP_SECRET|OPENAI_API_KEY|BLOB_READ_WRITE_TOKEN|SUPABASE_SERVICE_ROLE_KEY'
```

Expected: whitespace 오류 없음, 비밀값 없음, runtime job/output 파일이 git 대상에 없음.

- [ ] **Step 7: Task 9 커밋**

```powershell
git add apps/customer-ui/e2e/ai-content-runtime.spec.ts docs/ARCHITECTURE.md docs/PRE_LAUNCH_REQUIRED.md workers/brand-pilot-subject-analysis-worker/README.md README.md
git commit -m "test: cover product and service content analysis flow"
```

## 최종 수동 확인

- [ ] 제품과 서비스 모두 확정 브랜드 정보가 자동 적용되는지 확인한다.
- [ ] 서비스 URL 입력란이 숨겨지지 않는지 확인한다.
- [ ] URL 없이 문서 또는 직접 설명만으로 실행되는지 확인한다.
- [ ] 서비스가 SaaS, 컨설팅, 교육, 대행, 구독, 전문 서비스 중 내부 subtype을 생성하는지 API 로그로 확인한다.
- [ ] 분석 결과 화면 없이 타깃·소구점으로 이동하는지 확인한다.
- [ ] 소구점 제목·설명을 수정한 값이 최종 generation snapshot에 들어가는지 확인한다.
- [ ] 타깃·소구점 다음에 레퍼런스 선택 단계가 나오는지 확인한다.
- [ ] 같은 URL을 두 생성 건에서 사용했을 때 서로 다른 analysis ID가 생성되는지 확인한다.
- [ ] 기존 v1 generation 상세가 계속 열리는지 확인한다.
- [ ] 생성 terminal 상태에서 임시 원본이 정리되고 최종 산출물은 유지되는지 확인한다.
