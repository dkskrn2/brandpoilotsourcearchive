# 브랜드별 누적형 LLM Wiki 설계

작성일: 2026-07-16
상태: 확정안
범위: Instagram DM 자동답변용 브랜드 지식 생성·검색 구조

## 1. 목적

현재 시스템은 자사 URL, FAQ, 제품, 정책을 원문 단위로 정제하고 청크를 검색하는 하이브리드 RAG다. 이 구조는 질문과 유사한 청크가 검색 상위에 들어오지 않으면, 실제 제품 정보가 저장되어 있어도 답변에 사용하지 못한다.

이를 브랜드별 누적형 LLM Wiki로 전환한다. 여러 원문을 제품·서비스·정책·FAQ 단위의 대표 Wiki 페이지로 미리 통합하고, DM 답변 시 원문 청크가 아니라 통합 Wiki 페이지를 우선 검색한다.

목표는 다음과 같다.

- 브랜드마다 완전히 분리된 Wiki를 생성한다.
- 같은 브랜드의 여러 자사 URL과 업로드 데이터를 하나의 지식 구조로 통합한다.
- 제품과 서비스 정보에 원문 URL 및 실제 이동 URL을 보존한다.
- Wiki 생성 비용은 비동기 작업으로 이동하고 DM 응답 경로는 짧게 유지한다.
- 모든 답변은 원본 자료로 역추적할 수 있어야 한다.

## 2. 범위 단위

Wiki 소유 단위는 `workspace`가 아니라 `brand`다.

```text
workspace
  brand A
    active wiki version A-7
  brand B
    active wiki version B-3
```

하나의 고객 워크스페이스가 여러 브랜드를 운영하면 브랜드마다 별도의 Wiki, 활성 버전, 검색 범위와 출처가 존재한다. 모든 생성·검색 쿼리는 `workspace_id + brand_id`를 함께 검증한다.

다른 브랜드의 원문, Wiki 페이지, 임베딩 및 DM 대화는 검색 결과에 포함될 수 없다.

## 3. 접근 방식 검토

### A. 기존 원문 청크 RAG 유지

구현 변경이 작지만, 전체 제품 목록이나 여러 페이지를 종합해야 하는 질문에서 검색 누락이 반복된다. 누적되는 지식 구조도 생기지 않는다.

### B. Wiki 전체를 매 DM마다 전달

검색 누락은 줄지만 브랜드 자료가 증가할수록 토큰, 응답 시간과 비용이 함께 증가한다. 모든 고객에게 적용할 수 있는 운영 구조가 아니다.

### C. 브랜드별 통합 Wiki + 임베딩 검색

원문을 비동기로 통합해 대표 Wiki 페이지를 만들고, DM에서는 브랜드 핵심 페이지와 관련 페이지 일부만 사용한다. 생성 시 비용은 증가하지만 질문 처리 비용과 검색 노이즈가 감소한다.

**선택: C안.** 기존 임베딩 검색을 제거하지 않고 통합 Wiki 페이지 검색에 사용한다.

## 4. 지식 계층

```text
source_urls / source_snapshots / knowledge_entries
  -> 규칙 기반 원문 정제
  -> source knowledge units
  -> 브랜드 Wiki 컴파일
  -> canonical wiki pages
  -> page chunks + embeddings
  -> active wiki version
```

### 4.1 원본 계층

- `source_urls`: 사용자가 등록한 자사 URL
- `source_snapshots`: 크롤링 시점별 원문
- `knowledge_entries`: 사용자가 등록한 FAQ, 제품, 정책

원본 계층은 Wiki가 수정하지 않는다. Wiki가 잘못 생성되면 원본으로부터 다시 만들 수 있어야 한다.

### 4.2 정제 단위 계층

각 원본을 다음 원자 단위로 정제한다.

- `faq`
- `product`
- `service`
- `policy`
- `fact`
- `guide_section`

각 단위는 반드시 원본 식별자, 원본 URL, 근거 문장과 구조화 데이터를 보존한다. 제품·서비스에 별도 이동 URL이 있으면 `destination_url`로 저장한다.

### 4.3 대표 Wiki 페이지 계층

브랜드마다 다음 대표 페이지를 생성한다.

| page_type | 역할 |
|---|---|
| `brand_overview` | 브랜드 소개와 핵심 제공 가치 |
| `catalog` | 전체 제품·서비스 목록과 짧은 설명 |
| `product` | 개별 제품 상세 |
| `service` | 개별 서비스 상세 |
| `policy` | 결제, 환불, 배송, 해지 등 정책 |
| `faq` | 주제별 FAQ 요약과 연결 |
| `guide` | 이용 방법과 설명 문서 |

`catalog`는 제품·서비스 질문에서 항상 우선 조회되는 브랜드 핵심 페이지다. 제품과 서비스 상세 페이지는 안정적인 `stable_key`를 사용해 새 원문이 들어와도 같은 대상을 갱신한다.

DM 검색에서는 `brand_overview`와 `catalog`의 압축 요약을 합친 `brand_core` 검색 패킷을 항상 포함한다. `brand_core`는 별도의 사실 원본이 아니라 두 핵심 페이지에서 서버가 파생한 최대 3,000자의 읽기 전용 데이터다. 따라서 제품 종류를 묻는 표현을 코드에 나열하거나 별도의 LLM 의도 분류를 실행하지 않아도 브랜드와 제품의 기본 맥락을 놓치지 않는다.

## 5. 데이터 모델

기존 `wiki_versions`는 브랜드별 빌드 및 원자적 활성화 단위로 유지한다. `build_stage`를 추가해 수집·컴파일·임베딩·검증 단계를 추적하고, 기존 `status`는 `building|ready|active|failed|superseded`만 표현한다. 운영 중 두 검색 엔진을 함께 유지하는 분기나 브랜드별 엔진 설정은 추가하지 않는다.

### 5.1 wiki_source_units

원문별 Codex 정제 결과를 빌드 버전 안에 보존한다.

주요 필드:

- `workspace_id`
- `brand_id`
- `wiki_version_id`
- `source_kind`
- `source_id`
- `unit_type`
- `stable_key`
- `title`
- `content`
- `keywords`
- `aliases`
- `structured_data`
- `source_url`
- `destination_url`
- `source_quote`

### 5.2 wiki_pages

여러 `wiki_source_units`를 통합한 브랜드 대표 페이지다.

주요 필드:

- `workspace_id`
- `brand_id`
- `wiki_version_id`
- `page_type`
- `stable_key`
- `title`
- `summary`
- `content_markdown`
- `content_json`
- `structured_data`
- `source_count`
- `is_core`
- `is_active`

한 버전에서 `(wiki_version_id, stable_key)`는 유일하다.

`content_json`은 다음과 같은 출처 연결 블록을 저장하고 `content_markdown`은 이 데이터에서 렌더링한다.

```json
{
  "sections": [
    {
      "sectionKey": "summary",
      "heading": "핵심 기능",
      "body": "고객이 제공받는 기능 설명",
      "sourceUnitIds": ["uuid"],
      "destinationUrlId": "uuid-or-null"
    }
  ]
}
```

LLM이 자유로운 Markdown과 별도 출처 목록을 각각 출력하게 하지 않는다. 모든 문단은 존재하는 `sourceUnitIds`를 가져야 하고, 중앙 코드가 이를 검증한 뒤 Markdown을 생성한다.

### 5.3 wiki_page_sources

Wiki 페이지와 원본의 다대다 관계를 저장한다.

주요 필드:

- `wiki_page_id`
- `section_key`
- `source_kind`
- `source_id`
- `source_url`
- `destination_url`
- `source_quote`

DM 답변에 URL을 포함할 때 이 테이블의 검증된 URL만 사용할 수 있다.

### 5.4 wiki_build_requests

크롤링과 지식 업로드 이벤트를 브랜드별로 합치는 빌드 요청이다.

주요 필드:

- `workspace_id`
- `brand_id`
- `requested_revision`
- `building_revision`
- `status`
- `rebuild_requested`
- `quiet_until`

동일 브랜드에는 활성 빌드 요청이 하나만 존재한다. 빌드 도중 새 원문이 들어오면 현재 빌드를 중단하지 않고 `rebuild_requested = true`로 표시해 활성화 직후 최신 원문으로 다음 버전을 만든다.

### 5.5 wiki_page_links

대표 페이지 사이의 연결 관계를 저장한다.

예시:

- 카탈로그 -> 제품 상세
- 서비스 상세 -> 이용 정책
- FAQ -> 관련 제품

### 5.6 wiki_page_chunks

대표 Wiki 페이지를 검색하기 위한 청크와 임베딩을 저장한다. 짧은 카탈로그·제품 페이지는 페이지 전체를 한 청크로 유지하고, 긴 가이드만 분할한다.

기존 `wiki_documents`, `wiki_chunks`는 마이그레이션 호환과 롤백 조사 용도로 당분간 유지하지만 새 DM 검색 경로에서는 사용하지 않는다. 새 Wiki가 검증·활성화되면 애플리케이션 검색은 대표 페이지 청크만 사용한다. 구 테이블 제거는 운영 안정화 후 별도 마이그레이션으로 진행한다.

### 5.7 wiki_compilation_items

한 브랜드의 모든 자료를 Codex 한 번에 전달하지 않고 페이지 단위로 컴파일하기 위한 작업 큐다.

- `brand_core_pages`: 브랜드 개요와 카탈로그
- `detail_page`: 제품·서비스 상세 한 건
- `policy_page`: 정책 주제 한 건
- `faq_guide_page`: FAQ 또는 가이드 주제 한 건
- `validate`: 전체 연결과 출처 검증

작업은 lease, attempt count, timeout과 idempotency key를 가진다. 같은 버전과 stable key의 작업은 한 번만 성공 처리한다.

## 6. Wiki 빌드 흐름

### 6.1 빌드 시작

다음 이벤트는 해당 브랜드의 새 Wiki 버전을 생성한다.

- 자사 URL 크롤링 배치 완료
- FAQ·제품·정책 업로드 반영
- 사용자의 `Wiki 다시 만들기` 요청

챗봇 활성화 여부와 관계없이 Wiki는 생성한다.

개별 URL 크롤링 성공마다 새 버전을 만들지 않는다. 크롤링 배치가 끝났거나 마지막 변경 후 2분 동안 추가 변경이 없는 경우 하나의 브랜드 빌드로 합친다. 같은 브랜드에서 동시에 두 Wiki 버전을 만들 수 없다.

사용자가 `Wiki 다시 만들기`를 누른 경우에는 quiet period 없이 즉시 빌드를 요청한다.

### 6.2 원문 정제

소스별 작업은 기존 DM 우선순위를 유지하면서 한 건씩 처리한다. 원문 정규화 후 Codex knowledge curator가 원자 단위를 생성한다. URL은 LLM 출력에 맡기지 않고 중앙 코드가 원본 레코드에서 주입한다.

### 6.3 통합 컴파일

모든 소스 작업이 끝나면 브랜드 Wiki 컴파일 작업을 한 번 실행한다.

1. 기존 활성 Wiki의 대표 페이지 목록과 stable key만 읽는다.
2. 새 버전의 정제 단위를 `stable_key`별로 모은다.
3. 결정적 코드가 페이지별 compilation item을 생성한다.
4. Codex CLI가 페이지 한 건씩 출처 연결 블록을 생성한다.
5. 브랜드 개요와 카탈로그를 마지막에 생성한다.
6. 각 문장과 항목에 사용된 원문 연결을 저장한다.
7. 페이지 간 연결을 생성한다.
8. 대표 페이지를 청크화하고 임베딩한다.
9. 검증 통과 후 새 버전을 원자적으로 활성화한다.

한 소스가 실패하거나 출처 없는 중요 정보가 발견되면 새 버전을 활성화하지 않고 기존 활성 Wiki를 유지한다.

기존 활성 Wiki의 본문을 새 버전의 사실 근거로 사용하지 않는다. 기존 페이지는 stable key 유지와 변경 비교에만 사용하며, 새 버전의 모든 사실은 현재 활성 원본과 지식 데이터에서 다시 증명되어야 한다. 삭제된 원문에만 존재하던 내용은 새 Wiki에서 제거한다.

### 6.4 Codex CLI 역할

생성형 작업은 모두 `codex exec`를 사용한다.

| 역할 | Skill | 출력 |
|---|---|---|
| 원문 정제 | `knowledge-curator` | 출처가 있는 원자 지식 JSON |
| Wiki 페이지 통합 | `wiki-compiler` | 출처 연결 section JSON |
| Wiki 품질 검사 | `wiki-linter` | 오류 코드와 관련 페이지·원문 ID |
| DM 답변 | `dm-human-response` | 답변과 사용한 페이지·링크 ID JSON |

Wiki 컴파일은 다음 별도 설정을 사용한다.

```env
WIKI_CODEX_MODEL=gpt-5.4
WIKI_CODEX_REASONING_EFFORT=low
WIKI_CODEX_FAST_MODE=true
WIKI_CODEX_TIMEOUT_MS=120000
```

DM의 기존 `gpt-5.4`, `reasoning_effort=none`, fast mode 설정은 유지한다. 임베딩만 OpenAI Embeddings API를 사용한다.

Codex CLI는 워커 서버의 전용 `CODEX_HOME`에 인증된 세션을 사용한다. Codex 프로세스에는 read-only runtime 디렉터리와 중앙 코드가 선택한 입력 데이터만 전달하며 DB 자격 증명과 전체 저장소 접근 권한을 주지 않는다.

### 6.5 빌드 상태

Wiki 버전의 `status`와 `build_stage`는 다음 순서로 전이한다.

```text
status=building
  build_stage=collecting -> compiling -> embedding -> validating
  -> status=ready
  -> 기준 질문 오프라인 검증 통과
  -> status=active

어느 단계에서든 복구 불가 오류 -> status=failed
```

각 단계는 재실행 가능해야 한다. 프로세스가 종료되면 만료된 lease를 회수하고 완료된 compilation item 다음부터 이어서 처리한다.

`ready` 버전은 운영 DM에서 사용하지 않고 버전 ID를 명시한 오프라인 검증에만 사용한다. 검증이 끝나면 새 버전 활성화와 기존 버전 supersede를 한 transaction에서 처리한다.

## 7. URL 정책

제품·서비스 정보에는 두 종류의 URL이 존재한다.

- `source_url`: 해당 사실을 가져온 원문 페이지
- `destination_url`: 고객에게 안내할 실제 제품·서비스 이동 주소

둘이 같을 수 있다. `destination_url`이 없으면 `source_url`을 안내 주소로 사용할 수 있다.

URL 처리 원칙:

- LLM이 URL을 새로 만들거나 보정하지 않는다.
- 현재 브랜드의 등록된 자사 URL 또는 업로드 데이터에 명시된 URL만 허용한다.
- URL은 정규화 후 원본 호스트 허용 범위를 검증한다.
- 외부 참고 URL은 DM 제품 안내 주소로 사용하지 않는다.
- 답변에 URL이 도움이 되는 제품·서비스 질문이면 최대 2개만 제공한다.
- URL 근거가 없으면 링크 없이 답변한다.

Codex는 최종 답변 문자열 안에 URL을 직접 작성하지 않는다. 답변 JSON에 허용된 `destinationUrlId`만 반환하고, 중앙 서버가 검증된 URL을 답변 끝에 추가한다. 등록되지 않은 URL을 문자열에서 제거하는 불안정한 후처리는 사용하지 않는다.

## 8. DM 검색과 답변 흐름

```text
정확한 FAQ
  -> DB 고정 답변

일반 질문
  -> 질문 임베딩
  -> 브랜드 활성 Wiki 검색
  -> brand_core + 관련 페이지 최대 3개
  -> 최근 대화와 함께 Codex 1회 호출
  -> 근거 URL 검증
  -> Instagram DM 발송
```

### 8.1 핵심 페이지

`brand_overview`와 `catalog`에서 만든 압축 `brand_core`를 모든 일반 질문에 포함한다. 관련 상세 페이지는 하이브리드 검색 결과 최대 3개를 추가한다. 별도 LLM 의도 분류 호출은 하지 않는다.

### 8.2 검색 결과

검색 결과에는 다음을 함께 반환한다.

- 페이지 ID와 청크 ID
- 페이지 유형과 제목
- 본문
- 유사도와 키워드 점수
- 출처 URL
- 고객 안내용 URL
- 고객 안내용 URL ID

Codex는 전달받지 않은 페이지, 원문과 URL ID를 답변에 사용할 수 없다. 서버는 Codex가 반환한 ID의 브랜드 소유권과 활성 Wiki 버전을 다시 확인한다.

### 8.3 지식 부족

`catalog` 또는 관련 상세 페이지가 없거나 근거가 부족하면 기존 고정 안내문을 보내고 `knowledge_gap`으로 기록한다. DM 처리 중 추가 CLI 검색이나 실시간 Wiki 재생성은 하지 않는다.

## 9. 품질 관리

Wiki 컴파일 단계에서 다음을 자동 검사한다.

- 출처 없는 제품명·가격·정책
- 동일 stable key의 상충 정보
- 원문에서 삭제됐지만 Wiki에 남은 항목
- 링크가 끊어진 대표 페이지
- 제품·서비스가 있는데 카탈로그에 없는 항목
- 출처 URL이 없는 제품·서비스 항목

상충 정보는 임의로 선택하지 않는다. 해당 페이지를 비활성화하거나 마지막으로 확인된 원문과 함께 `wiki_issue`로 기록한다.

### 9.1 검색 품질 개선 루프

브랜드마다 다음 검색 결과를 기록한다.

- 질문과 선택된 Wiki 페이지 ID
- 벡터·키워드 점수
- 직접 FAQ, Wiki 답변, fallback 결과
- Codex가 실제 사용한 페이지와 URL ID
- 처리 시간

새 `knowledge_gap` 또는 저신뢰 결과가 5건 이상 쌓인 브랜드만 새벽 유지보수 대상에 포함한다. `wiki-linter`는 실패 질문과 현재 원문 지식을 비교해 다음만 제안할 수 있다.

- 기존 페이지의 별칭과 검색 키워드 보강
- 카탈로그와 상세 페이지 연결 보강
- 원문에 존재하지만 Wiki에서 빠진 페이지 재생성
- 실제로 부족한 FAQ·제품 데이터 목록 기록

사용자 DM 문장을 새로운 사실로 저장하거나 원문에 없는 답을 만들어 Wiki에 추가하지 않는다. 자동 개선 결과도 새 Wiki 버전으로 빌드·검증한 후 활성화한다. 검색 알고리즘은 공통으로 유지하되 별칭, 카탈로그와 페이지 구성은 브랜드별 데이터로 개선한다.

유지보수 실행은 `wiki_maintenance_runs`에 브랜드, 대상 질문 수, Codex 실행 결과, 변경된 stable key, 생성된 issue와 시작·완료 시간을 기록한다. 기본 실행 시간은 KST 새벽 3시이며, 임계값을 충족한 브랜드만 한 번씩 처리한다.

## 10. 성능 정책

Wiki 생성과 임베딩은 DM 요청 밖에서 실행한다. DM 응답 시에는 다음만 수행한다.

1. `brand_core` 조회 1회
2. 질문 임베딩 1회
3. 브랜드 Wiki 검색 1회
4. Codex 답변 1회
5. Meta 발송 1회

전체 Wiki를 매번 전달하지 않는다. 기본 최대 입력은 핵심 페이지 1개와 관련 페이지 3개다. 정확한 FAQ는 임베딩과 Codex 호출을 생략한다.

DM 워커 프로그램 안에 독립된 두 비동기 실행 lane을 둔다.

- DM lane: 동시 Codex CLI 1개, 항상 즉시 polling
- Wiki lane: 동시 Codex CLI 1개, 페이지 한 건씩 처리

Wiki CLI가 실행 중이어도 DM lane은 별도 `codex exec`를 시작할 수 있다. 전체 CLI 동시 실행 상한은 2개다. DM backlog가 있으면 Wiki lane은 다음 compilation item을 claim하지 않는다. 별도의 Wiki 서버나 상시 대화형 Codex 세션은 만들지 않는다.

## 11. 전환 전략

1. 현재 검색 경로로 실제 대표 질문 20~30개의 검색 문맥, 답변, URL, fallback 여부와 응답 시간을 기준 JSON에 저장한다.
2. 새 Wiki 테이블과 검색 함수를 추가하고 Growthline 브랜드로 누적형 Wiki를 생성한다.
3. 새 Wiki를 `ready` 상태로 두고 동일 질문 세트를 버전 ID를 지정해 오프라인 실행한다.
4. 근거 정확도, 사실 정확도, URL 정확도, fallback 비율과 응답 시간을 기준 JSON과 비교한다.
5. 기준을 통과하면 애플리케이션의 일반 질문 검색 경로를 새 Wiki로 한 번에 교체하고 새 버전을 활성화한다.
6. 정확 FAQ 직접 응답 경로는 전환 후에도 유지한다.
7. 문제가 생기면 런타임 엔진 스위치가 아니라 Git 이력과 이전 활성 버전을 기준으로 복구한다.

기존 활성 Wiki가 있는 동안에는 새 빌드 실패가 DM 서비스 중단으로 이어지지 않는다.

## 12. 테스트 기준

### 데이터 격리

- 브랜드 A 질문에 브랜드 B의 Wiki 페이지와 URL이 반환되지 않는다.
- 같은 워크스페이스에 속한 두 브랜드도 서로 검색되지 않는다.

### Wiki 생성

- 여러 URL의 제품 정보가 하나의 카탈로그에 통합된다.
- 동일 제품 정보가 stable key 기준으로 중복 생성되지 않는다.
- 제품 상세 페이지가 원문 URL과 destination URL을 보존한다.
- 새 빌드 실패 시 기존 활성 Wiki가 유지된다.
- 한 크롤링 배치에서 URL 수와 관계없이 Wiki 빌드 요청이 하나로 합쳐진다.
- 빌드 중 새 데이터가 들어오면 완료 후 최신 revision의 후속 빌드가 생성된다.
- 삭제된 원문에만 존재하는 사실이 다음 Wiki 버전에 남지 않는다.

### DM 답변

- `어떤 제품이 있나요?` 질문에는 카탈로그가 항상 포함된다.
- 제품 상세 질문에는 해당 제품 페이지와 검증된 URL이 전달된다.
- Codex가 반환한 URL ID만 중앙 서버가 실제 URL로 변환한다.
- 다른 브랜드 또는 과거 Wiki 버전의 URL ID는 거부한다.
- 정확한 FAQ는 기존 직접 답변 경로를 유지한다.

### 성능

- 일반 Wiki 답변은 질문 임베딩과 Codex 호출을 각각 1회만 수행한다.
- Wiki 빌드 작업은 DM 작업이 대기 중이면 다음 compilation item을 가져오지 않는다.
- Wiki 페이지 한 건이 120초를 초과하면 lease 만료 후 재시도하며 DM lane은 중단되지 않는다.

## 13. 제외 범위

- Wiki 전체를 매 DM마다 전달하는 방식
- 외부 참고 URL을 제품 이동 주소로 제공하는 기능
- DM 답변을 검증 없이 자동으로 Wiki에 기록하는 기능
- 고객이 Wiki 페이지를 직접 편집하는 UI
- 별도의 Wiki 전용 관리 서비스 또는 프로세스

## 14. 완료 조건

- 모든 브랜드가 독립된 활성 Wiki 버전을 가진다.
- 자사 URL, FAQ, 제품, 정책이 브랜드 대표 페이지로 통합된다.
- 제품·서비스 정보에서 원문 URL과 이동 URL을 추적할 수 있다.
- 제품 목록 질문이 임베딩 순위 실패와 무관하게 카탈로그를 사용한다.
- 기존 직접 FAQ와 fallback 정책, DM 우선순위가 유지된다.
- Wiki 생성 실패가 현재 운영 중인 DM 답변을 중단하지 않는다.
