# Brand Pilot D Hybrid Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 D 하이브리드 디자인을 기반으로 기존 Brand Pilot 기능을 보존하면서 브랜드 센터, 레퍼런스, 정보성·마케팅성 콘텐츠 생성, 게시, Instagram DM, 성과 학습을 하나의 운영 흐름으로 재구성한다.

**Architecture:** 기존 React 고객 앱, Fastify API, PostgreSQL, 콘텐츠·DM·Wiki 워커 계약을 유지한다. UI는 공통 사이드바 셸 위에 대시보드 A형과 브랜드 센터·콘텐츠 B형을 조합하고, 데이터는 `원본 → AI 제안 → 사용자 승인 → 실행 규칙` 권한 경계를 추가한다. 새 콘텐츠 분류와 자산 선택은 오케스트레이션 메타데이터로 추가하고 기존 `card_news | blog | marketing` 워커 계약으로 결정적으로 변환한다.

**Tech Stack:** React 18, React Router, TypeScript, Vite, Vitest, Testing Library, Playwright, Fastify, PostgreSQL/PGlite, Node.js 20+, Docker Compose, Caddy, Tailscale/SSH.

---

## 1. 기준 문서와 비협상 조건

구현자는 아래 문서를 먼저 읽고 체크리스트에 링크해야 한다.

- 설계 기준: `docs/superpowers/specs/2026-07-24-brand-reference-content-operating-system-design.md`
- 기능 보존 기준: `docs/prd/brand-pilot-feature-preservation-ledger.md`
- 시각 기준: `C:/Users/dkskr/.gstack/projects/dkskrn2-main/designs/brand-pilot-core-experience-20260724/variant-D-hybrid.html`
- Ubuntu 배포 기준: `docs/superpowers/specs/2026-07-22-ubuntu-container-deployment-design.md`
- 현재 실행 runbook: `docs/operations/UBUNTU_DEPLOYMENT.md`

다음 결정은 구현 중 변경하지 않는다.

- 대시보드는 A형, 브랜드 센터와 콘텐츠 생성은 B형, 전체 골자는 사이드바 셸이다.
- 레퍼런스와 아바타는 생성 과정에서 정확히 한 화면, 한 번만 선택한다.
- 콘텐츠 생성 상위 흐름은 `콘텐츠 생성 → 구현안 선택 → 생성 → 변경·검토·보완`이며, 첫 phase 안에는 3개 순차 accordion만 둔다.
- `구현안`은 완성 콘텐츠가 아니라 URL·브랜드·제품 근거로 만든 topic, target, hook, outline, format, channel의 제작 설계안이다.
- 레퍼런스는 D mockup의 예시 HTML이 아니라 실제 저장 미디어, crawl snapshot, 자사 artifact를 지연 로드해 보여준다.
- reference URL은 등록 시 `정보성 | 마케팅성 | 둘 다` 용도를 지정하고 AI 구현안 생성에서 해당 용도의 최신 성공 snapshot을 사용한다.
- Instagram, Threads, X, LinkedIn, YouTube, TikTok 채널 등록·상태 관리는 별도 `/channels` 화면에서 유지하고 실제 capability를 과장하지 않는다.
- 콘텐츠 최상위 분류는 `informational | marketing`이고 워커 타입은 `card_news | blog | marketing`을 유지한다.
- 정적 Instagram Story는 보존하지만 사용자 대상 영상·Reel·Shorts·TikTok 제작은 노출하지 않는다.
- Instagram DM 자동답변, 게시 복구, 사용량, 다운로드 비차감, 피드백, 고객센터, 도움말, 관리자, Ubuntu 운영 기능은 보존한다.
- 아바타의 초상권 동의 필드는 이번 제품 데이터와 화면에 추가하지 않는다.
- 기간성 오퍼 보관함은 만들지 않는다.
- 첫 Ubuntu 배포에서는 일일 예약 생성, 게시 자동화, DM 자동답변을 기능 플래그로 기본 비활성화한다.
- LM Studio는 개발·생성·배포 경로에 포함하지 않는다.

## 2. 구현 계획 묶음

| 순서 | 계획 | 산출물 | 선행 조건 |
|---|---|---|---|
| 0 | `2026-07-24-current-version-ubuntu-baseline-plan.md` | 현재 정상 SHA의 safe-mode Ubuntu 기준선 | 없음 |
| 1 | `2026-07-24-d-hybrid-shell-dashboard-implementation-plan.md` | 디자인 토큰, 공통 셸, 내비게이션, 대시보드 | 0 |
| 2 | `2026-07-24-d-hybrid-brand-center-implementation-plan.md` | 브랜드 센터 IA, Brand Core, 규칙, 승인·출처 경계 | 1 |
| 3 | `2026-07-24-d-hybrid-libraries-implementation-plan.md` | 제품·서비스, Wiki, 아바타, 레퍼런스 보관함 | 2 |
| 4 | `2026-07-24-d-hybrid-channel-capability-implementation-plan.md` | 채널 등록, 연결, 생성·export·게시 capability | 1 |
| 5 | `2026-07-24-d-hybrid-content-creation-implementation-plan.md` | 정보성·마케팅성 생성, AI 구성안, 단일 선택, 워커 호환 | 2–4 |
| 6 | `2026-07-24-d-hybrid-operations-integration-implementation-plan.md` | 결과 검토, 게시, DM, 성과, 지원 연결 | 1–5 |
| 7 | `2026-07-24-d-hybrid-regression-rollout-implementation-plan.md` | 전 회귀, 접근성, 기능 플래그, Ubuntu 배포·롤백 | 1–6 |

## 3. 릴리스 단위

### Release 0 — 현재 버전 Ubuntu 기준선

- [ ] `2026-07-24-current-version-ubuntu-baseline-plan.md`를 먼저 실행하고 증빙을 남긴다.
- [ ] D 하이브리드 구현을 시작하기 전에 현재 정상 SHA를 태그·기록한다.
- [ ] Tailscale node 도달성에 더해 intended `bpdeploy` public-key SSH를 복구·확인하고 기존 Ubuntu runbook으로 API+Caddy safe-mode canary를 올린다.
- [ ] scheduler, publish, DM/Wiki worker를 끈 상태에서 health, readiness, DB read, 로그인 callback, CORS, HTTPS를 확인한다.
- [ ] 현재 Vercel API를 최소 48시간 rollback 대상으로 유지한다.
- [ ] 기준선 배포 결과와 env checksum만 기록하고 secret 원문은 저장소에 넣지 않는다.

**진입 조건:** `bpdeploy` public-key Tailscale SSH, default `main`의 immutable image workflow, canary DNS·외부 80/443가 모두 준비된다. 일반 관리자 SSH나 TCP 22 도달성만으로 충족 처리하지 않는다.

**완료 조건:** 현재 기능 SHA의 Ubuntu canary가 통과하고 rollback 명령이 검증된다. 이후 D 하이브리드는 별도 feature branch/worktree에서 개발한다.

### Release A — 셸과 정보 구조

- [ ] 공통 디자인 토큰과 반응형 사이드바를 적용한다.
- [ ] 새 메뉴 그룹을 적용하되 아직 구현되지 않은 canonical 화면으로 링크하지 않고, 각 화면이 추가되는 릴리스에서 URL을 전환한다.
- [ ] 대시보드가 실제 API 데이터만 사용하고 실패를 샘플 데이터로 숨기지 않게 한다.
- [ ] 기존 피드백·도움말·사용량·모바일 메뉴·접근성 회귀를 통과시킨다.

**진입 조건:** 현재 고객 UI 테스트가 기준선에서 통과한다.

**완료 조건:** 셸·내비게이션·대시보드 단위 테스트와 Playwright 데스크톱·모바일 흐름이 통과한다.

### Release B — 브랜드 기반 데이터

- [ ] 기존 확정 분석을 Brand Core v1로 무손실 백필한다.
- [ ] 원본, AI 분석, 승인 Brand Core, 실행 규칙을 UI와 API에서 구분한다.
- [ ] 제품·서비스, Wiki, 아바타, 레퍼런스 보관함을 브랜드 범위로 제공한다.
- [ ] 승인된 Brand Core·규칙·제품·Wiki를 반환하는 공통 selector/API와 권한 테스트를 준비한다.
- [ ] Content와 DM의 실제 consumer 전환은 각각 Release C와 D의 완료 조건으로 둔다.

**진입 조건:** Release A 라우팅과 셸이 안정적이다.

**완료 조건:** 마이그레이션 통합 테스트, 브랜드 격리 테스트, 승인 버전 보존 테스트가 통과한다.

### Release C — 콘텐츠 생성 전환

- [ ] 채널 capability API와 `/channels` 등록·연결 UI를 먼저 완료한다.
- [ ] `contentFamily`, `messageStrategy`, `outputFormat`, `channelTargets`를 저장한다.
- [ ] 3개 입력 accordion에서 AI 구현안을 요청하고 2–3개 제작 설계안을 비교한다.
- [ ] HTTP는 proposal job을 202로 enqueue/poll하고 전용 content-proposal worker가 snapshot 기반 LLM 실행·lease·retry를 소유한다.
- [ ] 기존 crawl·자동 주제 기능이 검토할 구현안을 만들도록 연결하고 첫 배포에서는 scheduler를 끈다.
- [ ] 콘텐츠 API와 worker가 legacy profile이 아닌 활성 approved Brand Core·규칙·제품·Wiki selector를 실제 사용한다.
- [ ] 정보성 콘텐츠가 제품 없이도 Brand Core·Wiki·직접 주제를 근거로 생성될 수 있게 한다.
- [ ] 제품·서비스 콘텐츠는 승인된 라이브러리 항목 또는 새 분석 결과를 사용한다.
- [ ] 레퍼런스 0–5개와 아바타 0–1개를 단일 단계에서 선택하고 역할·스냅샷을 저장한다.
- [ ] 실제 reference preview는 구현안이 선택된 뒤에만 비동기로 불러온다.
- [ ] 기존 워커에는 계속 `content-generation-input.v2`와 기존 타입을 전달한다.

**진입 조건:** Release B의 브랜드 기반 API가 준비되어 있다.

**완료 조건:** 새 위저드 흐름과 기존 생성·다운로드·게시 회귀가 동시에 통과한다.

### Release D — 운영 통합과 배포

- [ ] 결과의 기획·카피·완성본·게시 탭을 정리한다.
- [ ] 게시 capability와 실제 준비도를 분리 표시한다.
- [ ] DM이 Brand Core·제품·Wiki만 근거로 사용하고 외부 레퍼런스를 배제하는지 검증한다.
- [ ] DM API와 worker가 활성 approved selector를 실제 사용하고 draft·legacy synthetic Wiki 항목을 배제한다.
- [ ] 성과를 관측·해석·다음 실험 제안으로 분리한다.
- [ ] 전체 기능 보존표와 Ubuntu canary·promote·rollback 절차를 통과한다.

**진입 조건:** Releases A–C가 기능 플래그 뒤에서 통합 빌드된다.

**완료 조건:** 운영 전 회귀, 스모크, 백업·복원 리허설 및 HTTPS 준비도 검증이 통과한다.

## 4. 공통 구현 규칙

### 4.1 TDD 순서

각 작업은 다음 순서를 지킨다.

1. 기존 동작을 고정하는 회귀 테스트를 먼저 추가한다.
2. 새 요구사항을 표현하는 실패 테스트를 추가하고 실패 이유를 확인한다.
3. 테스트를 통과시키는 최소 구현을 작성한다.
4. 관련 좁은 테스트를 다시 실행한다.
5. 워크스페이스 전체 테스트와 빌드를 실행한다.
6. 한 가지 책임만 담은 커밋을 만든다.

### 4.2 데이터 변경

- 새 마이그레이션은 `db/migrations/055_*.sql`부터 순서대로 추가한다.
- 기존 JSON을 파괴적으로 재작성하지 않는다.
- 백필은 재실행 가능해야 하며, 이미 승인된 데이터가 있으면 덮어쓰지 않는다.
- 모든 새 테이블은 `workspace_id`, `brand_id` 복합 소유권을 강제하고, 다른 테넌트 자원을 가리키는 모든 FK도 동일 복합 키를 사용한다.
- 복합 FK 대상 테이블에는 대응하는 `UNIQUE(id, workspace_id, brand_id)`를 먼저 둔다.
- 생성·수정·승인·보관 repository에는 `actorUserId`를 전달하고 owner/admin 권한과 `created_by_user_id`, `approved_by_user_id`, `approved_at` 감사 정보를 남긴다.
- active pointer는 동일 transaction에서 row를 잠근 뒤 approved 버전만 가리키게 하고 동시 승인 invariant를 테스트한다.
- 각 055–060 migration task는 `scripts/repository-contract.test.mjs`의 정확한 migration 목록과 schema smoke를 같은 커밋에서 갱신한다.
- 삭제는 기본적으로 soft delete 또는 `active` 상태 변경을 사용한다.
- API 응답은 새 필드를 추가하되 기존 필드를 최소 한 릴리스 동안 유지한다.

### 4.3 Canonical 데이터와 소비자

- Brand Core와 실행 규칙은 각각 승인 버전이 유일한 canonical source다. `brand_profiles`는 logo·색상·링크와 과도기 호환 projection만 맡고 승인 필드를 직접 수정하지 않는다.
- 기존 `knowledge_entries.__confirmed_brand_intelligence__`는 backfill 뒤 읽기 전용 legacy projection으로 표시하고 Wiki compiler와 신규 편집 API에서 제외한다.
- 제품·서비스는 `product_services + product_service_versions`가 canonical source다. 기존 product knowledge row는 idempotent backfill 후 읽기 전용 projection으로만 유지한다.
- Wiki의 직접 입력 항목은 origin, provenance, actor, draft/active 상태를 가지며 compiled page를 직접 PATCH하지 않는다.
- 콘텐츠와 DM은 같은 approved-data provider를 사용하되, DM corpus에는 외부 레퍼런스·트렌드·caption을 넣지 않는다.
- `autoApprovalRules`는 브랜드 문구 검토 규칙이며 실제 자동 게시/자동 답변 runtime switch와 분리한다.

### 4.4 신뢰 경계

```text
사실 근거
  Brand Core > 승인된 제품·서비스 > 활성 Wiki

영감 근거
  저장 레퍼런스 > 트렌드 > 외부 URL > 이전 우수 콘텐츠

금지
  영감 근거의 주장 → 자사 제품 사실로 승격
  AI 재분석 → 사용자 승인 데이터 자동 덮어쓰기
```

### 4.5 상태 UI

모든 데이터 화면은 아래 상태를 독립적으로 표현한다.

- `loading`: skeleton 또는 진행 상태
- `empty`: 첫 행동을 안내하는 빈 화면
- `error`: 원인과 재시도 버튼
- `stale`: 마지막 성공 데이터와 비차단 경고
- `ready`: 실제 서버 데이터

API 실패 시 하드코딩 샘플 수치, 가짜 성공 토스트, 가짜 프로필·썸네일을 표시하지 않는다.

대용량 데이터는 다음 순서로 지연 로드한다.

```text
목적 accordion 완료
  → family별 주제·crawl 요약
자료 accordion 완료
  → channel capability·target·format
AI 구현안 생성 완료 및 하나 선택
  → 실제 reference preview·avatar library
결과 상세 open
  → 큰 artifact·전체 caption·성과 상세
```

### 4.6 접근성

- 클릭 대상은 최소 44×44px로 한다.
- 탭은 `role="tablist"`, `aria-selected`, `aria-controls`를 갖는다.
- 토글과 선택 카드는 `aria-pressed` 또는 실제 form control을 사용한다.
- drawer/dialog는 focus trap, Escape 닫기, 호출자 focus 복원을 제공한다.
- `prefers-reduced-motion: reduce`에서는 변환·스크롤 애니메이션을 제거한다.
- 모바일 메뉴는 열린 동안 배경과 스크롤을 잠근다.

## 5. 공통 검증 명령

모든 명령은 저장소의 `brand_poilot` 디렉터리에서 실행한다.

```bash
npm run test --workspace @brand-pilot/customer-ui
npm run build --workspace @brand-pilot/customer-ui
npm run test --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/api
npm run test:migrations
npm run test:contract
npm run test:deployment
npm run test:e2e
npm test
npm run build
```

예상 결과:

- Vitest, Node test, Playwright가 모두 exit code 0이다.
- TypeScript `tsc --noEmit` 오류가 없다.
- Vite와 API bundle 빌드가 성공한다.
- 마이그레이션이 빈 DB와 기존 fixture DB에서 모두 적용된다.
- 기존 `card_news | blog | marketing` 계약 테스트가 계속 통과한다.

## 6. 단계별 Git 전략

아래는 구현 시 권장하는 커밋 순서이며 이 계획 작성 단계에서는 실행하지 않는다.

```text
feat(ui): add d-hybrid shell and navigation
feat(dashboard): compose operational dashboard
feat(brand): add versioned brand core and rules
feat(libraries): add product wiki avatar and reference libraries
feat(channels): expose channel capabilities and readiness
feat(content): add crawl-grounded content proposals
feat(content): add four-phase reference-once creation flow
feat(operations): integrate review publish dm and performance
test(regression): preserve customer admin and operational behavior
chore(deploy): gate and verify ubuntu rollout
```

각 커밋 전 `git diff --check`와 해당 작업의 좁은 테스트를 실행한다. Release A–D마다 통합 검증 결과를 별도 로그로 남긴다.
최종 인계 전 `git status --short`가 계획에 명시된 변경만 보여주는지 확인하고, 구현 완료 시에는 의도한 커밋 이후 빈 상태인지 확인한다.

## 7. 최종 수용 기준

- [ ] 원본, AI 제안, 승인된 Brand Core, 실행 규칙이 화면과 데이터에서 구분된다.
- [ ] 제품·서비스를 한 번 등록하고 콘텐츠와 DM에서 재사용한다.
- [ ] Wiki는 제품·브랜드 정형 필드를 복제하지 않고 설명형 지식과 지식 공백을 맡는다.
- [ ] 콘텐츠 생성에서 레퍼런스·아바타 선택은 정확히 한 번만 나타난다.
- [ ] 정보성·마케팅성 분류가 내부 워커 타입과 결정적으로 매핑된다.
- [ ] 3개 accordion 완료 후 생성된 AI 구현안의 의미와 사용 근거를 사용자가 이해할 수 있다.
- [ ] 레퍼런스가 제품 사실을 덮어쓰지 않는다.
- [ ] reference card가 실제 snapshot을 사용하고 preview 부재를 가짜 콘텐츠로 채우지 않는다.
- [ ] 채널 등록은 `/channels`에서 이루어지고 생성 화면은 capability만 소비한다.
- [ ] 사용자 화면에 영상·Reel 생성 선택지가 없다.
- [ ] Instagram 실제 게시와 Threads 내보내기, 준비 중 채널이 구분된다.
- [ ] Instagram DM의 webhook, 중복 방지, 상담 전환, 지식 부족, 재시도 흐름이 보존된다.
- [ ] 일일 생성 10회, 신규 다운로드 20회, 중복 다운로드 비차감, 자동 주제 4개, URL 10개, 해시태그 30개 제한이 보존된다.
- [ ] 피드백, 고객센터, 도움말, 공통 상태, ZIP, 접근성, 관리자 기능이 기능 보존표와 일치한다.
- [ ] Ubuntu에서 canary, HTTPS, worker readiness, promote, rollback, restore가 검증된다.
- [ ] 명시적 제외 기능은 신규 작업을 만들 수 없고 메뉴에도 노출되지 않는다.
