# 이미지 렌더 오류 이력 설계

## 목표

이미지 렌더 작업이 재시도된 뒤에도 최초 실패 원인을 생성 ID와 장면 번호 기준으로 확인할 수 있게 한다.

## 범위

- 기존 `audit_events`에 워커가 보고한 렌더 실패를 시도별로 추가한다.
- 기존 렌더 작업 행의 `error_code`, `error_message`, 재시도 판단 및 상태 전이는 변경하지 않는다.
- 이미지 워커는 기존 오류 코드와 별도로, 허용된 형식의 안전한 내부 진단 코드만 선택적으로 전달한다.
- UI, 프롬프트, 이미지 생성 방식, 재시도 횟수와 간격, DB 스키마는 변경하지 않는다.

## 데이터 흐름

1. 이미지 CLI 또는 후처리에서 오류가 발생한다.
2. 이미지 워커는 기존 `errorCode`, `errorMessage`, `retryable` 값을 그대로 계산한다.
3. 오류 객체의 비열거 `diagnostic` 문자열에서 `[a-z0-9_]{1,120}` 형식의 알려진 오류 코드만 추출한다. 원문 stderr와 콘텐츠는 전달하지 않는다.
4. API는 기존 실패 상태 전이를 먼저 커밋한다.
5. 커밋 이후 별도 자동 커밋 쿼리로 `audit_events`에 `ai_content_render_attempt_failed` 이벤트를 기록한다.
6. 감사 기록이 실패해도 이미 반영된 생성·재시도 상태는 롤백하지 않는다.

## 감사 이벤트

- `actor_type`: `worker`
- `actor_external_id`: 워커 ID
- `event_type`: `ai_content_render_attempt_failed`
- `entity_type`: `ai_content_generation_render_job`
- `entity_id`: 렌더 작업 ID
- `metadata`: 계약 버전, generationId, outputId, jobKind, assetIndex, attemptCount, maxAttempts, errorCode, errorMessage, diagnosticCode, requestedRetryable, willRetry

`errorMessage`는 기존 API 한도인 2,000자를 유지하고, `diagnosticCode`는 선택 값이다. 감사 이벤트에는 프롬프트, 첨부 이미지, 모델 출력, 원문 stderr를 넣지 않는다.

## 호환성과 실패 처리

- 구 워커가 `diagnosticCode`를 보내지 않아도 API는 정상 처리한다.
- 새 워커 배포 전 API를 먼저 배포한다.
- terminal 실패 재전송은 기존 멱등 경로를 유지하며 감사 이벤트를 중복 생성하지 않는다.
- 감사 이벤트 INSERT 실패는 실패 API의 성공 여부나 재시도 상태를 변경하지 않는다.

## 검증

- 재시도 가능한 실패 후 작업 행의 오류가 다음 claim에서 초기화돼도 감사 이벤트가 남는지 검증한다.
- terminal 실패 멱등 재전송이 이벤트를 중복 생성하지 않는지 검증한다.
- 진단 문자열에서 안전한 코드만 추출되고 비밀정보·자유 텍스트가 전달되지 않는지 검증한다.
- 기존 API/이미지 워커 테스트와 타입 검사를 실행한다.
