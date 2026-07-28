# D 하이브리드 완료·복구 설계

- 상태: 사용자 방향 승인, 실행 계획 작성 전 기준
- 작성일: 2026-07-28
- 일정: 하루 12시간, 5일 목표·6일 상한
- 기준 브랜치: `codex/brand-pilot-d-hybrid`
- 제품 기준: `2026-07-24-brand-reference-content-operating-system-design.md`
- 보존 기준: `docs/prd/brand-pilot-feature-preservation-ledger.md`

## 1. 목표

현재 D 하이브리드 브랜치의 구현을 전면 되돌리지 않고 보존한다. 이미 구현된 기능을 검증 가능한 기준선으로 고정한 뒤, 남은 콘텐츠 생성·운영 통합·회귀·Ubuntu 배포를 결과 중심 완료 단위와 독립 병렬 트랙으로 재편하여 5일을 목표로 하고 6일 안에 끝낸다.

기간을 줄이기 위해 기능을 삭제하거나 검증을 생략하지 않는다. 범위를 줄이는 대신 작업 단위와 리뷰 범위를 줄여 재작업을 줄인다.

## 2. 비협상 조건

1. 기존 커밋을 전면 revert, reset, 재구현하지 않는다.
2. 기능 보존표에서 `사용자 화면 제외`로 명시하지 않은 기존 기능은 유지한다.
3. 새 위치가 확정되지 않은 기존 기능은 삭제하지 않고 `미배치`로 보존한다.
4. 기존 `card_news | blog | marketing` API·worker 계약과 과거 데이터를 유지한다.
5. 회원, OAuth, 세션, 권한, workspace, 브랜드 설정과 운영 비밀정보를 보존한다.
6. AI 제안·생성 결과·렌더링·파생 snapshot·임시 job 등 재생성 가능한 데이터는 이전하지 않아도 된다.
7. 운영 env와 비밀정보는 사용자 승인 없이 변경하지 않는다.
8. 전체 회귀와 보존 검증 전에는 merge 또는 Ubuntu 배포를 하지 않는다.
9. 첫 Ubuntu 배포에서 scheduler, publish, DM 자동응답은 기본 비활성화한다.
10. 사용자 대상 영상·Reel·Shorts·TikTok 제작은 노출하거나 신규 작업을 만들지 않는다.

## 3. 현재 브랜치 처리 원칙

현재 브랜치의 커밋은 구현 자산으로 취급한다. 코드가 과도하게 상세하다는 이유만으로 제거하지 않는다.

- 이미 통과한 테스트와 migration은 다시 만드는 대신 회귀 증빙으로 연결한다.
- 미완료 리뷰 이슈는 해당 구현 위에 작은 수정 커밋으로 해결한다.
- 과도 구현이 남은 일정에 영향을 주지 않으면 보존한다.
- 보안, 데이터 손실, 기존 기능 파손을 일으키는 과도 구현만 별도 수정 대상으로 분류한다.
- 대규모 squash, history rewrite, force-push는 하지 않는다.

## 4. 기능 보존 방식

기능 보존표의 각 행은 완료 시 다음 상태 중 하나와 증빙을 가져야 한다.

| 상태 | 의미 | 필수 증빙 |
|---|---|---|
| 보존 | 기존 위치와 동작 유지 | 기존·신규 회귀 테스트 |
| 이동 | 새 화면으로 이동하고 legacy URL 호환 | route·redirect·브라우저 테스트 |
| 고도화 | 기존 기능 위에 새 계약 또는 UI 추가 | 구·신 계약 동시 테스트 |
| 신규 | 설계에 따라 새 기능 구현 | TDD·E2E·권한 테스트 |
| 첫 배포 비활성 | 구현은 유지하고 runtime flag OFF | flag OFF negative test |
| 사용자 화면 제외 | 기술 기반·기존 데이터만 보존 | 메뉴 미노출·작업 생성 차단 테스트 |

증빙이 없는 행은 완료로 처리하지 않는다.

## 5. 결과 중심 완료 단위 규칙

앞으로의 구현 단위는 다음 제한을 따른다.

- 한 단위는 한 가지 사용자 동작 또는 한 가지 runtime invariant만 담당한다.
- production code 전에 하나의 명확한 실패 테스트를 확인한다.
- 각 단위는 좁은 테스트, typecheck 또는 build, `git diff --check` 후 커밋한다.
- 매 Task마다 별도 명세 리뷰와 코드 품질 리뷰를 반복하지 않는다.
- 구현자가 자체 점검하고 핵심 테스트가 통과하면 다음 결과 단위로 이동한다.
- Critical, 인증·tenant 경계, 데이터 손실, migration, 사용량 중복 차감, 중복 게시·DM, 운영 env 위험만 즉시 차단한다.
- 일반 Important·Minor 이슈는 통합 체크포인트 리뷰에서 모아 수정한다.
- 매일 실제 브라우저에서 확인 가능한 결과를 우선 만든다.
- 서로 다른 패키지·화면처럼 독립적인 작업은 별도 worktree에서 병렬화하고 공통 계약은 먼저 고정한다.
- 계획 밖 migration, worker lifecycle, 운영 변경은 구현 전에 보고한다.

## 6. 5일 목표·6일 상한 실행 구조

### Day 1 — Task 4 안정화와 worker 병렬 구현

- Content Task 4의 마지막 idempotent replay ordering을 완료한다.
- clean checkpoint 뒤 Task 5 proposal worker와 Task 6 기존 generation worker 연결을 독립 트랙으로 병렬 구현한다.
- UI가 사용할 Task 4 계약을 고정한다.

완료 조건:

- working tree clean
- Task 4 핵심 PGlite·API·typecheck PASS
- proposal worker와 기존 worker 연결의 핵심 계약 테스트 PASS

### Day 2 — 콘텐츠 UI 수직 슬라이스

- 4개 상위 phase와 콘텐츠 생성의 3개 accordion을 연결한다.
- 정보성·마케팅성, 주제·제품, target·format·channel 입력을 실제 API에 연결한다.
- proposal 비교와 reference/avatar 단일 선택 흐름을 브라우저에서 확인 가능하게 만든다.

완료 조건:

- reload/resume·back navigation·field invalidation 핵심 테스트 PASS
- reference/avatar 선택 UI가 정확히 한 번만 렌더링
- 실제 브라우저에서 setup→proposal→선택 결과 확인

### Day 3 — 생성·검토·수정

- generating과 reviewing phase를 연결한다.
- 기획 근거, 카피, 완성본, 게시 탭과 부분 재생성·실패 output retry·다운로드를 연결한다.
- Content Tasks 10~11 API·UI·E2E를 완료한다.

완료 조건:

- card-news, blog, marketing worker 회귀 PASS
- text-only에서 이미지 job이 생성되지 않음
- 기존 생성·재생성·미리보기·다운로드 회귀 PASS
- 일일 생성 10회, 신규 다운로드 20회, 재다운로드 비차감 PASS

### Day 4 — 운영 통합과 통합 리뷰

- Operations Tasks 1~8을 기존 게시·DM·성과·지원 코드 위에 연결한다.
- 게시 deep link, 큐, retry, cancel, 결과 불명 복구를 보존한다.
- DM 근거 경계와 자동화 flag OFF를 검증한다.
- 누적 diff에 대해 통합 명세·코드 품질 리뷰를 한 번 실행하고 Critical/Important를 수정한다.

완료 조건:

- Operations 계획의 8개 Task를 작은 회귀 단위로 완료
- Instagram 게시·DM·성과·지원 기존 기능 회귀 PASS
- 자동화 flag OFF negative tests PASS

### Day 5 — 전체 회귀, 배포, 실제 QA

- 기능 보존표 전체 matrix를 실행한다.
- API, UI, workers, migrations, contracts, deployment tests를 실행한다.
- 실제 PostgreSQL 16 회귀를 실행한다.
- 인증·OAuth·세션·권한·브랜드 데이터 보존을 별도 검증한다.
- Ubuntu canary, HTTPS, CORS, readiness, backup·restore, rollback을 검증한다.
- 데스크톱·모바일 실제 브라우저 QA를 실행한다.

완료 조건:

- 설계 수용 기준 11개 모두 PASS
- 기능 보존표 모든 행에 증빙 존재
- blocker·Critical 리뷰 이슈 없음
- canary·rollback·restore PASS
- 사용자 승인 후 merge·promote

### Day 6 — 상한·버퍼

- Day 1~5에서 발견된 통합 결함과 환경 차이만 처리한다.
- 새 범위를 추가하지 않는다.
- 외부 Meta 권한, OAuth 설정, DNS, Ubuntu 접근 대기는 구현 시간과 분리한다.

## 7. 일정 통제

- 하루 12시간 기준으로 진행한다.
- 매일 종료 시 완료 항목, 테스트 수치, 현재 HEAD, 남은 예상 시간을 보고한다.
- Day 1 종료 시 worker 병렬 트랙이 완료되지 않으면 즉시 위험을 보고한다.
- Day 2 종료 시 UI 수직 슬라이스가 브라우저에서 보이지 않으면 즉시 위험을 보고한다.
- Day 4 종료 시 전체 회귀 진입이 불가능하면 6일 상한 위험을 보고한다.
- 6일을 넘길 조짐이 있으면 자동으로 계속하지 않고 blocker와 잔여 범위를 보고한다.

외부 Meta 권한, OAuth 설정, DNS, Ubuntu 접근 장애로 기다리는 시간은 구현 시간과 분리해 보고한다.

## 8. 데이터·배포 안전

새 migration은 forward-only로 작성한다. 적용된 migration을 수정하지 않는다.

배포 전 데이터 분류:

- 반드시 보존: 회원, OAuth, 세션, 권한, workspace, 브랜드 설정, 운영 비밀정보
- 재생성 가능: AI 제안, 생성 결과, 렌더링, 파생 snapshot, 임시 job과 사용자가 재수집 가능한 자료

삭제 또는 재생성 적용 전에는 대상 테이블, row 조건, 백업, rollback 방법을 사용자에게 보고한다.

## 9. 최종 완료 정의

D 하이브리드 완료는 새 화면이 보이는 것만 뜻하지 않는다.

다음을 모두 만족해야 한다.

1. 최상위 설계의 수용 기준 11개가 자동·수동 증빙으로 통과한다.
2. 기능 보존표의 기존 기능이 삭제되지 않고 유지·이동·고도화 상태로 검증된다.
3. 명시적 제외 기능은 신규 작업을 만들거나 메뉴에 노출되지 않는다.
4. 신규 콘텐츠 흐름과 기존 생성·게시·DM·관리자·지원 기능이 함께 통과한다.
5. 운영 인증 데이터와 원본 자료가 보존된다.
6. Ubuntu canary, rollback, backup·restore와 실제 브라우저 QA가 통과한다.
