# Brand Pilot Admin API 계약

작성일: 2026-07-19
상태: 확정
소비자: `dkskrn2/main` Next.js 관리자 서버

## 1. 목적과 원칙

이 API는 기존 Growthline 관리자 서버가 Brand Pilot 운영 데이터를 조회하고 제한된 운영 조치를 수행하기 위한 서버 간 계약이다.

- base path는 `/admin/v1`이다.
- 브라우저가 이 API를 직접 호출하지 않는다.
- 기존 고객 API를 관리자 권한으로 우회 호출하지 않는다.
- 응답에는 credential 원문을 포함하지 않는다.
- 변경 요청은 멱등성과 감사 로그를 보장한다.

## 2. 서버 환경변수

### `dkskrn2/main`

```text
BRAND_PILOT_ADMIN_API_URL=https://brand-pilot-api.example.com
BRAND_PILOT_ADMIN_API_TOKEN=<server-only-token>
BRAND_PILOT_APP_URL=https://brand-pilot.example.com
```

### Brand Pilot API

```text
ADMIN_SERVICE_TOKEN=<same-server-only-token>
```

서비스 토큰은 일반 사용자 세션, worker token, cron secret과 분리한다.

## 3. 인증 헤더

모든 요청:

```http
Authorization: Bearer <ADMIN_SERVICE_TOKEN>
X-Admin-Actor-Id: <existing-admin-identifier>
X-Request-Id: <uuid>
```

변경 요청 추가 헤더:

```http
Idempotency-Key: <uuid>
```

규칙:

- `X-Admin-Actor-Id`는 Next.js 서버가 기존 관리자 세션에서 생성한다.
- 브라우저가 보낸 actor ID를 그대로 전달하지 않는다.
- `POST`, `PATCH`, `DELETE` 요청은 `Idempotency-Key`가 없으면 `400 idempotency_key_required`를 반환한다.
- 같은 actor, endpoint, idempotency key의 재요청은 첫 결과를 반환하고 변경을 반복하지 않는다.

## 4. 공통 응답

단일 객체:

```json
{
  "data": {},
  "requestId": "f7f15abe-859a-4aa4-8320-503ba45e75bd"
}
```

목록:

```json
{
  "data": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  },
  "requestId": "f7f15abe-859a-4aa4-8320-503ba45e75bd"
}
```

오류:

```json
{
  "error": {
    "code": "state_conflict",
    "message": "현재 상태에서는 요청한 작업을 실행할 수 없습니다.",
    "details": {}
  },
  "requestId": "f7f15abe-859a-4aa4-8320-503ba45e75bd"
}
```

운영 오류의 `details`에는 토큰, authorization header, 쿠키, 암호화 payload를 포함하지 않는다.

## 5. 공통 query

| 이름 | 기본값 | 규칙 |
|---|---:|---|
| `limit` | 30 | 1~100 |
| `cursor` | 없음 | 서버가 발급한 opaque cursor |
| `q` | 없음 | trim 후 2~100자 |
| `brandId` | 없음 | UUID |
| `status` | 없음 | endpoint 허용값만 사용 |
| `from`, `to` | 없음 | ISO 8601, 최대 조회 기간 90일 |

목록 정렬은 기본적으로 `created_at desc, id desc`다. cursor에는 정렬 기준을 포함하고 클라이언트가 해석하지 않는다.

## 6. Endpoint 목록

### 6.1 운영 현황

#### `GET /admin/v1/overview`

응답:

```json
{
  "data": {
    "generatedAt": "2026-07-19T12:00:00.000Z",
    "brands": { "active": 3, "paused": 0, "disabled": 0 },
    "channels": { "connected": 2, "needsAttention": 1 },
    "generation24h": { "succeeded": 8, "failed": 1 },
    "publishing": { "pendingReview": 4, "scheduled": 2, "publishing": 0, "failed": 1 },
    "dm24h": { "received": 12, "replied": 10, "fallback": 1, "failed": 1 },
    "wiki24h": { "succeeded": 1, "failed": 0 },
    "workers": { "online": 4, "stale": 0 },
    "recentErrors": []
  },
  "requestId": "..."
}
```

### 6.2 고객·브랜드

#### `GET /admin/v1/brands`

Query: `q`, `status`, `limit`, `cursor`

각 항목:

- `id`, `workspaceId`, `workspaceName`
- `name`, `status`, `createdAt`, `lastActivityAt`
- `owner`: `displayName`, `email`
- `category`: `primary`, `subcategories`
- `onboardingCompleted`
- `connectedChannelCount`
- `dmEnabled`
- `entitlementStatus`

#### `GET /admin/v1/brands/:brandId`

브랜드 프로필, 자사 URL, 채널 요약, 최근 활동, 당일 AI 콘텐츠 사용량, 이용권과 최근 문의를 반환한다.

#### `PATCH /admin/v1/brands/:brandId/status`

```json
{
  "status": "paused",
  "reason": "고객 요청으로 운영 일시 중지"
}
```

허용 전이:

- `active -> paused`
- `paused -> active`

`disabled` 전환은 이 endpoint에서 허용하지 않는다.

#### `PATCH /admin/v1/brands/:brandId/entitlement`

```json
{
  "action": "grant",
  "startsAt": "2026-07-19T00:00:00+09:00",
  "expiresAt": "2026-08-19T23:59:59+09:00",
  "reason": "파일럿 고객 1개월 이용권"
}
```

`action`은 `grant`, `revoke`다. `grant`에는 `expiresAt`, `revoke`에는 `reason`이 필수다.

#### `PATCH /admin/v1/brands/:brandId/limits`

```json
{
  "aiContentDailyGeneration": 10,
  "aiContentDailyDownload": 20,
  "reason": "파일럿 한도 조정"
}
```

### 6.3 채널 연결

#### `GET /admin/v1/channels`

Query: `q`, `brandId`, `channel`, `status`, `limit`, `cursor`

각 항목:

- `id`, `brandId`, `brandName`, `channel`
- `enabled`, `status`, `authMode`
- `accountLabel`, `externalAccountIdMasked`
- `scopes`, `expiresAt`
- `lastHealthyAt`, `lastPublishedAt`
- `lastErrorCode`, `lastErrorMessage`

#### `POST /admin/v1/channels/:channelId/recheck`

외부 API 상태 확인 작업을 요청한다. 응답은 `operationId`, `status: accepted`다.

#### `POST /admin/v1/channels/:channelId/disable`

```json
{ "reason": "권한 만료로 재연결 필요" }
```

credential을 삭제하지 않고 채널 생성·게시 사용을 중단한다.

### 6.4 콘텐츠·게시

#### `GET /admin/v1/publishing`

Query: `q`, `brandId`, `channel`, `generationStatus`, `reviewStatus`, `publishStatus`, `from`, `to`, `limit`, `cursor`

#### `GET /admin/v1/publishing/:queueId`

반환 항목:

- 주제와 생성 근거
- 채널 결과물과 artifact descriptor
- 검토 이력
- 큐 상태와 예정·게시 시각
- 게시 시도 목록
- 외부 게시 URL
- 비민감 오류 메타데이터

#### `POST /admin/v1/publishing/:queueId/retry`

```json
{ "reason": "인증 갱신 후 재시도" }
```

허용 상태는 `failed`, `deferred`다. `published`, `publishing`, `cancelled`는 거부한다.

#### `POST /admin/v1/publishing/:queueId/cancel`

```json
{ "reason": "고객 요청으로 게시 취소" }
```

허용 상태는 `queued`, `scheduled`, `deferred`다.

#### `GET /admin/v1/publishing/:queueId/download`

관리자용 결과물 패키지를 반환한다. 고객 다운로드 한도는 차감하지 않으며 감사 로그는 남긴다.

### 6.5 DM 자동답변

#### `GET /admin/v1/dm/conversations`

Query: `q`, `brandId`, `automationStatus`, `attentionType`, `unanswered`, `limit`, `cursor`

#### `GET /admin/v1/dm/conversations/:conversationId`

대화, 메시지, 결정, Wiki 검색 근거, 처리 시간, attention 항목을 반환한다.

#### `POST /admin/v1/dm/conversations/:conversationId/pause`

```json
{ "reason": "담당자 직접 응대" }
```

#### `POST /admin/v1/dm/conversations/:conversationId/resume`

```json
{ "reason": "담당자 확인 완료" }
```

#### `POST /admin/v1/dm/conversations/:conversationId/messages`

```json
{ "body": "확인 후 안내드리겠습니다." }
```

Meta 전송 성공 후 outbound message를 완료 처리한다. 전송 결과가 불명확하면 `delivery_unknown`으로 기록하고 자동 재전송하지 않는다.

#### `POST /admin/v1/dm/jobs/:jobId/retry`

```json
{ "reason": "워커 복구 후 재처리" }
```

외부 발송 성공 여부가 확인된 작업은 재시도하지 않는다.

### 6.6 자사 정보·Wiki

#### `GET /admin/v1/knowledge/brands/:brandId`

자사 URL, 크롤링 실행, import 통계, 활성 Wiki 버전, 문서·page·chunk 수, 최근 issue를 반환한다.

#### `POST /admin/v1/knowledge/brands/:brandId/recrawl`

응답: `operationId`, `status: accepted`

#### `POST /admin/v1/knowledge/brands/:brandId/rebuild`

응답: `operationId`, `status: accepted`

#### `POST /admin/v1/knowledge/imports/:importId/retry`

실패한 import만 재시도한다.

### 6.7 결제·사용량

#### `GET /admin/v1/billing/brands`

Query: `q`, `status`, `entitlementSource`, `limit`, `cursor`

현재는 billing summary와 `ai_content_usage_ledger`를 조합한다. 결제 연동이 없으면 `configured: false`를 명시한다.

이용권과 한도 변경은 고객·브랜드 endpoint를 사용한다.

### 6.8 시스템

#### `GET /admin/v1/system/health`

- API와 DB 상태
- 현재 시각
- 최근 scheduler 실행
- queue 상태별 건수

#### `GET /admin/v1/system/workers`

Query: `workerType`, `status`, `limit`, `cursor`

`status`는 heartbeat 기준 `online`, `stale`, `offline`으로 계산한다.

#### `GET /admin/v1/system/jobs`

Query: `jobType`, `status`, `brandId`, `limit`, `cursor`

#### `POST /admin/v1/system/jobs/:jobId/retry`

```json
{ "reason": "일시 오류 복구 후 재시도" }
```

작업별 retry policy가 허용하고 외부 부작용의 성공 여부가 확인된 경우에만 재큐잉한다.

#### `POST /admin/v1/system/leases/cleanup`

만료된 lease만 정리한다. 유효 lease는 변경하지 않는다.

### 6.9 감사 로그

#### `GET /admin/v1/audit-events`

Query: `actorId`, `brandId`, `eventType`, `entityType`, `from`, `to`, `limit`, `cursor`

응답 필드:

- `id`, `createdAt`
- `actorType`, `actorId`
- `eventType`
- `brandId`, `entityType`, `entityId`
- `reason`
- `before`, `after`
- `requestId`, `idempotencyKey`

## 7. 감사 이벤트 규칙

관리자 변경 요청은 대상 데이터 변경과 감사 이벤트 insert를 같은 DB transaction에서 처리한다.

권장 event type:

```text
admin.brand_paused
admin.brand_reactivated
admin.entitlement_granted
admin.entitlement_revoked
admin.usage_limits_changed
admin.channel_recheck_requested
admin.channel_disabled
admin.publish_retry_requested
admin.publish_cancelled
admin.dm_paused
admin.dm_resumed
admin.dm_manual_reply_sent
admin.dm_job_retry_requested
admin.source_recrawl_requested
admin.wiki_rebuild_requested
admin.knowledge_import_retry_requested
admin.system_job_retry_requested
admin.expired_leases_cleanup_requested
admin.publish_artifact_downloaded
```

`before`와 `after`는 allowlist 기반으로 생성한다. 객체 전체를 그대로 직렬화하지 않는다.

## 8. 상태 충돌과 재시도

- 변경 전에 현재 row를 `for update`로 잠근다.
- 예상하지 않은 상태면 `409 state_conflict`를 반환한다.
- 외부 게시·DM처럼 부작용이 있는 작업은 외부 성공 여부가 불명확하면 자동 재시도하지 않는다.
- 재시도 요청은 기존 작업을 덮어쓰지 않고 새 attempt 또는 재큐잉 이벤트를 남긴다.
- 접수형 작업은 `202 Accepted`와 `operationId`를 반환한다.

## 9. 오류 코드

| HTTP | code | 의미 |
|---:|---|---|
| 400 | `validation_error` | 입력 형식 또는 필수값 오류 |
| 400 | `idempotency_key_required` | 변경 요청의 멱등성 키 누락 |
| 401 | `admin_unauthorized` | 서비스 토큰 불일치 |
| 403 | `admin_forbidden` | actor 권한 부족 |
| 404 | `not_found` | 대상 없음 |
| 409 | `state_conflict` | 현재 상태에서 작업 불가 |
| 409 | `idempotency_conflict` | 같은 키로 다른 요청 body 사용 |
| 422 | `action_not_allowed` | 정책상 금지된 운영 작업 |
| 429 | `rate_limited` | 관리자 작업 요청 한도 초과 |
| 502 | `external_provider_failed` | 외부 API 실패 |
| 503 | `dependency_unavailable` | DB, storage, worker 등 의존성 장애 |

## 10. 기존 코드 재사용과 신규 구현 경계

재사용 가능:

- 브랜드 프로필, 채널 상태, 게시 큐, DM 대화, Wiki 상태, 대시보드 repository query
- `publish_attempts`, `worker_instances`, `worker_resource_leases`, scheduler run 데이터
- 기존 결과물 artifact와 다운로드 패키지 생성 로직

신규 구현 필요:

- `/admin/v1` 인증 hook
- 관리자 전용 repository query와 커서 페이지네이션
- idempotency key 저장소 또는 감사 로그 기반 중복 방지
- 관리자 actor를 지원하는 감사 이벤트 기록
- 브랜드 중지·이용권·한도 데이터 모델
- 시스템 전체 queue 집계
- 안전한 작업 재시도 정책 함수

현재 `audit_events`는 테이블만 있고 repository에서 일관되게 기록하지 않는다. Admin API 구현 시 공통 `runAdminMutation` transaction helper로 강제한다.

## 11. `dkskrn2/main` 통합 계약

- 기존 `/admin` 세션 검증 함수를 그대로 사용한다.
- Brand Pilot 메뉴의 데이터 호출은 Server Component 또는 Server Action에서만 수행한다.
- `lib/brand-pilot-admin-client.ts` 한 곳에서 base URL, token, timeout, 오류 변환을 관리한다.
- 변경 Server Action은 브라우저 입력의 actor ID를 무시하고 세션의 관리자 식별자를 사용한다.
- API 장애 시 Brand Pilot 메뉴에만 오류 상태를 표시하고 기존 사이트 관리자 기능은 유지한다.
- 읽기 요청 timeout은 10초, 변경 접수 요청 timeout은 15초로 시작한다.

## 12. 계약 테스트 기준

- 인증 헤더가 없거나 잘못되면 모든 endpoint가 `401`을 반환한다.
- 목록 cursor가 변조되면 `400 validation_error`를 반환한다.
- 같은 idempotency key와 같은 body는 같은 결과를 반환한다.
- 같은 idempotency key와 다른 body는 `409 idempotency_conflict`를 반환한다.
- 모든 관리자 변경 후 정확히 한 개의 감사 이벤트가 생성된다.
- credential fixture의 secret 값이 JSON 응답과 로그에 나타나지 않는다.
- 게시·DM의 불명확한 외부 성공 상태는 재시도 endpoint에서 거부된다.
- Brand Pilot API가 중단돼도 `dkskrn2/main`의 기존 관리자 페이지는 렌더링된다.
