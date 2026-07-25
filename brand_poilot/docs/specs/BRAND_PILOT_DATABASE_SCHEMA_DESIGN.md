# Brand Pilot Database Schema Design

작성일: 2026-07-06  
상태: 설계 초안 확정  
대상 DB: Local PostgreSQL -> Supabase Postgres  

## 1. 목적

이 문서는 Brand Pilot Managed Content Automation MVP의 데이터베이스 스키마를 정의한다.

초기 개발은 로컬 PostgreSQL에서 시작하고, 이후 Supabase Postgres로 이전한다. 따라서 스키마는 처음부터 Supabase와 호환되는 PostgreSQL 기능을 기준으로 설계한다.

## 2. 설계 원칙

1. 로컬 DB는 PostgreSQL을 사용한다.
2. Supabase 이전을 고려해 `uuid`, `jsonb`, `timestamptz`, partial index, row-level security 준비 구조를 사용한다.
3. 상태값은 PostgreSQL enum 대신 `text + check constraint`로 둔다. MVP 중 상태가 자주 추가될 수 있기 때문이다.
4. 모든 고객 데이터 테이블은 가능한 한 `workspace_id`, `brand_id`를 가진다.
5. 고객 토큰은 절대 평문 저장하지 않는다.
6. Redis 없이 `jobs` 테이블 기반 queue로 worker를 운영한다.
7. 대부분의 삭제는 hard delete가 아니라 `deleted_at`, `disabled_at`, `revoked_at`으로 처리한다.
8. 운영자 화면은 현재 제외지만, 실패 추적과 감사 로그는 DB에 남긴다.

## 3. 로컬 DB 운영 방식

권장 로컬 구성:

```text
Docker Compose
  - postgres:16
  - app/api
  - worker
```

권장 확장:

```sql
create extension if not exists pgcrypto;
```

`pgcrypto`는 `gen_random_uuid()` 사용을 위해 필요하다. Supabase에서도 사용할 수 있다.

로컬에서는 자체 `app_users` 테이블을 사용한다. Supabase 이전 시 `app_users.auth_user_id`를 `auth.users.id`와 연결한다.

## 4. 공통 컬럼 규칙

대부분의 테이블은 아래 컬럼을 가진다.

```text
id uuid primary key default gen_random_uuid()
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
deleted_at timestamptz null
```

실제 migration에서는 `updated_at` 자동 갱신 trigger를 추가한다.

금액, 비용, 사용량은 `numeric`을 사용한다. 날짜/시간은 전부 `timestamptz`를 사용한다. 게시 슬롯의 기준 시각처럼 날짜가 필요 없는 값만 `time`을 사용한다.

## 5. 테이블 그룹

```text
Tenant
  app_users
  workspaces
  workspace_members
  brands
  brand_profiles

Sources
  source_urls
  source_snapshots
  topic_uploads
  topic_rows

Generation
  content_topics
  master_drafts
  channel_outputs
  auto_approval_checks
  llm_runs

Review
  review_events
  regeneration_requests

Publishing
  publish_slots
  publish_queue
  publish_attempts
  storage_artifacts

Channels
  brand_channels
  channel_credentials
  webflow_mappings

Workers and Audit
  jobs
  audit_events
```

## 6. Tenant Tables

### 6.1 app_users

서비스 사용자 테이블이다. 로컬 개발에서는 자체 유저로 쓰고, Supabase 이전 후에는 `auth_user_id`로 Supabase Auth와 연결한다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 내부 사용자 ID |
| auth_user_id | uuid | no | Supabase `auth.users.id` |
| email | text | yes | 로그인 이메일 |
| display_name | text | no | 사용자명 |
| status | text | yes | `active`, `invited`, `disabled` |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

제약:

- `unique(email)`
- `unique(auth_user_id)` where `auth_user_id is not null`
- `status in ('active', 'invited', 'disabled')`

### 6.2 workspaces

고객 조직 단위다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 워크스페이스 ID |
| name | text | yes | 조직명 |
| slug | text | yes | URL/식별용 slug |
| status | text | yes | `active`, `suspended`, `disabled` |
| created_by_user_id | uuid | no | 생성 사용자 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

제약:

- `unique(slug)`
- `created_by_user_id references app_users(id)`

### 6.3 workspace_members

사용자와 워크스페이스의 멤버십이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 멤버십 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| user_id | uuid | yes | 사용자 |
| role | text | yes | `owner`, `admin`, `member` |
| status | text | yes | `active`, `invited`, `disabled` |
| invited_email | text | no | 초대 이메일 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

제약:

- `workspace_id references workspaces(id)`
- `user_id references app_users(id)`
- `unique(workspace_id, user_id)`
- `role in ('owner', 'admin', 'member')`

### 6.4 brands

실제 콘텐츠를 운영하는 브랜드 단위다. MVP UI는 단일 브랜드처럼 시작하지만 DB는 다중 브랜드를 허용한다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 브랜드 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| name | text | yes | 브랜드명 |
| status | text | yes | `active`, `paused`, `disabled` |
| timezone | text | yes | 기본 `Asia/Seoul` |
| created_by_user_id | uuid | no | 생성 사용자 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

제약:

- `workspace_id references workspaces(id)`
- `unique(workspace_id, name)` where `deleted_at is null`

### 6.5 brand_profiles

콘텐츠 생성의 기준이 되는 브랜드 설정이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 프로필 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| industry | text | no | 업종 |
| primary_customer | text | no | 핵심 고객 |
| description | text | no | 제품/서비스 설명 |
| tone | text | no | 톤앤매너 |
| forbidden_terms | jsonb | yes | 금지어/금지 문장 배열 |
| default_cta | text | no | 기본 CTA |
| main_link | text | no | 기본 링크 |
| auto_approval_enabled | boolean | yes | 브랜드 전체 자동 승인 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `brand_id references brands(id)`
- `unique(brand_id)`
- `forbidden_terms default '[]'::jsonb`
- `auto_approval_enabled default false`

## 7. Source Tables

### 7.1 source_urls

자사 URL과 외부 참고 URL을 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | URL ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| source_type | text | yes | `owned`, `reference` |
| url | text | yes | 원본 URL |
| url_hash | text | yes | 정규화 URL hash |
| domain | text | no | 도메인 |
| title | text | no | 최근 추출 제목 |
| meta_description | text | no | 메타 설명 |
| status | text | yes | `active`, `crawling`, `crawled`, `crawl_failed`, `disabled` |
| enabled | boolean | yes | 생성에 사용 여부 |
| last_crawled_at | timestamptz | no | 마지막 크롤링 |
| last_error | text | no | 최근 오류 |
| disabled_at | timestamptz | no | 비활성화 일시 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

제약:

- `brand_id references brands(id)`
- `source_type in ('owned', 'reference')`
- `status in ('active', 'crawling', 'crawled', 'crawl_failed', 'disabled')`
- `unique(brand_id, source_type, url_hash)` where `deleted_at is null`

인덱스:

- `(brand_id, source_type, status)`
- `(brand_id, enabled)`

### 7.2 source_snapshots

크롤링 결과 스냅샷이다. 콘텐츠 생성 근거와 감사에 사용한다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 스냅샷 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| source_url_id | uuid | yes | 원본 URL |
| status | text | yes | `succeeded`, `failed` |
| fetched_at | timestamptz | yes | 가져온 시각 |
| http_status | int | no | HTTP status |
| content_hash | text | no | 본문 hash |
| raw_text | text | no | 추출 원문 텍스트 |
| extracted_title | text | no | 추출 제목 |
| extracted_text | text | no | 정제 본문 |
| summary | text | no | 생성용 요약 |
| metadata | jsonb | yes | 크롤링 메타데이터 |
| error_message | text | no | 실패 사유 |
| created_at | timestamptz | yes | 생성일 |

제약:

- `source_url_id references source_urls(id)`
- `status in ('succeeded', 'failed')`
- `metadata default '{}'::jsonb`

인덱스:

- `(source_url_id, fetched_at desc)`
- `(brand_id, status, fetched_at desc)`

### 7.3 topic_uploads

CSV/Excel 주제표 업로드 작업 단위다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 업로드 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| storage_artifact_id | uuid | no | 원본 파일 artifact |
| file_name | text | yes | 파일명 |
| file_mime_type | text | no | MIME |
| status | text | yes | `uploaded`, `validating`, `validated`, `applied`, `failed` |
| total_rows | int | yes | 총 행 수 |
| valid_rows | int | yes | 유효 행 수 |
| duplicate_rows | int | yes | 중복 행 수 |
| invalid_rows | int | yes | 유효하지 않은 행 수 |
| error_message | text | no | 실패 사유 |
| created_by_user_id | uuid | no | 업로드 사용자 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `brand_id references brands(id)`
- `storage_artifact_id references storage_artifacts(id)`
- row count 컬럼은 `default 0`

### 7.4 topic_rows

주제표의 개별 행이다. 한 행은 한 번만 사용한다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 주제 행 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| topic_upload_id | uuid | yes | 업로드 ID |
| row_number | int | yes | 파일 내 행 번호 |
| status | text | yes | `uploaded`, `queued`, `used`, `skipped`, `invalid`, `failed`, `disabled` |
| topic_title | text | yes | 주제 제목 |
| topic_angle | text | yes | 관점 |
| target_customer | text | no | 대상 고객 |
| region | text | no | 지역 |
| season | text | no | 시즌 |
| reference_url | text | no | 참고 URL |
| priority | int | yes | 우선순위 |
| notes | text | no | 메모 |
| topic_key | text | yes | 중복 판단 key |
| validation_errors | jsonb | yes | 검증 오류 배열 |
| queued_at | timestamptz | no | 생성 후보 선택 시각 |
| used_at | timestamptz | no | 사용 완료 시각 |
| disabled_at | timestamptz | no | 비활성화 시각 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `topic_upload_id references topic_uploads(id)`
- `unique(topic_upload_id, row_number)`
- `unique(brand_id, topic_key)` where `status not in ('invalid', 'disabled')`
- `priority default 0`
- `validation_errors default '[]'::jsonb`

인덱스:

- `(brand_id, status, priority desc, created_at asc)`
- `(brand_id, used_at desc)`

## 8. Generation Tables

### 8.1 content_topics

콘텐츠 생성 대상으로 선택된 주제다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 콘텐츠 주제 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| topic_row_id | uuid | no | 원본 주제 행 |
| title | text | yes | 생성 주제 제목 |
| angle | text | yes | 생성 관점 |
| status | text | yes | `selected`, `generating`, `generated`, `failed`, `cancelled` |
| source_context | jsonb | yes | 사용한 URL/snapshot 요약 |
| selected_at | timestamptz | yes | 선택 시각 |
| generated_at | timestamptz | no | 생성 완료 시각 |
| error_message | text | no | 실패 사유 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `topic_row_id references topic_rows(id)`
- `source_context default '{}'::jsonb`

### 8.2 master_drafts

채널별 콘텐츠로 변환하기 전의 중심 원고다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 마스터 초안 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| content_topic_id | uuid | yes | 콘텐츠 주제 |
| status | text | yes | `generated`, `failed`, `superseded` |
| prompt_version | text | yes | 프롬프트 버전 |
| draft_json | jsonb | yes | 구조화 초안 |
| source_snapshot_refs | jsonb | yes | 사용 snapshot ID 목록 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `content_topic_id references content_topics(id)`
- `draft_json default '{}'::jsonb`
- `source_snapshot_refs default '[]'::jsonb`

### 8.3 channel_outputs

Instagram, Threads, Webflow별 최종 결과물이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 채널 결과물 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| content_topic_id | uuid | yes | 콘텐츠 주제 |
| master_draft_id | uuid | yes | 마스터 초안 |
| channel | text | yes | `instagram`, `threads`, `webflow` |
| status | text | yes | 검토 상태 |
| title | text | yes | 내부 표시 제목 |
| preview_title | text | no | 미리보기 제목 |
| preview_body | text | no | 미리보기 본문 |
| output_json | jsonb | yes | 채널별 구조화 결과 |
| rendered_artifact_id | uuid | no | 렌더링 이미지/아티팩트 |
| source_summary | text | no | 생성 근거 요약 |
| block_reasons | jsonb | yes | 자동 승인 차단 사유 |
| generated_at | timestamptz | yes | 생성 시각 |
| approved_at | timestamptz | no | 승인 시각 |
| rejected_at | timestamptz | no | 거절 시각 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

`status` 값:

```text
pending_review
approved
auto_approved
auto_approval_blocked
rejected
regenerating
regenerated
```

제약:

- `content_topic_id references content_topics(id)`
- `master_draft_id references master_drafts(id)`
- `rendered_artifact_id references storage_artifacts(id)`
- `channel in ('instagram', 'threads', 'webflow')`
- `unique(master_draft_id, channel)` where `status != 'regenerated'`
- `output_json default '{}'::jsonb`
- `block_reasons default '[]'::jsonb`

인덱스:

- `(brand_id, channel, status, generated_at desc)`
- `(brand_id, status, generated_at desc)`

### 8.4 auto_approval_checks

자동 승인 검사 결과다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 검사 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel_output_id | uuid | yes | 채널 결과물 |
| status | text | yes | `passed`, `blocked`, `skipped` |
| policy_version | text | yes | 정책 버전 |
| reasons | jsonb | yes | 차단/통과 사유 |
| checks_json | jsonb | yes | 세부 검사 결과 |
| checked_at | timestamptz | yes | 검사 시각 |
| created_at | timestamptz | yes | 생성일 |

제약:

- `channel_output_id references channel_outputs(id)`
- `status in ('passed', 'blocked', 'skipped')`
- `reasons default '[]'::jsonb`
- `checks_json default '{}'::jsonb`

### 8.5 llm_runs

LLM 호출 비용, 프롬프트 버전, 결과 추적용 로그다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | LLM 실행 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | no | 브랜드 |
| job_id | uuid | no | 실행 job |
| content_topic_id | uuid | no | 콘텐츠 주제 |
| channel_output_id | uuid | no | 채널 결과물 |
| purpose | text | yes | `source_summary`, `master_draft`, `channel_output`, `regeneration`, `policy_check` |
| provider | text | yes | 예: `openai` |
| model | text | yes | 모델명 |
| prompt_version | text | yes | 프롬프트 버전 |
| status | text | yes | `succeeded`, `failed` |
| input_tokens | int | yes | 입력 토큰 |
| output_tokens | int | yes | 출력 토큰 |
| cost_usd | numeric(12,6) | yes | 추정 비용 |
| request_metadata | jsonb | yes | 민감정보 제외 요청 메타 |
| response_metadata | jsonb | yes | 민감정보 제외 응답 메타 |
| error_message | text | no | 실패 사유 |
| started_at | timestamptz | yes | 시작 시각 |
| finished_at | timestamptz | no | 종료 시각 |
| created_at | timestamptz | yes | 생성일 |

주의:

- 전체 prompt 원문과 고객 토큰은 저장하지 않는다.
- 재현이 필요한 결과물은 `channel_outputs.output_json` 또는 `storage_artifacts`에 저장한다.

## 9. Review Tables

### 9.1 review_events

승인, 자동 승인, 거절, 재생성 요청 등 검토 이벤트 이력이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 이벤트 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel_output_id | uuid | yes | 채널 결과물 |
| actor_user_id | uuid | no | 사용자 actor |
| actor_type | text | yes | `user`, `system`, `worker` |
| event_type | text | yes | 이벤트 타입 |
| reason | text | no | 사유 |
| metadata | jsonb | yes | 추가 정보 |
| created_at | timestamptz | yes | 생성일 |

`event_type` 값:

```text
approved
auto_approved
auto_approval_blocked
rejected
regenerate_requested
status_changed
publish_queue_created
```

제약:

- `channel_output_id references channel_outputs(id)`
- `actor_user_id references app_users(id)`
- `metadata default '{}'::jsonb`

### 9.2 regeneration_requests

직접 편집 대신 재생성을 요청한 기록이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 재생성 요청 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel_output_id | uuid | yes | 기존 결과물 |
| requested_by_user_id | uuid | no | 요청 사용자 |
| reason | text | yes | 재생성 사유 |
| status | text | yes | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| job_id | uuid | no | 재생성 job |
| replacement_output_id | uuid | no | 새 결과물 |
| error_message | text | no | 실패 사유 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `channel_output_id references channel_outputs(id)`
- `replacement_output_id references channel_outputs(id)`

## 10. Channel Tables

### 10.1 brand_channels

브랜드별 채널 연결 상태다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 브랜드 채널 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel | text | yes | `instagram`, `threads`, `webflow` |
| status | text | yes | 연결 상태 |
| account_label | text | no | 표시 계정명 |
| external_account_id | text | no | 외부 계정 ID |
| enabled | boolean | yes | 채널 사용 여부 |
| last_healthy_at | timestamptz | no | 마지막 정상 확인 |
| last_published_at | timestamptz | no | 마지막 게시 성공 |
| last_error | text | no | 최근 오류 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

`status` 값:

```text
not_connected
connected
needs_attention
expired
insufficient_permissions
mapping_required
publish_failed
```

제약:

- `brand_id references brands(id)`
- `unique(brand_id, channel)` where `deleted_at is null`

### 10.2 channel_credentials

채널별 토큰/API 정보 저장소다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | credential ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| brand_channel_id | uuid | yes | 브랜드 채널 |
| provider | text | yes | `meta`, `webflow` |
| credential_type | text | yes | `oauth`, `api_token` |
| encrypted_payload | text | yes | 암호화된 credential JSON |
| masked_display | text | no | UI 표시용 마스킹 값 |
| scopes | text[] | yes | 승인 scope |
| expires_at | timestamptz | no | 토큰 만료 |
| status | text | yes | `active`, `expired`, `revoked`, `invalid` |
| last_checked_at | timestamptz | no | 마지막 확인 |
| rotated_at | timestamptz | no | 교체 시각 |
| revoked_at | timestamptz | no | 폐기 시각 |
| created_by_user_id | uuid | no | 생성 사용자 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

제약:

- `brand_channel_id references brand_channels(id)`
- `scopes default '{}'::text[]`
- active credential은 채널별 하나만 허용한다.

인덱스:

- unique partial index: `(brand_channel_id)` where `revoked_at is null`
- `(brand_id, status, expires_at)`

보안:

- `encrypted_payload`에는 OAuth access token, refresh token, API token 등을 JSON으로 넣되 애플리케이션 계층에서 암호화한다.
- 암호화 master key는 `CREDENTIALS_ENCRYPTION_KEY` 환경변수로 관리한다.
- UI에는 `masked_display`만 보여준다.

### 10.3 webflow_mappings

Webflow CMS 필드 매핑이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 매핑 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| brand_channel_id | uuid | yes | Webflow 채널 |
| site_id | text | yes | Webflow Site ID |
| collection_id | text | yes | Webflow Collection ID |
| field_map | jsonb | yes | 내부 필드 -> Webflow 필드 |
| status | text | yes | `valid`, `invalid`, `not_checked` |
| last_validated_at | timestamptz | no | 마지막 검증 |
| last_error | text | no | 최근 오류 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

필수 `field_map` 키:

```json
{
  "title": "name",
  "slug": "slug",
  "summary": "post-summary",
  "body": "post-body",
  "meta_title": "meta-title",
  "meta_description": "meta-description",
  "cover_image": "main-image"
}
```

제약:

- `brand_channel_id references brand_channels(id)`
- `unique(brand_channel_id)`
- `field_map default '{}'::jsonb`

## 11. Publishing Tables

### 11.1 publish_slots

브랜드/채널별 게시 슬롯 정책이다. MVP 기본값은 채널별 하루 4개다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 슬롯 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel | text | yes | 채널 |
| slot_number | int | yes | 1-4 |
| base_time | time | yes | 기준 시간 |
| jitter_minutes | int | yes | 지터 분 |
| enabled | boolean | yes | 사용 여부 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

기본 슬롯:

| slot_number | base_time | jitter_minutes |
|---:|---|---:|
| 1 | 11:30:00 | 10 |
| 2 | 14:30:00 | 10 |
| 3 | 17:30:00 | 10 |
| 4 | 20:30:00 | 10 |

제약:

- `unique(brand_id, channel, slot_number)`
- `slot_number between 1 and 4`

### 11.2 publish_queue

승인 또는 자동 승인된 콘텐츠의 게시 큐다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 큐 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| channel_output_id | uuid | yes | 게시할 결과물 |
| brand_channel_id | uuid | yes | 게시 채널 |
| channel | text | yes | 채널 |
| status | text | yes | 게시 상태 |
| approval_type | text | yes | `manual`, `auto` |
| priority | int | yes | 우선순위 |
| slot_date | date | no | 배정 날짜 |
| slot_number | int | no | 슬롯 번호 |
| scheduled_for | timestamptz | no | 실제 예정 시각 |
| queued_at | timestamptz | yes | 큐 진입 시각 |
| publishing_started_at | timestamptz | no | 게시 시작 |
| published_at | timestamptz | no | 게시 완료 |
| failed_at | timestamptz | no | 실패 시각 |
| deferred_until | timestamptz | no | 이월 시각 |
| idempotency_key | text | yes | 중복 게시 방지 키 |
| last_error | text | no | 최근 오류 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

`status` 값:

```text
queued
scheduled
publishing
published
failed
deferred
cancelled
```

제약:

- `channel_output_id references channel_outputs(id)`
- `brand_channel_id references brand_channels(id)`
- `approval_type in ('manual', 'auto')`
- `unique(channel_output_id)`
- `unique(idempotency_key)`

인덱스:

- `(brand_id, channel, status, scheduled_for)`
- `(status, scheduled_for)` where `status in ('scheduled', 'deferred')`

### 11.3 publish_attempts

실제 외부 API 호출 이력이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 시도 ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | yes | 브랜드 |
| publish_queue_id | uuid | yes | 게시 큐 |
| attempt_number | int | yes | 시도 번호 |
| status | text | yes | `running`, `succeeded`, `failed` |
| request_metadata | jsonb | yes | 민감정보 제외 요청 메타 |
| response_metadata | jsonb | yes | 응답 메타 |
| external_post_id | text | no | 외부 게시물 ID |
| external_url | text | no | 게시 URL |
| error_code | text | no | 오류 코드 |
| error_message | text | no | 오류 메시지 |
| started_at | timestamptz | yes | 시작 시각 |
| finished_at | timestamptz | no | 종료 시각 |
| created_at | timestamptz | yes | 생성일 |

제약:

- `publish_queue_id references publish_queue(id)`
- `unique(publish_queue_id, attempt_number)`

### 11.4 storage_artifacts

업로드 파일, 렌더링 이미지, 생성 결과 manifest 등 파일성 객체의 메타데이터다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | artifact ID |
| workspace_id | uuid | yes | 워크스페이스 |
| brand_id | uuid | no | 브랜드 |
| artifact_type | text | yes | 파일 유형 |
| bucket | text | yes | storage bucket |
| path | text | yes | storage path |
| public_url | text | no | 공개 URL |
| mime_type | text | no | MIME |
| byte_size | bigint | no | 크기 |
| checksum | text | no | checksum |
| expires_at | timestamptz | no | 만료/삭제 예정 |
| created_by_user_id | uuid | no | 생성 사용자 |
| created_at | timestamptz | yes | 생성일 |
| deleted_at | timestamptz | no | 삭제 처리일 |

`artifact_type` 값:

```text
topic_upload
brand_asset
rendered_image
generated_manifest
cover_image
source_archive
```

권장 bucket:

| bucket | 공개 여부 | 용도 |
|---|---|---|
| topic-uploads | private | CSV/Excel 원본 |
| brand-assets | private | 브랜드 로고/이미지 |
| rendered-content | public | Instagram/Threads 게시 이미지 |
| generated-artifacts | private | manifest/생성 결과 백업 |

제약:

- `unique(bucket, path)`

## 12. Worker and Audit Tables

### 12.1 jobs

Postgres table-backed queue다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | job ID |
| workspace_id | uuid | no | 워크스페이스 |
| brand_id | uuid | no | 브랜드 |
| job_type | text | yes | 작업 유형 |
| status | text | yes | job 상태 |
| payload_json | jsonb | yes | 작업 payload |
| priority | int | yes | 우선순위 |
| run_at | timestamptz | yes | 실행 가능 시각 |
| attempt_count | int | yes | 시도 횟수 |
| max_attempts | int | yes | 최대 시도 |
| locked_until | timestamptz | no | lock 만료 |
| locked_by | text | no | worker ID |
| last_error | text | no | 최근 오류 |
| started_at | timestamptz | no | 시작 시각 |
| finished_at | timestamptz | no | 종료 시각 |
| created_at | timestamptz | yes | 생성일 |
| updated_at | timestamptz | yes | 수정일 |

`job_type` 값:

```text
daily_generation_enqueue
source_crawl
topic_select
master_draft_generate
channel_output_generate
auto_approval_check
instagram_render
artifact_upload
webflow_publish
instagram_publish
threads_publish
token_health_check
storage_cleanup
```

`status` 값:

```text
queued
running
succeeded
failed
dead
cancelled
```

인덱스:

- `(status, run_at, priority desc, created_at asc)` where `status = 'queued'`
- `(locked_until)` where `status = 'running'`
- `(brand_id, job_type, status, created_at desc)`

Worker lock 규칙:

```sql
select *
from jobs
where status = 'queued'
  and run_at <= now()
order by priority desc, created_at asc
for update skip locked
limit 1;
```

Worker는 선택한 job을 `running`으로 바꾸고 `locked_until`을 설정한다. 실패 시 `attempt_count`를 증가시키고, 재시도 가능하면 `queued`, 한도를 넘으면 `dead`로 바꾼다.

### 12.2 audit_events

사용자/시스템/worker의 주요 변경 이력이다.

| 컬럼 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| id | uuid | yes | 이벤트 ID |
| workspace_id | uuid | no | 워크스페이스 |
| brand_id | uuid | no | 브랜드 |
| actor_user_id | uuid | no | 사용자 actor |
| actor_type | text | yes | `user`, `system`, `worker` |
| event_type | text | yes | 이벤트명 |
| entity_type | text | yes | 대상 테이블/도메인 |
| entity_id | uuid | no | 대상 ID |
| before_json | jsonb | no | 변경 전 |
| after_json | jsonb | no | 변경 후 |
| metadata | jsonb | yes | 추가 정보 |
| created_at | timestamptz | yes | 생성일 |

제약:

- `actor_user_id references app_users(id)`
- `metadata default '{}'::jsonb`

인덱스:

- `(workspace_id, created_at desc)`
- `(brand_id, created_at desc)`
- `(entity_type, entity_id, created_at desc)`

## 13. 핵심 유니크/중복 방지 정책

### 13.1 URL 중복

`source_urls`는 정규화된 URL hash 기준으로 브랜드 내 중복 등록을 막는다.

```text
unique(brand_id, source_type, url_hash)
```

### 13.2 주제 행 중복

`topic_title + topic_angle`을 정규화한 `topic_key`로 중복을 막는다.

```text
unique(brand_id, topic_key)
```

사용 완료된 주제도 같은 key로 다시 자동 사용하지 않는다. 같은 주제를 다시 쓰려면 의도적으로 제목 또는 관점을 다르게 업로드해야 한다.

### 13.3 게시 중복

하나의 `channel_output`은 하나의 `publish_queue` 항목만 가진다.

```text
unique(channel_output_id)
unique(idempotency_key)
```

외부 API 재시도는 `publish_attempts`로 남기되, 같은 콘텐츠를 새 게시물로 중복 발행하지 않는다.

## 14. 주요 데이터 흐름

### 14.1 URL 등록과 크롤링

```text
source_urls
  -> jobs(source_crawl)
  -> source_snapshots
  -> source_urls.last_crawled_at/status 갱신
```

### 14.2 주제표 업로드

```text
storage_artifacts(topic_upload)
  -> topic_uploads
  -> topic_rows
```

### 14.3 매일 10시 생성

```text
jobs(daily_generation_enqueue)
  -> topic_rows(status=uploaded)
  -> content_topics
  -> master_drafts
  -> channel_outputs
  -> auto_approval_checks
```

### 14.4 승인 후 게시 큐

```text
channel_outputs(status=approved or auto_approved)
  -> review_events
  -> publish_queue(status=queued)
  -> publish_queue(status=scheduled)
  -> jobs(channel_publish)
  -> publish_attempts
```

## 15. Supabase 이전 준비

### 15.1 Auth 연결

로컬:

```text
app_users.id
```

Supabase 이전:

```text
app_users.auth_user_id -> auth.users.id
```

애플리케이션은 내부적으로 계속 `app_users.id`를 사용할 수 있다. Supabase session의 user id를 받은 뒤 `app_users.auth_user_id`로 내부 user를 찾는다.

### 15.2 RLS 준비

RLS는 Supabase 이전 시 아래 원칙으로 적용한다.

고객-facing 테이블:

```sql
workspace_id in (
  select workspace_id
  from workspace_members
  where user_id = current_app_user_id()
    and status = 'active'
)
```

Worker/API service role:

- service role은 RLS를 우회하거나 별도 secure RPC를 사용한다.
- 고객 토큰 복호화는 브라우저가 아니라 서버/worker에서만 수행한다.

### 15.3 Storage 이전

DB는 파일 자체를 저장하지 않고 `storage_artifacts`에 메타데이터만 저장한다.

Supabase Storage 이전 시 bucket 이름은 그대로 유지한다.

```text
topic-uploads
brand-assets
rendered-content
generated-artifacts
```

## 16. Migration 파일 계획

권장 migration 순서:

```text
001_extensions.sql
002_common_triggers.sql
003_tenant_tables.sql
004_storage_artifacts.sql
005_source_tables.sql
006_channel_tables.sql
007_generation_tables.sql
008_review_tables.sql
009_publish_tables.sql
010_jobs_and_audit.sql
011_seed_publish_slots.sql
012_rls_supabase_prepare.sql
```

초기 로컬 구현에서는 `012_rls_supabase_prepare.sql`을 비활성으로 두고, Supabase 이전 시 활성화한다.

## 17. MVP 구현 우선순위

1. Tenant tables
2. Brand profile
3. Source URL / topic upload / topic rows
4. Channel connection / Webflow mapping
5. Content topic / master draft / channel outputs
6. Review events
7. Publish queue / attempts
8. Jobs
9. LLM runs / audit events
10. Supabase RLS

## 18. 설계상 제외한 것

MVP DB에서 제외한다.

- 결제/요금제
- 성과 분석 대시보드
- 댓글/DM
- 광고 집행
- A/B 테스트
- 여러 언어별 운영 정책
- 고객이 직접 게시 시간을 변경하는 캘린더 편집

이 항목들은 별도 제품 범위가 확정된 뒤 추가한다.

## 19. 자체 검토

검토 결과:

- 로컬 PostgreSQL에서 시작할 수 있다.
- Supabase Postgres로 옮길 때 타입과 주요 기능이 호환된다.
- 고객별 멀티테넌시를 위해 주요 테이블에 `workspace_id`, `brand_id`를 포함했다.
- 고객 토큰은 암호화 저장 전제로 설계했다.
- 브랜드 전체 자동 승인 on/off와 자동 승인 차단 사유를 저장할 수 있다.
- Instagram 정방형 카드뉴스 렌더링 아티팩트를 저장할 수 있다.
- Webflow 필드 매핑과 게시 실패를 추적할 수 있다.
- Postgres table-backed queue로 worker 실행과 재시도를 관리할 수 있다.
- 게시 중복 방지를 위한 unique key와 idempotency key를 포함했다.
- 운영자 화면은 제외했지만, 운영 로그와 audit data는 남길 수 있다.
