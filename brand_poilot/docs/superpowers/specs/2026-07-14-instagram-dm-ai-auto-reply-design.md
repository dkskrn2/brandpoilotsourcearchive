# Instagram DM AI Auto Reply Design

작성일: 2026-07-14  
상태: 설계 확정  
대상: Brand Pilot 1차 Instagram DM 자동응답 MVP

## 1. 목표

고객이 FAQ 파일과 기존 자사 URL을 등록하면 이를 브랜드별 Wiki로 정리하고, Instagram DM 질문에 Wiki 근거를 사용해 자동으로 답변한다. 답변 근거가 부족하면 추측하지 않고 고정 안내문을 발송한 뒤 미답변 질문으로 기록한다.

1차 MVP는 Growthline Instagram 계정으로 실제 수신, 검색, CLI 답변 생성, 발송까지 한 사이클을 검증하는 것을 목표로 한다.

## 2. 확정 범위

### 2.1 포함

- Instagram Professional 계정 DM Webhook 수신
- `instagram_business_manage_messages` 권한 확인과 재연결
- Instagram 계정별 챗봇 활성화 ON/OFF
- FAQ CSV/Excel 일괄 업로드
- 기존 `owned` 자사 URL과 최신 성공 크롤링 스냅샷 재사용
- CLI 기반 Wiki LLM 정리
- Wiki 문서 버전과 충돌 기록
- Wiki chunk 임베딩 생성
- PostgreSQL `pgvector` 기반 벡터 검색
- 키워드 검색과 벡터 검색을 결합한 하이브리드 검색
- 별도 CLI DM 워커를 통한 답변 생성
- 근거 부족 시 고정 안내문 발송
- 미답변 질문과 처리 이력 기록
- 최근 수신 질문, 자동답변, 근거, 처리시간, 상태 조회 UI

### 2.2 제외

- PDF 업로드
- 자유 형식 텍스트 지식 등록
- 외부 참고 URL을 DM 답변 근거로 사용
- 웹사이트 챗봇
- 상담원 연결과 상담 배정
- 상담원이 서비스 화면에서 직접 답변하는 기능
- 주문, 배송, 예약, 재고 API 연동
- CRM 연동
- 마케팅 메시지 발송
- AI 답변 승인 절차
- 복잡한 대화 플로우 빌더
- 고객용 애니메이션 또는 Instagram 진행 상태 메시지

## 3. 핵심 원칙

### 3.1 활성화 후에만 자동응답

챗봇 활성화 스위치가 켜진 Instagram 계정만 자동응답한다. 비활성화 상태에서는 Webhook 이벤트를 수신하고 기록할 수 있지만 답변 작업을 만들거나 메시지를 발송하지 않는다.

활성화 조건은 다음과 같다.

1. Instagram 채널 연결이 정상이다.
2. 메시지 관리 권한이 확인됐다.
3. 메시지 Webhook 구독이 정상이다.
4. 활성 Wiki 지식이 한 건 이상 있다.

### 3.2 브랜드 지식 안에서만 답변

답변은 해당 브랜드의 활성 FAQ와 자사 사이트를 기반으로 생성한 Wiki만 사용한다. 가격, 운영시간, 정책, 일정처럼 근거가 필요한 내용을 모델이 임의로 추측해서는 안 된다.

### 3.3 근거 부족 시 고정 안내

검색 근거가 부족하거나 근거끼리 충돌하면 CLI가 새 사실을 만들지 않고 `fallback`을 반환한다. 중앙 API는 브랜드가 설정한 고정 안내문을 발송하고 해당 질문을 미답변 목록에 기록한다.

### 3.4 실제 채널 발송은 중앙 API만 담당

CLI 워커에는 Meta access token을 전달하지 않는다. 워커는 검색과 답변 생성만 담당하며, 중앙 API가 결과를 검증한 뒤 Meta Send API를 호출한다.

## 4. 전체 아키텍처

```text
FAQ CSV/Excel ─┐
               ├─> 중앙 API ─> wiki_refresh job
자사 URL Crawl ┘                     │
                                     ▼
                          brand-pilot-dm-worker
                                     │
                          Wiki 정리 + chunk 생성
                                     │
                          embedding 생성 + 결과 제출
                                     │
                                     ▼
                              PostgreSQL/pgvector

Instagram 사용자
      │ DM
      ▼
Meta Webhook
      │
      ▼
중앙 API
  - 서명 검증
  - 중복 제거
  - 채널/브랜드 식별
  - 활성화 확인
  - 메시지 저장
  - instagram_dm_reply job 생성
      │
      ▼
brand-pilot-dm-worker
  - 제한된 DB 함수로 Wiki 검색
  - 최근 대화 조회
  - CLI 답변 생성
  - 결과를 중앙 API에 제출
      │
      ▼
중앙 API
  - 결과 계약 검증
  - 중복 발송 차단
  - Meta Send API 호출
  - 처리 결과 저장
```

기존 Fastify API, PostgreSQL `jobs` 큐, React 고객 UI, credential 암호화, 워커 claim/heartbeat/complete/fail 패턴을 재사용한다. Redis, RabbitMQ, 별도 검색 서버, 새로운 백엔드 프레임워크는 추가하지 않는다.

## 5. Wiki 지식 설계

### 5.1 FAQ 업로드

지원 파일:

- `.csv`
- `.xlsx`

권장 컬럼:

| 컬럼 | 필수 | 설명 |
|---|---|---|
| `question` | 필수 | 고객 질문 |
| `answer` | 필수 | 승인된 답변 |
| `category` | 선택 | 운영시간, 가격, 환불 등 |
| `keywords` | 선택 | 검색 보조 키워드 |
| `priority` | 선택 | 충돌 시 우선순위 |
| `enabled` | 선택 | 기본값 `true` |

파일 전체를 하나의 업로드 작업으로 기록하고 각 행의 유효, 중복, 오류 상태를 반환한다. 오류 행이 있더라도 유효 행은 저장할 수 있으며, 파일 자체를 읽을 수 없거나 필수 컬럼이 없으면 업로드를 실패시킨다.

### 5.2 사이트 지식

- 기존 `source_urls.source_type = 'owned'`만 사용한다.
- 외부 참고 URL은 제외한다.
- 최신 성공 `source_snapshots`를 Wiki 원본으로 사용한다.
- `content_hash`가 바뀐 경우에만 Wiki 갱신 작업을 만든다.
- 크롤링 실패 스냅샷은 현재 활성 Wiki를 제거하지 않는다.

### 5.3 정보 우선순위

정보가 충돌하면 다음 순서를 사용한다.

```text
활성 FAQ > 최신 성공 자사 사이트 스냅샷 > 이전 Wiki 버전
```

CLI는 상충 정보를 임의로 합치지 않는다. 우선순위가 높은 근거를 현재 Wiki에 사용하고 충돌 내용을 별도로 저장한다.

### 5.4 Wiki 데이터

필요한 논리 테이블은 다음과 같다.

```text
knowledge_imports
knowledge_entries
wiki_documents
wiki_document_versions
wiki_chunks
wiki_conflicts
```

`wiki_chunks`는 다음 검색 정보를 가진다.

```text
brand_id
wiki_document_id
content
content_hash
keywords
search_vector
embedding
embedding_model
embedding_version
enabled
```

Wiki 문서와 chunk는 항상 `brand_id`로 분리한다. 같은 `content_hash`, `embedding_model`, `embedding_version` 조합은 다시 임베딩하지 않는다.

## 6. 임베딩과 검색

응답 본문 생성은 CLI가 담당한다. OpenAI API는 Wiki chunk와 수신 질문의 임베딩 생성에만 사용한다.

검색 순서:

1. 수신 질문을 임베딩한다.
2. 동일한 `brand_id`와 활성 Wiki만 벡터 검색한다.
3. PostgreSQL 키워드/전문 검색 결과를 함께 구한다.
4. 두 결과를 결합해 상위 근거를 선정한다.
5. 검색 근거와 최근 대화를 CLI에 전달한다.

키워드 검색은 상품명, 고유명사, 숫자, 정확한 정책명에 사용하고 벡터 검색은 표현이 다른 유사 질문을 찾는 데 사용한다.

유사도 점수 하나를 정답 확률로 취급하지 않는다. 답변 여부는 다음 조건을 함께 확인한다.

- 직접적인 근거가 존재하는가
- 질문에 필요한 사실이 근거에 포함됐는가
- 근거끼리 충돌하지 않는가
- 가격, 정책, 기간 등의 핵심 수치를 추측하지 않았는가

## 7. DM CLI 워커

신규 워커는 이미지 워커와 분리한다.

```text
workers/
  brand-pilot-image-worker/
  brand-pilot-dm-worker/
```

처리할 작업 유형:

- `wiki_refresh`
- `instagram_dm_reply`

워커는 기존 중앙 API의 worker token, job claim, heartbeat, complete, fail 계약을 따른다.

### 7.1 DB 접근

워커 전용 PostgreSQL 계정을 사용한다. 원본 테이블 전체 조회 권한을 주지 않고 답변용 함수 실행 권한만 부여한다.

```text
search_brand_wiki(brand_id, query_embedding, limit)
get_dm_conversation_history(brand_id, conversation_id, limit)
get_wiki_refresh_sources(brand_id, refresh_job_id)
```

워커는 다음 정보에 접근하지 못한다.

- Meta access token과 app secret
- 로그인 세션과 사용자 인증 정보
- 결제 정보
- 채널 credential 원문
- 답변 처리와 무관한 운영 데이터

### 7.2 CLI 결과 계약

```json
{
  "decision": "answer",
  "answer": "답변 내용",
  "wikiChunkIds": ["chunk-id-1"],
  "confidence": 0.88,
  "reason": "운영시간 FAQ에서 직접 확인됨"
}
```

허용하는 `decision`:

- `answer`: Wiki 근거를 사용한 답변
- `fallback`: 고정 안내문 발송과 미답변 기록
- `ignore`: 에코 또는 지원하지 않는 시스템 이벤트

중앙 API는 JSON 구조, 근거 ID의 브랜드 소유권, 답변 길이, 현재 작업 상태를 검증한 뒤에만 발송한다.

## 8. Webhook과 메시지 처리

### 8.1 수신

- 공개 HTTPS 중앙 API에서 Meta Webhook을 받는다.
- Webhook 검증 요청의 challenge를 처리한다.
- `X-Hub-Signature-256` 서명을 App Secret으로 검증한다.
- 검증과 최소 저장을 마치고 2초 이내 HTTP 200을 반환한다.
- AI 처리는 Webhook 요청과 분리된 비동기 job으로 실행한다.

### 8.2 중복과 순서

- 외부 `message.mid`에 고유 제약을 둔다.
- `is_echo`, `is_self` 이벤트로 답변 작업을 만들지 않는다.
- 동일 사용자가 연속으로 보낸 텍스트는 3초 debounce 후 한 질문으로 묶는다.
- 동일 대화의 답변 작업은 순차 처리한다.
- 이미 성공 발송된 수신 메시지는 다시 발송하지 않는다.

### 8.3 지원 메시지

- 1차 자동답변은 텍스트만 지원한다.
- 이미지, 음성, 영상만 수신하면 텍스트 문의 요청 안내를 발송한다.
- 사용자가 먼저 시작한 대화에만 응답한다.
- 자동응답은 Meta의 24시간 표준 메시징 범위 안에서만 발송한다.
- `HUMAN_AGENT` 권한을 자동응답 우회에 사용하지 않는다.

### 8.4 오류

- CLI 실패/시간 초과: 제한 횟수 재시도 후 실패 로그 저장
- Wiki 근거 부족: 고정 안내문 발송 후 미답변 기록
- Meta 일시 오류: 지수 백오프 재시도
- 토큰 만료/권한 부족: 채널 `needs_attention`
- Webhook 중복: 성공 처리된 이벤트 반환, 신규 작업 미생성

## 9. 응답 시간

```text
목표 중앙값: 10초 이내
허용 상한: 30초
30초 초과: 작업 실패 처리 후 제한적으로 재시도
```

10초는 강제 timeout이 아니라 파일럿 성능 목표다. 서버와 CLI 실행 성능을 측정한 뒤 작업 대기, 임베딩, 검색, CLI 생성, Meta 발송 시간을 각각 기록한다.

## 10. 고객 화면

### 10.1 채널 `/channels`

- Instagram 메시지 권한 상태
- Webhook 구독 상태
- 챗봇 활성화 ON/OFF
- 고정 안내문 설정
- 권한 부족 시 재연결
- Wiki 준비 전 활성화 차단과 차단 이유

### 10.2 소스 `/sources`

- 기존 자사 URL 유지
- FAQ CSV/Excel 템플릿 다운로드
- 파일 업로드
- 유효, 중복, 오류 행 결과
- 활성 FAQ 수
- Wiki 갱신 상태
- 마지막 임베딩 완료 시각
- Wiki 재생성

### 10.3 DM 자동화 `/dm-automation`

- 최근 수신 질문
- 자동답변 내용
- 사용한 Wiki 근거
- 총 처리시간
- 성공, fallback, 실패 상태
- 미답변 질문
- 지식 보완 완료 처리
- 기간 및 상태 필터

상담원 직접 응답용 Inbox는 1차에 포함하지 않는다.

## 11. Meta 설정

기존 Facebook Login 기반 게시 연결을 유지하면서 1차 파일럿에는 `instagram_manage_messages` scope를 추가한다.

필요 작업:

1. Meta 앱 이용 사례에서 Instagram 메시지 관리 권한을 추가한다.
2. OAuth 요청 scope에 `instagram_manage_messages`를 추가한다.
3. 기존 연결 계정을 재승인해 새 토큰을 저장한다.
4. 메시지 Webhook callback URL과 verify token을 등록한다.
5. `messages`, `messaging_postbacks`를 구독한다.
6. Growthline 계정으로 Standard Access 파일럿을 검증한다.
7. 외부 고객 연결 전에 Advanced Access와 App Review를 진행한다.

기존 토큰에는 신규 scope가 자동으로 추가되지 않으므로 재연결을 필수로 한다.

## 12. 주요 데이터

신규 논리 테이블:

```text
knowledge_imports
knowledge_entries
wiki_documents
wiki_document_versions
wiki_chunks
wiki_conflicts
instagram_dm_settings
instagram_dm_conversations
instagram_dm_messages
dm_reply_runs
unanswered_questions
```

기존 `jobs` 테이블에는 `wiki_refresh`, `instagram_dm_reply` 작업 유형을 추가한다.

모든 브랜드 소유 데이터는 `workspace_id`, `brand_id`를 가진다. 외부 메시지 ID와 발송 결과 ID를 함께 저장해 수신과 발송 멱등성을 보장한다.

## 13. 검증 전략

### 13.1 자동 테스트

- CSV와 Excel FAQ 파싱
- 필수 컬럼, 오류 행, 브랜드 내 중복 처리
- 자사 URL만 Wiki 입력에 포함
- 동일 hash chunk 임베딩 재사용
- 변경 chunk만 재임베딩
- 브랜드 범위를 벗어난 검색 차단
- Webhook challenge와 서명 검증
- 같은 `message.mid` 중복 처리
- 챗봇 OFF 시 작업 미생성
- 에코 이벤트 무응답
- 근거 충분 시 `answer`
- 근거 부족/충돌 시 `fallback`
- CLI 결과 계약 검증
- Meta 일시 오류 재시도
- 토큰 오류 `needs_attention`
- 동일 메시지 중복 발송 차단

### 13.2 파일럿 검증

Growthline 실제 계정으로 다음을 확인한다.

1. 메시지 권한이 포함된 OAuth 재연결
2. Webhook 수신
3. FAQ 기반 질문 답변
4. 사이트 기반 질문 답변
5. 표현이 다른 유사 질문 검색
6. 근거 없는 질문 fallback
7. 연속 메시지 병합
8. 중복 Webhook 재전송
9. 챗봇 OFF 상태
10. 토큰/권한 오류 상태 표시

## 14. 파일럿 완료 기준

- Growthline 실제 DM 20건 처리
- 중복 답변 0건
- 다른 브랜드 자료 노출 0건
- 근거 없는 임의 답변 0건
- 정상 질문 자동답변 성공률 90% 이상
- 응답시간 중앙값 10초 이내
- 수신, 검색 근거, CLI 실행, 발송 결과가 추적 가능
- fallback 질문이 미답변 목록에 기록

## 15. 단계별 진행 순서

1. 현재 Meta 앱의 메시지 이용 사례, 권한, Webhook 설정 상태를 확인한다.
2. DB와 `pgvector`, Wiki, DM 메시지 스키마를 추가한다.
3. FAQ CSV/Excel 업로드와 자사 사이트 Wiki 갱신을 구현한다.
4. embedding과 하이브리드 검색을 구현한다.
5. Meta Webhook과 Send API를 구현한다.
6. 별도 DM CLI 워커를 구현한다.
7. `/channels`, `/sources`, `/dm-automation`을 연결한다.
8. Growthline 계정으로 실제 파일럿을 실행한다.
9. 외부 고객용 Meta App Review 자료를 준비한다.

상세 구현 계획은 Meta 앱 현재 설정을 먼저 확인한 뒤 작성한다. 확인 결과에 따라 Facebook Login 유지 범위, 권한 신청 작업, Webhook 등록 순서를 구체화한다.
