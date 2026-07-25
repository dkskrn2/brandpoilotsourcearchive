# 자동 소스 크롤링 설계

## 목표

Brand Pilot에 신규 URL 즉시 크롤링과 URL별 3일 주기 크롤링을 추가한다. 기존 수동 `전체 크롤링` 기능은 유지하며, Vercel Cron이 중앙 API를 호출하고 Supabase가 실행 상태·중복 방지·재시도 정보를 관리한다.

## 범위

포함 범위는 다음과 같다.

- 신규 소스 URL 등록 직후 해당 URL만 1회 크롤링
- 각 URL의 마지막 성공 크롤링 후 72시간이 지난 경우 정기 크롤링
- 기존 수동 전체 크롤링 유지
- 실패 재시도와 최대 시도 횟수 관리
- 브랜드별 중복·동시 실행 방지
- 실행 이력과 처리 결과 저장
- 기존 URL 안전성 검사와 콘텐츠 중복 방지 재사용

다음 항목은 제외한다.

- 별도 상시 실행 크롤링 워커
- Supabase `pg_cron`
- 시간 단위 또는 실시간 반복 크롤링
- 고객별 사용자 정의 실행 시간
- 크롤러 프록시, 브라우저 렌더링 또는 CAPTCHA 우회
- 크롤링 후 콘텐츠 생성의 자동 실행

## 실행 주기

- 신규 URL: 등록 직후 해당 URL만 실행
- 정기 실행: URL별 마지막 성공 크롤링 후 72시간
- 수동 실행: 사용자가 소스 화면에서 `전체 크롤링` 선택
- 첫 번째 재시도: 실패 후 15분
- 두 번째 재시도: 첫 재시도 실패 후 1시간
- 세 번째 재시도: 두 번째 재시도 실패 후 6시간
- 세 번째 재시도까지 실패하면 자동 재시도를 종료하고 운영 확인 대상으로 표시

Vercel Cron은 15분마다 엔드포인트를 호출한다. API는 마지막 성공 크롤링 후 72시간이 지난 URL과 `next_retry_at`이 지난 재시도 대상만 선택한다. 대상이 없으면 외부 URL을 호출하지 않고 종료한다. Cron은 production 배포에서만 실행된다.

공식 참고 문서:

- <https://examples.vercel.com/docs/cron-jobs/quickstart>
- <https://examples.vercel.com/kb/guide/daily-digest-bot-with-chat-sdk-and-workflow-sdk>

## 전체 구조

```text
Vercel Cron (15분 간격)
        |
        v
GET /internal/cron/source-crawl
        |
        +-- CRON_SECRET 검증
        +-- 72시간이 지난 URL이 있는 브랜드 조회
        +-- URL별 실행 잠금 획득
        +-- URL별 실행 이력 생성
        |
        v
72시간 이상 지난 활성 소스 크롤링
        |
        +-- 콘텐츠 URL 탐색
        +-- 본문과 메타데이터 추출
        +-- content hash 중복 확인
        +-- snapshot과 topic 후보 저장
        |
        v
실행 결과 succeeded / partial / failed 기록
```

Cron 엔드포인트는 스케줄과 인증만 담당한다. 실제 대상 선택, 잠금, 크롤링과 결과 저장은 repository 계층의 명시적인 메서드가 담당한다.

## Vercel 설정

`apps/api/vercel.json`에 다음 Cron을 추가한다.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "fastify",
  "regions": ["bom1"],
  "crons": [
    {
      "path": "/internal/cron/source-crawl",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

운영 Vercel 환경에는 긴 임의 문자열인 `CRON_SECRET`을 설정한다. Vercel이 보내는 `Authorization: Bearer <CRON_SECRET>` 헤더와 정확히 일치할 때만 실행한다. 환경 변수가 없거나 헤더가 일치하지 않으면 `401`을 반환한다.

## API와 repository 경계

### 내부 Cron API

```text
GET /internal/cron/source-crawl
```

응답은 요청 처리 결과를 다음 형태로 반환한다.

```json
{
  "brandsSelected": 2,
  "runsStarted": 5,
  "sourcesProcessed": 5,
  "created": 3,
  "updated": 5,
  "failed": 1,
  "status": "partial"
}
```

### repository 메서드

- `crawlSingleSource(brandId, sourceId, trigger)`
  - 신규 URL 등록 직후 하나의 소스만 처리한다.
- `crawlDueSources(brandId, trigger, now)`
  - 활성 상태이며 마지막 성공 크롤링 후 72시간 이상 지난 소스를 처리한다. 신규 URL의 최초 크롤링은 등록 흐름에서 별도로 실행한다.
- `crawlAllSources(brandId, trigger)`
  - 마지막 실행 시각과 관계없이 모든 활성 소스를 처리한다.
- 기존 `crawlSources(brandId)`
  - 하위 호환을 위해 `crawlAllSources(brandId, "manual")`로 위임하거나 제거 전환 기간을 둔다.

현재 `crawlSources`의 실제 URL 수집 로직은 소스 하나를 처리하는 내부 함수로 추출한다. 크롤링 규칙 자체를 다시 구현하지 않는다.

## 신규 URL 흐름

1. 사용자가 URL을 등록한다.
2. API가 URL 레코드를 저장한다.
3. 저장 성공 후 해당 `sourceId`로 `crawlSingleSource`를 호출한다.
4. 크롤링 성공 여부와 관계없이 URL 등록 결과는 유지한다.
5. 크롤링 실패 시 소스 상태와 실행 이력에 오류를 기록한다.
6. API 응답에는 등록된 소스와 초기 크롤링 결과를 함께 반환한다.

신규 URL의 초기 크롤링이 오래 걸릴 수 있으므로 API 함수 제한 시간 안에서 실행할 수 있도록 발견 URL 수, 응답 크기와 timeout을 제한한다. 초기 버전에서는 기존 동기 실행 방식을 유지하고, 제한 시간을 초과할 정도로 규모가 커지면 별도 작업 큐로 전환한다.

## 정기 실행 대상 선택

정기 실행 시 다음 조건을 모두 만족하는 소스를 선택한다.

- `enabled = true`
- `deleted_at is null`
- `status != 'disabled'`
- 마지막 성공 snapshot 시각이 현재 시각보다 72시간 이상 이전
- 신규 등록 직후 최초 크롤링이 실패한 소스는 정기 대상이 아니라 재시도 대상으로 처리
- 자동 재시도 종료 상태가 아님

한 번의 Cron 호출에서 처리할 소스 수와 소스당 발견 URL 수에 상한을 둔다. 초깃값은 전체 브랜드를 합쳐 소스 5개, 소스당 발견 URL 20개로 한다. 실행 시간 예산은 45초이며 새 소스를 시작하기 전에 남은 시간을 확인한다. 나머지는 다음 15분 Cron 호출에서 처리한다.

## 데이터 모델

새 테이블 `source_crawl_runs`를 추가한다.

| 컬럼 | 형식 | 설명 |
|---|---|---|
| `id` | uuid | 실행 ID |
| `workspace_id` | uuid | 워크스페이스 |
| `brand_id` | uuid | 브랜드 |
| `source_url_id` | uuid | 실행 대상 URL |
| `parent_run_id` | uuid nullable | 재시도의 원본 실행 |
| `trigger` | text | `new_source`, `daily`, `manual`, `retry` |
| `status` | text | `queued`, `running`, `succeeded`, `partial`, `failed`, `abandoned` |
| `run_key` | text | 중복 방지 키 |
| `attempt` | integer | 최초 실행 0, 재시도 1~3 |
| `processed_count` | integer | 처리 소스 수 |
| `created_count` | integer | 신규 snapshot 수 |
| `updated_count` | integer | 갱신 항목 수 |
| `failed_count` | integer | 실패 수 |
| `started_at` | timestamptz | 시작 시각 |
| `finished_at` | timestamptz nullable | 완료 시각 |
| `next_retry_at` | timestamptz nullable | 다음 재시도 시각 |
| `last_error` | text nullable | 안전하게 정리한 마지막 오류 |
| `metadata` | jsonb | 실행 제한·버전 등 비민감 메타데이터 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 갱신 시각 |

정기 실행의 `run_key`는 `scheduled:<sourceId>:<KST 날짜>` 형식을 사용한다. 신규 등록 실행은 `new_source:<sourceId>`, 재시도 실행은 `retry:<원본 실행 ID>:<시도 번호>`, 수동 실행은 임의 UUID를 포함한 키를 사용한다. `run_key`에 유니크 인덱스를 두어 같은 URL의 같은 날짜 정기 실행과 같은 단계의 재시도가 한 번만 생성되게 한다. URL별 마지막 성공 시각을 다시 검사하므로 72시간이 지나지 않은 URL은 포함되지 않는다.

## 동시 실행과 중복 방지

- 실행 이력 생성은 `insert ... on conflict do nothing`으로 원자적으로 처리한다.
- 같은 `run_key`가 있으면 새로운 크롤링을 시작하지 않고 기존 실행 결과를 반환한다.
- URL별 `running` 상태는 부분 유니크 인덱스로 하나만 허용한다.
- 같은 URL의 수동 실행과 정기 실행이 겹치면 먼저 시작된 실행이 우선한다.
- 한 브랜드의 URL은 한 API 호출 안에서 순차 처리해 외부 사이트와 DB 부하를 제한한다.
- 오래된 `running` 실행은 일정 시간 후 실패로 전환할 수 있도록 시작 시각을 기록한다. 초기 기준은 30분이다.

## 실패와 재시도

개별 URL 실패는 다른 URL의 처리를 중단하지 않는다.

- 실패 0건: `succeeded`
- 성공과 실패가 함께 존재: `partial`
- 처리 대상이 모두 실패: `failed`
- 재시도 3회 이후 실패: `abandoned`

재시도 대상은 Cron 실행이 시작될 때 `next_retry_at <= now()` 조건으로 함께 조회한다. 별도 타이머를 만들지 않는다. 동일 Cron 엔드포인트가 15분마다 실행되지만 대상이 없으면 DB 조회 결과만 반환하고 외부 URL을 호출하지 않는다.

이 설계는 15분 간격 Cron을 지원하는 Vercel 요금제가 필요하다. 해당 빈도를 지원하지 않는 요금제라면 배포하지 않고, 요금제 변경 또는 별도 작업 실행 환경을 선택해야 한다. 재시도를 조용히 다음 날로 미루는 축소 동작은 제공하지 않는다.

## 보안과 비용 제한

- `CRON_SECRET`이 없으면 Cron 기능을 비활성화한다.
- 헤더 비교는 상수 시간 비교를 사용한다.
- 오류 응답과 로그에 secret, 전체 URL 쿼리, 원문 콘텐츠를 기록하지 않는다.
- 기존 loopback, 사설망, link-local, 클라우드 메타데이터 차단을 유지한다.
- DNS 확인 후 안전 주소인지 검사하고 리디렉션마다 다시 검사한다.
- 소스당 HTTP timeout, 최대 리디렉션과 최대 응답 크기를 강제한다.
- 브랜드당 처리 소스와 발견 URL 수를 제한한다.
- 실패 URL은 재시도 횟수와 마지막 오류를 저장한다.

## 관측성과 운영 화면

기존 소스 큐에 다음 정보를 추가한다.

- 마지막 자동 실행 시각
- 다음 예정 실행 시각
- 실행 상태
- 처리·성공·실패 개수
- 재시도 횟수
- 마지막 오류

내부 운영 확인을 위해 최근 실행 목록 API를 추가한다.

```text
GET /brands/:brandId/source-crawl-runs
```

고객 화면에는 최근 실행 상태만 보여주고 내부 stack trace나 민감 URL 정보는 노출하지 않는다.

## 테스트 기준

### 단위 테스트

- `CRON_SECRET` 누락·불일치 시 `401`
- 올바른 Authorization 헤더만 통과
- 신규 URL은 하나의 source만 크롤링
- 마지막 성공 후 72시간이 지나지 않은 소스 제외
- 신규 URL 등록 직후 최초 크롤링 1회 실행
- 비활성·삭제 소스 제외
- 처리 상한 적용
- 실패 0건은 `succeeded`
- 일부 실패는 `partial`
- 전체 실패는 `failed`
- 재시도 간격 15분·1시간·6시간
- 네 번째 시도는 `abandoned`
- 같은 `run_key` 중복 실행 방지
- 수동·정기 동시 실행 방지

### API 통합 테스트

- Cron 엔드포인트 인증과 결과 형식
- 신규 URL 저장 후 초기 크롤링 결과
- 수동 전체 크롤링의 기존 동작 유지
- 실행 이력 목록 조회
- 개별 URL 실패가 전체 실행을 중단하지 않음

### 설정 계약 테스트

- `apps/api/vercel.json`에 Cron 경로 존재
- `*/15 * * * *` Cron과 URL별 72시간 대상 선택 규칙이 일치
- `apps/api/.env.example`에 값이 비어 있는 `CRON_SECRET` 존재
- README와 배포 문서에 운영 설정 방법 존재

## 배포 순서

1. `source_crawl_runs` 마이그레이션을 Supabase에 적용한다.
2. `CRON_SECRET`을 Vercel production 환경에 설정한다.
3. API 코드와 `vercel.json`을 배포한다.
4. 수동 Authorization 요청으로 Cron 엔드포인트를 한 번 검증한다.
5. Vercel production Cron 등록과 15분 호출 로그를 확인한다.
6. 첫 정기 실행에서 중복·실패·실행 시간을 점검한다.
7. 처리 시간이 함수 제한에 가까워지면 브랜드당 처리 상한을 낮춘다.

Preview 배포에서는 Vercel Cron이 실행되지 않으므로 자동 실행 검증은 production 배포 후 수행한다.

## 완료 조건

- 신규 URL 등록 후 초기 크롤링 결과가 저장된다.
- 신규 URL은 등록 직후 한 번 크롤링된다.
- 이후 각 URL은 마지막 성공 크롤링 후 72시간이 지난 다음 Cron 호출에서 다시 크롤링된다.
- 같은 브랜드의 같은 날짜 실행이 중복되지 않는다.
- 실패한 URL은 다른 URL 실행을 막지 않는다.
- 재시도 횟수와 다음 실행 시각이 저장된다.
- 기존 수동 전체 크롤링이 유지된다.
- 비밀값과 내부 오류가 고객 응답에 노출되지 않는다.
- 전체 단위 테스트, API 테스트, 빌드와 설정 계약 테스트가 통과한다.
