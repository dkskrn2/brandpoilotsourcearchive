# Brand Pilot 통합 관리자 설계

작성일: 2026-07-19
상태: 확정
대상: `dkskrn2/main`의 기존 `/admin`에 통합할 Brand Pilot 운영 화면

## 1. 목적

기존 Growthline 관리자에서 Brand Pilot 고객, 채널, 콘텐츠 게시, Instagram DM, Wiki, 사용량, 워커 상태를 한곳에서 확인하고 필요한 운영 조치를 수행한다.

관리자 웹이 Brand Pilot 데이터베이스에 직접 접속하지 않는다. 기존 Next.js 관리자 서버가 Brand Pilot Admin API를 호출하고, Brand Pilot API만 데이터베이스와 워커 큐에 접근한다.

## 2. 확정 결정

| 항목 | 결정 |
|---|---|
| 관리자 위치 | 기존 `dkskrn2/main`의 `/admin` 아래에 통합 |
| 인증 | 기존 8시간 관리자 세션 재사용 |
| 기본 경로 | `/admin/brand-pilot` |
| DB 연결 | 브라우저와 `main` 서버의 Brand Pilot DB 직접 연결 금지 |
| 서버 통신 | `main` Next.js 서버 -> Brand Pilot Admin API |
| DB 분리 | 사이트 DB와 Brand Pilot DB는 분리 유지 |
| 민감정보 | 토큰, 앱 시크릿, 암호화 payload 원문을 응답하지 않음 |
| 변경 이력 | 모든 관리자 변경 작업을 `audit_events`에 기록 |
| 관리자 역할 | 초기에는 기존 단일 관리자 권한 사용 |
| 다중 역할 | `super_admin`, `operator`, `support`, `viewer`는 후속 범위 |
| 외부 연동 | OAuth 앱 등록, Toss Payments 실결제는 이번 범위에서 제외 |

## 3. 시스템 경계

```text
관리자 브라우저
  -> dkskrn2/main Next.js /admin 세션 검증
  -> Next.js Server Component / Server Action / Route Handler
  -> Brand Pilot Admin API (service token)
  -> Brand Pilot PostgreSQL / 작업 큐 / 워커 상태
```

### 3.1 `dkskrn2/main` 책임

- 기존 관리자 로그인과 세션 검증
- 관리자 페이지 렌더링
- 브라우저 입력 검증
- 로그인한 관리자 식별자를 Admin API에 전달
- Admin API 오류를 사용자 친화적인 상태로 변환
- Brand Pilot 서비스 토큰을 서버 환경변수에서만 사용

### 3.2 Brand Pilot 책임

- 관리자 서비스 토큰 검증
- 조회 범위와 변경 가능 상태 검증
- 데이터 조회와 변경 트랜잭션
- 작업 재시도와 큐 상태 변경
- 민감정보 제거
- 관리자 변경 감사 로그 기록

## 4. 정보 구조

| 메뉴 | 경로 | 목적 |
|---|---|---|
| 운영 현황 | `/admin/brand-pilot` | 핵심 수치, 오류, 큐와 워커 상태 확인 |
| 고객·브랜드 | `/admin/brand-pilot/brands` | 고객, 워크스페이스, 브랜드 상태 관리 |
| 채널 연결 | `/admin/brand-pilot/channels` | 채널 인증 상태와 권한 오류 확인 |
| 콘텐츠·게시 | `/admin/brand-pilot/publishing` | 생성 결과, 검토 상태, 게시 큐와 실패 관리 |
| DM 자동답변 | `/admin/brand-pilot/dm` | 대화, 제한 요청, 실패, 수동 응답 관리 |
| 자사 정보·Wiki | `/admin/brand-pilot/knowledge` | 크롤링, FAQ·제품 데이터, Wiki 빌드 관리 |
| 결제·사용량 | `/admin/brand-pilot/billing` | 구독 상태와 사용량 확인, 관리자 이용권 부여 |
| 시스템 | `/admin/brand-pilot/system` | API, DB, 워커, 스케줄러, 큐 상태 확인 |
| 감사 로그 | `/admin/brand-pilot/audit` | 관리자·시스템·워커 변경 이력 추적 |

## 5. 공통 화면 규칙

### 5.1 목록

- 서버 커서 기반 페이지네이션을 사용한다.
- 기본 페이지 크기는 30개, 최대 100개다.
- 검색은 브랜드명, 계정 이메일, 외부 계정 표시명처럼 화면에 표시 가능한 값만 대상으로 한다.
- 필터와 페이지 커서는 URL query string에 유지한다.
- 테이블의 첫 열에는 주요 식별값, 마지막 열에는 작업 메뉴를 둔다.

### 5.2 상세 화면

- 상단에 브랜드명, 상태, 워크스페이스, 생성일을 표시한다.
- 위험 작업은 별도 영역에 두고 사유 입력을 필수로 한다.
- 원본 JSON 전체를 기본 화면에 노출하지 않는다.
- 오류 코드는 복사 가능하게 표시하되 credential과 요청 헤더는 제거한다.

### 5.3 상태

- 초기 로딩은 스켈레톤을 표시한다.
- 데이터 없음은 오류로 표현하지 않고 다음 운영 행동을 안내한다.
- API 일시 장애는 관리자 세션 만료로 처리하지 않는다.
- 작업 요청이 접수되면 즉시 성공으로 표시하지 않고 `접수됨` 상태와 작업 ID를 보여준다.

## 6. 화면별 상세 기능

### 6.1 운영 현황

표시 항목:

- 활성 브랜드 수
- 연결된 채널 수와 확인 필요 채널 수
- 최근 24시간 생성 성공·실패 수
- 현재 검토 필요 수
- 예약·게시 중·실패 큐 수
- DM 자동답변 활성 브랜드 수
- 최근 24시간 DM 수신·응답·fallback·실패 수
- Wiki 최신 빌드 성공·실패 수
- 실행 중 워커와 마지막 heartbeat
- 최근 시스템 오류 최대 10개

관리 액션:

- 실패 게시 목록 이동
- 확인 필요 채널 목록 이동
- 응답 실패 DM 목록 이동
- 오프라인 워커 상세 이동

빈 상태:

- 브랜드가 없으면 고객·브랜드 등록 상태만 안내한다.
- 최근 오류가 없으면 `최근 오류 없음`을 표시한다.

### 6.2 고객·브랜드

목록 표시:

- 계정 이메일과 표시명
- 워크스페이스명
- 브랜드명과 대표·세부 분야
- 상태: `active`, `paused`, `disabled`
- 온보딩 완료 여부
- 채널 연결 수
- DM 활성 여부
- 최근 활동 시각
- 이용권 상태

브랜드 상세:

- 브랜드 프로필과 자사 URL
- 자동 승인 설정
- 채널별 상태
- 최근 생성·게시·DM·Wiki 활동
- AI 콘텐츠 생성·다운로드 당일 사용량
- 최근 문의 내역

관리 액션:

- 브랜드 이용 중지와 재개
- 관리자 이용권 기간 부여 또는 회수
- 사용 한도 조정

제약:

- 물리 삭제는 제공하지 않는다.
- 이용 중지는 기존 `paused` 상태를 사용하고 데이터와 게시 이력을 보존한다.
- `disabled`는 별도의 계정 폐기 절차에서만 사용하고 목록에서 임의 전환하지 않는다.
- 모든 변경에 사유가 필요하다.

### 6.3 채널 연결

표시 항목:

- 브랜드, 채널, 활성 여부
- 연결 상태와 인증 방식
- 외부 계정 표시명과 마스킹된 외부 ID
- 승인 scope
- 토큰 만료 예정일
- 마지막 정상 확인과 마지막 게시 성공
- 최근 오류 코드와 메시지

관리 액션:

- 연결 상태 재확인
- 채널 비활성화
- 고객 재연결 필요 상태로 변경

보안:

- access token, refresh token, app secret, `encrypted_payload`는 조회 API에 포함하지 않는다.
- 토큰 복호화 또는 복사 기능을 제공하지 않는다.

### 6.4 콘텐츠·게시

목록 표시:

- 브랜드, 주제, 채널, 전달 형식
- 생성 상태와 검토 상태
- 게시 큐 상태
- 예정 시각과 게시 시각
- 시도 횟수
- 외부 게시 URL
- 최근 오류

상세 표시:

- 생성된 이미지, 영상, HTML 또는 텍스트 미리보기
- 생성 근거 URL과 주제 입력
- 검토 이력
- 게시 시도 이력
- 외부 API 응답의 비민감 메타데이터

관리 액션:

- 실패한 게시 재시도
- 게시 전 큐 취소
- 생성 결과 다운로드

제약:

- `published` 항목을 재시도하지 않는다.
- `publishing` 항목은 lease 만료와 외부 게시 여부를 확인하기 전 임의 재시도하지 않는다.
- 고객 검토 정책을 우회하는 관리자 즉시 게시는 제공하지 않는다.

### 6.5 DM 자동답변

목록 표시:

- 브랜드와 Instagram 계정
- 상대 사용자 표시명
- 최근 메시지
- 자동응답 상태: `active`, `paused`
- 확인 상태와 유형
- 미응답 수
- 최근 처리 시간

대화 상세:

- 수신·발신 메시지 타임라인
- 답변 결정: `reply`, `fallback`, `no_reply`
- 검색된 Wiki 근거와 검색 점수
- worker 처리 시간과 실패 코드
- 제한 요청, 불만, 지식 부족 표시

관리 액션:

- 자동응답 일시 중지와 재개
- 수동 답변
- 확인 항목 완료 처리
- 실패한 응답 작업 재시도

제약:

- 제한 요청은 자동응답 재개만으로 과거 메시지를 자동 재처리하지 않는다.
- 수동 답변은 Meta 전송 결과를 확인한 뒤 발신 완료로 기록한다.

### 6.6 자사 정보·Wiki

표시 항목:

- 자사 URL과 최근 크롤링 상태
- 발견·성공·실패 페이지 수
- FAQ, 제품, 이벤트 등 지식 항목 수
- 활성 Wiki 버전
- 문서, 페이지, chunk, embedding 수
- 최근 빌드와 유지보수 실행 결과
- 검색 실패와 지식 부족 이슈

관리 액션:

- 자사 URL 재크롤링
- Wiki 재빌드 요청
- 실패한 import 또는 빌드 재시도

확장 규칙:

- FAQ·제품·이벤트는 공통 `knowledge_entries` 유형으로 확장한다.
- 새 유형 추가 시 관리자 목록 필터와 Wiki 전처리 계약을 함께 갱신한다.

### 6.7 결제·사용량

현재 표시 가능 항목:

- 결제 연동 구성 여부
- 구독 상태
- 관리자 이용권 상태와 만료일
- AI 콘텐츠 일일 생성·다운로드 사용량

관리 액션:

- 관리자 이용권 시작일·종료일 설정
- 브랜드별 생성·다운로드 한도 설정
- 이용권 회수

Toss Payments 연동 후 추가:

- 결제 수단 마스킹 정보
- 다음 결제일
- 결제 성공·실패·환불 이력
- 다음 결제일 해지
- 결제 실패 즉시 이용 중지 상태

카드 번호, CVC, 전체 유효기간은 저장하거나 표시하지 않는다.

### 6.8 시스템

표시 항목:

- 중앙 API와 DB health
- 워커 종류, `worker_id`, 모드, 버전, 마지막 heartbeat
- `worker_resource_leases` 점유와 만료 시각
- 이미지·텍스트·DM·Wiki·AI 콘텐츠 작업 큐 수
- 실행 중, 재시도 대기, exhausted, dead 작업 수
- 소스 크롤링, 일일 생성, 게시, 성과 수집 스케줄러 최근 실행
- 최근 24시간 오류 코드별 건수

관리 액션:

- 안전한 상태의 실패 작업 재시도
- 만료된 lease 정리 요청

제약:

- 관리자 UI에서 워커 프로세스를 직접 시작하거나 종료하지 않는다.
- 서버 명령 실행과 임의 SQL 실행 기능을 제공하지 않는다.

### 6.9 감사 로그

표시 항목:

- 발생 시각
- actor 유형과 관리자 식별자
- event type
- 대상 브랜드와 entity
- 변경 사유
- 변경 전·후의 비민감 필드
- request ID와 idempotency key

필터:

- 기간
- actor
- 브랜드
- event type
- entity type

감사 로그는 관리자 UI에서 수정하거나 삭제할 수 없다.

## 7. 관리자 액션 정책

| 액션 | 사유 필수 | 멱등성 키 | 감사 로그 |
|---|---:|---:|---:|
| 브랜드 중지·재개 | 예 | 예 | 예 |
| 이용권 부여·회수 | 예 | 예 | 예 |
| 사용 한도 변경 | 예 | 예 | 예 |
| 채널 비활성화 | 예 | 예 | 예 |
| 채널 상태 재확인 | 아니요 | 예 | 예 |
| 게시 재시도·취소 | 예 | 예 | 예 |
| DM 중지·재개 | 예 | 예 | 예 |
| 수동 DM 답변 | 아니요 | 예 | 예 |
| Wiki 재크롤링·재빌드 | 아니요 | 예 | 예 |
| 작업 재시도 | 예 | 예 | 예 |

## 8. 데이터 소스

| 기능 | 주요 데이터 |
|---|---|
| 고객·브랜드 | `app_users`, `workspaces`, `workspace_members`, `brands`, `brand_profiles` |
| 채널 | `brand_channels`, `channel_credentials`의 비민감 메타데이터 |
| 콘텐츠·게시 | `content_topics`, `channel_outputs`, `publish_queue`, `publish_attempts`, `storage_artifacts` |
| DM | `instagram_dm_settings`, `instagram_dm_conversations`, `instagram_dm_messages`, attention·reply job 테이블 |
| Wiki | `source_urls`, `source_crawl_runs`, `knowledge_imports`, `knowledge_entries`, `wiki_versions`, `wiki_pages`, `wiki_page_chunks`, `wiki_issues` |
| 사용량 | `ai_content_usage_ledger`와 현재 billing summary |
| 시스템 | `worker_instances`, `worker_resource_leases`, 생성·DM·Wiki 작업 테이블, scheduler run 테이블 |
| 감사 | `audit_events` |

## 9. 보안과 운영 원칙

- `BRAND_PILOT_ADMIN_API_TOKEN`은 `dkskrn2/main` 서버 환경변수에만 저장한다.
- 브라우저 번들, HTML, 로그, 오류 응답에 서비스 토큰을 포함하지 않는다.
- Admin API는 일반 고객 API와 `/admin/v1` namespace를 분리한다.
- service token 비교는 timing-safe 방식으로 처리한다.
- 변경 요청은 관리자 ID, 사유, request ID, idempotency key를 서버에서 기록한다.
- 감사 로그의 before/after에는 credential, 쿠키, authorization header, 전체 DM 개인정보를 저장하지 않는다.
- 조회 API의 외부 사용자 식별자는 운영에 필요한 범위로 제한한다.

## 10. 범위 제외

- 관리자 계정 생성·초대·권한 관리
- 브라우저에서 DB SQL 실행
- 워커 원격 셸 제어
- credential 원문 조회
- 고객 데이터 물리 삭제
- Toss Payments 실제 승인·빌링키 발급
- 아직 개발자 인증이 끝나지 않은 채널의 실제 외부 게시

## 11. 완료 기준

- 기존 `/admin` 로그인으로 Brand Pilot 메뉴에 접근한다.
- 브라우저 네트워크 요청에 Brand Pilot service token이 노출되지 않는다.
- 9개 메뉴가 실제 DB 데이터 또는 명시적인 빈 상태를 표시한다.
- 위험 작업은 사유와 확인 절차 없이는 실행되지 않는다.
- 같은 idempotency key의 관리자 변경은 한 번만 반영된다.
- 모든 변경 작업이 감사 로그에서 관리자와 대상 기준으로 조회된다.
- credential 원문이 API 응답과 관리자 로그에 포함되지 않는다.
- Brand Pilot API 장애가 기존 사이트 관리자 기능을 중단시키지 않는다.

## 12. 구현 순서

1. Brand Pilot API에 관리자 인증, 공통 응답, 감사 mutation helper를 추가한다.
2. 운영 현황, 브랜드, 채널, 시스템 조회 API를 먼저 구현한다.
3. 게시, DM, Wiki의 조회 API와 안전한 운영 액션을 구현한다.
4. 관리자 이용권과 브랜드별 AI 콘텐츠 한도 저장 구조를 추가한다.
5. `dkskrn2/main`에 서버 전용 Admin API client와 Brand Pilot 메뉴를 추가한다.
6. 목록·상세 화면을 구현한 뒤 변경 액션과 감사 로그 화면을 연결한다.
7. 실제 서버 이전 시 service token을 생성하고 두 서버 환경변수에 주입한다.
