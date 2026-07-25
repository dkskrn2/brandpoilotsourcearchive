# Brand Pilot Managed Content Automation MVP

작성일: 2026-07-05  
최종 갱신: 2026-07-16
상태: 구현 기준 반영, 고객용 IA 확정  
범위: 관리형 콘텐츠 마케팅 자동화 서비스 MVP  

현재 런타임 구조와 워커 책임은 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)를 단일 기준으로 삼는다. 채널 또는 워커 기능을 변경할 때는 같은 작업에서 해당 문서를 갱신해야 한다.

## 1. 한 줄 정의

Brand Pilot Managed Content Automation은 사업자와 브랜드 운영자가 자사 URL, 참고 URL, 주제표를 등록하면 매일 콘텐츠 초안을 생성하고, 사용자의 승인 후 지원 채널에 게시하는 관리형 콘텐츠 운영 서비스다. 현재 지원 런타임 채널은 Instagram, Threads, X, LinkedIn, YouTube, TikTok이다.

Webflow는 지원하지 않는다. 마이그레이션 `035_remove_webflow_and_split_content_status.sql`에서 기존 Webflow 런타임 데이터와 DB 제약 값을 물리적으로 제거했으며 API, UI, 워커, 게시 경로에도 포함하지 않는다.

초기 제품은 완전 셀프서브 SaaS가 아니다. 고객별 채널 연결을 운영자가 도와주는 관리형 서비스로 시작하며, 고객에게 Meta access token 입력을 요구하지 않는다.

## 2. 왜 이 제품인가

많은 소규모 사업자와 브랜드는 마케팅이 필요하다는 사실은 알지만, 콘텐츠를 꾸준히 만들고 채널별로 변환해서 게시하는 운영을 지속하지 못한다. 문제는 콘텐츠 아이디어 부족만이 아니라 반복 운영이다.

이 제품은 사용자가 직접 매일 글을 쓰는 부담을 줄이고, 브랜드 자료와 주제표를 기반으로 승인 가능한 콘텐츠를 계속 생산하고 배포하는 운영 시스템을 제공한다.

성공 사례로 참고한 오늘의집, The Sill 같은 콘텐츠 중심 브랜드는 콘텐츠가 판매와 브랜드 신뢰를 만드는 구조를 보여준다. 다만 이 사례가 곧바로 자동화 SaaS 수요를 증명하지는 않는다. MVP의 검증 포인트는 "콘텐츠 자동 생성"이 아니라 "고객이 실제로 승인하고 게시할 만큼 쓸만한 결과가 반복적으로 나오는가"다.

## 3. MVP 포지션

### 3.1 제품 형태

- 셀프서브 SaaS가 아니라 관리형 자동화 서비스로 시작한다.
- 고객은 브랜드 정보, URL, 주제표, 승인 상태, 게시 상태를 UI에서 관리한다.
- 채널 연결은 고객별로 저장한다. Instagram/Threads는 우리 Meta 앱 기반 OAuth로 연결하고 credential은 중앙 API가 암호화 저장한다. 고객이 Meta token을 입력하는 UI는 제공하지 않는다.
- 자동 게시는 MVP에 포함한다. 복사만 제공하는 제품은 핵심 가치가 약하다.

### 3.2 대상 고객

초기 고객은 "마케팅이 필요한 모든 업종"이 아니라 아래 조건을 만족하는 고객으로 좁힌다.

- 이미 사업, 서비스, 상품, 콘텐츠 자산을 가지고 있다.
- 홈페이지, 상품 페이지, FAQ, 블로그, 고객 사례 등 브랜드 자료가 있다.
- 최소 주 3-5회 이상 콘텐츠 게시를 하고 싶지만 직접 운영이 어렵다.
- 채널 연결 세팅을 운영자와 함께 진행할 의사가 있다.
- 생성된 콘텐츠를 승인 또는 재생성 판단할 수 있는 담당자가 있다.

초기에는 여행, 교육, 커머스, B2B 서비스처럼 설명형 콘텐츠가 잘 맞는 업종이 유리하다. 업종은 제한하지 않지만, 입력 자료가 부족한 업종은 결과 품질이 낮아질 수 있다.

## 4. 핵심 결정 사항

| 항목 | 결정 |
|---|---|
| 지원 런타임 채널 | Instagram, Threads, X, LinkedIn, YouTube, TikTok |
| Facebook | Instagram에서 자동 공유되는 경우 별도 채널로 다루지 않음 |
| 콘텐츠 단위 | 하나의 주제를 여러 채널에 재가공 |
| 승인 방식 | Approve / Regenerate / Reject / Auto Approve |
| 자동 승인 | 브랜드 전체 옵션, 기본값 off, 정책 통과 시에만 허용 |
| 직접 수정 | MVP에서는 제공하지 않음 |
| 자동 게시 | 포함 |
| 생성 시간 | 매일 오전 10시 |
| 게시 시간 | 서비스 정책 슬롯 + 임의 지터 |
| 게시 개수 | 브랜드 전체 하루 최대 4개 주제 그룹 |
| 게시 개수 설정 | 사용자가 설정하지 않음 |
| 미게시 콘텐츠 | 다음날 큐로 이월 |
| 승인 안 된 콘텐츠 | 게시하지 않음 |
| 주제표 | CSV/Excel 업로드만 제공 |
| 주제표 행 재사용 | 한 번 쓰고 끝 |
| URL 종류 | 자사 URL, 외부 참고 URL |

## 5. MVP 범위

### 5.1 포함

1. 브랜드 프로필 등록
2. 자사 URL 등록
3. 외부 참고 URL 등록
4. URL 크롤링 및 스냅샷 저장
5. 주제표 CSV/Excel 업로드
6. 주제표 유효성 검사
7. 매일 오전 10시 콘텐츠 생성 배치
8. 주제 기반 마스터 초안 생성
9. 지원 채널별 결과물 계약과 생성 상태 관리
10. Instagram 이미지·영상 콘텐츠 생성
11. Threads 텍스트 콘텐츠 생성
12. 콘텐츠 검토함
13. 승인 / 자동 승인 / 재생성 / 거절
14. 승인 또는 자동 승인된 콘텐츠 게시 큐 등록
15. 브랜드별 하루 최대 4개 주제 그룹 자동 게시
16. 게시 성공/실패 상태 표시
17. 고객별 채널 연결 정보 저장
18. Instagram 게시용 이미지 렌더링 및 공개 URL 업로드
19. 브랜드 전체 자동 승인 설정
20. 자동 승인 차단 사유 표시
21. 기본 운영 로그

### 5.2 제외

1. 콘텐츠 직접 편집기
2. 사용자가 게시 시간을 직접 선택하는 기능
3. 사용자가 채널별 생성 개수를 직접 설정하는 기능
4. 고급 캘린더 편집
5. 댓글/DM 관리
6. 성과 분석 대시보드
7. 광고 집행
8. 해시태그 자동 실험
9. A/B 테스트
10. 다국어 자동 번역 운영
11. 결제/요금제
12. 고객 개인 Meta Developer App 세팅
13. 모바일 앱

## 6. 입력 소스 설계

### 6.1 자사 URL

자사 URL은 브랜드 콘텐츠 생성의 1차 근거다.

예시:

- 홈페이지
- 서비스 소개 페이지
- 상품 상세 페이지
- 가격 페이지
- FAQ
- 고객 사례
- 기존 블로그 글
- 회사 소개

처리 방식:

1. 사용자가 URL을 등록한다.
2. 시스템이 크롤링한다.
3. 본문, 제목, 메타 설명, 주요 문단을 추출한다.
4. 브랜드 지식 스냅샷으로 저장한다.
5. 이후 콘텐츠 생성 시 사실 근거로 우선 사용한다.

### 6.2 외부 참고 URL

외부 참고 URL은 인사이트와 트렌드 참고용이다. 원문을 요약해서 재게시하는 방식으로 쓰면 표절/요약봇처럼 보일 위험이 있다.

예시:

- 해외 사례
- 업종 뉴스
- 트렌드 리포트
- 경쟁사 콘텐츠
- 유튜브/리서치 링크
- 해외 브랜드 블로그

처리 원칙:

- 외부 글의 문장을 그대로 재사용하지 않는다.
- 콘텐츠의 주장, 구조, 관점 참고에만 사용한다.
- 자사 브랜드의 관점과 고객 문제로 재해석한다.
- 필요하면 출처 URL을 내부적으로 보관한다.
- 장문 콘텐츠에서는 출처 표시 옵션을 나중에 검토한다.

### 6.3 주제표

초기에는 사용자가 직접 주제표를 CSV/Excel로 업로드한다. UI에서 행을 직접 편집하지 않는다.

권장 컬럼:

| 컬럼 | 필수 | 설명 |
|---|---|---|
| topic_title | 필수 | 주제 제목 |
| topic_angle | 필수 | 어떤 관점으로 말할지 |
| target_customer | 선택 | 대상 고객 |
| region | 선택 | 지역 |
| season | 선택 | 계절/시기 |
| reference_url | 선택 | 참고 URL |
| priority | 선택 | 우선순위 |
| notes | 선택 | 추가 메모 |

상태:

- `uploaded`: 업로드됨
- `queued`: 생성 후보로 선택됨
- `used`: 콘텐츠 생성에 사용됨
- `skipped`: 중복 또는 정책상 제외
- `invalid`: 필수값 누락 등으로 사용 불가
- `failed`: 사용 중 오류 발생

중복 기준:

- `topic_title + topic_angle`이 같으면 중복으로 본다.

재사용 정책:

- 한 행은 한 번만 사용한다.
- 사용된 행은 다시 자동 선택하지 않는다.
- 같은 주제를 다시 쓰고 싶으면 사용자가 새 행을 업로드한다.

## 7. 콘텐츠 생성 플로우

```text
Source URLs + Topic Table + Brand Profile
  -> Topic Selection
  -> Master Draft
  -> Channel Outputs
  -> Review
  -> Publish Queue
  -> Channel Publish
```

### 7.1 Topic Selection

매일 오전 10시에 배치가 실행된다.

선택 기준:

1. 아직 사용되지 않은 주제표 행
2. 필수 컬럼이 유효한 행
3. 우선순위가 높은 행
4. 최근 사용한 주제와 중복도가 낮은 행
5. 연결된 URL과 관련성이 높은 행

MVP에서는 복잡한 최적화보다 안정성을 우선한다. 우선순위와 업로드 순서 기반으로 시작하고, 결과가 쌓이면 추천/스코어링을 추가한다.

### 7.2 Master Draft

Master Draft는 채널별 최종 콘텐츠가 아니라, 여러 채널로 재가공하기 전의 중심 원고다.

포함 정보:

- 핵심 메시지
- 대상 고객
- 문제 상황
- 브랜드 관점
- 근거 URL 요약
- 금지할 표현
- CTA 방향
- 채널별 변환 힌트

### 7.3 Channel Outputs

하나의 Master Draft에서 채널별 결과물을 만든다.

Instagram:

- Feed 캐러셀, Story, Reel 중 브랜드가 활성화한 포맷을 Feed → Story → Reel 순서로 순환
- 중앙 API는 주제와 포맷만 선택하고 storyboard나 최종 자산 수를 만들지 않음
- 워커가 Feed 카드·Reel 장면을 필요한 최소 1~5개로 결정하고 Story는 1080 x 1920 한 장 생성
- Feed는 1080 x 1080 PNG, Story/Reel 장면은 1080 x 1920 PNG
- Reel은 장면 PNG를 Python/FFmpeg로 H.264/AAC, 1080 x 1920, 30fps MP4로 합성

Threads:

- 짧은 본문
- 필요 시 스레드 구조
- 링크/CTA
- 과도한 해시태그는 피함

X / LinkedIn:

- 채널 글자 수와 링크 정책을 반영한 텍스트 결과물
- 채널별 CTA와 미리보기 계약

YouTube / TikTok:

- 영상·Shorts/Reel 계열 delivery format 계약
- 제목, 설명, 장면 또는 영상 산출물 metadata

## 8. 검토 플로우

### 8.1 검토 상태

채널별 결과물은 독립적으로 승인된다. MVP에서는 사람이 검토하는 수동 승인과 정책을 통과한 결과물을 자동으로 승인하는 자동 승인을 함께 제공한다.

상태:

| 상태 | 의미 | 사용자 액션 |
|---|---|---|
| `generating` | 생성 작업 대기 또는 실행 중 | 없음 |
| `generation_failed` | 생성 작업 최종 실패 | Instagram/Threads 재생성 또는 거절 |
| `pending_review` | 완성된 결과물의 검토 대기 | 승인, 재생성, 거절 |
| `approved` | 사용자 승인 완료 | 없음 |
| `auto_approved` | 자동 승인 완료 | 없음 |
| `auto_approval_blocked` | 완성된 결과물이 자동 승인 정책 또는 결과 검증을 통과하지 못함 | 수동 승인, 재생성, 거절 |
| `rejected` | 사용자 거절 완료 | 없음 |
| `regenerating` | 대체 결과물 생성 중 | 없음 |
| `regenerated` | 신규 결과물로 대체된 과거 결과 | 없음, 기본 목록에서 제외 |

기본 생성 전환은 `generating -> auto_approved/pending_review`이고 최종 실패는 `generating -> generation_failed`다. `auto_approval_blocked`는 생성이 끝난 완성 결과의 정책·검증 차단에만 사용하며 워커 대기, 실행 실패, 산출물 누락에는 사용하지 않는다.

재시도 가능한 워커 오류이고 시도 횟수가 남아 있으면 job만 `queued`로 되돌리고 결과물은 `generating`을 유지한다. 재시도 불가 오류, 최대 시도 횟수 소진, 결과 계약 또는 산출물 검증 실패는 job을 `failed`, 결과물을 `generation_failed`로 전환한다. 만료된 lease는 시도가 남아 있으면 다시 claim하고, 소진됐으면 다음 claim 정리 단계에서 최종 실패 처리한다.

### 8.2 사용자가 할 수 있는 액션

Approve:

- 해당 채널 결과물을 승인한다.
- 승인 즉시 게시 큐에 들어간다.

Auto Approve:

- 브랜드 전체 자동 승인 설정이 켜져 있고, 자동 승인 정책을 통과한 결과물을 시스템이 승인한다.
- 자동 승인된 결과물은 `auto_approved` 상태가 된다.
- 자동 승인된 결과물도 게시 전까지 게시 큐에서 확인할 수 있어야 한다.
- 자동 승인 기본값은 off다.

Regenerate:

- 직접 수정 대신 재생성을 요청한다.
- 현재 Instagram과 Threads 결과물만 재생성을 지원한다. X, LinkedIn, YouTube, TikTok 요청은 상태 변경 전에 거부한다.
- MVP에서는 간단한 재생성 사유 입력을 허용한다.
- 예: "더 전문적으로", "광고 느낌 줄이기", "여행 초보자 기준으로".

Reject:

- 해당 결과물을 폐기한다.
- 게시 큐에 들어가지 않는다.

### 8.3 직접 편집을 제외하는 이유

직접 편집기를 넣으면 MVP의 범위가 커지고, 콘텐츠 관리 도구와 경쟁하게 된다. 초기 가치는 "사용자가 콘텐츠를 직접 만드는 것"이 아니라 "승인만으로 운영이 굴러가는 것"이다.

다만 재생성 품질이 낮으면 직접 편집 요구가 커진다. 따라서 Regenerate UX는 반드시 있어야 한다.

### 8.4 자동 승인 정책

자동 승인은 완전 무검수 게시가 아니다. 브랜드 전체 자동 승인 설정이 켜진 상태에서, 시스템 검사 조건을 통과한 콘텐츠만 자동 승인된다.

초기 권장:

- 브랜드 전체 자동 승인 기본값은 off다.
- on 상태에서는 연결된 모든 채널 결과물이 동일한 자동 승인 정책 대상이 된다.
- 완성된 Instagram/Threads 결과물부터 품질 기준과 자동 게시 안정성을 확인한다.
- 자동 승인된 콘텐츠는 게시 큐에서 `자동 승인` 표시를 가진다.

자동 승인 통과 조건:

- 브랜드 금지어가 없다.
- 필수 CTA와 링크가 정상이다.
- 외부 참고 URL 문장 복제 위험이 낮다.
- 채널별 글자 수, 이미지, 필드 규격을 통과했다.
- 채널별 필수 필드와 산출물 규격이 정상이다.
- 최근 같은 주제와 중복도가 높지 않다.
- 브랜드 전체 자동 승인이 켜져 있다.

자동 승인 차단 조건:

- 외부 URL 의존도가 너무 높다.
- 금지 표현이 포함되어 있다.
- 민감 업종, 가격, 법률, 의료성 표현이 포함되어 있다.
- 완성 결과물에 필수 필드가 누락됐다.
- 완성 결과물이 채널별 정책 또는 결과 검증을 통과하지 못했다.
- 같은 주제 반복 가능성이 높다.

자동 승인 차단 시 결과물은 `auto_approval_blocked`가 되고, 사용자는 검토함에서 차단 사유를 확인한 뒤 수동 승인, 재생성, 거절 중 하나를 선택한다.

이미지 렌더링, worker 실행, 결과 계약 검증 자체가 실패하면 `generation_failed`다. OAuth, 토큰, 권한, 외부 게시 실패는 채널 연결 또는 게시 큐 실패로 처리하며 `auto_approval_blocked`로 바꾸지 않는다.

## 9. 게시 정책

### 9.1 기본 정책

- 생성 배치: 매일 오전 10시, 브랜드별 최대 4개 주제 그룹
- 게시 슬롯: 브랜드별 하루 4개
- 단위: `topic_publish_group`
- 사용자는 게시 시간을 설정하지 않음
- 서비스 정책상 정한 시간대에 임의 지터를 붙여 게시
- 수동 승인 또는 자동 승인된 콘텐츠만 게시
- 승인되지 않은 콘텐츠가 있으면 해당 슬롯은 비워둠
- 같은 주제의 채널 결과물은 준비가 끝나면 동일 슬롯과 `scheduled_for`를 공유
- 밀린 승인 콘텐츠는 다음 사용 가능한 주제 그룹 슬롯으로 이월

예시 슬롯:

| 슬롯 | 기준 시간 | 지터 |
|---|---:|---:|
| 1 | 11:30 | ±10분 |
| 2 | 14:30 | ±10분 |
| 3 | 17:30 | ±10분 |
| 4 | 20:30 | ±10분 |

위 시간은 MVP 기본값이며 운영 데이터에 따라 조정한다.

### 9.2 큐 정책

수동 승인 또는 자동 승인된 콘텐츠는 `publish_queue`에 들어간다.

큐 정렬 기준:

1. 승인 시간
2. 생성 날짜
3. 주제 우선순위
4. 채널 정책
5. 승인 유형

상태:

- `queued`: 큐에 있음
- `scheduled`: 게시 예정 시간 배정됨
- `publishing`: 게시 중
- `published`: 게시 완료
- `failed`: 게시 실패
- `deferred`: 다음날로 이월

### 9.3 실패 처리

게시 실패 시 즉시 무한 재시도하지 않는다.

실패 유형:

- 토큰 만료
- 권한 부족
- 계정 타입 문제
- 게시 제한
- 이미지 URL 접근 불가
- API 일시 장애

처리:

- 일시 장애는 제한된 횟수 재시도
- 인증/권한 문제는 `needs_attention`으로 표시
- 실패한 슬롯은 동일 날 다음 슬롯에 재시도 가능
- 계속 실패하면 다음날로 이월하지 않고 수동 확인 대상으로 둔다

## 10. 채널 연결 설계

### 10.1 초기 원칙

초기에는 고객별 채널 연결을 운영자가 돕되, Meta 계열 채널은 우리 앱의 OAuth 연결만 사용한다.

의미:

- 고객에게 Meta Developer Console 설정, 개인 Meta 앱 생성, access token 입력을 요구하지 않는다.
- OAuth로 획득한 credential과 계정 ID는 중앙 API가 암호화 저장하며 워커로 전달하지 않는다.
- App Review 전에는 앱 role/tester 또는 제한된 파일럿 계정만 사용한다.

중요한 현실:

Instagram/Threads는 단순히 고객 계정 ID와 비밀번호를 받는 방식으로 자동 게시할 수 없다. 공식 API를 사용해야 하고, 공식 API는 Meta 앱, 권한, 토큰, 계정 조건의 영향을 받는다.

OAuth 승인 이후 연결 상태, 계정 ID, scope, 만료와 capability를 중앙 API가 관리한다.

### 10.2 Instagram

현재 구현은 고객별 Instagram credential과 Business/Creator account ID를 중앙 DB에서 조회해 게시한다. `INSTAGRAM_PUBLISH_ENABLED`가 켜진 경우 Vercel Blob 공개 산출물을 Meta Graph API로 전달한다.

- Feed 캐러셀: 자식 컨테이너 생성·완료 확인 후 부모 캐러셀 생성
- Story: capability가 `available`이고 현재 credential의 scope·Story 게시 검증이 일치할 때만 생성
- Reel: 공개 MP4 URL로 `REELS` 컨테이너 생성
- 공통: 컨테이너 `status_code`를 기본 5초 간격, 최대 60회 폴링해 `FINISHED` 후 `media_publish` 호출

Instagram 리스크:

- 개인 계정은 불가
- Professional 계정 조건 필요
- 로그인 방식에 따라 Facebook Page 연결/권한 영향
- App Review 전 일반 고객 연결 제한
- API 게시 제한 존재
- 정방형 이미지/캐러셀 규격 오류 가능

### 10.3 Threads

Threads는 MVP에서 텍스트 중심으로 작게 시작한다.

초기 범위:

- 단문 게시
- 필요 시 thread 구조
- 이미지 게시와 캐러셀은 후순위

필요한 것:

- 우리 Meta 앱 기반 Threads OAuth 연결
- OAuth로 발급받은 Threads 계정 토큰
- 게시 권한
- 토큰 만료 관리
- 고객별 연결 상태

Threads 리스크:

- Instagram보다 API 운영 경험이 적다.
- 권한/App Review 흐름이 출시 속도에 영향을 준다.
- 토큰 만료와 재승인 정책을 운영 UI에서 처리해야 한다.

### 10.4 X, LinkedIn, YouTube, TikTok

네 채널은 런타임 카탈로그, 활성화 상태, 기본 delivery format, 생성 제약과 게시 어댑터 계약을 지원한다. 공급자별 OAuth 정보 또는 실제 게시 어댑터가 준비되지 않은 경우 각각 `oauth_required`, `provider_not_implemented`로 실패를 기록하며 게시 성공으로 처리하지 않는다.

## 11. 화면 설계

상세 기능 명세: `docs/specs/BRAND_PILOT_CUSTOMER_UI_FUNCTIONAL_SPEC.md`
디자인 시스템: `docs/specs/BRAND_PILOT_CUSTOMER_UI_DESIGN_SYSTEM.md`
와이어프레임: `docs/specs/BRAND_PILOT_CUSTOMER_UI_WIREFRAMES.md`

### 11.0 고객용 IA 확정

상태: 확정

MVP의 고객용 IA는 대시보드 없이 시작한다. 첫 화면은 고객의 현재 상태에 따라 온보딩, 콘텐츠 검토함, 게시 큐 중 하나로 진입한다. 운영자 전용 화면은 현재 범위에서 제외한다.

IA 원칙:

- 대시보드는 만들지 않는다.
- 고객은 콘텐츠 운영에 필요한 화면만 본다.
- 가장 중요한 반복 업무는 콘텐츠 검토와 게시 상태 확인이다.
- 설정성 화면은 뒤로 보내고, 실행성 화면을 앞에 둔다.
- 자동 승인은 별도 제품처럼 분리하지 않고 콘텐츠 검토/게시 큐/채널 설정 안에서 드러낸다.

고객용 내비게이션:

```text
온보딩

콘텐츠
  - 검토 필요
  - 자동 승인됨
  - 자동 승인 차단
  - 재생성 중
  - 거절됨

게시 큐
  - 오늘 게시 예정
  - 예정
  - 게시 완료
  - 실패

소스
  - 자사 URL
  - 참고 URL
  - 주제표 업로드
  - 주제 큐

채널
  - Instagram
  - Threads
  - X
  - LinkedIn
  - YouTube
  - TikTok
  - 연결 오류/권한 상태

브랜드 설정
  - 브랜드 프로필
  - 톤앤매너
  - 금지 표현
  - CTA
  - 기본 링크
  - 브랜드 전체 자동 승인
```

기본 진입 규칙:

- 온보딩이 끝나지 않았으면 `온보딩`으로 진입한다.
- 검토 대기 콘텐츠가 있으면 `콘텐츠 > 검토 필요`로 진입한다.
- 오늘 게시 예정 또는 실패 항목이 있으면 `게시 큐`에서 상태를 확인할 수 있게 한다.
- 모든 설정이 완료되고 검토할 콘텐츠가 없으면 `게시 큐 > 오늘 게시 예정`을 기본 업무 화면으로 둔다.

고객 여정:

```text
가입/초기 진입
  -> 온보딩 체크리스트
  -> 브랜드 설정
  -> 소스 등록
  -> 주제표 업로드
  -> 채널 연결
  -> 콘텐츠 생성
  -> 콘텐츠 검토 또는 자동 승인 확인
  -> 게시 큐 확인
  -> 게시 완료/실패 확인
```

핵심 성공 경험:

- 고객은 매일 새 콘텐츠를 직접 작성하지 않아도 된다.
- 고객은 검토가 필요한 콘텐츠만 빠르게 승인/재생성/거절한다.
- 브랜드 전체 자동 승인이 켜져 있으면 정책을 통과한 콘텐츠가 자동으로 게시 큐에 들어간다.
- 실패나 권한 문제는 게시 큐와 채널 화면에서 바로 확인할 수 있다.

### 11.1 온보딩 체크리스트

목적: 고객이 시작 가능한 상태인지 빠르게 확인한다.

항목:

- 브랜드 정보 입력
- 자사 URL 등록
- 참고 URL 등록
- 주제표 업로드
- Instagram 연결
- Threads 연결
- 활성 채널 연결 또는 게시 설정
- 첫 콘텐츠 생성
- 첫 승인
- 첫 게시 완료

상태:

- 완료
- 필요
- 오류
- 운영자 확인 필요

### 11.2 브랜드 설정

입력:

- 브랜드명
- 업종
- 핵심 고객
- 제품/서비스 설명
- 톤앤매너
- 금지 표현
- 기본 CTA
- 주요 링크

목적:

- 모든 콘텐츠 생성의 기준값으로 사용한다.

### 11.3 소스 URL 관리

탭:

- 자사 URL
- 참고 URL

리스트 컬럼:

- URL
- 유형
- 제목
- 마지막 크롤링 시간
- 상태
- 오류 사유
- 사용 여부

액션:

- URL 추가
- 다시 크롤링
- 비활성화
- 삭제

### 11.4 주제표 업로드

화면 구성:

1. 템플릿 다운로드
2. CSV/Excel 업로드
3. 검증 결과
4. 반영

검증 결과:

- 총 행 수
- 유효 행 수
- 중복 행 수
- 필수값 누락 행 수
- 사용 불가 행 수

MVP에서는 행 직접 편집을 제공하지 않는다. 오류가 있으면 파일을 수정해서 다시 업로드한다.

### 11.5 주제 큐

목적:

- 사용된 주제와 남은 주제를 확인한다.

탭:

- 사용 가능
- 생성 예정
- 사용 완료
- 오류
- 스킵

액션:

- 비활성화
- 우선순위 조정

직접 편집은 MVP 제외다.

### 11.6 콘텐츠 검토함

목적:

- 생성된 콘텐츠를 채널별로 승인/재생성/거절한다.
- 자동 승인된 콘텐츠와 자동 승인 차단 콘텐츠를 확인한다.

구성:

- 주제 카드
- 생성 근거
- 채널 탭: Instagram / Threads / X / LinkedIn / YouTube / TikTok
- 미리보기
- 자동 승인 상태와 차단 사유
- 승인 버튼
- 재생성 버튼
- 거절 버튼

표시해야 할 정보:

- 어떤 URL/주제표에서 생성됐는지
- 생성 시간
- 사용된 채널
- 승인 유형: 수동 승인 / 자동 승인 / 자동 승인 차단
- 게시 예정 여부
- 재생성 이력

### 11.7 게시 큐

목적:

- 오늘과 앞으로 게시될 콘텐츠 상태를 보여준다.

구성:

- 날짜별 보기
- 채널별 슬롯
- 게시 예정 콘텐츠
- 자동 승인으로 예약된 콘텐츠
- 수동 승인으로 예약된 콘텐츠
- 게시 완료 콘텐츠
- 실패 콘텐츠

사용자는 시간을 직접 변경하지 않는다. 다만 왜 비어 있는지, 왜 실패했는지는 명확히 볼 수 있어야 한다.

### 11.8 채널 연결

채널 카드:

- Instagram
- Threads
- X
- LinkedIn
- YouTube
- TikTok

브랜드 설정:

- 브랜드 전체 자동 승인 on/off
- 자동 승인 허용 범위
- 자동 승인 차단 조건 요약
- 자동 승인된 콘텐츠의 게시 전 표시 여부

상태:

- `not_connected`
- `connected`
- `needs_attention`
- `expired`
- `insufficient_permissions`
- `publish_failed`

표시:

- 연결 계정명
- 마지막 정상 확인 시간
- 마지막 게시 성공 시간
- 마지막 오류
- 재연결/정보 수정 버튼

## 12. 데이터 모델 초안

```text
workspaces
  brands
    brand_profiles
    source_urls
      source_snapshots
    topic_uploads
      topic_rows
    content_topics
      master_drafts
      channel_outputs
        review_events
        auto_approval_checks
        publish_queue
          publish_attempts
    brand_channels
      channel_credentials
      auto_approval_rules
    audit_events
    llm_runs
```

### 12.1 주요 테이블

`workspaces`

- 고객 조직 단위

`brands`

- 실제 콘텐츠를 운영하는 브랜드 단위

`brand_profiles`

- 브랜드명, 업종, 고객, 톤, CTA, 금지 표현

`source_urls`

- 자사/참고 URL 목록

`source_snapshots`

- 크롤링된 원문/요약/추출 결과

`topic_uploads`

- CSV/Excel 업로드 작업 단위

`topic_rows`

- 업로드된 개별 주제 행

`content_topics`

- 콘텐츠 생성에 선택된 주제

`master_drafts`

- 채널 공통 초안

`channel_outputs`

- Instagram/Threads/X/LinkedIn/YouTube/TikTok별 결과물

`review_events`

- 승인/재생성/거절 이력

`auto_approval_checks`

- 자동 승인 검사 결과, 통과/차단 여부, 차단 사유

`brand_channels`

- 브랜드가 사용하는 채널과 상태

`channel_credentials`

- 고객별 토큰/API 정보. 반드시 암호화 저장

`auto_approval_rules`

- 브랜드 전체 자동 승인 설정, 자동 승인 허용 여부, 차단 조건

`publish_queue`

- 게시 예정/진행/완료 상태

`publish_attempts`

- 실제 API 호출 이력

`llm_runs`

- LLM 호출 비용, 프롬프트 버전, 결과 추적

`audit_events`

- 운영자/사용자/시스템 변경 이력

## 13. 아키텍처 초안

```text
Web App
  - React
  - Next.js App Router
  - TypeScript
  - Tailwind CSS
  - shadcn/ui
  - Review Inbox
  - Source Manager
  - Topic Upload
  - Channel Connections

API Server
  - Auth
  - Workspace/Brand
  - Source URL
  - Topic Upload
  - Review
  - Publish Queue
  - Channel Credentials

Workers
  - URL Crawler
  - Daily Generator
  - Channel Adapter
  - Renderer
  - Publisher
  - Token/Health Checker

Storage
  - Database
  - Object Storage for rendered images
  - Encrypted credential store

External APIs
  - OpenAI
  - Instagram Graph API
  - Threads API
  - X API
  - LinkedIn API
  - YouTube Data API
  - TikTok API
```

## 14. Brand_Pilot 재사용 범위

재사용 가능:

- OpenAI draft 생성 구조
- Instagram channel adaptation 구조
- Instagram card news JSON 구조
- 이미지 렌더링 로직
- Supabase Storage 업로드 패턴
- Instagram publish container/media_publish 흐름
- 외부 webhook 처리와 서명 검증 패턴은 참고 가능
- Notion mirror는 선택

새로 만들어야 함:

- 멀티 워크스페이스
- 고객별 브랜드
- 고객별 채널 연결
- 고객별 credential 암호화 저장
- Threads, X, LinkedIn, YouTube, TikTok publishing adapter 구현
- 주제표 업로드/검증
- 게시 큐/슬롯 스케줄러
- 사이트 내 검토함
- 사이트 내 승인/자동 승인 플로우
- 연결 상태/오류 UI

현재 Brand_Pilot은 단일 계정 자동화 도구다. 새 서비스의 핵심 작업은 Brand_Pilot을 그대로 웹으로 감싸는 것이 아니라, 단일 계정 파이프라인을 고객별 멀티 채널 운영 시스템으로 바꾸는 것이다.

### 14.1 Brand_Pilot 현재 인프라

현재 Brand_Pilot은 별도 상시 서버 없이 GitHub Actions가 스케줄러와 워커 역할을 하고, Supabase가 상태 저장소와 공개 이미지 저장소 역할을 한다.

```text
GitHub Actions schedule
  -> Node CLI
    -> Supabase Postgres
    -> Supabase Storage
    -> OpenAI API
    -> Discord API
    -> Instagram Graph API
    -> Notion API

Discord button interaction
  -> Supabase Edge Function
    -> Supabase Postgres
```

위 Discord 승인 구조는 현재 Brand_Pilot의 기존 구조를 설명하기 위한 참고용이다. 새 서비스 MVP에서는 Discord 승인 플로우를 사용하지 않고, 처음부터 사이트 내 검토함에서 승인/자동 승인/재생성/거절을 처리한다.

구성 요소:

| 구성 | Brand_Pilot에서 하는 일 |
|---|---|
| GitHub Actions collection workflow | URL 수집, 초안 생성, Discord 검수 요청 |
| GitHub Actions publish workflow | 승인 콘텐츠 채널 변환, Instagram 렌더링, Storage 업로드, Instagram 게시 |
| GitHub Actions token alert workflow | Meta token 만료 경고 |
| Supabase Postgres | 콘텐츠 상태, 채널 결과, 이벤트 저장 |
| Supabase Storage | Instagram 게시용 public PNG/manifest 저장 |
| Supabase Edge Function | Discord 승인/거절 버튼 처리 |
| GitHub Secrets/Variables | OpenAI, Discord, Meta, Supabase, Notion 설정 저장 |
| SQLite | 로컬 개발 fallback |

현재 DB 핵심 구조:

```text
content_items
  - collected
  - draft_created
  - pending_review
  - approved
  - rejected
  - channel_generated
  - publish_pending
  - published
  - failed

channel_outputs
  - generated
  - publish_pending
  - published
  - failed

events
```

좋은 점:

- 상태 전이가 단순하다.
- 이벤트 로그가 있다.
- `next_retry_at`, `locked_until`로 중복 게시 방지를 시작했다.
- Supabase Storage public URL로 Instagram Graph API 요구사항을 해결한다.

부족한 점:

- workspace/brand 개념이 없다.
- 고객별 credential 저장 구조가 없다.
- 여러 채널/여러 고객 큐를 운영하기 어렵다.
- GitHub Secrets에 단일 계정 토큰이 박혀 있다.
- 승인 UX가 Discord 중심이다.
- GitHub Actions cron은 고객별 실시간 상태와 운영 UI에 약하다.

### 14.2 GitHub Actions를 그대로 쓰면 안 되는 이유

GitHub Actions는 내부 자동화에는 좋지만 고객 서비스 런타임으로는 맞지 않는다.

문제:

- 고객별 작업량이 늘면 queue 제어가 어렵다.
- 워크플로 실행 간격이 고정적이고 세밀한 슬롯 운영이 불편하다.
- 고객별 토큰을 GitHub Secrets로 관리할 수 없다.
- 장애/재시도/중복 실행 제어가 UI와 분리된다.
- Playwright 렌더링, 이미지 업로드, API 게시가 커지면 Actions 시간이 불안정해진다.
- 사용자가 승인하면 즉시 큐에 반영되는 서비스 경험을 만들기 어렵다.

따라서 GitHub Actions는 다음 용도로 제한한다.

- CI
- 테스트
- 배포
- 내부 파일럿 임시 cron
- 수동 운영 명령

서비스의 실제 생성/게시 런타임은 별도 worker가 맡아야 한다.

### 14.3 서비스형 MVP 인프라 권장안

초기에는 Brand_Pilot의 Supabase 중심 구조를 참고하되, GitHub Actions를 서비스 런타임으로 계속 쓰지는 않는다.

권장 MVP 인프라:

```text
Web App/API
  -> Supabase Auth/Postgres/Storage
  -> Node Worker
  -> External APIs
```

구체적인 조합:

| 영역 | 권장 |
|---|---|
| Web App/API | React + Next.js App Router, Vercel 또는 Render Web Service |
| Worker | Render Background Worker, Fly.io Machine, Railway Worker 중 하나 |
| DB | Supabase Postgres |
| Auth | Supabase Auth |
| Storage | Supabase Storage 또는 Cloudflare R2 |
| Queue | Postgres table-backed queue |
| Scheduler | Worker cron 또는 Render Cron/Supabase Cron |
| Secrets | 배포 플랫폼 env + DB 암호화 credential store |
| Monitoring | Sentry + worker logs + Slack/Email/System alert |

전체 구조:

```text
Browser
  -> React/Next.js Web App/API
    -> Supabase Auth
    -> Supabase Postgres
    -> Supabase Storage

Scheduler
  -> Worker enqueue jobs

Worker
  -> crawl URLs
  -> generate master drafts
  -> generate channel outputs
  -> render Instagram images
  -> upload artifacts
    -> publish supported channels
    -> write job attempts/events
    -> write auto approval checks

External APIs
  -> OpenAI
  -> Instagram Graph API
  -> Threads API
  -> X / LinkedIn / YouTube / TikTok APIs
```

### 14.4 Worker와 Queue

Worker는 이 서비스의 핵심이다. LLM 호출, 크롤링, 이미지 렌더링, 외부 API 게시를 처리한다.

필수 조건:

- Node.js 런타임
- Playwright/Chromium 실행 가능
- 긴 작업 처리 가능
- 환경변수 secret 관리 가능
- 실패 로그 확인 가능
- 일정 작업 실행 가능

Worker 작업 종류:

```text
daily_generation
source_crawl
topic_select
master_draft_generate
channel_output_generate
instagram_render
artifact_upload
instagram_publish
threads_publish
token_health_check
storage_cleanup
```

MVP에서는 Redis나 별도 메시지 큐 없이 Postgres table-backed queue로 시작한다.

권장 테이블:

```text
jobs
  id
  workspace_id
  brand_id
  job_type
  status
  payload_json
  priority
  run_at
  attempt_count
  max_attempts
  locked_until
  locked_by
  last_error
  created_at
  updated_at
```

상태:

- `queued`
- `running`
- `succeeded`
- `failed`
- `dead`
- `cancelled`

Worker는 `run_at <= now()`이고 lock이 없는 job을 가져가 실행한다. Brand_Pilot의 `locked_until`, `next_retry_at` 패턴을 일반 job queue로 확장하는 방식이다.

### 14.5 Scheduler

필요한 스케줄:

| 작업 | 시간 |
|---|---|
| Daily generation enqueue | 매일 10:00 KST |
| Publish slot 1 | 11:30 KST ±10분 |
| Publish slot 2 | 14:30 KST ±10분 |
| Publish slot 3 | 17:30 KST ±10분 |
| Publish slot 4 | 20:30 KST ±10분 |
| Token health check | 매일 09:00 KST |
| Storage cleanup | 매일 03:00 KST |
| URL recrawl | 고객/URL 정책에 따라 |

구현 원칙:

- Scheduler는 직접 게시하지 않는다.
- Scheduler는 job만 만든다.
- 실제 작업은 Worker가 lock을 잡고 실행한다.
- 지터는 job 생성 시 `scheduled_at`을 계산해서 넣는다.

### 14.6 Storage 설계

필요 bucket:

| Bucket | 공개 여부 | 용도 |
|---|---|---|
| topic-uploads | private | CSV/Excel 원본 |
| brand-assets | private 또는 public | 브랜드 로고, 참고 이미지 |
| rendered-content | public | Instagram/Threads가 가져갈 이미지 |
| generated-artifacts | private | LLM 결과, manifest, 백업 |

Instagram과 Threads 이미지 게시에는 외부 API가 접근 가능한 public URL이 필요하다. 따라서 게시용 이미지는 public bucket 또는 public CDN 경로가 필요하다.

초기에는 Supabase Storage public bucket으로 충분하다. 트래픽이 커지면 Cloudflare R2 + CDN으로 옮긴다.

권장 보관 기간:

- 게시용 public artifact: 30일 보관 후 삭제
- manifest: DB 또는 private storage에 장기 보관
- topic upload 원본: 고객이 삭제 요청할 때까지 보관, 또는 90일 정책
- source snapshot: 콘텐츠 재현/감사를 위해 보관하되 민감정보 포함 여부 확인

### 14.7 Secrets와 고객 credential

플랫폼 secret:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
WORKER_API_TOKEN
CREDENTIALS_ENCRYPTION_KEY
META_APP_ID
META_APP_SECRET
SENTRY_DSN
```

주의:

- `SUPABASE_SERVICE_ROLE_KEY`는 서버/worker에서만 사용한다.
- 브라우저에는 절대 노출하지 않는다.
- 고객 토큰은 env가 아니라 DB에 저장한다.

고객별 channel credential:

Instagram:

- OAuth access token
- 우리 Meta app id/app secret 참조
- instagram business account id
- token expiry
- granted scopes

Threads:

- OAuth access token
- user/profile id
- token expiry
- granted scopes

X / LinkedIn / YouTube / TikTok:

- 공급자 OAuth access token
- 공급자 account 또는 channel id
- token expiry와 granted scopes

저장 방식:

- `channel_credentials` 테이블에 암호화해서 저장
- 암호화 전용 master key는 `CREDENTIALS_ENCRYPTION_KEY`로 env에 보관
- 가능하면 Supabase Vault 또는 KMS를 사용
- 토큰 일부만 masked 표시
- 전체 토큰은 UI에 다시 보여주지 않음

### 14.8 환경 구성

Local:

- 개발자 로컬 테스트
- LLM mock
- 채널 publish mock
- Supabase local 또는 dev Supabase project
- 실제 Instagram/Threads 게시는 기본 off

Staging:

- 실제 API 연동 테스트
- 파일럿 전 검증
- Supabase staging project
- staging web app
- staging worker
- 지원 공급자별 test 계정
- 별도 OpenAI key 또는 usage tracking tag

Production:

- 고객 서비스
- Supabase production project
- production web app
- production worker
- production storage bucket
- Sentry/alert
- daily backup
- credential encryption key

절대 하지 말 것:

- staging과 production DB 공유
- 고객 토큰을 로컬 `.env`에 복사
- production service role key를 브라우저나 로그에 노출

### 14.9 단계별 인프라 세팅 순서

1. Supabase `staging`, `production` 프로젝트를 만든다.
2. Brand_Pilot schema를 그대로 쓰지 말고 멀티테넌시 schema로 새로 잡는다.
3. Storage bucket을 만든다.
   - `topic-uploads` private
   - `brand-assets` private
   - `rendered-content` public
   - `generated-artifacts` private
4. Web App/API를 배포한다.
5. Worker를 배포한다.
6. Scheduler를 설정한다.
7. Instagram publish 로직을 고객별 credential 기반으로 운영한다.
8. Threads는 텍스트 게시부터 연결한다.
9. X, LinkedIn, YouTube, TikTok은 공급자별 OAuth와 게시 어댑터를 순차 연결한다.
10. 브랜드별 전체 자동 승인 설정과 자동 승인 차단 사유를 저장한다.
11. 운영자 콘솔에서 연결 상태, job 실패, publish attempts, LLM 비용, storage usage를 볼 수 있게 한다.

### 14.10 실패 모드

| 실패 | 원인 | 대응 |
|---|---|---|
| 같은 콘텐츠 중복 게시 | worker 중복 실행, lock 실패 | `locked_until`, idempotency key, publish_attempt unique key |
| 승인됐는데 게시 안 됨 | queue 누락, slot 계산 오류 | 승인 이벤트에서 queue 생성 트랜잭션 처리 |
| 자동 승인된 부적절 콘텐츠 게시 | 검사 조건 부족, 프롬프트 실패 | 기본값 off, 자동 승인 조건, 차단 사유, 브랜드 전체 on/off |
| Instagram 이미지 접근 실패 | public URL 만료/권한 문제 | public bucket, 게시 전 URL fetch 검증 |
| 토큰 만료 | 고객 token 만료 | daily token health check와 재연결 안내 |
| LLM 비용 폭증 | 배치 중복 실행 | workspace별 daily limit, job idempotency |
| 외부 URL 크롤링 지연 | 대상 사이트 응답 지연 | timeout, snapshot 실패 상태, 재시도 제한 |
| 고객 데이터 노출 | RLS/권한 오류 | RLS 테스트, service role 분리, audit log |

## 15. 개발 순서

### Phase 1. 내부 운영 MVP

목표:

- Instagram과 Threads의 최소 생성·검토·게시 운영 루프를 만든다.

범위:

- 브랜드 설정
- URL 등록
- 주제표 업로드
- 매일 10시 생성
- Instagram/Threads 출력 생성
- 승인/재생성/거절
- 브랜드 전체 자동 승인 옵션
- 지원 채널 게시 큐
- Instagram/Threads 자동 게시

성공 기준:

- 한 브랜드가 1주일 동안 매일 콘텐츠를 생성하고 승인 후 게시할 수 있다.
- 브랜드 전체 자동 승인 off 상태에서 수동 승인 루프가 정상 동작한다.
- 브랜드 전체 자동 승인 on 상태에서 정책 통과 콘텐츠가 자동으로 게시 큐에 들어간다.

### Phase 2. Instagram 파일럿

목표:

- Brand_Pilot의 Instagram 렌더링/게시 로직을 고객별 설정으로 확장한다.

범위:

- 고객별 Instagram 연결 정보
- 카드뉴스 렌더링
- 이미지 public URL 업로드
- 브랜드 전체 자동 승인 정책 적용
- Instagram publish
- 게시 실패 표시

성공 기준:

- 2-3개 파일럿 계정에서 승인된 카드뉴스가 안정적으로 게시된다.

### Phase 3. Threads 파일럿

목표:

- Threads 텍스트 게시를 붙인다.

범위:

- Threads 채널 출력
- Threads 토큰/계정 연결
- 브랜드 전체 자동 승인 정책 적용
- 텍스트 게시
- 실패 상태 표시

성공 기준:

- 동일 주제를 Instagram과 Threads로 재가공해서 게시할 수 있다.

### Phase 4. 사이트 내 검토/승인 고도화

목표:

- 사이트 내 검토함을 정식 승인 화면으로 고도화한다.

범위:

- Review Inbox
- 미리보기
- 승인/재생성/거절
- 자동 승인 상태와 차단 사유 표시
- 재생성 이력
- 게시 큐 연결

성공 기준:

- 고객이 사이트에서 콘텐츠를 검토하고 승인 또는 자동 승인된 콘텐츠가 자동 게시까지 완료된다.

### Phase 5. 셀프서브 준비

목표:

- 관리형 서비스에서 SaaS로 넘어갈 준비를 한다.

범위:

- Meta App Review
- 개인정보처리방침/약관
- 연결 해제
- 데이터 삭제 요청
- 요금제/결제
- 고객별 사용량 제한

성공 기준:

- 운영자 개입 없이 신규 고객이 지원되는 게시 어댑터 하나 이상을 연결하고 게시할 수 있다.

## 16. 기술 리스크

### 16.1 Meta App Review

가장 큰 출시 리스크다.

Instagram/Threads는 고객 개인 Meta 앱 세팅이 아니라 우리 Meta 앱 기반 OAuth 연결로 간다. 따라서 일반 고객 확장을 위해서는 우리 Meta 앱의 App Review와 권한 승인이 필요하다.

리스크:

- 권한 승인 지연
- 심사 반려
- 개인정보처리방침/데모 플로우 미흡
- 고객 계정 타입 문제
- Live mode/Advanced Access 제한

대응:

- Instagram/Threads는 App Review 전까지 앱 role/tester 또는 제한된 파일럿 고객으로 검증한다.
- App Review는 별도 작업으로 초기에 시작한다.
- "AI가 무단 자동 게시"가 아니라 "고객 승인 후 게시" 구조로 설명한다.

### 16.2 콘텐츠 품질

자동 생성 품질이 낮으면 고객은 승인하지 않는다.

대응:

- 브랜드 프로필을 강제 입력한다.
- 자사 URL을 우선 근거로 사용한다.
- 외부 참고 URL은 참고용으로만 사용한다.
- 재생성 사유를 수집해서 프롬프트 개선에 반영한다.
- 승인률을 핵심 지표로 본다.
- 자동 승인 콘텐츠의 게시 후 문제 발생률을 따로 본다.

### 16.3 자동 승인 리스크

자동 승인은 운영 부담을 줄이지만 브랜드 훼손 리스크가 있다.

대응:

- 기본값은 off로 둔다.
- 자동 승인은 검증된 Instagram/Threads 파일럿 고객에게만 제한한다.
- 자동 승인 검사 결과와 차단 사유를 남긴다.
- 민감 표현, 금지어, 외부 URL 복제 위험, 채널 규격 오류는 자동 승인 차단 조건으로 둔다.
- 자동 승인된 콘텐츠도 게시 큐에서 구분 표시한다.

### 16.4 저작권/표절

외부 URL 기반 콘텐츠는 표절 리스크가 있다.

대응:

- 문장 재사용 금지
- 원문 요약 재게시 금지
- 브랜드 관점으로 재해석
- 외부 URL은 내부 근거로 기록
- 장문 콘텐츠는 출처 표시 옵션 검토

### 16.5 고객 온보딩 비용

OAuth 연결로 고객 난이도는 낮아지지만, 계정 타입, 권한, 공급자별 승인 절차, 자동 승인 정책 안내 때문에 초기 온보딩 비용은 여전히 존재한다.

대응:

- 초기 고객 수를 제한한다.
- 온보딩 체크리스트를 만든다.
- 운영자용 내부 메모/상태를 둔다.
- 반복되는 세팅은 자동화 후보로 기록한다.

## 17. 핵심 지표

제품 품질 지표:

- 생성 콘텐츠 승인률
- 자동 승인률
- 자동 승인 차단률
- 재생성률
- 거절률
- 게시 성공률
- 게시 실패 복구 시간
- 자동 승인 콘텐츠 문제 발생률

고객 가치 지표:

- 주간 게시 완료 수
- 승인까지 걸린 평균 시간
- 고객이 직접 작성하지 않아도 게시된 콘텐츠 수
- 고객 유지율

운영 지표:

- 고객 온보딩 소요 시간
- 채널 연결 실패율
- 토큰 만료/권한 오류 건수
- LLM 비용/콘텐츠
- 이미지 렌더링 비용/시간

초기 성공 기준:

- 파일럿 고객 3곳
- 각 고객이 2주 동안 최소 10개 콘텐츠 승인
- 승인 콘텐츠 게시 성공률 90% 이상
- 고객이 "직접 만들었을 때보다 운영 부담이 줄었다"고 말함

## 18. 운영 정책

### 18.1 승인 없이는 게시하지 않는다

자동 게시 제품이지만, MVP에서는 수동 승인 또는 정책 기반 자동 승인 없이는 게시하지 않는다. 자동 승인 기본값은 off이며, 자동 승인 정책을 통과한 콘텐츠만 게시 큐에 들어간다.

### 18.2 실패는 숨기지 않는다

게시 실패, 토큰 만료, 권한 오류는 고객에게 명확히 보여준다. 실패를 숨기면 신뢰가 깨진다.

### 18.3 외부 URL은 원문 복제에 쓰지 않는다

외부 URL은 아이디어와 맥락 참고용이다. 결과물은 고객 브랜드 관점의 새 콘텐츠여야 한다.

### 18.4 채널별 결과물은 독립 승인한다

같은 주제라도 Instagram은 승인, Threads는 재생성, X는 거절될 수 있다.

### 18.5 자동 승인은 브랜드 전체 설정으로 적용한다

자동 승인은 브랜드 설정에서 전체 on/off로만 제공한다. on 상태에서도 각 채널 결과물은 자동 승인 검사 조건을 통과해야 게시 큐에 들어간다. off 상태에서는 모든 채널 결과물이 수동 검토 대상으로 생성된다.

## 19. 대안 검토

### 대안 A. 완전 셀프서브 SaaS부터 만든다

장점:

- 장기적으로 확장성이 좋다.
- 고객 온보딩 비용이 낮아질 수 있다.

단점:

- Meta App Review와 OAuth 구현 때문에 출시가 늦다.
- 콘텐츠 품질 검증 전에 인프라에 시간을 많이 쓴다.
- 초기 고객이 실제로 원하는지 확인이 늦어진다.

판단:

- 지금 단계에서는 비추천.

### 대안 B. 관리형 서비스 + 자동화 도구로 시작한다

장점:

- 빠르게 고객 검증 가능
- 채널 연결 문제를 운영으로 흡수 가능
- 실제 승인률과 게시 성공률 데이터를 빨리 얻음

단점:

- 운영자 개입이 많다.
- 고객 수를 빠르게 늘리기 어렵다.
- 토큰/계정 세팅이 고객마다 다를 수 있다.

판단:

- MVP 추천안.

### 대안 C. Webflow 전용 콘텐츠 자동화로 좁힌다 (폐기된 과거 대안)

장점:

- 가장 빠르게 출시 가능
- Meta 리스크 없음
- 블로그 콘텐츠 품질 검증에 집중 가능

단점:

- 사용자가 기대하는 SNS 자동 운영 가치가 약해짐
- Instagram/Threads로 확장할 때 다시 설계 필요

판단:

- 채택하지 않는다. Webflow는 현재 지원 대상이 아니며 런타임 데이터와 제약 값도 물리적으로 제거됐다. 이 항목은 의사결정 이력으로만 남긴다.

## 20. 가장 중요한 가정

이 제품의 핵심 가정은 다음이다.

1. 고객은 콘텐츠를 직접 만드는 것보다 승인하는 것을 선호한다.
2. 고객은 완전 자동 무검수 게시보다 승인 후 자동 게시를 더 신뢰한다.
3. 자사 URL과 주제표만으로도 충분히 쓸만한 콘텐츠가 반복 생성된다.
4. 채널별로 재가공된 콘텐츠가 단일 채널 콘텐츠보다 더 높은 가치를 준다.
5. 초기 고객은 채널 세팅을 운영자와 함께 진행할 의사가 있다.
6. 일정 수준 이상 품질이 안정되면 고객은 브랜드 전체 자동 승인을 허용한다.

가장 먼저 검증해야 하는 것은 3번, 5번, 6번이다. 콘텐츠 품질, 온보딩 난이도, 자동 승인 신뢰도가 MVP의 생사를 결정한다.

## 21. 다음 액션

1. 와이어프레임 기준으로 React/shadcn 화면 구현 계획을 작성한다.
2. 각 고객에게 받을 입력 자료 템플릿을 만든다.
3. 주제표 CSV 템플릿을 만든다.
4. 파일럿 고객 후보 3곳을 정한다.
5. Instagram/Threads 생성·검토·게시 루프를 파일럿에서 검증한다.
6. Brand_Pilot Instagram 게시 로직을 고객별 OAuth credential 기반 config로 분리할 설계를 한다.
7. 완성 결과물에 대한 브랜드 전체 자동 승인 정책과 차단 조건을 정의한다.
8. Meta 앱의 OAuth redirect URI, 앱 도메인, 개인정보처리방침 URL, use case/permission 상세 설정을 정리한다.
9. Meta App Review는 병렬로 준비한다.

## 22. 자체 검토

문서 내 결정 사항은 현재 논의와 일치한다.

- 사용자는 채널별 게시 개수를 설정하지 않는다.
- 게시 시간은 서비스 정책으로 정한다.
- 하루 최대 4개는 채널별 개수가 아니라 브랜드 전체의 공용 주제 그룹 기준이다.
- 콘텐츠 직접 수정 기능은 제외했다.
- 자동 게시와 조건부 자동 승인은 MVP 핵심 범위에 포함했다.
- 주제표는 CSV/Excel 업로드만 제공한다.
- 주제 행은 한 번 사용하면 재사용하지 않는다.
- 지원 런타임 채널은 Instagram, Threads, X, LinkedIn, YouTube, TikTok이다.
- Webflow는 지원하지 않으며 런타임에서 물리적으로 제거됐다.
- Meta 계열 채널은 고객 개인 앱 세팅이 아니라 우리 OAuth 앱 연결로 시작한다.
- 고객용 IA는 대시보드 없이 온보딩, 콘텐츠, 게시 큐, 소스, 채널, 브랜드 설정으로 확정했다.

아직 확정되지 않은 항목:

- 브랜드 전체 자동 승인 허용 조건

이 항목들은 구현 설계 전에 결정해야 한다.
