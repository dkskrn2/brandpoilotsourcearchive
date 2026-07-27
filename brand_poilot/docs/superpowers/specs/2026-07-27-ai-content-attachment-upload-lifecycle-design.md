# AI Content Attachment Upload Lifecycle Design

**Date:** 2026-07-27

**Status:** Approved for implementation planning

## 1. Goal

AI 콘텐츠 생성 과정에서 사용하는 임시 첨부파일을 업로드 세션부터 물리 삭제까지 추적한다. 사용자가 같은 파일을 다시 업로드할 수 있게 하고, 실패한 생성의 immutable retry input은 terminal 시점부터 15일 동안 보존하며, 미확정 업로드와 보존기간이 끝난 Blob은 재시도 가능한 GC로 정리한다.

## 2. Scope

이 lifecycle은 다음 AI 콘텐츠 생성 임시 첨부에만 적용한다.

- 주제 분석 단계의 제품 이미지와 문서
- 생성 프롬프트 단계의 이미지와 문서
- `ai_content_generation_attachments`에 저장되는 사용자 업로드

다음 자산은 포함하지 않는다.

- 레퍼런스·아바타·제품·서비스 라이브러리 자산
- 생성 결과 artifact, ZIP, manifest
- 게시 미디어
- subject analysis crawler가 수집한 이미지
- 기존 Blob provider 또는 접근 모델 변경
- Ubuntu 운영 서버 배포와 timer 활성화

## 3. Existing Behavior and Problems

현재 구현은 MIME, 파일 크기, checksum, Blob hostname/path/head metadata를 검증하고 generation row lock으로 최대 5개 제한을 직렬화한다. 그러나 lifecycle 경계는 불완전하다.

1. 토큰 발급 전에 DB 세션이 없어 업로드 후 confirm하지 않은 Blob을 찾을 수 없다.
2. Blob 경로가 checksum과 파일명으로 결정되어 `allowOverwrite=false` 상태에서 같은 파일 재업로드가 충돌한다.
3. `deleted_at`이 사용자 논리 삭제와 물리 삭제 완료를 동시에 의미한다.
4. worker claim이 live attachment row를 다시 읽어 queue 이후 입력이 바뀔 수 있다.
5. terminal cleanup이 실패한 generation의 retry input을 즉시 삭제할 수 있다.
6. cleanup이 durable lease, backoff, fencing token 없이 job claim의 부수효과로 실행된다.
7. API는 Retry를 무기한 노출하지만 Blob 보존기간은 정의하지 않는다.

## 4. Product Contract

### 4.1 Retry retention

- `completed`, `partial_failed`, `failed`가 된 시점을 `terminal_at`으로 기록한다.
- `retryable_until = terminal_at + 15 days`로 저장한다.
- 15일 안에는 immutable attachment snapshot의 Blob을 물리 삭제하지 않는다.
- 15일 안에 retry가 승인되면 retry job과 attachment snapshot을 같은 transaction에 고정한다. queued/processing job snapshot이 존재하는 동안 GC hold를 유지하고, retry 결과가 terminal이 될 때 새 15일 보존기간을 계산한다.
- retry 결과가 다시 terminal이 되면 그 시점부터 15일을 새로 계산한다.
- 15일 이후 UI는 Retry를 숨기거나 비활성화하고 만료 이유와 새 생성 안내를 표시한다.
- API는 만료된 retry에 `410 ai_content_attachment_retention_expired`를 반환한다.

### 4.2 Attachment mutation

- generation이 attachment input snapshot을 만들기 전에는 첨부 추가·삭제가 가능하다.
- 첫 consuming snapshot을 생성할 때 `attachments_locked_at`을 기록한다.
- lock 이후 token 발급, confirm, remove, attachment-bearing draft 수정은 `409 ai_content_attachments_locked`로 거절한다.
- 사용자 제거는 논리 삭제다. 물리 삭제는 snapshot 참조와 보존기간을 확인한 GC만 수행한다.
- 같은 파일 재업로드는 새 upload attempt UUID와 새 storage path를 사용한다.

## 5. Data Model

Migration은 `065_ai_content_attachment_upload_sessions.sql`을 사용한다. `059`와 `060`은 프로그램 계획에서 예약되어 있으므로 `065`는 이미 존재하는 `044`, `051`, `061`–`064`만 전제로 작성하고 fresh DB와 upgrade DB가 같은 schema에 도달하는지 검증한다.

### 5.1 `ai_content_attachment_upload_sessions`

각 token 발급 시도마다 하나의 row를 만든다.

Required fields:

- `id uuid primary key`
- `workspace_id`, `brand_id`, `generation_id`
- `created_by_user_id`
- `nonce`
- `status`: `pending | confirmed | cancelled | expired | failed`
- immutable expected metadata:
  - `role`
  - `file_name`
  - `mime_type`
  - `size_bytes`
  - `checksum`
- `storage_path`
- `token_expires_at`
- `confirmed_attachment_id`
- `confirmed_at`, `cancelled_at`, `created_at`, `updated_at`

Constraints:

- generation ownership은 `(generation_id, workspace_id, brand_id)` 복합 FK다.
- actor membership은 가능한 경우 기존 membership composite FK를 재사용한다.
- `storage_path`와 `nonce`는 unique다.
- `pending`은 confirm/cancel 시각과 attachment ID가 없어야 한다.
- `confirmed`는 attachment ID와 `confirmed_at`이 있어야 한다.
- `cancelled | expired`는 다시 confirm할 수 없다.
- legacy actor를 추정해서 채우지 않는다.

### 5.2 `ai_content_generation_attachments`

기존 사실 메타데이터와 `deleted_at`은 유지하되 물리 삭제 상태를 분리한다.

Additional fields:

- `upload_session_id`
- `deletion_reason`
- `physical_delete_status`: `none | pending | deleting | failed | deleted | dead_letter`
- `physical_delete_attempt_count`
- `physical_delete_next_attempt_at`
- `physical_delete_last_error`
- `physical_delete_lease_token`
- `physical_delete_lease_expires_at`
- `physically_deleted_at`

`deleted_at`은 UI와 live draft에서 제외되는 논리 삭제만 뜻한다. `physically_deleted_at`은 provider 삭제 성공 또는 provider의 verified not-found 이후에만 기록한다.

### 5.3 `ai_content_generations`

Additional fields:

- `attachments_locked_at`
- `generation_input_snapshot jsonb`
- `terminal_at`
- `retryable_until`

`generation_input_snapshot`은 모든 generation mode에서 사용하는 canonical immutable input이다. 기존 `subject_analysis_snapshot`은 read compatibility와 이전 retry 지원을 위해 유지하고 새 snapshot으로 점진 전환한다.

### 5.4 `ai_content_attachment_deletion_jobs`

generation 또는 workspace cascade가 cleanup 의무를 지우지 않도록 별도 deletion job table을 사용한다. job은 storage URL/path, tenant identity, attachment ID, deletion reason, lease, attempt, next-attempt, last-error, completion 시각을 자체 보유한다. parent row가 삭제돼도 provider 삭제 성공 또는 dead-letter 전까지 cleanup obligation이 남는다.

## 6. Storage Path and Upload Flow

New paths:

```text
workspaces/{workspaceId}/brands/{brandId}/ai-content/{generationId}/attachments/{sessionId}/{attemptId}/{safeFileName}
```

checksum은 검증 metadata이며 object identity가 아니다. ownership은 path 문자열에서 추론하지 않고 DB tenant scope로 확인한다.

Token flow:

```text
authenticated request
  -> validate UUID, membership, generation state, attachment policy
  -> lock generation
  -> count active pending + confirmed reservations
  -> insert pending upload session with DB expiry
  -> issue provider token for exact attempt path
  -> return session ID, nonce, token
```

- DB pending expiry는 10분이다.
- provider token은 9분으로 설정해 DB session이 먼저 만료된 상태에서 유효한 upload가 도착하지 않게 한다.
- token 생성 실패 시 session을 `failed`로 남겨 진단할 수 있게 한다.
- 최대 5개 제한은 pending reservation과 confirmed attachment를 함께 센다.

Confirm flow:

```text
confirm(sessionId, nonce)
  -> lock tenant-scoped pending session and generation
  -> reject expired/cancelled/foreign/locked generation
  -> read immutable expected metadata from DB
  -> verify provider Blob path, size, MIME, availability
  -> create confirmed attachment
  -> mark session confirmed
```

- client는 storage path, tenant ID, retention, deletion state를 결정하지 않는다.
- 동일 session의 동일 confirm replay는 기존 attachment를 반환한다.
- conflicting replay는 `409 ai_content_upload_confirmation_conflict`다.
- confirm과 expiry GC가 경쟁하면 row lock을 획득한 한쪽만 상태를 전이한다.

## 7. Immutable Snapshot and Worker Contract

Generation start transaction:

1. generation row를 lock한다.
2. active confirmed attachment를 ordered snapshot으로 만든다.
3. attachment ID, role, metadata, storage URL/path를 `generation_input_snapshot`에 저장한다.
4. `attachments_locked_at`을 기록한다.
5. output/job을 생성한다.

Worker claim과 retry는 live attachment table을 다시 읽지 않는다. job 생성 transaction에서 snapshot을 payload 또는 별도 job snapshot relation에 고정하고 worker는 그 값만 읽는다.

GC는 다음 attachment를 claim할 수 없다.

- `retryable_until > now()`
- queued/processing job snapshot이 참조
- attachment deletion hold가 활성
- physical deletion lease가 다른 worker에 의해 유지

## 8. Garbage Collection

GC는 AI worker claim의 부수효과가 아니다. central API가 secret-protected internal endpoint를 제공하고 외부 cron 또는 Ubuntu systemd timer가 호출한다.

첫 구현과 배포에서는:

- `AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=false`
- GC endpoint와 repository는 구현·테스트
- Ubuntu timer와 운영 env는 활성화하지 않음
- 운영 활성화는 Operations/rollout 계획에서 별도 승인

GC phases:

1. 만료된 pending upload session 처리
2. 논리 삭제됐고 snapshot 참조가 없는 confirmed attachment 처리
3. `retryable_until`이 지난 terminal generation attachment 처리
4. expired deletion lease 회수

Claim protocol:

- DB `now()`를 사용한다.
- `FOR UPDATE SKIP LOCKED`로 bounded batch를 claim한다.
- `deleting` 상태, lease token, lease expiry를 기록하고 commit한다.
- provider 삭제는 transaction 밖에서 실행한다.
- finalize는 같은 lease token으로 compare-and-set한다.
- provider not-found는 성공으로 처리한다.
- transient failure는 exponential backoff와 jitter로 재시도한다.
- permanent `401/403` 또는 최대 시도 초과는 `dead_letter`로 보낸다.

Defaults:

- batch 25, hard maximum 100
- provider timeout 15 seconds
- endpoint budget about 45 seconds
- retry backoff capped near one hour

## 9. Retry and GC Arbitration

Retry와 GC는 generation을 동일한 순서로 lock한다.

```text
retry:
  lock generation -> validate retryable_until -> ensure no committed deletion claim
  -> snapshot job input -> extend hold -> enqueue

GC:
  lock generation/attachment -> validate retention and no active job snapshot
  -> commit deletion claim -> remote delete -> fenced finalize
```

GC가 `deleting` claim을 commit한 뒤에는 retry가 실패한다. 외부 삭제가 시작된 뒤 claim을 취소하지 않는다. retry 만료 경계는 DB 시간으로 판단한다.

## 10. API and UI Errors

- `400 ai_content_upload_session_id_invalid`
- `400 ai_content_generation_id_invalid`
- `400 ai_content_attachment_id_invalid`
- `404 ai_content_generation_not_found`
- `404 ai_content_upload_session_not_found`
- `409 ai_content_upload_confirmation_conflict`
- `409 ai_content_attachment_limit_exceeded`
- `409 ai_content_attachments_locked`
- `410 ai_content_upload_session_expired`
- `410 ai_content_attachment_retention_expired`
- `422 ai_content_attachment_blob_unavailable`
- `422 ai_content_attachment_size_mismatch`
- `422 ai_content_attachment_mime_mismatch`
- `503 ai_content_attachment_storage_unavailable`

foreign-tenant ID는 존재하지 않는 ID와 같은 404를 반환한다. SQL UUID 오류를 노출하지 않는다.

UI는 다음을 표시한다.

- upload session 만료: 파일을 다시 선택하도록 안내
- 최대 5개: 기존 제한 문구 유지
- attachment lock: 새 generation에서 변경하도록 안내
- retry 만료: 새 생성 또는 파일 재업로드 안내
- storage 일시 오류: 현재 draft를 보존하고 재시도 제공

## 11. Migration and Rollout

Migration order:

1. nullable columns와 새 tables/indexes 생성
2. 기존 active attachment를 confirmed legacy row로 backfill
3. 기존 `deleted_at is not null` row는 physical state를 `pending/unknown`으로 둔다
4. terminal generation은 `terminal_at = coalesce(completed_at, updated_at)`
5. `retryable_until = terminal_at + interval '15 days'`
6. backfill 검증 후 check constraint를 추가

기존 `deleted_at`을 `physically_deleted_at`으로 복사하지 않는다. 과거 row가 논리 삭제인지 물리 삭제 완료인지 구분할 수 없기 때문이다. provider not-found를 성공으로 취급하는 idempotent GC가 legacy 상태를 수렴시킨다.

Rollout:

1. additive migration 배포
2. flag off 상태에서 dual-contract API/UI 배포
3. legacy 10분 token과 deployment skew가 끝날 때까지 old confirm 유지
4. GC가 legacy와 new session을 모두 처리할 수 있는지 canary 검증
5. new issuance flag 활성화
6. queue age, error, dead-letter를 관찰
7. old confirm 제거는 후속 release에서 수행

Migration rollback은 하지 않는다. flag를 끄는 것이 application rollback이며 cleanup obligation은 계속 보존한다.

## 12. Observability

각 GC run은 다음 구조화 지표를 남긴다.

- sessions scanned/claimed/confirmed/expired
- deletion claimed/succeeded/failed/retried
- lease reclaimed
- queue depth와 oldest pending age
- attempt-count buckets
- dead-letter count
- duration과 provider error category

Blob token, nonce, secret 원문은 로그에 남기지 않는다. oldest pending age 증가, 반복 실패, nonzero dead-letter에 alert를 연결한다.

## 13. Test Strategy

### Migration

- fresh DB, existing fixture upgrade, idempotent backfill
- future `059/060` 존재 여부와 무관하게 fresh/upgrade schema convergence
- legacy active/deleted/terminal/nonterminal rows
- composite tenant FK, state checks, partial indexes

### Repository and API

- five-file pending + confirmed reservation concurrency
- token/session actor and tenant scope
- unique same-file upload attempt paths
- confirm replay/conflict/expiry/cancel races
- generation lock and attachment mutation rejection
- malformed UUID 400 and foreign tenant 404
- retry immediately before, at, and after expiry
- retry vs GC lock ordering
- two GC callers claim once
- expired lease reclaim and stale fencing token rejection
- partial provider deletion, not-found replay, transient/permanent failure
- generation parent deletion does not erase cleanup obligation

### Worker

- original and retry job inputs use byte-for-byte equivalent attachment snapshot
- live row mutation cannot change queued job input
- missing retained Blob returns deterministic terminal error

### UI

- pending reservation and progress
- confirm replay after lost response
- locked attachment guidance
- retry deadline and expiration guidance
- draft preservation on storage failure

### Environment

- PGlite for migration and transaction contracts
- PostgreSQL 16/Testcontainers for `SKIP LOCKED`, leases, fencing, and concurrency
- Docker unavailable 시 PostgreSQL tests는 명시적으로 미검증 상태로 남기며 완료 처리하지 않는다.

## 14. Acceptance Criteria

- abandoned uploads are discoverable and eventually deleted
- same file can be uploaded again without overwriting a retained snapshot Blob
- at most five pending + confirmed attachments are reserved per generation
- attachment inputs become immutable at generation start
- retry before 15 days uses the original attachment snapshot
- retry at or after expiry fails honestly and is not shown as available
- GC never deletes a Blob referenced by a queued/processing job
- GC is idempotent across process crashes and duplicate cron calls
- logical deletion and physical deletion are independently observable
- failed deletion remains retryable or dead-lettered
- tenant and actor scope is enforced at every transition
- feature flag and GC scheduler remain disabled in the first Ubuntu rollout
