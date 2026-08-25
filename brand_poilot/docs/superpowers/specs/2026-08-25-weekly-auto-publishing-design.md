# 주간 자동 게시 설정·실행 설계

작성일: 2026-08-25

기준 소스: 운영 release 및 `state/current` `b953c49f0d39bb00a84c18af874dced7a6a2124c`

상태: 사용자 제품 결정 완료, 작성된 설계 문서 검토 대기

## 1. 배경과 확인된 운영 상태

현재 자동 게시 설정은 `publish_calendar_settings.slot_times time[]` 한 벌을 다음 7일의 모든 날짜에 똑같이 적용한다. 이 구조는 월요일과 화요일에 서로 다른 시간을 두거나 하루에 여러 개의 안정적인 반복 슬롯을 정의할 수 없다.

2026-08-25 운영 조사에서는 다음 사실도 확인했다.

- 운영 API의 `INSTAGRAM_PUBLISH_ENABLED=true`, `LOCAL_SCHEDULER_ENABLED=false`다.
- `/ready`는 `publishing=enabled`, `scheduler=disabled`를 반환한다.
- Ubuntu에 `publish-due`를 호출하는 timer, crontab 또는 전용 컨테이너가 없다.
- 운영 API의 Vercel 설정에도 `publish-due` cron 정의가 없다.
- 실제 11:30 예약 한 건은 콘텐츠와 Instagram 결과가 11:30 전에 준비됐지만 14:52에도 slot `content_assigned`, group `waiting`, queue `queued`, 게시 시도 0회로 남았다.
- 운영 DB에는 자동 게시 설정 행과 미래 자동 슬롯이 각각 0건이므로 구형 자동 설정 데이터를 새 모델로 추정 변환할 필요가 없다.

따라서 이번 변경은 헤더 토글 UI만 바꾸는 작업이 아니다. 주간 일정 저장 구조, 설정 API, 자동 슬롯 배정기, 게시 만료 정책과 실제 단일 실행 주체를 함께 완성해야 한다.

## 2. 확정된 제품 결정

1. 자동 게시 일정은 월요일부터 일요일까지 반복되는 주간 일정이다.
2. 요일마다 게시 시간을 여러 개 등록할 수 있고 동일한 시각의 여러 슬롯도 허용한다.
3. 모든 활성 채널은 하나의 공통 주간 일정을 사용한다.
4. 공통 슬롯 하나는 동일한 콘텐츠 주제를 모든 활성 채널에 배포한다.
5. 채널별 산출물만 해당 채널 규격에 맞게 생성하며 게시 한도는 publication unit 1건으로 계산한다.
6. 전체 자동 게시 마스터와 연결된 채널별 ON/OFF를 제공한다.
7. 마스터 또는 채널을 꺼도 이미 생성된 미래 예약은 취소하지 않는다.
8. 예약 시각이 지나도 한국시간 기준 예약 당일 23:59 전까지는 준비되는 즉시 게시한다.
9. 예약 당일 23:59에 게시가 시작되지 않은 대상은 자동 취소한다.
10. 게시가 이미 시작됐거나 완료된 대상은 23:59에 중단하거나 되돌리지 않는다.
11. 완료는 초록색, 예약·예정은 파란색으로 표시한다.

## 3. 목표와 비목표

### 3.1 목표

- 반복 주간 일정과 채널 설정을 한 화면에서 명확하게 편집한다.
- 주간 일정의 각 발생을 멱등한 실제 `publish_calendar_slots` 행으로 생성한다.
- 일일 정보성·트렌드성 추천을 생성 전 자동 슬롯에 연결하고 기존 콘텐츠 생성 플로우를 사용한다.
- 추천으로 채워지지 않은 슬롯에 사용자가 생성 중·완료 미게시 콘텐츠를 연결하거나 새 콘텐츠 생성 1단계를 시작할 수 있게 한다.
- 구독 시작일 기준 주간 게시 한도를 자동·수동 예약 전체에 적용한다.
- 운영에서 실제로 1분 단위 게시 실행과 23:59 만료 처리가 일어나게 한다.
- 목록과 캘린더의 기존 공통 `PublishItem[]` 읽기 모델, 예약·취소·결과 조회를 유지한다.

### 3.2 비목표

- Instagram 외 게시 provider adapter 구현
- 일일 정보성·트렌드성 추천 생성 기능 변경
- 콘텐츠 생성 모델, 프롬프트 또는 렌더 worker 변경
- 기존 수동 예약 데이터의 일괄 변환·삭제·재배정
- DM, FAQ, crawl, wiki, 자동응답 설정 또는 무관 worker 변경
- Caddy 변경
- 게시 실패 분류와 명시적 재시도 정책의 전면 재설계
- 이번 작업 중 운영 배포

## 4. 검토한 접근과 선택

### 4.1 선택: 정규화된 주간 일정 행

요일과 시간 하나를 안정적인 ID를 가진 한 행으로 저장한다. 동일 요일·시각의 중복 행을 허용하고, 실제 날짜 슬롯의 idempotency key는 주간 일정 행 ID와 한국 날짜로 만든다.

장점은 DB 제약, 조회, 부분 수정, 멱등성, 테스트가 명확하고 JSON 형식 변화에 의존하지 않는다는 점이다. 이 접근을 사용한다.

### 4.2 제외: 설정 행의 JSONB 일정

단일 컬럼으로 빠르게 저장할 수 있지만 요일·시간 검증, 동일 시각 발생 순서, 부분 수정과 DB 수준 무결성이 애플리케이션 코드에만 의존한다. 운영 예약 원장에는 적합하지 않아 제외한다.

### 4.3 제외: 기존 `slot_times time[]` 재사용

시간 값에 요일을 표현할 수 없고 별도 문자열 인코딩은 `time[]` 타입과 기존 검증을 우회한다. 요구사항을 표현할 수 없으므로 제외한다.

## 5. 데이터 모델

### 5.1 기존 설정 행

`publish_calendar_settings`는 다음 전역 설정을 계속 소유한다.

- `enabled`: 전체 자동 게시 마스터 상태
- `channels`: 자동 게시 대상으로 사용자가 켜 둔 지원 채널 배열
- `informational_format`: 정보성 추천의 선호 형식
- `trend_format`: 트렌드성 추천의 선호 형식

마스터를 꺼도 `channels`를 비우지 않는다. 다시 켰을 때 사용자의 채널 선택을 복원한다. 설정 팝업에서 채널을 저장해도 마스터 상태를 암묵적으로 바꾸지 않는다.

구형 `slot_times`는 새 런타임의 fallback으로 사용하지 않는다. 단계적 배포 중 구 UI 호환에 필요한 기간만 API 계약을 유지한 뒤 코드 경로를 제거한다. DB 컬럼 삭제는 별도 승인된 contract migration 전까지 rollback 보존 목적으로만 남기며, 새 코드가 읽거나 쓰지 않는다.

### 5.2 새 주간 일정 테이블

additive migration으로 `publish_calendar_weekly_schedule_entries`를 추가한다.

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `day_of_week smallint not null`: 월요일 1, 일요일 7
- `slot_time time not null`: 한국시간의 벽시계 시각
- `sort_order integer not null`: 같은 요일 안의 UI 표시 순서
- `created_at`, `updated_at`
- `(brand_id, workspace_id)` tenant FK
- `(brand_id, day_of_week, sort_order)` unique

`(brand_id, day_of_week, slot_time)` unique는 만들지 않는다. 동일한 요일·시각의 여러 publication unit을 허용하기 때문이다. 일정 행 ID는 편집 후에도 유지하며 단순 재정렬은 이미 materialize된 슬롯의 identity를 바꾸지 않는다.

새 테이블의 SELECT·INSERT·UPDATE·DELETE와 sequence가 있다면 해당 사용 권한을 운영 application role에 명시한다. 전체 transaction을 owner가 아닌 운영 동등 application role의 실제 PostgreSQL에서 검증한다.

### 5.3 실제 슬롯 identity

주간 일정은 템플릿이고 `publish_calendar_slots`는 실제 예약 원장이다. 자동 슬롯 idempotency key는 다음 canonical 값의 SHA-256이다.

```text
["weekly-auto", scheduleEntryId, "YYYY-MM-DD"]
```

동일 시각의 서로 다른 일정 행은 ID가 다르므로 각각 한 슬롯을 만든다. allocator 재실행은 같은 key의 기존 슬롯을 반환하고 새 슬롯을 만들지 않는다.

설정 변경이나 OFF는 이미 materialize된 미래 슬롯을 수정·취소하지 않는다. 삭제된 일정 행은 아직 생성되지 않은 다음 발생부터 중단된다.

## 6. API 계약

### 6.1 설정 조회

`GET /brands/:brandId/publish-calendar/settings`는 다음을 반환한다.

- `enabled`
- `channels`
- `informationalFormat`
- `trendFormat`
- `weeklySchedule: [{ id, dayOfWeek, time, sortOrder }]`
- `updatedAt`

지원 채널 목록과 연결 상태는 기존 channel catalog/상태 API를 사용한다. 미연결 또는 아직 provider가 지원되지 않는 채널은 UI에서 비활성 상태로 보이고 저장 대상이 될 수 없다.

### 6.2 마스터 토글

헤더 토글은 일정 전체를 stale payload로 덮어쓰지 않는 전용 경로를 사용한다.

```text
PATCH /brands/:brandId/publish-calendar/settings/enabled
{ enabled: boolean }
```

OFF는 항상 허용한다. ON은 연결된 지원 채널이 하나 이상 켜져 있고 주간 일정 행이 하나 이상일 때만 허용한다. 실패 시 서버 상태를 유지하고 구체적인 설정 필요 오류를 반환한다.

### 6.3 설정 저장

설정 팝업은 채널 배열, 정보성·트렌드성 형식과 주간 일정 행 전체를 하나의 brand advisory transaction에서 저장한다. 기존 일정 행은 ID를 유지하고, 삭제된 ID는 해당 브랜드 범위에서만 삭제하며, 클라이언트가 임의의 다른 브랜드 ID를 참조하면 tenant 오류로 거부한다.

검증 규칙은 다음과 같다.

- `dayOfWeek`는 1~7
- 시간은 유효한 `HH:mm`
- 하루 슬롯 수와 주간 전체 슬롯 수는 서버 상한 이내
- 동일 시각 중복과 임의 간격은 허용
- 마스터 ON 상태에서 활성 채널 0개 또는 일정 0개 저장은 거부
- 지원되지 않거나 미연결인 채널 저장은 거부
- 템플릿의 주간 전체 횟수는 현재 플랜의 `weekly_publish_limit`를 초과할 수 없음

저장 성공은 기존 materialize 슬롯을 바꾸지 않고 다음 미생성 발생에만 적용된다. UI는 이 사실을 저장 전에 안내한다.

### 6.4 단계적 호환성

API 선배포와 UI 선배포 사이의 짧은 전환 구간만 구형 `slotTimes` 응답·입력을 지원한다. 운영에 기존 자동 설정과 미래 자동 슬롯이 0건임을 배포 직전에 다시 확인한다.

- 전환 중 구 UI write는 새 weekly schedule을 만들지 않고 구형 설정으로만 격리한다.
- 새 UI가 운영 승격되고 이전 UI revision으로 유입되는 write가 없음을 확인한 뒤 구형 DTO, 검증, repository write와 allocator fallback을 제거한다.
- 장기 dual-write, 암묵적 월~일 복제 또는 숨은 fallback은 남기지 않는다.

## 7. 설정 UI

### 7.1 캘린더 헤더

기존 `자동 게시 설정` 버튼을 다음 컨트롤로 교체한다.

1. `자동 게시` 라벨
2. `role="switch"`, `aria-checked`를 가진 마스터 토글과 ON/OFF 문구
3. 설정 팝업을 여는 `수정` 버튼
4. 기존 이전 달·다음 달 버튼

토글과 수정 저장은 서버 성공 이후에만 화면 상태를 확정한다. 저장 중 중복 조작을 막고 실패 시 기존 상태와 사용자 입력을 유지한다. 팝업을 닫으면 포커스를 `수정` 버튼으로 되돌린다.

### 7.2 설정 팝업

팝업에는 마스터 토글을 중복 배치하지 않는다. 다음 순서로 구성한다.

- 게시 채널: 연결된 지원 채널별 ON/OFF
- 주간 일정 요약: 주간 설정 횟수와 현재 플랜 한도
- 월~일 일정표: 요일, 이번 주 실제 날짜, 해당 요일의 시간 행
- 각 요일의 `시간 추가`, 각 행의 시간 입력·삭제
- 정보성 추천 형식과 트렌드성 추천 형식
- 기존 예약은 변경되지 않는다는 안내
- 저장·취소

동일한 시각 행은 별개의 행으로 그대로 표시한다. 30분 간격 안내나 자동 보정은 두지 않는다. 좁은 화면에서는 요일 카드가 한 열로 쌓이고 팝업·본문 모두 가로 overflow를 만들지 않는다.

### 7.3 캘린더 상태 표현

- 게시 완료: 초록색
- 예약·게시 예정: 파란색
- 게시 지연: 주황색
- 게시 실패·결과 확인 필요: 빨간색
- 취소·자동 취소: 회색

색상만으로 상태를 전달하지 않고 텍스트 badge와 접근 가능한 이름을 함께 제공한다. 생성 완료 콘텐츠에는 기존 artifact/manifest에서 얻은 썸네일을 표시하고, 생성 전·생성 중이거나 썸네일 조회가 실패하면 안정적인 placeholder를 사용한다.

## 8. 자동 슬롯과 콘텐츠 배정

### 8.1 슬롯 materialization

allocator는 한국시간 오늘부터 7일 horizon을 계산하고 각 날짜의 요일과 일치하는 주간 일정 행을 시간·sort order 순으로 처리한다. 마스터가 ON이고 활성·연결된 지원 채널이 있을 때만 아직 없는 occurrence를 만든다.

한 occurrence는 현재 활성 채널 배열을 가진 슬롯 한 개와 publication unit 한 개다. 이후 채널 설정 변경은 이미 생성된 슬롯의 target을 바꾸지 않는다.

### 8.2 추천 자동 선택

기존 일일 정보성·트렌드성 추천 2건을 변경하지 않는다. 추천 batch가 준비되면 같은 한국 날짜의 아직 콘텐츠가 없는 자동 슬롯 중 시간순 첫 적합 슬롯에 연결한다.

- 정보성 추천은 `informational_format`
- 트렌드성 추천은 `trend_format`
- 사용자가 형식을 설정하지 않은 초기값은 정보성 카드뉴스, 트렌드성 릴스로 혼합 배치
- 추천을 슬롯에 연결한 뒤 기존 콘텐츠 생성 1단계와 생성·렌더 flow를 그대로 사용
- 같은 추천과 같은 슬롯의 재실행은 기존 idempotency 계약으로 한 번만 연결

하루 슬롯이 추천 2건보다 많으면 남은 슬롯은 `open` 상태로 유지한다. 임의 주제를 새로 만들거나 추천을 중복 사용하지 않는다.

### 8.3 사용자 직접 배정

열린 슬롯마다 사용자는 다음 중 하나를 선택할 수 있다.

- 생성 중 콘텐츠
- 생성 완료·미게시 콘텐츠
- 새 콘텐츠 생성

새 콘텐츠 생성은 기존 생성 1단계의 목적, 주제/URL/추천/참고자료, 형식과 DB catalog 선택값을 받는다. 일괄 등록은 같은 필드를 행 단위 테이블로 입력하고 목적·형식 등 catalog 값은 select box를 사용한다. 전체·행별 검증, idempotency와 부분 실패 표현은 기존 manual/batch provisioning 계약을 유지한다.

## 9. 구독과 주간 한도

게시 한도는 구독 시작일을 기준으로 7일씩 나눈 기존 subscription week를 사용한다. 반복 일정의 월~일 표현과 quota 주기는 서로 다른 개념이다.

- 템플릿 주간 횟수는 현재 플랜의 주간 게시 한도를 넘을 수 없다.
- materialization 시 해당 occurrence가 속하는 subscription week의 published와 활성 예약을 다시 센다.
- 수동 예약과 자동 예약을 함께 계산하고 `additionalAvailable`이 0이면 슬롯을 만들지 않는다.
- 같은 publication unit의 여러 활성 채널 target은 한도 1건이다.
- 동일 시각의 서로 다른 publication unit은 각각 1건이다.
- cancelled publication unit은 예약 사용량에서 해제한다.
- 예약만으로 생성 잔여 횟수를 차감하지 않는다.
- 월 구독 플랜 변경으로 한도가 줄어도 기존 예약은 유지하고 신규 자동 슬롯만 중단한다.

한도로 만들지 못한 occurrence는 숨은 예약으로 저장하지 않는다. 설정 팝업과 캘린더에는 현재 주의 잔여 한도 때문에 생성되지 않았음을 명시한다.

## 10. 게시 실행과 23:59 만료

### 10.1 단일 실행 주체

운영 API의 `LOCAL_SCHEDULER_ENABLED=false`는 유지한다. primary와 canary API 프로세스 안에서 각각 scheduler를 켜지 않는다.

대신 release bundle에 게시 전용 singleton scheduler 서비스를 추가한다. 이 서비스는 DB·Meta·Blob 자격 증명을 갖지 않고 Docker 내부 네트워크에서 primary API의 `GET /internal/cron/publish-due`를 1분마다 호출한다. `CRON_SECRET`은 기존 root-owned secret을 읽기 전용 mount로 받으며 로그에 출력하지 않는다.

- scheduler replica는 정확히 1개
- 이전 호출이 끝나지 않았으면 다음 tick을 중첩 실행하지 않음
- API에도 전역 advisory lock을 추가해 오배치된 중복 caller를 방어
- 응답 status와 처리 건수만 구조화 로그로 기록
- healthcheck는 프로세스 생존뿐 아니라 최근 성공 tick 시각을 검증
- 배포·롤백 시 scheduler만 해당 release의 immutable 정의로 교체 가능

기존 추천 생성 예약 기능은 주제 추천을 만들 뿐 게시 큐를 실행하지 않는다. 두 실행 주체를 같은 기능으로 간주하지 않는다.

### 10.2 당일 지연 게시

예약 시각이 지났고 콘텐츠가 아직 준비되지 않았으면 슬롯을 `publish_delayed`로 표시한다. 같은 한국 날짜의 23:59 전 콘텐츠와 target queue가 준비되면 `effectiveScheduledFor=now`로 예약해 즉시 게시한다. 원래 예약 시각은 변경하지 않고 상세에 원래 시각과 실제 실행 시각을 함께 표시한다.

### 10.3 23:59 자동 취소

한국시간 예약일 23:59:00 이후 첫 tick은 due 게시 선택보다 만료 처리를 먼저 수행한다.

- 아직 `publishing` 또는 `published`가 아닌 queue target은 `cancelled`
- 어떤 target도 시작되지 않았으면 slot과 publish group 예약을 취소
- 일부 target이 published이고 나머지가 미게시라면 완료 target은 유지하고 나머지만 취소
- 23:59 전에 `publishing`을 시작한 target은 중단하지 않음
- 시작한 target이 23:59 뒤 실패하면 자동으로 다음 날 재게시하지 않고 기존 실패·명시적 재시도 정책을 사용
- 생성 중 작업은 계속 진행하며 완료 결과는 미예약 콘텐츠로 반환
- 자동 취소 이유는 `reservation_expired_at_2359_kst`처럼 안정적인 코드로 저장하고 UI에서 이해 가능한 문구로 변환

23:59 경계는 `23:58:59.999`까지 지연 게시 가능, `23:59:00.000`부터 미시작 대상 만료로 고정한다.

## 11. 오류 처리와 관찰성

- 설정 조회 실패: 토글 비활성화, 수정 팝업에서 재시도 제공
- 토글 ON 조건 부족: 필요한 채널 또는 일정 설정 안내
- 채널 연결 해제: 신규 슬롯에서 제외하고 기존 예약 상세에 연결 문제 표시
- 구독 비활성·한도 부족: 예약을 만들지 않고 다음 subscription week 시작일 안내
- mutation 성공 후 재조회 실패: 저장 성공과 새로고침 실패를 분리하고 재제출하지 않음
- scheduler 비정상: 최근 성공 tick이 기준을 넘으면 health 실패와 운영 경고
- 한 브랜드 처리 실패: 다른 브랜드 처리를 계속하고 실패 brand와 안정적인 error code 기록
- provider 호출 전 실패와 provider 호출 후 결과 불명을 구분
- 사용자에게 원래 예약 시각, 실제 실행 시각, 자동 취소 시각과 이유를 분리해 표시

## 12. 테스트와 검증

### 12.1 DB·repository

- migration 전후 기존 수동 예약 읽기·쓰기 유지
- application role의 새 일정 행 CRUD와 전체 settings transaction
- 월~일, 하루 여러 시간, 동일 시각 중복 저장
- 일정 행 ID 유지·삭제·tenant 침범 거부
- schedule entry/date idempotency replay와 payload conflict
- 7일 horizon의 요일·한국 날짜 계산
- 설정 변경·마스터 OFF·채널 OFF 이후 기존 미래 슬롯 유지
- 추천 2건 자동 선택과 남은 open 슬롯
- 정보성 카드뉴스·트렌드성 릴스 기본 혼합 및 명시 형식
- 구독 시작일 주간 경계, 수동+자동 quota, multi-target 1건 계산
- 플랜 축소 후 기존 예약 보존과 신규 materialization 중단
- 23:58:59 지연 게시, 23:59:00 자동 취소
- 모든 target 미시작, 일부 published, publishing 진행 중, provider 결과 불명 조합
- 만료 후 생성 완료 결과가 미예약 콘텐츠로 남음

DB write 검증은 운영과 동등한 최소 권한 application role의 실제 PostgreSQL에서 transaction 전체를 실행한다. owner/provider role 통과나 skip된 PostgreSQL 테스트를 권한 검증 완료로 보고하지 않는다.

### 12.2 API·scheduler

- 마스터 PATCH가 일정·채널·형식을 덮어쓰지 않음
- OFF 항상 허용, ON 사전 조건 검증
- settings 전체 저장의 strict DTO와 stale/tenant ID 거부
- singleton tick, 중복 tick 방지, global advisory lock
- scheduler HTTP 인증 실패·timeout·API 5xx와 recovery
- primary만 호출하고 canary에 mutation 요청을 보내지 않음
- 최근 성공 tick health와 구조화 오류 로그
- `publish-due`가 준비된 당일 지연 건은 게시하고 23:59 만료 건은 provider 호출하지 않음

### 12.3 고객 UI

- 헤더 토글 ON/OFF, 저장 중 상태와 실패 복구
- 수정 팝업에 중복 마스터 토글 없음
- 연결 채널별 ON/OFF와 미연결 disabled 상태
- 월~일 일정 행 추가·삭제·동일 시각 중복
- 주간 횟수와 플랜 한도 표시
- 기존 예약 유지 안내와 저장 후 서버 응답 반영
- 완료 초록, 예약 파랑, 지연 주황, 실패 빨강, 취소 회색
- 색상 외 텍스트·접근 가능한 상태 이름
- 생성 완료 썸네일과 placeholder
- 모바일에서 가로 overflow 없음

### 12.4 영향 범위 회귀

- 공통 `PublishItem[]` 목록·캘린더 동일 항목
- 수동 단건·일괄 예약, 예약 변경, 취소
- 게시 queue claim, provider 게시, 결과 조회와 명시적 재시도
- 생성 전·생성 중·완료 미게시 콘텐츠 연결
- API와 customer UI typecheck/build

DM, FAQ, crawl, wiki와 무관 worker는 변경하지 않고 영향 테스트 대상에 포함하지 않는다.

## 13. 배포 경계

이번 설계·구현 단계에서는 운영 배포하지 않는다. 향후 배포 승인을 받으면 다음 경계를 지킨다.

1. 배포 직전 원격 main, Ubuntu `state/current`, GitHub `PRODUCTION_RELEASE_SHA`, 실행 digest와 별도 hotfix를 다시 확인한다.
2. 운영의 자동 설정·미래 자동 슬롯 0건 전제를 다시 확인한다. 달라졌으면 자동 변환하지 않고 중단한다.
3. additive migration과 backward-compatible API를 먼저 canary 후 primary에 승격한다.
4. UI를 승격하고 새 weekly settings read/write를 운영 브라우저에서 확인한다.
5. 구형 UI write가 없음을 확인한 뒤 구형 DTO/repository/allocator fallback을 제거한다.
6. scheduler는 API와 UI 검증 후 마지막에 활성화한다. 첫 tick 전에 due·expired dry-run 목록과 현재 게시 한도를 확인한다.
7. scheduler 활성화 후 최근 성공 tick, publish attempt, provider 오류, API health/ready와 restart count를 확인한다.
8. Caddy, DB 이외 worker, DM, Wiki와 자동응답 설정은 변경하지 않는다.

rollback은 변경한 구성요소만 대상으로 한다. scheduler를 먼저 중지하고 UI, API를 각 직전 검증 revision/digest로 되돌린다. additive schedule table은 기존 API와 충돌하지 않으므로 자동 DROP하지 않는다. 이미 생성된 예약이나 게시 결과를 rollback 과정에서 삭제·재배정하지 않는다.

## 14. 완료 조건

1. 사용자가 월~일 공통 반복 일정과 요일별 여러 시간을 저장할 수 있다.
2. 마스터와 채널별 ON/OFF가 설정을 보존하며 기존 미래 예약을 취소하지 않는다.
3. 일정 occurrence가 멱등하게 실제 슬롯 한 개로 생성되고 동일 시각 여러 슬롯을 허용한다.
4. 활성 채널 전체가 동일 주제를 공유하고 채널별 산출물만 다르며 게시 한도는 1건이다.
5. 추천 2건은 생성 전 자동 선택되고 추가 슬롯은 open으로 남아 수동 배정할 수 있다.
6. 수동·자동 예약 합계가 구독 시작일 기준 주간 게시 한도를 넘지 않는다.
7. 예약 당일 23:59 전에는 지연 게시하고 23:59부터 미시작 대상은 provider 호출 없이 자동 취소한다.
8. 운영에서 singleton scheduler가 매분 실행되고 최근 성공 tick을 확인할 수 있다.
9. 완료·예정 색상, 상태 문구, 썸네일과 상세 정보가 캘린더에 정확히 표시된다.
10. 기존 목록·캘린더 공통 데이터, 수동 예약, 게시 queue와 결과·재시도가 영향 테스트를 통과한다.
11. 운영 application role PostgreSQL 검증이 실제로 실행되고 skip되지 않는다.
12. 무관 서비스는 변경·배포·테스트하지 않는다.
