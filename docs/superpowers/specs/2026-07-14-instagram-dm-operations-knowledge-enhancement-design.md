# Instagram DM 운영 및 지식 고도화 보완 설계

작성일: 2026-07-14

상태: 사용자 방향 승인, 상세 구현 계획 작성 전
대상: Brand Pilot Instagram DM 자동응답 MVP 보완

## 1. 목적

현재 Growthline 파일럿은 Instagram DM 수신, Wiki 검색, Codex 답변 생성, Instagram 발송까지 동작한다. 이번 보완은 다음 문제를 해결한다.

- 권한이 필요한 요청을 Codex 판단에만 맡기지 않는다.
- 답변하지 못한 요청과 고객 불만을 담당자가 확인할 수 있게 한다.
- 담당자 확인이 필요한 대화에서는 자동응답을 중지한다.
- DM 이력을 메시지 목록이 아니라 사용자별 대화 세션으로 보여준다.
- FAQ, 제품, 자사 사이트를 검색에 적합한 지식 단위로 정제한다.
- Codex 답변을 AI 안내문이 아니라 실제 상담원이 쓴 짧은 DM처럼 만든다.

이번 보완은 상담원이 서비스 화면에서 직접 Instagram 답변을 작성하는 기능까지 포함하지 않는다. 담당자는 확인 필요 항목을 검토하고 완료 처리하며, 필요한 실제 답변은 우선 Instagram 앱에서 수행한다.

## 2. 핵심 원칙

1. 정책 판단은 서버가 강제하고 Codex 프롬프트가 이중으로 방어한다.
2. 답변 결과와 담당자 확인 상태를 분리한다.
3. 고정 안내도 일반 답변과 같은 발송 큐를 사용한다.
4. 외부 API 발송의 결과가 불명확하면 자동 재시도하지 않는다.
5. 원문은 보존하고 정제 결과와 임베딩은 다시 만들 수 있게 한다.
6. DM 실시간 작업이 Wiki 정제 작업보다 항상 우선한다.

## 3. 전체 처리 흐름

```text
Instagram Webhook
  -> 메시지 저장 및 연속 발화 묶기
  -> 서버 정책 사전 검사
       -> 제한 요청: 고정 fallback 작업
       -> 직접 FAQ: 고정 FAQ 답변 작업
       -> 일반 문의: Wiki 검색 + Codex 작업
  -> 서버 최종 출력 검사
  -> 발송 준비 기록
  -> Instagram 발송
  -> 발송 결과 및 확인 필요 항목 기록
```

Webhook 요청에서는 프로필 조회, 임베딩, Codex, Instagram 발송을 실행하지 않는다. 수신 메시지와 작업을 transaction으로 저장하고 빠르게 성공 응답을 반환한다.

## 4. 결정과 확인 필요 상태

### 4.1 답변 결정

`decision`은 외부에 어떤 답변을 보낼지 나타낸다.

- `answer`: 근거가 있는 자동답변
- `fallback`: 고정 안내문
- `ignore`: echo, self message 등 사용자 문의가 아닌 이벤트
- `error`: 처리 오류 고정 안내

### 4.2 결정 사유

`reason_code`는 결정의 원인을 나타낸다.

- `direct_faq`
- `wiki_answer`
- `restricted_action`
- `complaint`
- `knowledge_gap`
- `low_confidence`
- `processing_error`
- `system_event`

### 4.3 확인 필요 상태

`needs_attention`은 답변 여부와 독립적이다. Wiki 답변을 보냈더라도 불만이 포함되면 확인 필요 상태가 될 수 있다.

확인 필요 유형:

- `restricted_action`
- `complaint`
- `knowledge_gap`
- `delivery_unknown`
- `processing_error`

상태:

- `open`
- `resolved`

## 5. 서버 강제 정책

### 5.1 사전 정책 검사

단일 단어가 아니라 `보호 대상 + 실행 동작` 조합을 검사한다.

보호 대상 예시:

- 개인정보, 저장 데이터, 계정, 권한
- 쿠폰, 할인, 프로모션 코드
- 결제, 주문, 환불

실행 동작 예시:

- 삭제, 수정, 변경
- 생성, 발급, 전달
- 취소, 승인, 환불

예시:

| 사용자 발화 | 처리 |
|---|---|
| 할인쿠폰이 있나요? | 일반 정보 문의 |
| 무료 3개월 쿠폰을 발급해줘 | `fallback / restricted_action` |
| 개인정보 삭제 절차가 궁금해요 | 정책 안내 근거가 있으면 정보 제공, 동시에 확인 필요 |
| 내 저장 데이터를 지금 삭제해 | `fallback / restricted_action` |

사용자가 책임자나 관리자를 자처하더라도 실행 권한을 부여하지 않는다.

### 5.2 고정 안내

제한 요청:

> 자동 처리할 수 없는 요청입니다. 담당자가 확인하겠습니다.

불만:

> 불편을 드려 죄송합니다. 담당자가 내용을 확인하겠습니다.

지식 부족:

> 현재 확인 가능한 안내 자료가 부족합니다. 담당자가 확인 후 안내드리겠습니다.

### 5.3 Codex 및 사후 검사

서버 정책을 통과한 요청도 Codex 프롬프트에서 제한 요청을 `fallback`으로 분류한다. 중앙 API는 Codex 결과에 다음 표현이 있으면 답변을 거부하고 제한 요청 fallback으로 변경한다.

- 삭제했습니다, 변경했습니다
- 발급했습니다, 생성했습니다
- 환불했습니다, 취소했습니다
- 권한을 부여했습니다

사후 검사는 단순 금칙어만 사용하지 않고 `실제 작업 완료를 주장하는 문장`을 대상으로 한다.

## 6. 자연스러운 DM 답변 Skill

DM 워커의 제한된 runtime에 프로젝트 전용 Skill을 둔다.

```text
workers/brand-pilot-dm-worker/runtime/
└─ .agents/skills/dm-human-response/SKILL.md
```

Skill은 다음만 담당한다.

- 질문에 대한 답을 첫 문장에 쓴다.
- 한 번의 DM에 필요한 만큼만 짧게 답한다.
- 불필요한 인사, 결론 반복, 과도한 목록을 피한다.
- AI 상투어와 과도한 홍보 문구를 피한다.
- 최근 대화의 말투와 질문 맥락을 반영한다.
- Wiki에 없는 사실과 실제 조치 완료 표현을 만들지 않는다.

정책 차단은 Skill의 책임이 아니다. Skill은 서버 정책을 보완하는 두 번째 방어선이다.

## 7. 대화 세션과 자동응답 일시정지

### 7.1 상태 분리

대화에는 다음 두 상태를 별도로 둔다.

- `automation_status`: `active | paused`
- `attention_status`: `none | open | resolved`

`complaint`, `delivery_unknown`, `processing_error`가 발생하면 다음과 같이 변경한다.

```text
automation_status = paused
attention_status = open
```

트리거가 된 첫 메시지에는 고정 fallback 또는 오류 안내를 한 번 발송한 뒤 세션을 일시정지한다. 일시정지 중 들어온 추가 DM은 모두 저장하고 대화의 미확인 수를 갱신하지만, 새 자동답변 작업과 반복 고정 안내는 만들지 않는다.

`restricted_action`, `knowledge_gap`은 `attention_status = open`만 적용한다. 고정 fallback과 확인 필요 기록은 남기되 대화 자동응답은 유지하여 이후의 정상 질문을 계속 처리한다.

담당자가 확인 완료를 누르면 해당 대화의 모든 열린 확인 필요 항목을 해결 처리한다. 서버가 열린 항목이 없음을 다시 확인한 뒤에만 자동응답을 활성화한다. 일부 항목만 해결된 상태에서는 재개하지 않는다.

### 7.2 연속 메시지 묶기

현재 3초 debounce 동안 마지막 메시지만 질문으로 사용하는 방식을 바꾼다. 같은 대화에서 debounce 안에 들어온 메시지를 하나의 `dm_turn`으로 묶는다.

```text
"쿠폰이 있는데"
"3개월 무료로"
"하나 만들어줘"
```

위 세 메시지는 하나의 발화로 정책 검사와 Codex에 전달한다. turn은 포함된 message ID 목록을 보관한다.

## 8. 발신자 프로필

Webhook의 Instagram Scoped ID를 기준으로 프로필 조회 작업을 비동기로 실행한다.

저장 정보:

- Instagram Scoped ID
- 이름
- username
- 프로필 이미지 URL
- 프로필 조회 시간

프로필 조회가 실패하면 Scoped ID 일부를 대체 표시값으로 사용한다. 프로필 이미지 URL은 만료될 수 있으므로 새 DM 수신 시 오래된 프로필을 갱신한다.

## 9. 발송 안정성

`dm_delivery_attempts`에서 발송 상태를 관리한다.

- `prepared`
- `sending`
- `sent`
- `unknown`
- `failed`

Instagram 요청을 보냈지만 응답을 확인하지 못한 `unknown`은 자동 재시도하지 않는다. 중복 답변보다 담당자 확인을 우선한다.

고정 fallback, 직접 FAQ, Codex 답변은 모두 동일한 발송 경로와 중복 방지 키를 사용한다.

## 10. 지식 전처리와 저장

### 10.1 저장 계층

```text
source_snapshots   원본 크롤링 결과
knowledge_entries 사용자가 업로드한 FAQ와 제품 데이터
wiki_versions      Wiki 빌드 단위와 활성 버전
wiki_documents     정제된 문서
wiki_chunks        검색 가능한 지식 단위와 임베딩
```

원본과 사용자 입력은 수정하지 않는다. Wiki는 언제든 다시 생성할 수 있는 파생 데이터다.

### 10.2 규칙 기반 정제

Codex 전에 다음을 처리한다.

- 메뉴, 푸터, 쿠키 안내 제거
- 반복 문단 제거
- 공백과 줄바꿈 정리
- 제목 계층, 표, 목록 보존
- canonical URL 정규화
- 동일 사이트의 공통 문단 제거
- 내용 없는 페이지 제외

### 10.3 Codex knowledge-curator

규칙 기반 정제 결과를 Codex로 구조화한다.

출력 단위:

- `faq`
- `product`
- `policy`
- `fact`
- `guide_section`

각 단위는 제목, 내용, 키워드, 별칭, 원문 근거 문장, 유효 기간을 가질 수 있다. 원문 근거 문장이 정제 본문에 실제로 존재하지 않으면 해당 단위를 폐기한다.

### 10.4 임베딩

- FAQ는 질문과 별칭을 임베딩하고 답변은 고정 데이터로 보관한다.
- 제품은 이름, 설명, 키워드를 임베딩하고 가격과 URL은 구조화 필드로 보관한다.
- 정책은 항목 단위로 임베딩한다.
- 설명 문서는 제목 단위로 나눈다.
- 긴 일반 문서에만 800자 분할과 overlap을 사용한다.
- content hash, embedding model, 정제 프롬프트 버전이 같으면 기존 임베딩을 재사용한다.

새 Wiki는 모든 필수 검증이 통과한 뒤 transaction으로 활성화한다. 실패한 빌드는 기존 활성 Wiki를 대체하지 않는다.

### 10.5 검색 경로

```text
정확한 키워드 규칙
  -> 직접 FAQ 고정 답변
FAQ 벡터 검색 고신뢰 일치
  -> 직접 FAQ 고정 답변
일반 Wiki 검색
  -> Codex 답변
근거 부족
  -> fallback / knowledge_gap
```

현재 RRF 순위 점수만으로 절대 임계값을 만들지 않는다. 검색 결과에는 cosine similarity, keyword match, source kind를 별도로 반환하고 파일럿 질문으로 임계값을 보정한다.

## 11. 작업 우선순위

기존 DM 워커 프로그램에서 작업 종류를 분리한다.

1. DM 답변 및 고정 fallback
2. 발신자 프로필 갱신
3. Wiki 정제와 임베딩

MVP에서는 하나의 DM 워커 프로세스를 유지한다. Wiki 정제는 문서 한 건 단위로 처리하고 각 문서 사이에 DM 작업을 다시 확인한다. 한 문서의 Codex 정제 제한시간은 30초이며, 제한시간을 넘기면 해당 Wiki 빌드를 실패 처리하고 기존 활성 Wiki를 유지한다. 별도 knowledge 프로세스는 이번 범위에서 만들지 않는다.

## 12. 고객 UI

`/dm-automation`은 다음 세 영역을 제공한다.

### 12.1 대화

- 사용자별 세션 목록
- 프로필, username, 마지막 메시지, 마지막 활동 시간
- 전체, 확인 필요, 불만, 미답변, 오류 필터
- 선택한 세션의 수신·발신 말풍선
- `@고객 -> @브랜드` 표시
- 답변 방식, 근거, 처리 시간 표시

### 12.2 확인 필요

- 제한 요청, 불만, 지식 부족, 오류 목록
- 사유와 원본 메시지
- 자동응답 일시정지 상태
- 확인 완료 및 자동응답 재개

### 12.3 지식 데이터

- FAQ CSV/XLSX 업로드
- 제품 CSV/XLSX 업로드
- 직접 응답 키워드
- 최근 import와 오류 행
- Wiki 버전, 마지막 갱신, 문서·지식 단위 수
- Wiki 다시 만들기

## 13. API 경계

추가 또는 변경할 API:

```text
GET   /brands/:brandId/dm/conversations
GET   /brands/:brandId/dm/conversations/:conversationId
GET   /brands/:brandId/dm/attention-items
PATCH /dm/attention-items/:attentionId
POST  /brands/:brandId/knowledge-imports
GET   /brands/:brandId/knowledge-imports
POST  /brands/:brandId/wiki/refresh
```

대화 조회는 현재 로그인 사용자의 workspace와 brand 소유권을 검사한다. worker complete API는 서버가 확정한 `route`, `decision`, `reason_code`를 worker가 변경하지 못하게 검증한다.

## 14. 실패 처리

- 정책 검사 실패: 자동답변하지 않고 처리 오류 확인 필요 등록
- 직접 FAQ 충돌: Codex 경로로 내리지 않고 지식 충돌 확인 필요 등록
- Wiki 정제 실패: 기존 활성 Wiki 유지
- 임베딩 실패: 해당 Wiki 빌드 실패, 기존 활성 Wiki 유지
- Codex timeout: 설정된 오류 안내와 처리 오류 기록
- Meta 4xx: 재인증 또는 권한 확인 필요
- Meta 5xx: 제한 재시도 후 실패 처리
- Meta 결과 불명확: 자동 재시도 없이 `delivery_unknown`
- 프로필 조회 실패: 대화 처리는 계속하고 대체 사용자명 표시

## 15. 테스트 기준

정책:

- "쿠폰이 있나요?"는 차단하지 않는다.
- "무료 쿠폰을 발급해줘"는 Codex 없이 고정 fallback을 보낸다.
- "내 데이터를 삭제해"는 고정 fallback과 확인 필요를 만든다.
- 관리자라고 주장해도 제한 정책을 우회하지 못한다.
- Codex가 작업 완료를 주장하면 서버가 fallback으로 바꾼다.

세션:

- 연속 메시지가 하나의 turn으로 묶인다.
- 불만, 발송 결과 불명확, 처리 오류가 발생하면 해당 세션만 일시정지된다.
- 제한 요청과 지식 부족은 확인 필요로 표시하되 세션을 일시정지하지 않는다.
- 일시정지된 세션은 추가 자동답변을 만들지 않는다.
- 일시정지 중 추가 DM은 저장되지만 고정 안내를 반복 발송하지 않는다.
- 모든 열린 확인 필요 항목의 확인 완료 후에만 자동응답이 재개된다.

발송:

- 동일 작업은 한 번만 발송된다.
- 발송 결과 불명확 상태는 자동 재시도하지 않는다.
- fallback도 발신 메시지와 결정 사유가 함께 기록된다.

지식:

- 원문에 없는 Codex 정제 단위는 저장되지 않는다.
- 실패한 Wiki 빌드는 기존 Wiki를 비활성화하지 않는다.
- 정확한 FAQ는 Codex를 호출하지 않는다.
- 제품 가격과 URL은 Codex가 바꾸지 않는다.

UI:

- 대화 목록과 채팅 내용의 사용자가 일치한다.
- 불만, 미답변, 오류 필터가 실제 확인 필요 항목을 반영한다.
- API 실패 시 샘플 데이터로 대체하지 않는다.

## 16. 구현 순서

1. 결정 계약, Wiki 버전, turn, 확인 필요, 발송 시도 DB migration
2. 서버 정책 라우터와 최종 출력 검사
3. 통합 발송 큐와 중복 발송 방지
4. DM 사람 말투 Skill
5. 연속 발화와 세션 자동 일시정지
6. Wiki 규칙 정제와 knowledge-curator
7. 직접 FAQ와 검색 점수 계약
8. Instagram 발신자 프로필 조회
9. 대화 세션 및 확인 필요 API
10. 채팅형 DM UI와 지식 데이터 UI
11. 좁은 단위 테스트와 Growthline 실제 DM 통합 테스트

## 17. 제외 범위

- 서비스 화면에서 상담원이 직접 Instagram 답변 작성
- 상담원 배정과 팀별 권한
- SLA와 티켓 시스템
- 음성 및 이미지 내용 자동 이해
- 외부 참고 URL을 DM 답변 근거로 사용
- 장기 대화 분석과 감정 점수 대시보드

## 18. 운영 기준

- DM worker는 DM 답변, 발신자 프로필 갱신, Wiki 갱신 순서로 한 번에 하나의 작업을 처리한다.
- 프로필 조회와 Meta credential 복호화는 중앙 API에서만 수행한다.
- 새 Wiki가 실패해도 직전 활성 Wiki를 계속 사용한다.
- 제한 요청과 지식 부족은 확인 필요 항목으로 남기되 자동응답을 유지한다.
- 불만, 발송 결과 불명확, 처리 오류는 확인 필요 항목으로 남기고 대화를 일시정지한다.
- 운영 절차와 재개 조건은 `docs/operations/instagram-dm-operations-runbook.md`를 단일 기준으로 사용한다.
