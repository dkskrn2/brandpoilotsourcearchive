# FAQ Suggestion Worker Design

- 작성일: 2026-08-02
- 상태: 사용자 승인 완료
- 기준 브랜치: `codex/dm-faq-ui-latest`
- 상위 설계: `2026-08-01-instagram-dm-faq-llm-control-design.md`
- 구현 범위: FAQ 자동 제안, 검토, 수정, 제외, 승인
- 배포 범위: 로컬 구현과 검증만 수행하며 push, 배포, 운영 DB 적용은 하지 않는다.

## 1. 목적

브랜드 센터의 승인된 정보에서 FAQ 후보를 비동기로 생성하고 사용자가 검토한 항목만 기존 활성 FAQ로 전환한다. FAQ 생성은 온보딩 워커와 분리하며 기존 DM 정확 일치 검색과 저장 답변 발송 경로를 그대로 사용한다.

이번 기능은 다음 사용자 흐름을 완성한다.

1. 사용자가 `브랜드 센터 > FAQ`에서 `FAQ 자동 제안`을 실행한다.
2. 실행 상태는 페이지를 벗어나도 유지된다.
3. 생성 결과는 검토 전용 제안 항목으로 표시된다.
4. 사용자는 카테고리, 질문, 답변을 수정하거나 항목을 제외할 수 있다.
5. 승인된 항목만 `knowledge_entries`의 활성 FAQ가 된다.
6. 활성화 직후 기존 `find_direct_faq_exact` 검색에서 사용할 수 있다.

## 2. 현재 구현에서 재사용할 것

기존 시스템에는 다음 기반이 이미 존재한다.

| 기존 기반 | 재사용 방식 |
|---|---|
| `knowledge_entries` | 승인된 FAQ의 최종 저장소로 유지 |
| FAQ `draft`, `active`, `inactive` 관리 API | 최종 FAQ 표시와 수동 관리 계약을 유지 |
| `find_direct_faq_exact` | 활성 FAQ의 결정적 검색 경로로 유지 |
| DM 작업자의 `direct_faq` 경로 | 저장된 FAQ 답변을 재작성하지 않고 발송 |
| 브랜드 코어, 제품·서비스, owned source, 업로드 문서 | FAQ 생성 입력으로 참조 |
| CLI 실행 및 작업 임대 패턴 | FAQ 전용 작업 레인에서 재사용 |
| 브랜드 센터 FAQ UI 프리뷰 | 실제 API 상태와 동작으로 교체 |

FAQ 검색, DM 발송, 대화 수집, 수동응답 로직은 이번 범위에서 다시 구현하지 않는다.

## 3. 범위

### 3.1 포함

- FAQ 제안 실행과 상태 복구
- FAQ 제안 입력 스냅샷과 지문 저장
- FAQ 제안 전용 작업 임대, 재시도, 실패 처리
- 엄격한 CLI 입력·출력 계약
- 제안 항목 검토, 수정, 제외, 승인
- 기존 FAQ와의 결정적 중복 검사
- 승인된 FAQ의 `knowledge_entries` 저장
- 브랜드 센터 UI의 실제 API 연결
- 테넌트 경계, 권한, 멱등성, 회귀 테스트

### 3.2 제외

- 온보딩 워커 수정
- 브랜드 분석 재실행
- LLM 답변 ON/OFF 설정
- 명시적 Wiki 생성 버튼 연결
- FAQ 의미 유사도 검색 임계값 변경
- DM 정책과 작업자 우선순위 변경
- 수동응답 변경
- FAQ 자동 승인
- 운영 마이그레이션 적용, push, 배포

## 4. 선택한 아키텍처

`brand-pilot-dm-worker` 패키지에 `faq` 전용 실행 모드를 추가한다. 이 패키지는 이미 DM과 Wiki 작업을 포함하지만 FAQ 실행은 기존 `runWorkerCycle`에 섞지 않는다. 프로세스를 `WORKER_MODE=faq`로 시작했을 때만 FAQ 제안 실행을 claim한다.

이 구조는 다음 경계를 가진다.

- 고객 API: 제안 실행 생성, 상태 조회, 사용자 편집과 승인
- FAQ 저장소: 실행과 제안 항목의 상태 및 테넌트 경계
- FAQ 작업 레인: 실행 claim, 입력 로딩, CLI 호출, 결과 검증과 저장
- 기존 Wiki 관리 저장소: 승인된 FAQ를 기존 관리 화면에 노출
- 기존 DM 경로: 활성 FAQ를 검색하고 저장 답변을 발송

FAQ 작업 레인은 온보딩 워커의 큐, 임대, 재시도, 상태에 의존하지 않는다. 두 기능은 승인된 브랜드 데이터만 공유한다.

## 5. 데이터 모델

### 5.1 `faq_suggestion_runs`

실행과 작업 임대의 단일 상태 원본이다. 일반 `jobs` 테이블에 같은 상태를 중복 저장하지 않는다.

필드:

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `status text not null`
- `input_fingerprint text not null`
- `source_snapshot_json jsonb not null`
- `attempt_count integer not null default 0`
- `max_attempts integer not null default 3`
- `available_at timestamptz not null default now()`
- `lease_owner text null`
- `lease_token uuid null`
- `lease_expires_at timestamptz null`
- `error_code text null`
- `created_by_user_id uuid not null`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

상태:

```text
queued -> running -> review_ready -> completed
                  -> partial
       -> failed
```

- `queued`, `running`: 작업자가 처리할 수 있는 상태
- `review_ready`: 모든 유효 제안이 검토 가능
- `partial`: 일부 결과만 검토 가능하고 나머지는 검증 실패
- `failed`: 재시도 한도를 소진했거나 복구 불가능
- `completed`: 모든 제안이 승인, 제외 또는 중복 처리됨

동일 브랜드에서 `queued` 또는 `running` 실행은 최대 하나만 허용한다. 실행 중 재요청은 새 행을 만들지 않고 기존 실행을 반환한다.

`source_snapshot_json`에는 원문 전체가 아니라 다음 식별 정보만 저장한다.

```json
{
  "contractVersion": "faq-suggestion-sources.v1",
  "sources": [
    {
      "sourceType": "brand_core|product_service|owned_snapshot|document|faq",
      "sourceId": "uuid",
      "contentHash": "sha256",
      "label": "사용자에게 표시할 출처명"
    }
  ]
}
```

`input_fingerprint`는 정렬된 source type, ID, content hash의 SHA-256이다.

### 5.2 `faq_suggestion_items`

제안 결과와 사용자 편집 상태를 저장한다.

필드:

- `id uuid primary key`
- `workspace_id uuid not null`
- `brand_id uuid not null`
- `run_id uuid not null`
- `position integer not null`
- `category text not null`
- `question text not null`
- `answer text not null`
- `evidence_json jsonb not null`
- `confidence double precision not null`
- `status text not null default 'review'`
- `duplicate_of_knowledge_entry_id uuid null`
- `approved_knowledge_entry_id uuid null`
- `reviewed_by_user_id uuid null`
- `reviewed_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

항목 상태:

- `review`: 수정, 승인, 제외 가능
- `approved`: 활성 FAQ로 전환 완료
- `dismissed`: 사용자가 제외
- `duplicate`: 기존 FAQ와 결정적으로 중복

질문은 1자 이상 500자 이하, 답변은 1자 이상 2,000자 이하로 제한한다. evidence는 1개 이상 5개 이하이며 실행의 입력 스냅샷에 포함된 source만 참조할 수 있다. confidence는 0 이상 1 이하이다.

### 5.3 FAQ 카테고리

다음 서버 enum만 허용한다.

- `service`
- `product`
- `price_payment`
- `location_visit`
- `hours`
- `shipping`
- `exchange_refund`
- `reservation_usage`
- `account_membership`
- `other`

화면에서는 각각 한국어 레이블을 사용한다.

## 6. 생성 입력

실행 생성 시점에 승인되거나 활성 상태인 자료만 스냅샷으로 고정한다.

- 활성 브랜드 코어
- 활성 제품·서비스 버전
- 사용 가능한 owned source snapshot
- 사용자가 등록하고 처리가 끝난 문서
- 기존 활성 FAQ

입력이 하나도 없으면 실행을 만들지 않고 `faq_suggestion_sources_missing`을 반환한다. 작업자는 claim 이후 source ID와 content hash를 다시 검증한다. source가 삭제되거나 hash가 바뀌면 해당 실행은 `faq_suggestion_source_changed`로 실패하고 최신 입력으로 다시 실행하도록 안내한다.

문서와 웹페이지의 지시는 데이터로 취급하며 CLI 시스템 지시를 변경할 수 없다.

## 7. CLI 계약

### 7.1 입력

```json
{
  "contractVersion": "faq-suggestion-input.v1",
  "brandId": "uuid",
  "categories": ["product", "shipping"],
  "sources": [
    {
      "sourceType": "product_service",
      "sourceId": "uuid",
      "label": "제품명",
      "content": "검증된 입력 내용"
    }
  ],
  "existingFaqs": [
    {
      "id": "uuid",
      "question": "기존 질문",
      "answer": "기존 답변"
    }
  ]
}
```

워크스페이스 ID, DB 자격증명, 내부 경로, 사용자 개인정보는 프롬프트에 넣지 않는다.

### 7.2 출력

```json
{
  "contractVersion": "faq-suggestion-result.v1",
  "suggestions": [
    {
      "category": "product",
      "question": "제품은 어떻게 구매하나요?",
      "answer": "공식 온라인 스토어에서 구매할 수 있습니다.",
      "evidence": [
        {
          "sourceType": "product_service",
          "sourceId": "uuid"
        }
      ],
      "confidence": 0.92
    }
  ]
}
```

서버는 결과를 저장하기 전에 다음을 검증한다.

- 계약 버전과 모든 enum이 정확하다.
- 질문과 답변 길이가 허용 범위다.
- evidence가 입력 source의 부분집합이다.
- 근거가 없는 가격, 위치, 운영시간, 환불 약속이 없다.
- 출력에 임의 URL, SQL, 작업 명령이 없다.
- 제안 개수는 실행당 최대 20개다.

계약 오류는 유효한 항목과 실패 항목을 구분할 수 있을 때 `partial`, 전체 결과를 신뢰할 수 없으면 `failed`로 처리한다.

## 8. API 계약

### 8.1 실행

```text
POST /brands/:brandId/faq-suggestions
```

- 새 실행 생성: `202 Accepted`
- 기존 실행 중: 기존 실행을 `200 OK`로 반환
- 입력 없음: `409 faq_suggestion_sources_missing`
- 권한 없음: `403`

```text
GET /brands/:brandId/faq-suggestions/latest
GET /brands/:brandId/faq-suggestions/:runId
```

latest가 없으면 `{ "run": null }`을 반환한다. 실행 상세에는 항목 목록이 position 순으로 포함된다.

### 8.2 편집

```text
PATCH /brands/:brandId/faq-suggestions/:runId/items/:itemId
```

요청:

```json
{
  "category": "product",
  "question": "수정한 질문",
  "answer": "수정한 답변",
  "expectedUpdatedAt": "ISO-8601"
}
```

`review` 상태에서만 수정할 수 있다. 낙관적 잠금이 실패하면 `409 faq_suggestion_item_conflict`를 반환한다.

### 8.3 승인과 제외

```text
POST /brands/:brandId/faq-suggestions/:runId/items/:itemId/approve
POST /brands/:brandId/faq-suggestions/:runId/items/:itemId/dismiss
```

두 동작은 멱등적이다. 승인 요청에는 `expectedUpdatedAt`을 포함한다.

승인 트랜잭션은 다음 순서로 처리한다.

1. 실행과 항목을 workspace, brand, run, item 범위로 잠근다.
2. 사용자가 수정한 최종 질문을 NFKC, 공백 축약, 소문자로 정규화한다.
3. 같은 브랜드의 모든 기존 FAQ에서 동일 normalized question을 확인한다.
4. 중복이면 항목을 `duplicate`로 전환하고 기존 FAQ ID를 기록한다.
5. 중복이 아니면 `knowledge_entries`에 활성 FAQ를 생성한다.
6. `origin`은 기존 허용값인 `manual`을 사용하고 `provenance_json`에 suggestion run, item, evidence를 기록한다.
7. `enabled = true`, `direct_reply_enabled = true`, `status = 'active'`, 승인자와 승인 시각을 기록한다.
8. `approved_knowledge_entry_id`를 기록하고 항목을 `approved`로 전환한다.
9. 모든 항목이 terminal 상태면 실행을 `completed`로 전환한다.

FAQ 제안 승인은 Wiki 빌드 요청이나 Wiki outbox 이벤트를 만들지 않는다. 직접 FAQ 검색은 `knowledge_entries`를 조회하므로 승인 즉시 사용할 수 있다.

## 9. 작업 임대와 재시도

FAQ worker는 하나의 실행을 다음 조건으로 claim한다.

- `queued`이며 `available_at <= now()`
- 또는 `running`이지만 lease가 만료됨
- `attempt_count < max_attempts`

claim은 `for update skip locked`와 lease token을 사용한다. 임대 시간은 60초이며 CLI 실행 중 주기적으로 heartbeat한다.

재시도 가능 오류:

- CLI timeout
- 일시적인 프로세스 실행 실패
- 임시 DB 연결 실패

재시도 불가 오류:

- source hash 변경
- 입력 계약 위반
- 출력 계약 전체 위반
- source tenant 불일치

재시도는 5초, 30초, 120초 간격을 사용하고 최대 3회 실행한다. 결과 저장은 run ID와 lease token을 모두 확인한 경우에만 허용한다.

## 10. UI 연결

현재 `FaqSuggestionPreviewPanel`을 서버 상태 기반 컴포넌트로 전환한다.

상태:

- 실행 없음: 입력 source 요약과 생성 버튼
- `queued`, `running`: 생성 중 표시, 버튼 비활성화, 2초 polling
- `review_ready`, `partial`: 제안 목록과 편집, 승인, 제외
- `failed`: 오류 코드에 대응하는 사용자 문구와 다시 실행
- `completed`: 처리 결과 요약과 새 제안 실행

polling은 실행이 terminal 상태가 되거나 컴포넌트가 unmount되면 중단한다. 항목 수정은 textarea blur 또는 명시적 저장 동작에서 PATCH하며 저장 중 다른 승인 동작을 비활성화한다.

기존 FAQ 목록은 그대로 유지하고 승인 후 다시 조회한다. 승인되지 않은 제안은 기존 Wiki 목록과 DM 검색에 나타나지 않는다.

## 11. 권한과 신뢰 경계

- 실행과 편집: 기존 Wiki author 권한
- 승인과 제외: 기존 Wiki approve 권한
- 모든 repository 쿼리: `workspace_id`, `brand_id` 필수
- run과 item 관계도 같은 workspace, brand 복합 FK로 강제
- CLI는 SQL, DB ID 조회, 임의 action을 결정하지 않는다.
- CLI가 반환한 ID는 실행 입력 스냅샷에 포함된 ID인지 서버가 검증한다.
- FAQ 답변은 승인 후에도 LLM으로 재작성하지 않는다.
- 오류 응답에 SQL, 프롬프트, 원문 문서, 스택, 자격증명을 포함하지 않는다.

## 12. 기존 기능에 대한 영향

### 변경하지 않는 것

- 온보딩 워커와 브랜드 분석 상태
- Instagram webhook 수신과 대화 aggregation
- `instagram_dm_settings.enabled`
- `find_direct_faq_exact`
- DM LLM Wiki 검색
- 수동응답과 상담 필요 처리
- 기존 수동 FAQ 생성과 수정 API

### 변경되는 것

- FAQ 제안용 DB 테이블과 repository
- FAQ 전용 worker mode
- 고객 API의 FAQ suggestion endpoint
- 브랜드 센터 FAQ 프리뷰의 실제 상태 연결

## 13. 오류 처리

| 오류 | 사용자 동작 | 시스템 동작 |
|---|---|---|
| 입력 source 없음 | 브랜드 정보 추가 안내 | 실행 생성 안 함 |
| 실행 중 중복 클릭 | 기존 실행 표시 | 신규 실행 안 함 |
| source 변경 | 다시 생성 안내 | 실행 실패, 결과 저장 안 함 |
| CLI timeout | 생성 중 상태 유지 | lease 기반 재시도 |
| 일부 제안 검증 실패 | 유효 항목 검토 | 실행 `partial` |
| 전체 결과 계약 실패 | 다시 생성 안내 | 실행 `failed` |
| 편집 충돌 | 최신 내용 다시 표시 | 변경 저장 안 함 |
| 기존 FAQ 중복 | 기존 FAQ 링크 표시 | 신규 FAQ 생성 안 함 |
| 승인 권한 없음 | 권한 안내 | 트랜잭션 시작 전 거부 |

## 14. 관측성

민감한 원문 없이 다음을 기록한다.

- 실행 ID, workspace ID, brand ID
- 실행 상태와 attempt count
- source 유형별 개수와 input fingerprint
- 생성 소요 시간
- 생성, 검증 실패, 중복, 승인, 제외 개수
- 오류 코드

기록하지 않는 정보:

- 고객 DM 전문
- 문서와 웹페이지 원문
- CLI 프롬프트 전문
- API 토큰과 DB 자격증명

## 15. 테스트 전략

### 계약

- 허용 카테고리와 길이 경계를 검증한다.
- evidence가 입력 source의 부분집합이 아니면 거부한다.
- 임의 URL, SQL 형태, 알 수 없는 필드를 거부한다.
- partial과 failed 판정을 구분한다.

### 저장소

- 실행 중 브랜드별 단일 실행을 보장한다.
- workspace와 brand가 다른 run 또는 item을 읽고 수정할 수 없다.
- lease claim, heartbeat, 만료 회수, retry 한도를 검증한다.
- 수정 충돌이 기존 값을 덮어쓰지 않는다.
- 승인 전 `knowledge_entries`에 FAQ가 생성되지 않는다.
- 승인 시 사용자 수정값이 저장된다.
- 중복 질문은 기존 FAQ를 덮어쓰지 않는다.
- 승인 시 Wiki 빌드 요청을 만들지 않는다.

### 작업자

- CLI를 한 번 호출하고 유효한 결과를 저장한다.
- 입력 source hash가 달라지면 CLI를 호출하지 않는다.
- timeout을 재시도한다.
- 잘못된 출력 ID와 근거 없는 결과를 저장하지 않는다.
- DM 및 Wiki worker cycle을 호출하지 않는다.

### API

- author와 approve 권한을 분리한다.
- 실행 중 재요청이 같은 run을 반환한다.
- latest와 run 상세이 테넌트 범위를 지킨다.
- 편집, 승인, 제외의 멱등성과 충돌 응답을 검증한다.

### UI

- 빈 상태, 생성 중, 검토, 부분 성공, 실패, 완료 상태를 표시한다.
- 페이지 재진입 시 latest 실행을 복구한다.
- 편집한 textarea 값이 저장되고 승인 요청에 반영된다.
- 승인 후 기존 FAQ 목록을 다시 불러온다.
- 기존 수동 FAQ 관리와 DM 수동응답 회귀 테스트가 통과한다.

## 16. 구현 및 배포 안전

구현을 시작하기 전에 현재 작업 트리를 최신 `origin/main` 위로 갱신한다. 현재 UI 변경은 별도 커밋으로 보존하고 과거 파일을 최신 코드 위에 복사하지 않는다. 충돌은 파일별로 검토한다.

이번 작업에서 허용되는 동작:

- 로컬 마이그레이션 파일 작성
- 로컬 PGlite/PostgreSQL 테스트 적용
- 로컬 API와 worker 실행
- 로컬 브라우저 검증

사용자 추가 승인 없이는 다음을 하지 않는다.

- 운영 DB 마이그레이션
- push, PR, merge
- Render 또는 기타 환경 배포
- 운영 worker mode 변경

## 17. 완료 기준

- 온보딩 워커를 변경하지 않고 FAQ 제안 작업이 실행된다.
- 같은 브랜드에서 실행 중인 제안은 하나뿐이다.
- 페이지를 나갔다 돌아와도 실행과 검토 상태가 복구된다.
- CLI 결과가 서버 계약과 source 범위 검증을 통과해야 저장된다.
- 사용자는 제안 질문과 답변을 수정, 제외, 승인할 수 있다.
- 승인 전 제안은 기존 FAQ 목록과 DM 검색에 나타나지 않는다.
- 승인된 FAQ는 기존 정확 일치 검색에서 즉시 사용할 수 있다.
- 승인 시 기존 FAQ를 덮어쓰거나 Wiki 빌드를 암묵적으로 실행하지 않는다.
- 기존 DM 자동응답, 대화, 수동응답 테스트가 유지된다.
- 전체 테스트와 빌드가 통과한다.
- push, 배포, 운영 DB 적용은 실행되지 않는다.
