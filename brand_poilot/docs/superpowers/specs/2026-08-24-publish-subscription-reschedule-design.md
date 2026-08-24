# 게시 구독 기준 통합과 예약 변경 설계

## 1. 배경과 확인된 원인

운영 게시 설정 화면은 날짜·시간 입력 문제가 아니라 구독 확인 단계에서 차단된다. 운영 DB에는 `billing_plan_catalog` 행이 없고 GROWTHLINE 브랜드의 `brand_subscriptions` 행도 없다. 따라서 게시 수동 예약 옵션 API가 `publish_calendar_subscription_inactive`를 반환하고 UI의 `게시 예약` 버튼이 비활성화된다.

현재 사이드바의 `FREE 플랜`은 실제 구독 조회 결과가 아니라 기본 문자열이며, `생성 4건 남음`은 플랜 주간 한도가 아니라 별도 일일 생성 한도 10건의 잔여값이다. 게시 예약과 사이드바가 서로 다른 기준을 사용한다.

기존 예약에는 상세와 취소만 있고 날짜·시간을 변경하는 API와 UI가 없다. 예약 생성 API를 다시 호출하면 동일 콘텐츠 중복 예약으로 거절된다.

## 2. 확정된 정책

- 플랜 코드는 `free`, 표시 이름은 `FREE`로 한다.
- 플랜 시작 시각을 기준으로 7일 단위 사용 주기를 계산한다.
- 주간 생성 한도는 30건, 주간 게시 한도는 30건이다.
- 구독 기간은 시작일 기준 월 단위로 갱신한다.
- 게시 예약과 사이드바는 `billing_plan_catalog`과 `brand_subscriptions`를 단일 기준으로 사용한다.
- 미래의 미게시 예약은 기존 슬롯을 유지한 채 날짜·시간을 변경한다.
- 자동 배정 예약을 사용자가 변경하면 `assignment_mode='manual'`로 전환한다.
- 게시 중, 게시 완료, 결과 미확정, 실패, 취소된 항목은 변경하지 않는다.
- 예약 변경은 새로운 예약 단위를 만들지 않으므로 주간 게시 한도를 추가 차감하지 않는다.
- 기존 Instagram 게시, 지연 게시, 재시도 분류, 자동 추천 생성은 변경하지 않는다.

## 3. 검토한 접근

### 3.1 구독·한도 기준

1. **브랜드 구독을 단일 기준으로 사용 — 채택**
   - 플랜명, 주간 생성 잔여량, 주간 게시 잔여량, 예약 가능 여부가 한 데이터 흐름을 사용한다.
   - 기존 플랜별 주간 한도 요구사항과 일치한다.
2. 사이드바 기본값과 게시 구독을 별도로 유지 — 제외
   - 같은 사용자에게 `FREE·생성 4건 남음`과 `구독 없음`이 동시에 보이는 현재 오류가 반복된다.
3. 게시 예약을 구독에서 분리 — 제외
   - 플랜별 게시 한도와 월 구독 경계를 적용할 수 없다.

### 3.2 예약 변경 방식

1. **동일 슬롯 원자 변경 — 채택**
   - 슬롯 ID와 콘텐츠 연결을 보존하고 슬롯·게시 그룹·아직 실행되지 않은 큐의 시각을 한 트랜잭션에서 갱신한다.
   - 게시 한도 중복 차감과 취소/재생성 사이의 유실 구간이 없다.
2. 기존 예약 취소 후 새 예약 생성 — 제외
   - 두 작업 사이 실패, 중복 한도 계산, 콘텐츠 연결 유실 위험이 있다.
3. UI에서만 변경한 것처럼 표시 — 제외
   - worker와 DB 예약 시각이 바뀌지 않아 오게시 위험이 있다.

## 4. 데이터와 구독 설정

새 forward-only migration은 `billing_plan_catalog`에 다음 canonical 행을 등록한다.

| code | name | weekly_generation_limit | weekly_publish_limit | active |
| --- | --- | ---: | ---: | --- |
| free | FREE | 30 | 30 | true |

마이그레이션은 다른 브랜드에 구독을 일괄 생성하지 않는다. `free` 행이 이미 있으면 값을 덮어쓰지 않고 30/30 계약과 정확히 같은지 검증하며, 다르면 migration을 중단한다. 운영 적용 단계에서 정확히 한 개로 확인된 GROWTHLINE 브랜드 ID에만 application role로 `brand_subscriptions`를 등록한다. 시작 시각, 현재 기간 시작은 적용 시각으로 하고 현재 기간 종료는 시작일 기준 다음 달 같은 날짜로 계산한다. 동일 브랜드에 구독이 이미 생겼으면 덮어쓰지 않고 중단한다.

기존 월 갱신 로직 `applyDueSubscriptionRenewals`를 그대로 사용한다. 갱신 runner가 월 경계를 넘긴 활성 구독을 플랜 시작일 anchor에 맞춰 다음 기간으로 이동한다.

## 5. API 설계

### 5.1 청구 요약

`GET /brands/:brandId/billing/summary`는 하드코딩된 미구독 응답을 제거하고 브랜드 범위의 구독과 활성 플랜을 조회한다.

- 활성 또는 취소 예정 구독: 실제 플랜명, 상태, 기간 종료일 반환
- 구독 없음: 현재와 같은 `status='none'`
- 결제 제공자 정보는 아직 없으므로 `configured=false`, 결제수단·결제이력은 빈 값 유지

### 5.2 주간 사용량

`GET /brands/:brandId/publish-calendar/usage`를 사이드바의 플랜 사용량 기준으로 사용한다. 응답의 생성·게시 사용량은 플랜 시작일부터 계산한 동일한 7일 창을 사용한다.

일반 콘텐츠 생성도 주간 생성 30건을 넘길 수 없도록 실제 생성 예약 트랜잭션에서 canonical 사용량을 확인한다. 기존 일일 제한은 운영 보호용 보조 rate limit으로 유지하되, 사용자에게 표시하는 플랜 잔여량과 결제 권한 판정은 주간 구독 한도를 따른다. 주간 잔여량이 0이면 신규 생성과 재생성이 동일한 플랜 한도 오류로 중단된다.

### 5.3 예약 변경

`PATCH /brands/:brandId/publish-calendar/slots/:slotId/schedule`

요청:

```json
{
  "scheduledFor": "2026-08-31T18:30:00.000Z"
}
```

서버는 브랜드 advisory lock과 DB 트랜잭션 안에서 다음을 검증한다.

- workspace·brand·slot 소유권
- 활성 구독과 활성 플랜
- 미래 시각
- 슬롯이 취소·실행·완료 상태가 아님
- 연결된 게시 큐에 `publishing`, `published`, `failed` 또는 결과 미확정 상태가 없음
- 변경 대상 슬롯을 제외한 목표 주기의 게시 사용량에 이 슬롯 1건을 더해도 30건을 넘지 않음
- 같은 publication unit을 유지하므로 같은 주기 안의 변경은 추가 한도 차감 없음

검증 후 다음을 함께 갱신한다.

- `publish_calendar_slots.scheduled_for`
- `publish_calendar_slots.assignment_mode='manual'`
- 연결된 `topic_publish_groups.scheduled_for`, 서울 기준 `slot_date`
- 연결된 아직 실행 전 `publish_queue.scheduled_for`, 서울 기준 `slot_date`

다른 주기로 이동하면 기존 주기의 예약 1건을 빼고 목표 주기에 같은 예약 1건을 옮긴다. 목표 주기가 이미 30건이면 전체 트랜잭션을 거절한다.

큐가 아직 생성되지 않은 생성 전·생성 중 예약은 슬롯만 변경한다. 실행 가능한 큐가 이미 `scheduled` 상태면 그룹과 큐까지 같은 시각으로 변경한다. provider 재시도 중인 `deferred` 큐는 사용자가 변경하지 못하게 하여 기존 재시도 정책을 보존한다.

오류 코드는 소유권 누락, 변경 불가 상태, 과거 시각, 비활성 구독을 구분한다. 실패한 트랜잭션은 어떤 시각도 부분 갱신하지 않는다.

## 6. 고객 UI

- 사이드바 플랜명은 실제 billing summary의 플랜명을 표시한다.
- 생성·게시 잔여량은 주간 구독 usage에서 가져온다.
- 구독 조회 실패 시 `FREE`나 일일 잔여량으로 위장하지 않고 `플랜 확인 필요`를 표시한다.
- 목록의 예약 전 항목은 기존 `게시 설정`을 유지한다.
- 미래 예약 항목은 `예약 변경`을 제공한다.
- 캘린더 슬롯 상세에도 같은 `예약 변경` 동작을 제공한다.
- 변경 패널은 현재 예약 날짜·시간을 초기값으로 표시하고 버튼 문구를 `예약 변경`으로 구분한다.
- 저장 중 중복 제출을 막고, 성공 후 공통 `PublishItem[]`과 사이드바 usage를 새로고침한다.
- 저장은 성공했지만 새로고침이 실패한 경우 저장 성공과 조회 실패를 분리해 안내한다.
- 게시 중·완료·실패·취소 항목에는 변경 버튼을 표시하지 않는다.

## 7. 테스트와 운영 검증

### API·DB

- migration 전후 `free` 플랜 30/30 계약과 재실행 안전성
- application role로 플랜 조회, GROWTHLINE 구독 등록, usage 조회 검증
- 예약 전·생성 중·예약 완료 전 슬롯 시각 변경
- 자동 슬롯 변경 시 수동 모드 전환
- scheduled 그룹·큐 시각의 원자 동기화
- 새 publication unit 또는 추가 quota가 생성되지 않음
- 과거 시각, 타 브랜드 슬롯, publishing/published/failed/deferred/cancelled 거절
- 중간 SQL 실패 시 슬롯·그룹·큐 전체 rollback
- 주간 생성 30건 및 게시 30건 경계

### UI

- 실제 `FREE` 플랜명과 생성·게시 잔여량 표시
- 예약 항목에서만 변경 버튼 표시
- 목록과 캘린더가 같은 변경 패널과 PATCH API 사용
- 기존 시각 초기화, 성공·실패·새로고침 실패 처리
- 신규 예약과 예약 변경 문구·payload 구분

### 배포

1. 배포 직전 실제 운영 소스 remote의 `main`, Ubuntu `state/current`, GitHub `PRODUCTION_RELEASE_SHA`, 실행 digest와 별도 hotfix를 다시 확인한다.
2. API 교체와 분리해 migration 089를 먼저 적용하고 canonical `free` 30/30 행을 application role로 조회 검증한다.
3. 정확히 한 개로 확인된 GROWTHLINE 브랜드에만 `free` 월 구독을 application role로 등록하고 billing summary/usage 조회를 먼저 검증한다. 구독 없는 요청을 차단하는 새 API를 이 단계보다 먼저 primary로 승격하지 않는다.
4. API canary에서 billing summary, usage, 예약 변경 계약을 확인한 뒤 primary로 승격한다.
5. 고객 UI를 별도로 배포한다.
6. 운영 브라우저에서 플랜명, 주간 30건, 신규 예약, 미래 예약 변경, 목록·캘린더 동기화를 확인한다.
7. API health/ready, restart count, 게시 worker heartbeat와 최근 오류를 확인한다.
8. 실패 시 변경한 UI와 API만 직전 revision으로 되돌리고, 신규 구독 데이터는 삭제하지 않은 채 비활성화하여 감사 가능성을 보존한다.

DB, API, 고객 UI가 실제 변경 대상이다. Caddy, DM, Wiki, 무관 worker와 자동응답 설정은 변경하지 않는다. 게시 worker 코드는 변경하지 않지만 예약 시각 소비 회귀만 운영에서 확인한다.
