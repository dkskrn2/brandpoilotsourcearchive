# 브랜드 인텔리전스 온보딩 워커 v2 확정 설계

**Status:** Final
**Date:** 2026-07-30
**Supersedes:** `docs/superpowers/specs/2026-07-21-brand-intelligence-onboarding-design.md`

## 1. 목표

온보딩 2단계 전용 워커가 사용자의 회사명, 자사 URL, 선택 문서를 안전하게 분석해 검토 가능한 브랜드 코어를 만든다. 자사 사이트는 중요한 콘텐츠 페이지만 최대 20개 읽고, 제품·서비스 페이지와 대표 항목은 각각 합산 최대 5개로 제한한다. 분석 실행은 활성 처리 시간 20분을 넘지 않으며, 사용자가 취소하면 실행 프로세스와 해당 실행의 입력·업로드·중간 산출물·초안을 폐기한다.

이 설계는 한 번의 거대한 CLI 호출을 사용하지 않는다. 자료 수집, 자사 사실 추출, 대표 제품·서비스 선정, 브랜드 코어 합성, 외부 시장 근거 수집, 최종 감사가 서로 다른 계약과 제한을 가진 단계형 파이프라인으로 실행된다.

## 2. 확정 결정

| 항목 | 확정값 |
|---|---|
| 변경 대상 | 온보딩 브랜드 인텔리전스 흐름과 그 실행에 필요한 API·DB·공유 리소스 보호 |
| 자사 콘텐츠 페이지 | 실제 콘텐츠 fetch 시도 최대 20개 |
| 중요 페이지 성공 조건 | `successful >= min(10, ceil(eligibleSelected / 2))` |
| 제품·서비스 페이지 | 자사 20개 안에서 합산 최대 5개 |
| 대표 제품·서비스 결과 | product/service 합산 최대 5개 |
| 외부 근거 | 워커가 실제 fetch·보존하는 canonical URL 합산 최대 10개 |
| CLI | 순차 실행, logical call 최대 8개 |
| CLI 재시도 | run 전체 합산 최대 2회, physical process 최대 10개 |
| 활성 처리 제한 | 20분 hard deadline |
| 리소스 대기 | 활성 20분에서 제외, 최대 60분 뒤 명시적 실패 |
| 동시성 | 전체 Codex 2개, DM 예약 1개, non-DM 1개 |
| 온보딩 동시 실행 | 호스트당 1개, CLI 병렬 호출 금지 |
| 회사명 | Step 1 필수, Step 1~3 표시, Step 3 수정, 확정 트랜잭션에서 `brands.name` 반영 |
| Kakao 이름 | 사람 이름으로만 취급하며 회사명으로 추론하거나 복사하지 않음 |
| 취소 | process tree 중단, run 데이터 purge, 신규 온보딩은 빈 Step 1로 복귀 |
| 재분석 취소 | 실행 초안만 폐기하고 기존 confirmed 회사명·브랜드 정보는 유지 |

## 3. 범위

### 포함

- 온보딩 Step 1 회사명 입력 및 Step 2/3 지속 표시
- Step 2 취소 버튼, 취소 경쟁조건, 프로세스 중단, durable purge
- 중요 페이지 discovery/ranking/fetch와 정확한 20페이지 제한
- 제품·서비스 페이지 및 대표 항목 합산 5개 제한
- 자사 페이지 성공 기준과 파일 전용 분석 분기
- 단계형 CLI 실행, 계약 검증, 외부 근거 최대 10개
- 활성 20분 deadline, stage/call/retry 카운터, 자원 대기 표시
- 동일 PC의 API 보호를 위한 global/local admission과 fail-closed lease
- v1 confirmed 결과를 계속 읽는 v2 호환 레이어
- 회사명 확정, 프로필·지식·Wiki 요청의 원자적 저장
- 취소·실패·성공별 업로드 수명주기와 고아 업로드 정리
- 관측성, 보안 canary, 성능 benchmark, 단계적 rollout

### NOT in scope

- `/sources`의 일반 수동·72시간 크롤링 동작 변경
- 특정 콘텐츠 제작용 제품·서비스 URL 분석 통합
- CLI 호출 병렬화
- 로그인·쿠키가 필요한 사이트, CAPTCHA 우회
- 스캔 PDF OCR, DOCX, PPTX
- 자동 확정 또는 기존 confirmed 버전 자동 덮어쓰기
- 주기적 브랜드 CLI 재분석
- 경쟁사 정보로 자동 비교 광고 생성
- 회사명으로 `workspaces.name`을 자동 변경
- UI 목업·시각 리디자인
- 새로운 `brand_offerings` 테이블

대표 제품·서비스는 v2 확정 JSON과 기존 knowledge entry의 `structured_data`에 둔다. 별도 테이블은 현재 소비자가 요구하지 않으므로 추가하지 않는다.

## 4. 이미 존재하는 기반

다음 코드는 새로 만들지 않고 보강해 재사용한다.

- `apps/api/src/sourceCrawler.ts`
  - DNS pinning, redirect별 재검증, bounded response read, content discovery
- `apps/api/src/brandDocumentExtractor.ts`
  - TXT/MD/PDF/CSV/XLSX 정규화, 표·문자 제한
- `apps/api/src/brandIntelligenceRepository.ts`
  - run row lock, lease token fencing, confirmed version 활성화 트랜잭션
- `apps/api/src/brandIntelligenceProvider.ts`
  - draft가 downstream으로 유출되지 않게 하는 confirmed-only 경계
- `apps/api/src/workerResources.ts`와 `worker_resource_leases`
  - 전체 2개, DM 예약 1개, non-DM 1개 정책
- `workers/brand-pilot-worker-runtime`
  - Windows 포함 process tree 종료
- `workers/brand-pilot-dm-worker/src/knowledgeCurator.ts`
  - source quote가 원문에 실제 존재하는지 검증하는 패턴
- `wiki_build_requests`
  - 확정 트랜잭션 안에서 생성되는 durable Wiki 재빌드 요청
- 기존 API/worker/UI 계약 테스트와 smoke script

공유 lease helper의 heartbeat 실패 무시 동작은 재사용하지 않는다. 모든 Codex 실행 경로가 사용하는 fail-closed helper로 교체한다.

## 5. 시스템 경계

```text
Customer UI
   |
   | create / poll / cancel / confirm
   v
API control plane
   |  - auth, validation, lifecycle state, fencing
   |  - no page crawl, no document parsing, no CLI wait
   v
PostgreSQL
   |  - run + stage metadata + upload intent
   |  - global Codex resource leases
   v
Onboarding worker on the same PC
   |  - local pressure admission
   |  - private upload read + document isolation
   |  - discovery/crawl + temporary evidence
   |  - sequential CLI stages
   |  - purge and stale-runtime sweeper
   v
Codex CLI child processes
   - no shell/browser/apps/computer tools
   - web search only in external-candidate stage
```

API는 control plane이다. 현재 `claimAndPrepareBrandAnalysis`가 API 요청 안에서 수행하는 URL crawl, Blob download, 문서 parse는 모두 온보딩 워커로 이동한다. API claim은 DB row를 임대한 뒤 즉시 반환해야 한다.

## 6. 실행 상태와 fencing

### 6.1 Run lifecycle

세부 작업 단계를 run status에 모두 넣지 않는다. lifecycle과 current stage를 분리한다.

```text
accepting_uploads -- all uploads complete + start --> queued
       |
       | upload timeout
       v
     failed

queued
  |
  v
waiting_for_resource -- queue timeout --> failed
  |
  | global lease + local admission acquired
  v
running --------------------------------------> failed
  |                                              ^
  | final contract valid                         | deadline / worker lost /
  v                                              | insufficient evidence
finalizing -- raw-input cleanup complete --> review_ready
                                              |
                                              | confirm transaction
                                              v
                                          confirmed

accepting_uploads | queued | waiting_for_resource | running | finalizing | review_ready | failed
               \                    /
                --> cancel_requested --> purging --> cancelled --> row deleted
```

`confirmed`는 취소할 수 없다. `complete`, `stage complete`, `cancel`, `confirm`은 모두 같은 run row를 `FOR UPDATE`로 잠그고 `state_version`, `worker_id`, `lease_token`을 검사한다.

위 lifecycle은 `pipeline_version=2`에 적용한다. additive schema는 rollout 동안 v1의 `extracting|analyzing` 상태도 계속 허용하며 기존 row를 rewrite하지 않는다.

Step 1 제출은 먼저 `accepting_uploads` run과 파일별 upload intent를 한 트랜잭션으로 만든다. 파일이 없으면 start가 즉시 `queued`로 전환한다. 파일이 있으면 브라우저가 run ID를 받은 뒤 파일을 순차 업로드하고, 모든 intent가 `uploaded`가 된 경우에만 명시적 start 요청이 `queued`로 전환한다. 따라서 Blob이 생기기 전에 항상 소유 run과 정리 대상 row가 존재한다. 30분 안에 start되지 않은 run은 `upload_session_expired`로 실패한 뒤 purge 대상이 된다.

취소가 먼저 commit되면 모든 늦은 stage/complete write는 409로 거부된다. complete가 먼저 `review_ready`가 되어도 confirm 전이면 cancel이 run을 폐기할 수 있다. confirm이 먼저 commit된 confirmed run은 취소 요청을 거부한다.

### 6.2 Stage codes

- `discovering_pages`
- `crawling_owned_pages`
- `extracting_documents`
- `extracting_owned_facts`
- `selecting_offerings`
- `synthesizing_brand_core`
- `discovering_market_sources`
- `fetching_market_sources`
- `validating_result`
- `purging`

각 stage의 content-free 메타데이터는 `brand_analysis_stage_runs`에 저장한다. 원문, URL query, 파일 내용, CLI 출력 전문은 stage 테이블에 저장하지 않는다.

### 6.3 Deadline과 retry

- run이 global resource lease와 local admission을 모두 얻는 순간 `active_started_at`과 `deadline_at = DB now() + 20 minutes`를 한 번만 기록한다.
- resource queue 대기는 20분에서 제외한다.
- active 시작 뒤의 crawl, document parse, pressure wait, CLI, external fetch, validation은 모두 20분에 포함한다.
- heartbeat가 deadline을 연장하지 않는다.
- `lease_expires_at = least(DB now() + lease_ttl, deadline_at)`로 제한한다.
- logical call은 최대 8개, retry process는 최대 2개, physical CLI process는 최대 10개다.
- 완료된 stage는 같은 run에서 다시 실행하지 않는다.
- worker crash 후 active run 전체를 자동 재실행하지 않는다. watchdog가 `worker_lost`로 실패시키고 사용자가 명시적으로 retry한다.
- resource 대기는 최대 60분이며 초과 시 `resource_queue_timeout`으로 실패한다.

## 7. 회사명 수명주기

### 7.1 데이터 원칙

- `app_users.display_name`: Kakao에서 받은 사람 이름
- `brands.name`: 사용자가 명시적으로 확정한 회사명
- `brands.company_name_state`: `provisional | legacy_unknown | confirmed`
- `brands.company_name_confirmed_at`: explicit confirmation 시각

신규 가입은 DB 호환용 opaque placeholder를 생성하되 UI에 회사명으로 투영하지 않는다. Kakao nickname을 `brands.name`으로 복사하지 않는다.

기존 row는 이름 문자열만으로 모두 confirmed 처리하지 않는다.

- 명확한 내부 placeholder는 `provisional`
- 출처가 불명확한 기존 이름은 `legacy_unknown`
- active confirmed v1 run이 있고 내부 placeholder가 아닌 기존 이름은 기존 사용자를 막지 않도록 one-time grandfather하여 `confirmed`
- 그 밖에는 migration 이후 사용자가 온보딩 또는 브랜드 설정에서 명시적으로 저장한 이름만 `confirmed`

active confirmed v1 run을 가진 기존 사용자는 이름이 `legacy_unknown|provisional`이어도 온보딩 gate에서 grandfather한다. 내부 placeholder는 표시하지 않고 “회사명 확인 필요”를 표시하며, 다음 설정/재분석에서 확인하도록 한다. 그 외 `legacy_unknown`은 입력란을 빈 값으로 열고 기존 값을 숨은 기본값으로 제출하지 않는다.

### 7.2 화면과 run

- 신규 온보딩 Step 1은 빈 회사명이며 필수다.
- create 요청의 `companyName`은 run immutable input snapshot에 저장한다.
- Step 2는 run snapshot의 회사명을 표시한다.
- Step 3은 회사명을 편집할 수 있다.
- CLI가 회사명을 결정하지 않는다. API가 user-owned field로 관리한다.
- 신규 온보딩 cancel은 회사명까지 지우고 빈 Step 1로 돌아간다.
- 재분석은 confirmed 회사명을 prefill한다. 재분석 cancel은 그 confirmed 값으로 돌아가고, 취소한 draft만 버린다.

### 7.3 Confirm

confirm API는 회사명과 edited result를 한 요청으로 받는다.

```json
{
  "companyName": "모종애드",
  "editedResult": {},
  "idempotencyKey": "uuid",
  "expectedRevision": 3
}
```

서버는 NFKC normalize, trim, 길이, control character를 검증한다. `brands_workspace_name_active_unique` 충돌은 `409 company_name_conflict`로 반환한다.

브랜드 row를 먼저 잠근 뒤 다음을 한 트랜잭션으로 수행한다.

1. 회사명과 confirmed state 갱신
2. run v2 effective result 확정
3. 기존 active run 비활성화 및 새 run 활성화
4. `brand_profiles` 호환 필드 갱신
5. knowledge entry의 content/structured data 갱신
6. Wiki build request 생성 또는 revision 증가

UI의 Topbar/Sidebar/Settings는 하나의 display-name selector를 사용한다. 갱신되는 UI status를 stale auth session보다 우선해 확정 직후 `"내 브랜드"`가 남지 않게 한다.

## 8. 중요 페이지 discovery와 20페이지 제한

### 8.1 Page budget의 정확한 의미

`content fetch attempt`는 HTML 본문을 읽으려 시도한 canonical candidate 한 개다.

- 최대 20 attempts
- seed homepage도 20 안에 포함하며 discovery 후 다시 fetch하지 않고 cache한다.
- redirect chain은 같은 page attempt다.
- 같은 URL의 JS fallback은 같은 page attempt다.
- `robots.txt`와 sitemap은 metadata request라서 20에 포함하지 않지만 별도 byte/time/count 제한을 갖는다.
- 제품·서비스 페이지 최대 5개는 20개 subset이며 추가 fetch가 아니다.

각 attempt는 다음 중 하나로 분류한다.

- `success`: 안전한 final URL, 유효 HTML, 충분한 unique normalized 본문, owned canonical/hash 검증 통과
- `failure`: network/HTTP/timeout/parse/content-too-short
- `neutral`: canonical/hash duplicate 또는 deterministic hard exclusion

`eligibleSelected = success + failure`이다. neutral을 빼되 실패를 분모에서 제거하지 않는다.

이 success는 “페이지를 안전하게 읽었다”는 crawl 성공 정의다. 이후 CLI fact 추출 결과를 미리 요구하지 않는다. facts가 부족하거나 검증에 실패하면 해당 field의 source gap 또는 분석 계약 실패로 처리하되 이미 계산한 page-read threshold를 소급 변경하지 않는다.

```text
requiredSuccess = min(10, ceil(eligibleSelected / 2))
complete iff success >= requiredSuccess
```

예시:

- eligible 20 → 최소 10
- eligible 15 → 최소 8
- eligible 8 → 최소 4
- 실질적인 1페이지 사이트 → 최소 1
- eligible 0 → `no_important_pages`

URL이 입력되면 문서가 함께 있어도 이 성공 조건은 필수다. 파일만 입력한 분석은 페이지 성공 조건을 적용하지 않는다.

### 8.2 Candidate discovery

후보는 최대 200개를 수집하면서 즉시 cap한다.

1. seed HTML의 nav/main/body link
2. canonical, OG URL, JSON-LD
3. `robots.txt`의 sitemap
4. `/sitemap.xml`
5. bounded sitemap index와 2-hop owned link

Metadata 제한:

- robots 256 KiB, 5초
- sitemap body 2 MiB
- sitemap 최대 5개, index depth 1
- candidate 최대 200개
- compression/decompression byte cap

HTML은 regex가 아니라 parser로 처리한다. URL은 tracking parameter, fragment, default port, duplicate slash를 normalize하고 final redirect/canonical 기준으로 dedupe한다.

### 8.3 Owned scope

- seed와 같은 registrable domain
- seed 또는 already accepted owned page가 직접 링크한 subdomain만 allowset에 추가
- redirect와 canonical이 allowset 밖으로 나가면 owned evidence로 채택하지 않음
- every URL/redirect/DNS resolution은 globally-routable-only 정책을 통과해야 함
- credentials, non-HTTP schemes, IP literal private ranges, localhost, metadata endpoints 차단

### 8.4 Hard exclusions

- terms, privacy, cookie, legal, policy boilerplate
- login, account, cart, checkout
- search, tag, author, pagination, feed
- careers, press archive
- locale/print duplicate
- tracking/session variants
- binary/download files
- empty shell, error page, canonical duplicate

한국어·영어 URL segment, 이미 관찰한 anchor text와 sitemap metadata를 함께 본다. seed 언어를 우선하고 quota가 비는 경우에만 다른 locale을 사용한다.

### 8.5 Deterministic ranking quotas

| 종류 | 최대 |
|---|---:|
| homepage | 1 |
| company / brand / about | 3 |
| product / service / solution | 5 |
| price / plan | 2 |
| case / review / portfolio | 3 |
| FAQ / help | 2 |
| location / contact | 2 |
| 기타 높은 정보 밀도 페이지 | 2 |

합계 fetch attempt는 최대 20이다. fetch 전 priority는 URL, 이미 관찰한 link text/nav 위치, sitemap priority/lastmod, path depth만으로 계산한다. 아직 fetch하지 않은 candidate의 title, JSON-LD, 본문 정보 밀도를 안다고 가정하지 않는다.

priority queue에서 하나를 꺼내는 순간 attempt를 소비한다. fetch된 페이지의 title/JSON-LD/body는 그 페이지의 category/success 판정과 결과 metadata에만 쓰고, 거기서 발견한 owned link는 depth 2 이내에서 candidate queue에 추가한다. 새 link 자체는 fetch할 때까지 attempt가 아니며 candidate total 200 cap을 넘지 않는다. redirect/canonical/hash duplicate도 이미 소비한 같은 attempt의 neutral 결과다. 이 dynamic frontier 방식으로 2-hop discovery와 20-attempt hard cap을 동시에 지킨다. LLM은 선택에 사용하지 않는다.

### 8.6 Fetch와 JS fallback

- HTTP page timeout 10초
- raw response 최대 2 MiB
- normalized text 페이지당 최대 15,000자
- HTTP concurrency 최대 3
- redirect 최대 3
- 자동 content retry 없음
- raw HTML과 normalized full text는 worker temp에만 존재

정적 HTML이 명백한 JS shell일 때만 fallback한다.

- run당 최대 3페이지
- Chromium 1개, page 1개, fresh context, cookies 없음
- image/video/font/download/websocket/service worker 차단
- 모든 main/subresource는 DNS-pinning egress proxy를 통과
- private/non-global destination 차단
- Chromium은 CLI를 실행하기 전에 완전히 종료

## 9. 문서와 업로드

### 9.1 입력 제한

- 파일 최대 5개
- 각 파일 최대 10 MiB
- run 전체 raw upload 최대 25 MiB
- 지원: TXT, MD, text PDF, CSV, XLSX
- 문서당 normalized 최대 100,000자
- 문서 전체 normalized 최대 200,000자
- 페이지 source당 normalized 최대 100,000자
- 페이지+문서 combined normalized 최대 400,000자

제한 초과를 조용히 잘라내지 않는다. `document_content_limit_exceeded`로 실패하거나 명시적 source gap을 만들 수 있는 단계에서는 누락 범위를 기록한다.

### 9.2 Upload intent와 privacy

Step 1 create transaction에서 Blob보다 먼저 run-scoped upload intent를 만든다. storage path는 파일명을 포함하지 않는 opaque UUID/hash 경로다.

브라우저는 인증된 `PUT /brands/:brandId/brand-intelligence/analyses/:analysisId/uploads/:uploadId/content`로 파일을 한 개씩 보낸다. API는 body를 메모리에 모으지 않고 private Blob `put`으로 stream하며 다음을 동시에 강제한다.

- 요청의 workspace/brand/run/upload 소유권
- upload intent의 `intent` 상태와 30분 만료
- 파일별 upload attempt 최대 3회; 성공한 intent는 다시 쓸 수 없음
- 선언된 Content-Length, MIME, 파일당 10 MiB, run 합산 25 MiB
- 실제 stream SHA-256과 제출 checksum 일치
- `access: "private"`, opaque path, overwrite 금지

각 PUT은 header/expiry를 먼저 검증한 뒤 짧은 DB transaction에서 attempt를 증가시키고 `brand_analysis_upload_attempts` row와 2분 lease를 만든 뒤 parent intent를 `intent|failed → uploading`으로 전이한다. attempt UUID는 Blob object path의 일부이므로 모든 retry가 서로 다른 key를 쓴다. network stream 동안 DB lock을 잡지 않는다. 완료 transaction은 attempt ID, run status, expiry를 다시 검사한 뒤에만 parent를 `uploaded`로 전이한다. checksum 또는 metadata가 다르면 해당 attempt object만 즉시 삭제하고 intent를 `failed`로 둔다. 성공한 `uploaded` intent의 두 번째 PUT과 4번째 attempt는 거부한다.

cancel endpoint는 같은 API process의 진행 중 upload controller를 즉시 abort한다. process crash나 다른 instance 때문에 controller가 없더라도 late completion은 run status/attempt fencing에 실패하며 자기 attempt path만 삭제한다. 2분이 지난 `uploading` attempt는 sweeper가 그 attempt path를 조회·삭제한 뒤 `failed`로 바꾸어 같은 intent의 재시도를 허용한다. run당 partial unique index로 동시에 `uploading`인 attempt는 하나뿐이다.

cancelled tombstone으로 전이하거나 upload row를 hard-delete하기 전에 모든 attempt가 terminal이고 알려진 attempt path의 삭제가 확인되어야 한다. 따라서 cancel과 process crash 사이에도 추적되지 않는 late object가 생기지 않는다.

API는 브라우저에 storage credential, Blob URL, storage path를 반환하지 않는다. 이 경로는 최대 25 MiB의 단일 순차 stream만 사용하며 CLI/Chromium과 겹치기 전에 끝난다. API 응답성과 메모리 사용은 같은 PC 부하 benchmark에 포함한다.

Worker는 다운로드 후 실제 byte SHA-256을 제출 checksum과 비교한다. CLI에는 storage credential이나 Blob URL을 전달하지 않고 internal source ID와 bounded text만 전달한다.

### 9.3 Parser isolation

PDF/XLSX는 전체 decode 전에 page/object/sheet/decompressed-byte 제한을 적용한다. 각 문서는 별도 subprocess 또는 worker thread에서 처리하며 다음을 제한한다.

- 30초
- RSS 256 MiB
- XLSX sheet/row/cell/decompressed byte
- PDF page/object/text byte
- stdout/result byte

### 9.4 Retention

- `accepting_uploads`: 30분 안에 start되지 않으면 `upload_session_expired` 후 purge
- `cancel_requested`: worker/process 중단 후 Blob 삭제, upload row 제거
- `failed`: `retention_expires_at`까지 동일 입력 retry를 위해 private Blob과 input을 최대 24시간만 유지; 만료 sweeper가 `purging`으로 전이
- `finalizing`: result/evidence를 먼저 durable 저장하고 raw Blob cleanup을 `pending`으로 기록
- `review_ready`: finalizing cleanup이 모든 원본 삭제를 확인한 뒤에만 전이하며 짧은 excerpt/hash/파일 메타데이터만 유지
- `confirmed`: 원본은 유지하지 않고 confirmed result, source metadata, hash, bounded excerpt만 유지

취소 tombstone에는 company, URL, file name, storage path, content를 남기지 않는다.

worker는 Blob을 직접 먼저 지우지 않는다. final result write/응답이 유실되어도 같은 complete key가 durable `finalizing` row를 replay하고 cleanup loop가 이어받는다. cleanup 실패 시 result는 보존되고 UI는 “분석 정리 중”을 표시한다.

## 10. 단계형 CLI 파이프라인

### 10.1 Call graph

```text
Owned evidence (max 400k chars)
      |
      +--> Calls 1..4: owned facts, offline, char-balanced batches
      |          |
      |          +--> verified facts + quotes + gaps
      |
      +--> Call 5: representative offerings <= 5, offline
      |
      +--> Call 6: brand core synthesis, offline
      |
      +--> Call 7: external candidate URL discovery, search only
      |          |
      |          +--> worker safe-fetches <= 10 external pages
      |
      +--> Call 8: external synthesis + final evidence audit, offline
                       |
                       v
             brand-intelligence-result.v2
```

Calls 1~4는 고정 4회가 아니라 1~4회다. 각 source는 heading/paragraph 경계에서 최대 20,000자의 stable segment로 나누며, 긴 단일 block만 Unicode-safe boundary로 분할한다. segment는 원 source ID, segment ID, character range, hash를 보존하므로 내용이나 provenance를 버리지 않는다. 이 segment들을 source priority와 원문 순서대로 네 batch에 순차 pack하고 batch당 최대 100,000자로 제한한다. 따라서 combined 400,000자를 네 call에 항상 수용한다.

### 10.2 Owned facts

각 fact는 다음을 포함한다.

- stable fact ID
- claim
- source ID
- source URL 또는 null
- 원문에 실제 존재하는 1~4개 bounded quote
- category
- confidence가 아니라 `supported | conflicting | missing`

Quote는 whitespace normalize 후 원문 substring인지 worker가 deterministic하게 검증한다. 검증 실패 fact는 다음 단계에 전달하지 않는다.

### 10.3 Representative offerings

product/service를 한 배열로 다룬다.

- 합산 최대 5
- canonical URL, SKU가 있으면 SKU, 없으면 normalized name으로 dedupe
- source fact ID 필수
- evidence 없는 가격·성과·효능·인증 생성 금지
- page quota 5와 result quota 5를 모두 적용

### 10.4 Brand core

자사 facts만 사용한다.

- company one-line definition
- overview / business description
- primary/subcategories
- primary/secondary targets
- customer needs
- value proposition
- differentiators
- core/supporting appeals
- keywords
- observed tone suggestion

`observedTone`은 제안으로만 저장하며 기존 `brand_profiles.tone`을 자동 변경하지 않는다.

### 10.5 External market research

Call 7에는 raw 자사 페이지나 upload 내용을 전달하지 않는다. 검증된 core에서 만든 짧은 search brief만 전달한다.

- shell/browser/apps/computer tools 비활성
- web search만 허용
- candidate URL 최대 30개
- worker가 safe normalize/dedupe
- 실제 external fetch attempt와 retained unique canonical URL 합산 최대 10개
- owned crawler와 같은 DNS-pinned safe-fetch를 사용하고 모든 DNS answer/redirect hop/canonical을 globally-routable로 재검증
- domain당 최대 2개 우선
- 외부 fetch 실패는 전체 분석 실패가 아니라 빈 competitors/market과 source gap으로 degrade

Codex search backend가 내부적으로 접촉한 URL 수는 worker가 강제할 수 없다. 이 설계의 “외부 10페이지”는 워커가 실제 fetch해 final analysis에 넣는 페이지 수다. search provider 접촉 자체까지 10으로 제한해야 하는 요구가 생기면 CLI live search를 dedicated search API로 교체한다.

### 10.6 Final audit

Call 8은 search가 없는 offline 호출이다.

- company name을 result에 출력하거나 변경하지 않음
- owned claim은 owned registry source ID만 참조
- external claim은 worker external registry만 참조
- retained external URL distinct 합계 ≤10
- offerings ≤5
- unsupported number/achievement/efficacy 제거
- conflicting claims는 source gap으로 이동
- 새 source ID, URL, claim을 만들 수 없음

## 11. CLI trust boundary

Raw 웹·문서 내용은 untrusted data다. 프롬프트 지시만으로 방어하지 않는다.

모든 호출 공통:

- pinned Codex CLI version
- `--ignore-user-config`
- `--ignore-rules`
- `--ephemeral`
- `--output-schema`
- `--sandbox read-only`
- shell tool disabled
- apps/plugins/browser/computer/image tools disabled
- isolated empty runtime directory
- `shell_environment_policy.inherit=none`
- minimal child environment
- dedicated low-privilege service identity
- model process lower OS priority
- stdout/stderr streaming byte cap
- full prompt/model output를 application log나 DB error에 기록하지 않음

Call 7만 web search tool을 허용한다. JSONL event allowlist 밖의 tool invocation이 나타나면 즉시 process tree를 종료하고 `cli_tool_policy_violation`으로 실패시킨다.

Worker 시작 시 sandbox canary를 실행한다.

1. shell tool이 노출되지 않는지
2. runtime 밖 sentinel file을 읽지 못하는지
3. child tool environment에 secret이 없는지
4. offline stage에서 web event가 발생하지 않는지
5. search stage에서 shell/browser event가 발생하지 않는지

canary 실패 시 v2 job을 claim하지 않는다.

## 12. 동일 PC 리소스 보호

CLI를 호출하는 프로세스도 같은 PC의 CPU/RAM을 사용하므로 “CLI라서 서버와 무관”하지 않다.

### 12.1 Global lease

- total Codex slots: 2
- DM reserved: 1
- non-DM: 1
- workload에 `onboarding` 추가
- onboarding, subject analysis, content, Wiki가 non-DM 한 칸을 공유
- 온보딩은 active 시작 전에 lease를 얻고 전체 active pipeline 동안 보유
- heartbeat 15초, TTL 45초
- 마지막 성공 heartbeat가 safety margin을 넘으면 task의 AbortSignal을 fire하고 Chromium/CLI/process tree를 kill
- heartbeat 오류를 로그만 남기고 계속 실행하는 기존 helper를 fail-closed shared helper로 교체

모든 Codex spawn 경로가 같은 helper를 사용해야 hard guarantee가 성립한다.

### 12.2 Local admission

Global lease 획득 전과 각 heavyweight stage 전 확인한다.

lease 획득 직후에도 즉시 다시 sample한다. 두 번째 sample이 기준을 넘으면 active를 시작하지 않고 lease를 release한 뒤 resource queue로 돌아간다. 최대 60분 대기 뒤의 stale sample로 active를 시작하지 않는다.

- 10초 CPU 평균이 80% 초과면 대기
- available RAM이 3 GiB 미만이면 대기
- child tree RSS가 6 GiB를 넘으면 kill
- 온보딩 worker 호스트 semaphore 1
- Chromium과 Codex 비중첩
- Codex/Chromium lower priority

active 시작 뒤 pressure wait는 20분에 포함된다. deadline까지 회복하지 않으면 `analysis_deadline_exceeded`로 실패한다.

## 13. 시간 예산

| 구간 | soft cap |
|---|---:|
| discovery + owned crawl + documents | 4분 30초 |
| owned facts 전체 | 4분 30초 |
| offerings | 1분 |
| brand core | 1분 |
| market candidate search | 1분 15초 |
| external fetch | 1분 15초 |
| final audit | 1분 |
| durable finalizing write | 15초 |
| scheduling/retry/pressure buffer | 5분 15초 |

합계는 정확히 20분이다. stage별 downstream reserve는 순서대로 `615, 345, 285, 225, 150, 75, 15, 0초`다. 모든 실제 timeout은 `min(stageCap, remainingRunBudget - downstreamReserve)`이며 reserve가 남지 않으면 stage를 시작하지 않는다. 20분 도달 시 process tree를 종료하고 complete를 거부한다.

최대 입력, JS fallback, PDF/XLSX를 포함한 대표 corpus benchmark가 release gate다. p95가 20분 안에 review-ready가 되지 않으면 페이지/문자 budget 또는 모델 설정을 조정하고 feature flag를 열지 않는다. hard kill 자체는 benchmark와 무관하게 항상 적용한다.

## 14. Result v2와 compatibility

```ts
interface BrandIntelligenceResultV2 {
  contractVersion: "brand-intelligence-result.v2";
  oneLineDefinition: string | null;
  companyOverview: string | null;
  businessDescription: string | null;
  primaryCategory: { code: string | null; name: string } | null;
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string | null;
  secondaryTargets: string[];
  customerNeeds: string[];
  valueProposition: string | null;
  differentiators: string[];
  coreAppeal: string | null;
  supportingAppeals: string[];
  offerings: Array<{
    kind: "product" | "service";
    name: string;
    description: string | null;
    target: string | null;
    benefit: string | null;
    priceText: string | null;
    purchaseUrl: string | null;
    sourceFactIds: string[];
  }>;
  keywords: string[];
  observedTone: { summary: string; sourceFactIds: string[] } | null;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  marketContext: Array<{ claim: string; sourceUrls: string[] }>;
  evidence: Array<{
    fieldPath: string;
    claim: string;
    sourceId: string;
    sourceUrl: string | null;
    excerpt: string;
    sourceKind: "owned" | "external" | "upload";
  }>;
  sourceGaps: string[];
}
```

서버 parser는 `v1 | v2` discriminated union을 읽는다. Provider는 두 버전을 공통 view로 normalize한다.

회사명은 result JSON에 중복 저장하지 않는다. run snapshot과 confirm의 top-level `companyName`이 유일한 user-owned source이며, Provider가 confirmed `brands.name`을 공통 view에 주입한다.

- v1 offerings는 빈 배열
- v1 string differentiators는 공통 view의 배열 1개로 변환
- 기존 v1 confirmed row를 rewrite하지 않음
- 새 run만 v2
- v2가 저장된 뒤 v1-only API로 코드 rollback 금지
- rollback은 v2 dual-reader를 유지한 채 feature flag만 끄는 방식

사용자가 Step 3에서 필드를 수정하면 그 field path의 모델 evidence는 `user_edited`로 표시하거나 제거한다. 원래 evidence를 수정된 claim의 근거처럼 계속 표시하지 않는다. 원본 result와 edited result를 모두 보존해 차이를 감사할 수 있다.

Confirm 필수값:

- companyName
- companyOverview
- businessDescription
- primaryCategory.name
- primaryTarget
- valueProposition
- differentiator 최소 1개
- coreAppeal

모델이 근거 부족으로 null을 반환하면 사용자가 채우기 전 confirm할 수 없다.

## 15. 데이터 모델

### `brands`

- `company_name_state`
- `company_name_confirmed_at`

### `brand_analysis_runs`

기존 열을 가산 확장한다.

- lifecycle `status`
- `pipeline_version`
- `contract_version`
- `current_stage`
- `state_version`
- `input_json`
- `result_json`, `edited_result_json`
- `active_started_at`, `deadline_at`, `queue_expires_at`
- `upload_expires_at`, `retention_expires_at`
- `cancel_requested_at`, `purged_at`, `tombstone_expires_at`
- `superseded_by_run_id`
- create/start/retry/worker-complete/confirm idempotency key와 request hash
- `logical_call_count`, `retry_call_count`, `physical_cli_count`
- selected/success/required/external/offerings counters
- worker lease/fencing fields
- public error code, internal error fingerprint

Partial unique index로 한 brand에 open run 하나만 허용한다.

```text
accepting_uploads, queued, waiting_for_resource, running, finalizing, review_ready,
cancel_requested, purging
```

기존 중복 open row가 있으면 migration preflight가 가장 최신 한 건을 남기고 나머지를 `failed/migration_superseded`로 terminalize한 뒤 index를 만든다.

### `brand_analysis_stage_runs`

- analysis ID
- stage code
- stable stage instance key
- facts batch index `0..3`
- status
- started/finished/duration
- input/output/count metrics
- error code/fingerprint

Content, URL, filename, prompt, model output은 저장하지 않는다.

### `brand_analysis_cli_calls` / `brand_analysis_cli_attempts`

- logical call key와 logical index `1..8`
- stage run 연결
- physical attempt `1..3`
- status/duration/error fingerprint

logical call insert는 `(analysis_id, logical_call_key)`로 idempotent하다. 새 logical row를 만든 transaction만 run logical counter를 증가시킨다. physical attempt insert만 physical counter를 증가시키며 attempt 2 이상이면 global retry counter도 증가시킨다. 따라서 응답 유실 replay, facts batch 4개, 전체 `logical 8 / retry 2 / physical 10`을 DB가 원자적으로 집행한다.

### `brand_analysis_uploads`

- upload intent 상태
- opaque storage path
- checksum/size/MIME
- upload expiry/completion time
- upload attempt count `0..3`
- `cleanup_after`
- `cleanup_status`
- `deleted_at`

cancel tombstone 생성 전 Blob deletion을 확인하거나, provider 장애 시 `purging`을 유지하고 retry한다. cancel API는 idempotent하다.

### `brand_analysis_upload_attempts`

- upload/run ID
- attempt UUID와 attempt number `1..3`
- attempt UUID를 포함한 unique private storage path
- `uploading | succeeded | failed | delete_pending | deleted`
- 2분 lease, completion/deletion time, public error code

run당 `uploading` attempt는 partial unique index로 하나만 허용한다.

## 16. API 계약

### Customer

- `GET /brands/:brandId/brand-intelligence/onboarding-context`
- `POST /brands/:brandId/brand-intelligence/analyses`
- `PUT /brands/:brandId/brand-intelligence/analyses/:analysisId/uploads/:uploadId/content`
- `POST /brands/:brandId/brand-intelligence/analyses/:analysisId/start`
- `GET /brands/:brandId/brand-intelligence/analyses/:analysisId`
- `PATCH /brands/:brandId/brand-intelligence/analyses/:analysisId`
- `POST /brands/:brandId/brand-intelligence/analyses/:analysisId/cancel`
- `POST /brands/:brandId/brand-intelligence/analyses/:analysisId/retry`
- `POST /brands/:brandId/brand-intelligence/analyses/:analysisId/confirm`
- `GET /brands/:brandId/brand-intelligence`

Create는 `companyName`, owned URL, 파일 metadata/checksum 목록, idempotency key, request hash를 검증하고 `accepting_uploads` run과 intent들을 반환한다. 같은 key+같은 payload는 intent 상태를 포함한 기존 응답을 replay하고, 같은 key+다른 payload는 409다.

같은 brand에 아직 24시간 보존 중인 content-bearing failed run이 있으면 다른 create key는 `failed_input_retained` 409를 받는다. 사용자는 동일 입력 retry 또는 “입력 자료 삭제” purge 중 하나를 먼저 선택해야 한다. 이 규칙은 old failed run의 늦은 purge가 새 open run과 partial unique index에서 충돌하는 것을 막는다.

Start는 DB `now()`가 upload expiry 전인지, 모든 선언 파일 intent가 `uploaded`인지 검증하고 persisted start key/hash와 `expectedRevision`으로 한 번만 `queued` 전환한다. 응답 유실 후 같은 key/hash는 기존 queued run을 replay하고 다른 hash는 409다. upload 중 사용자가 취소하면 브라우저의 upload AbortSignal을 먼저 fire한 뒤 run cancel API를 호출한다.

Cancel은 run 상태 자체를 idempotency ledger로 사용한다. 최초 요청이 `cancel_requested`를 commit한 뒤 응답이 유실되어도 `cancel_requested|purging|cancelled`에 대한 반복 요청은 현재 sanitized public state를 반환한다. confirmed/superseded run은 취소할 수 없다.

Confirm은 edited result와 company name을 같은 요청에서 원자적으로 저장한다. confirm key/hash를 run에 저장하며 confirmed 이후 동일 key/hash는 기존 성공 응답을 replay하고 다른 hash는 409다.

Retry는 failed run 자체의 deadline/counter를 되감지 않는다. `POST .../:analysisId/retry`는 먼저 persisted retry key/hash를 조회해 이미 생성한 run을 replay한 다음에만 open-run/retention 검사를 한다. 최초 요청은 failed run을 잠그고 24시간 보존 기간과 open-run 부재를 확인한 뒤, 같은 immutable company/URL 입력을 가진 새 queued run을 만든다. 아직 보존 중인 private upload row는 새 run으로 원자적으로 재귀속하고, 이전 run의 content를 지운 뒤 `superseded_by_run_id`만 남긴다. FK는 `ON DELETE SET NULL`이며 이전 content-free row는 별도 tombstone expiry로 삭제된다. 새 run은 새 resource queue와 새 20분 active deadline/call counters를 가진다. 입력을 바꾸려면 retry가 아니라 기존 run을 purge하고 Step 1에서 새 create를 사용한다.

### Worker

- claim with `supportedPipelineVersions`
- progress/stage begin/stage complete
- heartbeat returning cancel/deadline/state version
- complete
- fail
- purged/cancelled acknowledgement

Worker write는 lease token, state version, stage instance ID, CLI attempt ID를 모두 검사한다. heartbeat 또는 resource lease가 definitive하게 실패하면 local task를 중단한다.

Worker complete는 completion key와 validated result hash를 저장하면서 `running → finalizing`을 한 transaction으로 commit한다. 응답 유실 후 동일 key/hash는 durable finalizing 결과를 replay하며 Blob cleanup을 다시 앞서 실행하지 않는다.

## 17. 취소와 purge

### 사용자 동작

Step 2의 `분석 취소`는 확인 문구를 보여준다.

> 진행 중인 분석과 이번에 입력한 회사명, URL, 첨부 파일, 분석 결과를 삭제합니다.

확인 후:

1. cancel endpoint가 run을 row-lock한다.
2. `cancel_requested`와 새 `state_version`을 commit한다.
3. worker heartbeat가 최대 5초 안에 cancel을 받는다.
4. HTTP/Chromium/CLI AbortSignal을 fire하고 process tree를 kill한다.
5. global/local resource를 release한다.
6. temp directory와 intermediate를 지운다.
7. private Blob과 upload metadata를 지운다.
8. input/evidence/result/company fields를 redact한다.
9. content-free cancelled tombstone만 24시간 유지한다.
10. UI가 Step 1 context를 새로 읽는다.

신규 온보딩이면 완전 빈 Step 1이다. 재분석이면 기존 confirmed company/owned URL만 다시 보이고 취소한 draft/upload는 보이지 않는다.

Blob provider가 일시 실패하면 status는 `purging`이며 cleanup worker가 backoff retry한다. UI는 회사명·URL·파일 내용을 다시 표시하지 않고 “취소 정리 중”을 표시한다. storage deletion이 확인된 뒤 `cancelled` tombstone이 된다.

Worker process가 죽어도 cleanup은 같은 온보딩 worker의 별도 purge loop가 처리한다. 시작 시 stale temp directory와 만료된 `accepting_uploads` run/intent를 sweep한다.

## 18. 실패 처리

| 실패 | 처리 | 사용자 복구 |
|---|---|---|
| `upload_session_expired` | start 전 run 실패 후 purge | 파일 다시 선택 |
| `upload_content_mismatch` | private object 삭제, intent 실패 | 해당 파일 다시 업로드 |
| `upload_storage_unavailable` | intent 유지, object 없음 확인 | 업로드 재시도 |
| `no_important_pages` | URL 모드 실패 | URL 수정 또는 파일 전용 |
| `insufficient_owned_pages` | 성공 기준 미달 | 입력 확인 후 retry |
| `crawl_site_blocked` | robots/auth/captcha/403 | 파일 업로드 안내 |
| `document_invalid` | 해당 run 실패 | 파일 교체 |
| `resource_queue_timeout` | active 전 실패 | 나중에 retry |
| `resource_lease_lost` | process kill, 실패 | retry |
| `cli_stage_failed` | 남은 budget 안에서 stage retry 1회 가능 | retry |
| `cli_contract_invalid` | schema retry, global retry cap 적용 | retry |
| `cli_tool_policy_violation` | 즉시 kill, 운영 alert | 지원 문의 |
| `analysis_deadline_exceeded` | process kill | 입력 축소 후 retry |
| `worker_lost` | watchdog terminalize | retry |
| `company_name_conflict` | confirm rollback | 회사명 수정 |
| `cleanup_pending` | purge loop retry | 기다리기/상태 다시 확인 |

Internal stack/model output을 사용자에게 노출하지 않는다. UI는 public error code별 한국어 설명과 가능한 다음 행동을 표시한다.

## 19. 관측성

Step 2:

- company name
- queue wait와 active elapsed를 분리
- current stage
- candidate count / content attempts / success / required
- logical CLI stage `n / max`
- 외부 evidence `n / 10`
- active max 20분
- cancel 상태

운영 metrics:

- queue wait p50/p95
- active elapsed p50/p95/max
- page attempt/success/required
- stage duration/retry/failure
- CLI logical/physical count
- RSS/CPU admission wait
- resource lease wait/loss
- cancel-to-process-death
- cancel-to-storage-purge
- orphan temp/upload cleanup

로그에는 raw URL query, filename, page content, document content, prompt, CLI output, secret을 남기지 않는다.

## 20. 테스트와 release gates

### Unit

- URL normalize/canonical/final redirect/dedupe
- multilingual exclusion/ranking/quota
- actual fetch attempts 20/21 boundary
- products/services page quota와 result 5/6 boundary
- success formula 1/8/15/20, failure가 분모에서 빠지지 않음
- neutral duplicate 처리
- file-only threshold skip, URL+file threshold mandatory
- SSRF/RFC non-global/DNS rebinding/redirect/canonical escape
- document checksum, magic bytes, decompression, aggregate budget
- v1/v2 parser와 common view
- source quote/provenance/external registry integrity
- call/retry/deadline counters

### API/DB integration

- one open run partial unique index
- same idempotency key same/different payload
- cancel vs stage complete, cancel vs complete, cancel replay
- confirm vs cancel, concurrent confirm, stale revision
- company name conflict full rollback
- expired lease/max-attempt/watchdog terminalization
- resource lease loss abort
- upload put-confirm loss와 orphan cleanup
- cancel purge가 company/URL/file/result를 redact
- reanalysis cancel이 existing confirmed version을 보존

### Worker

- shell/browser/apps tool unavailable canary
- offline stage에서 web event가 나오면 kill
- search stage에서 허용되지 않은 tool event가 나오면 kill
- process tree deadline/cancel kill ≤5초
- Chromium과 CLI 비중첩
- logical ≤8, retry ≤2, physical ≤10
- external fetched/retained distinct URL ≤10
- temp cleanup on normal/error/startup sweep

### UI/E2E

- 신규 Kakao 가입 후 빈 company name
- Kakao display name이 company field에 들어가지 않음
- Step 1~3 동일 company display와 Step 3 edit
- refresh/multiple tabs에서 active run 복원
- double submit은 run 한 개
- polling temporary failure 회복
- fail/retry flow
- Step 2 cancel, process stopped, 신규 blank Step 1
- reanalysis cancel, previous confirmed data 복원
- confirm 후 Topbar/Sidebar/Settings/API/AI context 같은 이름·version
- v1 confirmed brand 화면 회귀 없음

### Eval

대표 corpus에서 다음을 평가한다.

- owned facts가 source quote로 검증됨
- 외부 정보가 company-owned fact에 섞이지 않음
- unsupported 숫자/효능/성과 생성 없음
- 대표 offering 중복 없음, 최대 5
- source gap이 실제 누락을 설명
- prompt injection fixture가 tool use·secret exposure·contract bypass에 실패

### Performance

기준 PC: 4 physical / 8 logical CPU, 16 GiB RAM.

- onboarding 1 + DM 1 동시 부하에서 API status/cancel p95 < 500 ms
- non-DM Codex active process는 항상 1개 이하
- total Codex active process는 항상 2개 이하
- 최대 corpus active run은 20분 hard stop
- representative corpus p95 review-ready < 20분
- RSS kill과 admission threshold 검증

Feature flag는 migration, dual reader, security canary, integration, eval, performance gate를 모두 통과한 뒤에만 연다.

## 21. Rollout과 rollback

1. v1의 `extracting|analyzing` 상태와 row를 그대로 유지하는 additive DB migration과 existing open-run preflight
2. v1/v2 dual-read/write API, mixed queue version-filter claim, old UI 호환
3. fail-closed shared resource lease 배포
4. v2 worker 배포, canary만 실행
5. v2 UI/API create feature flag를 내부 brand에만 활성
6. max-input performance/eval/security canary
7. 점진적 활성

서버 권위 kill switch `BRAND_INTELLIGENCE_V2_ENABLED=false`와 internal brand allowlist를 둔다. 새 UI는 onboarding context가 v2 capability를 반환할 때만 versioned v2 create header를 보낸다. header가 없는 기존 UI의 v1 create/upload/body 없는 confirm은 유지하고, 기존 `review_ready` v1 run도 계속 confirm할 수 있다.

Run에 `pipeline_version=2`를 기록하고 worker claim은 supported version을 보낸다. version을 보내지 않는 old worker는 v1만 지원하는 것으로 간주해 v2 run을 claim할 수 없다. v2 worker는 v1을 claim하지 않는다. v1 queue가 drain되기 전에는 legacy DB status를 제거하거나 rewrite하지 않는다.

Rollback은 신규 v2 create flag를 끈다. v2 dual-reader와 additive schema는 유지한다. 기존 v1 confirmed row와 v2 confirmed row는 모두 계속 읽는다.

## 22. 구현 병렬화

계약과 migration 설계를 먼저 고정한 뒤 세 lane으로 나눈다.

```text
Phase 0: shared contracts + additive migration
                 |
        +--------+---------+
        |                  |
Lane A: API/control     Lane B: worker/runtime
state/company/cancel    crawl/CLI/resource/security
        |                  |
        +--------+---------+
                 |
Lane C: UI + integration + eval + rollout
```

- Lane A와 B는 shared contract가 merge된 뒤 병렬 가능
- shared worker-runtime resource helper는 Lane B가 소유
- UI는 customer types/API contract가 안정된 뒤 시작
- 최종 integration, migration, E2E, benchmark는 한 worktree에서 순차 실행

## 23. 최종 검토 결론

초기 안의 차단 문제였던 취소/완전 폐기, open-run 중복, stale completion, 고아 Blob, 회사명 누락, v1/v2 롤백, global lease 우회, heartbeat fail-open, prompt injection, 외부 URL cap, 전체 deadline/call budget을 모두 이 설계에 포함했다.

미해결 제품 결정은 없다. 구현 완료를 주장하려면 테스트와 release gate를 통과해야 하지만, 구현을 시작하기 위한 설계는 확정한다.
