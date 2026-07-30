# Webflow Removal and Content Output Status Design

작성일: 2026-07-16
상태: 확정
범위: Webflow 런타임 제거, 콘텐츠 결과물 상태 생명주기 분리

## 1. 목적

Webflow는 현재 지원 채널에서 제거됐지만 이후 멀티채널 기반 작업에서 채널 카탈로그와 DB 제약에 다시 추가됐다. 그 결과 매일 생성 배치가 처리할 수 없는 Webflow 결과물을 만들고 `auto_approval_blocked` 상태로 영구 누적하고 있다.

동시에 `auto_approval_blocked`가 콘텐츠 생성 대기와 실제 자동 승인 차단을 함께 표현해 검토 건수와 운영 상태를 왜곡한다. 이번 변경은 Webflow 런타임 데이터를 물리 삭제하고 콘텐츠 생성 상태와 검토 상태를 분리한다.

## 2. 결정 사항

### 2.1 Webflow 제거 범위

다음 런타임 요소에서 Webflow를 제거한다.

- 채널 타입과 채널 카탈로그
- OAuth 제공자와 연결 UI
- 신규 가입 시 생성되는 기본 채널
- 콘텐츠 생성 결과와 delivery format
- 게시 어댑터와 게시 관리 UI
- 성과 수집 채널과 대시보드
- DB 채널 및 delivery format 제약
- 운영 중인 Webflow 채널, 자격증명, 결과물, 게시 데이터, 성과 데이터
- 현재 기준 아키텍처와 제품 명세

과거 설계안과 프로토타입은 개발 이력으로 보존한다. 현재 기준 문서에는 Webflow가 지원되지 않는다고 명시한다.

### 2.2 기존 데이터 처리

신규 파괴적 마이그레이션을 추가한다. 마이그레이션은 참조 무결성을 지키는 순서로 Webflow 데이터를 삭제한 뒤 관련 CHECK 제약을 Webflow 없는 채널 목록으로 다시 만든다.

삭제 대상은 다음과 같다.

- Webflow `publish_attempts`와 `publish_queue`
- Webflow `jobs`와 `channel_outputs`
- Webflow 성과 스냅샷과 수집 작업
- Webflow 자격증명과 `brand_channels`
- 남아 있는 Webflow 전용 매핑 데이터

마이그레이션은 재실행 가능해야 하며, Webflow 외 채널 데이터는 변경하지 않는다.

## 3. 콘텐츠 상태 모델

`channel_outputs.status`는 다음 상태만 사용한다.

| 상태 | 의미 | 사용자 액션 |
|---|---|---|
| `generating` | 생성 작업이 대기 또는 실행 중 | 없음 |
| `generation_failed` | 생성 작업이 최종 실패 | 재생성 또는 거절 |
| `pending_review` | 결과물 완성, 사용자 검토 필요 | 승인, 재생성, 거절 |
| `auto_approval_blocked` | 결과물 완성, 자동 승인 정책 또는 검증만 실패 | 수동 승인, 재생성, 거절 |
| `approved` | 사용자가 승인함 | 없음 |
| `auto_approved` | 자동 승인됨 | 없음 |
| `rejected` | 사용자가 거절함 | 없음 |
| `regenerating` | 재생성 작업이 진행 중 | 없음 |
| `regenerated` | 새 결과물로 대체된 과거 결과 | 없음, 기본 목록에서 숨김 |

### 3.1 생성 전환

```text
주제 선택
  -> generating
  -> 생성 성공 + 자동 승인 ON + 검증 통과: auto_approved
  -> 생성 성공 + 자동 승인 OFF: pending_review
  -> 생성 성공 + 자동 승인 검증 실패: auto_approval_blocked
  -> 생성 최종 실패: generation_failed
```

작업 재시도 중에는 `generating`을 유지한다. 최대 재시도 횟수를 소진했을 때만 `generation_failed`로 바꾼다.

### 3.2 재생성 전환

```text
기존 결과물
  -> regenerating
  -> 기존 결과물 regenerated
  -> 신규 결과물 generating
```

신규 결과물은 일반 생성과 같은 성공·실패 전환을 따른다.

### 3.3 기존 상태 마이그레이션

다음 조건을 만족하는 기존 `auto_approval_blocked` 결과물은 `generating`으로 바꾼다.

- `output_json.generationState = pending`
- `output_json.artifactStatus = pending`
- 차단 사유가 채널별 `*_pending` 코드인 경우

완성된 결과물이면서 실제 자동 승인 차단 사유를 가진 행은 `auto_approval_blocked`를 유지한다.

## 4. 작업과 결과물 책임

`jobs.status`는 워커 실행 상태의 원본이고 `channel_outputs.status`는 사용자에게 보이는 콘텐츠 상태의 원본이다.

- 작업이 `queued` 또는 `running`이면 결과물은 `generating` 또는 `regenerating`이다.
- 재시도 가능한 실패는 작업을 다시 `queued`로 두고 결과물은 `generating`을 유지한다.
- 작업이 재시도 불가능하거나 최대 횟수를 소진하면 결과물을 `generation_failed`로 변경하고 `output_json.generationError`에 오류 코드와 마지막 오류 메시지를 저장한다.
- 워커 완료 트랜잭션에서 결과물과 작업 상태를 함께 갱신한다.

## 5. API와 화면

### 5.1 콘텐츠 검토

- `generating`: 생성 중 배지와 대기 사유만 표시하고 검토 버튼을 숨긴다.
- `generation_failed`: 오류 요약과 재생성·거절 버튼을 표시한다.
- `pending_review`: 일반 검토 액션을 표시한다.
- `auto_approval_blocked`: 실제 차단 사유와 수동 검토 액션을 표시한다.
- `regenerated`: 기본 목록에서 제외한다.
- 알 수 없는 상태는 `상태 확인 필요`로 표시하고 화면을 유지한다.

### 5.2 게시 관리

게시 관리는 완성된 결과물과 실제 게시 큐 중심으로 표시한다. `generating`, `generation_failed`, `regenerating`은 주제 그룹의 준비 상태에는 반영하지만 게시 예정 건수에는 포함하지 않는다.

### 5.3 사이드바와 대시보드 집계

- 검토 건수: `pending_review`, `auto_approval_blocked`, `generation_failed`
- 생성 중 건수: `generating`, `regenerating`
- `regenerated`는 모든 활성 집계에서 제외

따라서 생성 대기 결과물이 콘텐츠 검토 배지 숫자를 부풀리지 않는다.

## 6. 오류 처리

- 워커가 실행되지 않은 대기 상태는 `generating`으로 명확히 표시한다.
- 작업 최종 실패 시 `generation_failed`로 변경하고 `output_json.generationError`에 오류 코드·메시지·실패 시각을 저장한다. `block_reasons`에는 `generation_failed`를 추가한다.
- 상태 전환과 작업 완료는 동일 트랜잭션에서 처리한다.
- Webflow 데이터 삭제 후 Webflow 값을 다시 쓰려는 요청은 DB 제약과 API 입력 검증에서 거부한다.

## 7. 검증

- Webflow 채널이 카탈로그, 신규 가입, API 응답, 프론트 화면에 나타나지 않는다.
- 운영 DB에 Webflow 런타임 행이 남지 않는다.
- 생성 직후 결과물은 `generating`이다.
- 성공 시 자동 승인 설정에 따라 `auto_approved` 또는 `pending_review`로 전환한다.
- 실제 자동 승인 검증 실패만 `auto_approval_blocked`가 된다.
- 최종 생성 실패는 `generation_failed`가 된다.
- 기존 pending 차단 데이터가 `generating`으로 변환된다.
- 검토 배지와 생성 중 집계가 분리된다.
- 알 수 없는 상태값으로 프론트가 중단되지 않는다.

## 8. 구현 순서

1. 실패하는 계약·마이그레이션·UI 테스트 추가
2. Webflow 삭제 및 상태 제약 마이그레이션 작성
3. 채널 카탈로그와 신규 가입 기본 채널에서 Webflow 제거
4. 생성·완료·실패 상태 전환 수정
5. API 집계와 프론트 상태 표시 수정
6. 활성 문서 갱신
7. 로컬 및 운영 DB 사전 집계 후 마이그레이션 적용
8. 전체 테스트, 빌드, 실제 API·UI 확인
