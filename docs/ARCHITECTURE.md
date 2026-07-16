# Brand Pilot Runtime Architecture

작성일: 2026-07-16  
상태: Living document  
적용 범위: 중앙 API, 고객 UI, PostgreSQL, 작업 큐, 콘텐츠 생성, DM 자동답변, Wiki, 크롤링, 게시 및 성과 수집

## 1. 문서 역할

이 문서는 Brand Pilot 런타임 구조의 단일 기준 문서다.

- 현재 구현과 목표 운영 구조를 구분한다.
- 서버에서 상시 실행하거나 자원을 사용하는 프로세스를 관리한다.
- 워커의 책임, 큐, 우선순위, 동시성, 확장 기준을 관리한다.
- 신규 채널, 신규 워커, 배포 구조, 저장소 또는 작업 흐름이 변경되면 같은 변경 작업에서 이 문서를 함께 수정한다.
- 개별 기능 명세와 구현 계획이 이 문서와 충돌하면 실제 코드와 운영 결정을 확인한 후 이 문서를 먼저 갱신한다.

## 2. 용어

### 콘텐츠 생성 워커

`workers/brand-pilot-image-worker`는 코드 디렉터리의 기존 이름이다. 실제 책임은 이미지 생성에 한정되지 않는다. 이 문서에서는 **콘텐츠 생성 워커**라고 부른다.

현재 처리 범위:

- Instagram 카드뉴스 콘텐츠 생성
- Instagram Story 콘텐츠 생성
- Instagram Reel 콘텐츠 생성과 영상 렌더링
- Threads 텍스트 콘텐츠 생성
- X, LinkedIn, YouTube, TikTok 채널 출력 계약
- 대표 URL 직접 조회
- 생성 결과 검증
- Vercel Blob 등 Object Storage 업로드
- 중앙 API에 manifest와 작업 결과 보고

현재 지원 런타임 채널은 Instagram, Threads, X, LinkedIn, YouTube, TikTok이다. 채널별 게시 권한과 실제 외부 API 발행은 중앙 API 또는 게시 워커가 담당한다. Webflow는 지원하지 않으며 마이그레이션 `035_remove_webflow_and_split_content_status.sql`에서 런타임 데이터와 DB 제약 값까지 물리적으로 제거됐다.

### 중앙 API

인증, 워크스페이스와 브랜드 소유권, 채널 자격 증명, Webhook, 작업 큐, 결과 검증 및 발행 권한을 소유하는 유일한 제어면이다.

### 워커

DB 또는 중앙 API 큐에서 lease를 획득해 오래 걸리는 작업을 수행하는 실행 프로세스다. 동일 종류의 워커를 여러 개 실행할 수 있으며 `worker_id`는 서로 달라야 한다.

## 3. 현재 구조(As-Is)

```text
React/Vite Customer UI
        |
        v
Fastify Central API + Local Scheduler
        |
        +----------------------+
        |                      |
        v                      v
Supabase PostgreSQL      External Channel APIs
        |
        +----------------------------+
        |                            |
        v                            v
DM Worker Process              Content Generation Worker
  - DM replies                   - text content
  - profile refresh              - card news
  - Wiki source curation         - story
  - Wiki compilation             - reel and FFmpeg
  - embeddings                   - artifact upload
  - Wiki maintenance
```

현재 코드 패키지:

| 코드 위치 | 현재 역할 | 현재 한계 |
|---|---|---|
| `apps/api` | 중앙 API와 로컬 스케줄러 | 예약 작업이 API 프로세스와 자원을 공유함 |
| `apps/customer-ui` | 고객용 React UI | 운영에서는 정적 빌드로 배포해야 함 |
| `workers/brand-pilot-dm-worker` | 동일 코드에서 `dm` 또는 `wiki` 전용 모드로 실행 | Wiki 빌드와 DM 답변이 별도 프로세스로 분리됨 |
| `workers/brand-pilot-image-worker` | 콘텐츠 생성, 이미지·영상 렌더링, 텍스트 작업, 업로드 | 디렉터리 이름이 실제 책임보다 좁고 이미지 작업이 지속되면 텍스트 작업이 지연될 수 있음 |

현재 로컬 스케줄러는 중앙 API 내부에서 1분마다 tick을 실행한다.

| 작업 | 현재 실행 조건 | 실행 정책 |
|---|---|---|
| 게시 예정 큐 처리 | 매 tick | 게시 시간이 도래한 작업을 처리한다. |
| 자사 URL 크롤링 진입 | 매시 `00`, `15`, `30`, `45`분 | 실제 대상은 마지막 크롤링 시각과 활성 상태를 기준으로 저장소 계층에서 선택한다. |
| 콘텐츠 생성 진입 | 매일 10:00 KST | 브랜드별 하루 생성 정책과 중복 실행 방지는 저장소 계층에서 적용한다. |
| 발행 콘텐츠 성과 수집 | 매일 03:00 KST 이후 첫 정상 tick | 최근 30일 발행물을 대상으로 브랜드·채널별 하루 한 번 실행한다. 03:00에 서버가 꺼져 있었다면 같은 날 재시작 후 보충 실행한다. |

이 스케줄러는 Vercel 함수에서는 실행하지 않는다. 비 Vercel 중앙 API에서 `LOCAL_SCHEDULER_ENABLED=true`일 때만 시작한다. Instagram 트렌드 검색과 지표 갱신은 예약 작업이 아니라 사용자가 해시태그를 검색할 때 실행하는 요청 기반 기능이다.

## 4. 목표 구조(To-Be)

초기 운영에서는 프로세스를 과도하게 분리하지 않되, 실시간 DM과 무거운 배치 작업은 반드시 분리한다.

```text
                         +--------------------+
                         | Customer Web App   |
                         +----------+---------+
                                    |
                                    v
                         +--------------------+
                         | Central API        |
                         | Auth / Webhook     |
                         | Queue / Validation |
                         +----+----------+----+
                              |          |
                   +----------+          +-------------------+
                   v                                         v
        +----------------------+                    +------------------+
        | PostgreSQL           |                    | Object Storage   |
        | tenant data / queues |                    | media / manifest |
        +----+--------+--------+                    +------------------+
             |        |
      high   |        | low
    priority |        | priority
             v        v
     +-----------+  +-----------+       +---------------------+
     | DM Worker |  | Wiki      |       | Content Generation  |
     | Pool x2   |  | Worker x1 |       | Worker x1           |
     +-----------+  +-----------+       +---------------------+
             ^              ^                    |
             |              |                    v
             +--------------+-----------+  +------------------+
                                        |  | Scheduler / IO   |
                                        |  | Worker x1        |
                                        |  +------------------+
                                        v
                             Instagram / Threads / X /
                             LinkedIn / YouTube / TikTok
```

## 5. 초기 운영 프로세스 목록

| 프로세스 | 초기 수량 | 실행 방식 | 자원 특성 | 주요 책임 |
|---|---:|---|---|---|
| 중앙 API | 1 | 상시 | 낮음~중간 | 인증, Webhook, API, 큐 등록, 권한, 결과 검증 |
| 스케줄러·일반 작업 워커 | 1 | 상시 | 낮음~중간 | 예약 게시, 크롤링 진입, 성과 수집, 배치 작업 등록 |
| DM 전용 워커 | 2 | 상시 | 작업 시 높음 | Wiki 검색, Codex 답변 생성, 중앙 API 완료 보고 |
| Wiki 전용 워커 | 1 | 상시 저우선순위 또는 야간 | 작업 시 높음 | 정제, 컴파일, 임베딩, 유지보수, 후보 Wiki 검증 |
| 콘텐츠 생성 워커 | 1 | 상시 폴링 | 가장 높음 | 채널별 텍스트·이미지·영상 콘텐츠 생성과 업로드 |
| PostgreSQL | 1 | 상시 | 중간 | 고객 데이터, 큐, lease, Wiki, 상태, 로그 |
| 정적 프론트 | 1 배포 | 요청 시 낮음 | 낮음 | 빌드된 React 자산 제공; Vite 개발 서버는 운영에서 사용하지 않음 |

초기 운영 서버의 핵심 실행 수는 API 1개, 일반 작업 1개, DM 2개, Wiki 1개, 콘텐츠 생성 1개다. PostgreSQL과 정적 프론트는 별도 서비스로 계산한다.

## 6. 워커 책임

### 6.1 DM 전용 워커

- 동일한 워커 프로그램을 서로 다른 `WORKER_ID`로 두 개 실행한다.
- 모든 고객의 공용 DM 큐를 사용한다.
- 한 작업은 하나의 워커만 lease할 수 있어야 한다.
- 고객별 동시 처리 기본값은 1이다.
- 제한 요청과 고정 fallback은 가능하면 Codex를 호출하지 않는다.
- Meta credential 복호화와 실제 DM 발송은 중앙 API가 담당한다.
- 동일 브랜드의 DM 답변 작업은 DB claim 단계에서 동시에 한 건만 실행한다.

초기 실행 명령:

```text
npm run dev:dm-worker:1
npm run dev:dm-worker:2
```

증설 기준:

- 큐 대기 시간이 5초 이상 지속됨
- 모든 DM 워커가 계속 작업 중임
- API 수신 시점부터 worker claim까지 지연이 누적됨

증설 순서: `2 -> 4 -> 8`. 서버 CPU나 메모리가 포화된 경우 같은 서버에서 프로세스만 늘리지 않고 다른 서버에 동일 워커를 추가한다.

### 6.2 Wiki 전용 워커

- 고객마다 별도 Wiki 버전을 생성한다.
- 고객별로 동시에 하나의 Wiki 빌드만 실행한다.
- 전체 Wiki 동시 실행 기본값은 1이다.
- 기존 활성 Wiki는 후보 Wiki 생성 중에도 계속 사용한다.
- 후보 Wiki는 검증과 회귀 질문 평가를 통과한 뒤에만 활성화한다.
- 실패 질문은 사실 원본으로 사용하지 않고 검색 개선 신호로만 사용한다.
- 원본에 없는 사실은 자동 추가하지 않고 `wiki_issues`에 기록한다.

실행 명령은 `npm run dev:wiki-worker`이며 DM lane을 함께 실행하지 않는다.

자동 유지보수 조건과 결과는 고객별로 격리한다. 과거 전체 질문이 아니라 마지막 유지보수 이후의 정규화된 고유 실패 질문을 사용해야 한다.

### 6.3 콘텐츠 생성 워커

- 주제, 대표 URL, 브랜드 설정과 채널 형식을 받아 최종 콘텐츠를 생성한다.
- 카드뉴스, Story, Reel은 이미지 생성 모델 또는 승인된 생성 명령을 사용한다.
- Reel은 생성 자산을 FFmpeg로 영상화할 수 있다.
- 텍스트 채널은 채널별 프롬프트와 결과 계약으로 생성한다.
- 최종 자산과 manifest를 Object Storage에 업로드한다.
- DB와 Meta credential에 직접 접근하지 않는다.
- 콘텐츠 생성 동시성 기본값은 1이다.

현재는 텍스트와 미디어 작업을 한 워커가 순차 처리한다. 텍스트 작업 지연이 누적될 때만 아래처럼 분리한다.

```text
Content Generation Worker
  -> Text Content Worker
  -> Image Generation Worker
  -> Video Render Worker
```

### 6.4 스케줄러·일반 작업 워커

초기에는 다음 I/O 중심 작업을 하나로 묶는다.

- 게시 슬롯과 이월 큐 계산
- 외부 채널 게시 호출
- URL 크롤링 작업 등록 또는 실행
- 콘텐츠 생성 배치 등록
- 매일 발행 콘텐츠 성과 지표 갱신
- 실패 작업 재시도 가능 시간 관리

게시 또는 크롤링이 API 응답을 장시간 점유하지 않도록 중앙 API와 별도 프로세스로 운영하는 것이 목표다. 부하가 커지면 크롤링, 게시, 성과 수집 워커로 나눈다.

Instagram 트렌드 데이터는 스케줄러가 자동 갱신하지 않는다. 사용자의 해시태그 검색 요청이 들어왔을 때 Meta API를 호출하고 저장된 인기 미디어와 지표를 갱신한다.

### 6.5 성과 수집 스케줄러

현재 성과 수집은 별도 워커가 아니라 중앙 API의 로컬 스케줄러에 포함되어 있다.

```text
Local Scheduler (1분 tick)
  -> 03:00 KST 이후 실행 가능 여부 확인
  -> 활성 브랜드와 활성 채널 조회
  -> 최근 30일 게시 성공 콘텐츠 조회
  -> 채널별 Performance Adapter 호출
  -> 성과 스냅샷과 동기화 실행 이력 저장
```

실행 규칙:

- 스케줄러는 매 tick마다 성과 수집 진입점을 호출하지만, 저장소 계층이 03:00 KST 이전 요청을 `not_due`로 종료한다.
- `performance_sync_runs`의 브랜드·채널·실행일 단위 제약으로 같은 날 중복 수집을 막는다.
- 스케줄러의 성과 수집 대기 시간은 30초다. 시간 초과나 채널 API 실패는 해당 결과에 기록하고 크롤링, 생성, 게시 등 다른 예약 작업을 중단시키지 않는다.
- 인증 정보가 없거나 지원되지 않는 채널은 `not_configured`로 기록한다.
- 목표 운영 구조에서는 이 책임을 중앙 API에서 `스케줄러·일반 작업 워커`로 옮긴다. 초기에는 별도 성과 워커를 추가하지 않고, 수집량이나 외부 API 대기 시간이 커질 때만 분리한다.

## 7. 작업 우선순위와 동시성

```text
P0  Instagram DM 수신과 고정 정책 응답
P1  일반 DM Wiki 검색과 답변 생성
P2  예약 게시
P3  고객이 요청한 콘텐츠 생성
P4  URL 크롤링과 성과 수집
P5  Wiki 유지보수와 재생성
```

초기 전역 제한:

| 자원 | 제한 |
|---|---:|
| 전체 Codex CLI 동시 실행 | 2 |
| DM용 예약 Codex 슬롯 | 최소 1 |
| 고객별 DM 동시 처리 | 1 |
| Wiki 빌드 동시 실행 | 1 |
| 콘텐츠 생성 동시 실행 | 1 |
| 이미지 생성 동시 실행 | 1 |
| FFmpeg 동시 실행 | 1 |

DM 워커 두 개, Wiki 워커 한 개, 콘텐츠 생성 워커 한 개를 실행하더라도 무거운 CLI 작업 네 개가 동시에 실행되면 안 된다. `worker_resource_leases`가 프로세스와 PC를 가로지르는 DB 기반 semaphore 역할을 한다.

- `codex_cli` lease 전체 수는 `WORKER_CODEX_MAX_CONCURRENCY=2`로 제한한다.
- 비-DM workload인 `wiki`와 `content`는 합쳐서 최대 1개만 lease를 얻는다.
- 나머지 1개는 `WORKER_CODEX_DM_RESERVED_SLOTS=1`로 DM에 예약한다.
- 각 lease는 45초이며 실행 중 15초 간격 heartbeat로 연장한다.
- 프로세스가 비정상 종료되면 만료된 lease를 다음 acquire에서 정리한다.
- 콘텐츠 생성의 이미지·영상 처리와 Wiki 배치는 비-DM 슬롯을 공유하므로 동시에 무거운 Codex CLI를 실행하지 않는다.

## 8. 주요 데이터 흐름

### 콘텐츠 생성과 게시

```text
Source URL / Topic Row
  -> Topic queue
  -> Content generation job
  -> Content Generation Worker
  -> Artifact + manifest upload
  -> Central API validation
  -> Review / auto approval
  -> Publish queue
  -> Scheduler / IO Worker
  -> External channel API
```

`channel_outputs.status` 생명주기:

| 상태 | 의미 | 다음 전환 또는 액션 |
|---|---|---|
| `generating` | 생성 작업 대기 또는 실행 중 | `auto_approved`, `pending_review`, `auto_approval_blocked`, `generation_failed` |
| `generation_failed` | 생성 작업 최종 실패 | Instagram/Threads 재생성 또는 거절 |
| `pending_review` | 완성된 결과물의 사용자 검토 대기 | 승인, 재생성, 거절 |
| `auto_approval_blocked` | 완성된 결과물이 자동 승인 정책 또는 결과 검증을 통과하지 못함 | 수동 승인, 재생성, 거절 |
| `approved` | 사용자 승인 완료 | 게시 큐 |
| `auto_approved` | 자동 승인 완료 | 게시 큐 |
| `rejected` | 사용자 거절 완료 | 종료 |
| `regenerating` | 대체 결과물 생성 시작 | 기존 결과물 `regenerated`, 신규 결과물 `generating` |
| `regenerated` | 새 결과물로 대체된 과거 결과 | 종료, 기본 활성 목록 제외 |

생성 성공은 자동 승인 설정과 완성 결과 검증에 따라 `auto_approved` 또는 `pending_review`로 전환한다. 완성 결과가 자동 승인 정책이나 결과 검증을 통과하지 못한 경우에만 `auto_approval_blocked`를 사용한다. 워커 실행 실패, 산출물 누락, manifest 계약 실패 같은 생성 실패를 이 상태로 기록하지 않는다.

`jobs.status`는 워커 실행 상태의 원본이고 `channel_outputs.status`는 사용자에게 보이는 콘텐츠 상태의 원본이다. 재시도 가능한 실패이고 `attempt_count < max_attempts`이면 job을 다음 `run_at`까지 `queued`로 되돌리고 결과물은 `generating` 또는 `regenerating`을 유지한다. 재시도 불가 오류, 최대 시도 횟수 소진, 결과 계약·산출물 검증 실패는 job을 `failed`, 결과물을 `generation_failed`로 같은 트랜잭션에서 전환하고 `output_json.generationError`와 `block_reasons`에 실패를 기록한다. 만료된 lease는 남은 시도가 있으면 다시 claim할 수 있고, 시도를 모두 소진했으면 다음 claim 정리 단계에서 최종 실패 처리한다.

재생성은 현재 Instagram과 Threads만 지원한다. 기존 결과물을 `regenerating`으로 잠근 뒤 `regenerated`로 대체하고 같은 채널·delivery format의 신규 `generating` 결과물과 작업을 만든다. X, LinkedIn, YouTube, TikTok 재생성 요청은 상태를 변경하기 전에 거부한다.

### Instagram DM

```text
Meta Webhook
  -> Central API signature and policy validation
  -> Conversation turn aggregation
  -> DM queue
  -> DM Worker
  -> Brand-scoped Wiki retrieval
  -> Codex response generation
  -> Central API answer validation
  -> Meta DM send
  -> Delivery and quality logs
```

### Wiki 생성과 자동 보완

```text
Owned URL / FAQ / Product data
  -> Crawl and normalize
  -> Brand-scoped source units
  -> Candidate Wiki build
  -> Embedding and retrieval index
  -> Regression question evaluation
  -> Activate candidate or keep current version

DM retrieval logs
  -> Cluster knowledge gaps / low confidence
  -> Wiki maintenance proposal
  -> Candidate Wiki build request
```

## 9. 비밀정보 경계

| 구성 요소 | 보유 가능 | 보유 금지 |
|---|---|---|
| 중앙 API | DB 연결, credential 암호화 키, Meta 앱 secret, OAuth credential | 브라우저 노출 |
| DM 워커 | 중앙 API worker token, 제한된 Wiki DB 연결, embedding 키 | Meta access token, 앱 secret |
| Wiki 워커 | 제한된 Wiki DB 연결, embedding 키, worker token | Meta credential |
| 콘텐츠 생성 워커 | worker token, Blob 쓰기 토큰, 생성 모델 설정 | DB 연결, Meta credential, 서비스 role key |
| 고객 UI | 공개 API URL과 사용자 세션 | worker token, DB URL, service role key, 채널 access token |

## 10. 데이터베이스 마이그레이션

`schema_migrations`에 적용된 마이그레이션 파일은 불변이다. 적용 후에는 기존 SQL 파일을 수정·이름 변경·삭제하지 않고, 모든 스키마 또는 데이터 보정은 다음 번호의 새 마이그레이션으로 추가한다. 마이그레이션 러너는 적용 이력의 checksum과 디스크 파일이 다르면 `migration_checksum_mismatch`로 중단한다. 명시적으로 허용된 과거 checksum 호환 항목 외에는 이 규칙에 예외를 두지 않는다.

2026-07-16 기준 최신 마이그레이션:

- `035_remove_webflow_and_split_content_status.sql`: Webflow 런타임 데이터를 물리 삭제하고 지원 채널·delivery format 제약과 `channel_outputs` 생성/검토 상태를 분리한다.
- `036_harden_performance_and_wiki_activation.sql`: 성과 수집의 tenant 소유권 외래 키를 강화하고 compiled Wiki 활성화 검증을 보강한다.

## 11. 확장 단계

### 단계 1: 파일럿

- DM 2개
- Wiki 1개
- 콘텐츠 생성 1개
- 일반 작업 1개
- 전역 CLI 동시성 2

### 단계 2: 고객 증가

- DM 큐 대기 시간에 따라 DM 워커 수평 확장
- 텍스트 콘텐츠와 미디어 콘텐츠 큐 분리
- 크롤링과 게시 워커 분리
- 워커별 큐 대기 시간, 처리 시간, 실패율 대시보드 추가

### 단계 3: 다채널·고부하

- 채널 어댑터별 게시 worker pool
- 영상 렌더링 전용 노드
- 자동 worker autoscaling
- DB connection pool과 작업 큐 파티셔닝 검토

## 12. 현재 구현과 목표 구조의 차이

아래 항목은 목표 구조에 포함되지만 아직 구현이 완료되지 않았다.

- 중앙 API에서 로컬 스케줄러 분리
- DM용 전역 Codex 슬롯 예약
- 후보 Wiki 회귀 평가 후 자동 활성화
- 성공했지만 부자연스럽거나 잘못된 답변의 비동기 품질 평가
- 동일 destination URL 중복 제거
- 유지보수 질문의 기간 제한과 의미 기반 중복 제거
- 변경된 Wiki stable key 중심 부분 재생성
- 콘텐츠 생성 워커의 공식 패키지·문서 명칭 변경

디렉터리 이름 변경은 import, 배포 경로와 운영 스크립트에 영향을 주므로 별도 마이그레이션으로 진행한다. 그 전까지 코드 경로는 `brand-pilot-image-worker`, 제품 용어는 콘텐츠 생성 워커를 사용한다.

## 13. 문서 변경 규칙

다음 변경이 발생하면 구현 PR 또는 같은 작업에서 이 문서를 반드시 수정한다.

- 워커 종류 추가·삭제·통합·분리
- 워커 기본 인스턴스 수 또는 동시성 변경
- 큐 우선순위와 재시도 정책 변경
- 중앙 API, DB, 워커의 비밀정보 경계 변경
- 지원 채널 추가·삭제 또는 채널별 생성·검토·게시 경로 변경
- Object Storage, PostgreSQL 또는 배포 위치 변경
- DM, Wiki, 콘텐츠 생성의 데이터 흐름 변경
- 스케줄러 주기와 실행 책임 변경

변경 시 확인 항목:

1. 현재 구조와 목표 구조가 모두 최신인가.
2. 실제 코드 경로와 문서의 프로세스 이름이 대응하는가.
3. 실행 수량과 동시성 제한이 명시됐는가.
4. 새 작업의 우선순위와 실패 복구 방식이 명시됐는가.
5. 비밀정보가 새 프로세스로 불필요하게 확산되지 않는가.
6. README와 운영·배포 문서의 링크가 유효한가.

채널 또는 워커 기능을 변경하는 작업은 완료 조건에 `docs/ARCHITECTURE.md` 갱신을 포함해야 한다.

## 14. 관련 문서

- [관리형 콘텐츠 자동화 MVP](specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md)
- [DB 스키마 설계](specs/BRAND_PILOT_DATABASE_SCHEMA_DESIGN.md)
- [서버 이전 및 출시 체크리스트](SERVER_MIGRATION_AND_LAUNCH_CHECKLIST.md)
- [공개 출시 전 필수 항목](PRE_LAUNCH_REQUIRED.md)
- [Instagram DM 운영 런북](operations/instagram-dm-operations-runbook.md)
- [콘텐츠 생성 워커 설정](IMAGE_WORKER_SETUP.md)
