# AI 콘텐츠 생성 스튜디오 실제 생성·저장 설계

작성일: 2026-07-18  
상태: 구현 설계 확정  
선행 문서: `docs/superpowers/specs/2026-07-18-ai-content-studio-ui-design.md`
품질 기준: `docs/superpowers/specs/2026-07-18-ai-content-worker-quality-guidelines.md`

## 1. 목표

AI 콘텐츠 생성 화면의 mock 데이터를 제거하고 사용자가 입력한 생성 요청을 실제 DB에 저장한다. 카드뉴스, 블로그, 마케팅 소재 전용 Codex CLI 워커가 각 산출물을 생성해 Object Storage에 업로드하고, 프론트는 저장된 실제 결과를 유형에 맞게 보여준다.

이번 구현은 다음을 완료해야 한다.

- 생성 중 새로고침하거나 다른 화면을 다녀와도 같은 작업을 다시 볼 수 있다.
- 카드뉴스는 실제 이미지 1~5장과 캡션·해시태그를 보여준다.
- 블로그는 실제 HTML, 대표 이미지, 본문 이미지 1~3장과 메타 정보를 보여준다.
- 마케팅 소재는 실제 이미지 1~3개와 결과별 카피를 보여준다.
- 결과 파일과 생성 텍스트는 DB와 Object Storage에 영속화한다.
- 생성 실패와 부분 실패는 원인을 표시하고 결과 단위 재시도를 지원한다.
- Instagram에 연결된 브랜드는 완성된 카드뉴스를 기존 게시 관리로 보낼 수 있다.

결제, 요금제별 실제 한도 결정, 새로운 이미지 모델 선택, 직접 편집기는 이번 범위에 포함하지 않는다.

## 2. 채택한 구조

기존 `channel_outputs`를 AI 콘텐츠 생성 저장소로 재사용하지 않는다. 자동 운영 콘텐츠와 사용자가 직접 요청한 AI 콘텐츠는 생성 목적, 사용량, 결과 형식과 게시 가능 범위가 다르기 때문이다.

AI 콘텐츠 전용 데이터 모델과 공통 작업 큐를 추가하고 다음 세 워커를 새로 만든다.

- `workers/brand-pilot-card-news-worker`: 카드뉴스 분석, 기획, PNG 1~5장과 게시 카피 생성
- `workers/brand-pilot-blog-worker`: 블로그 분석, 기획, HTML·메타 정보, 대표 이미지와 본문 이미지 생성
- `workers/brand-pilot-marketing-worker`: 마케팅 분석, 기획, 결과별 광고 이미지와 카피 생성

기존 `brand-pilot-image-worker`는 자동 운영용 SNS 콘텐츠만 계속 처리하며 코드와 작업 계약을 변경하지 않는다. 각 AI 콘텐츠 워커는 자신과 같은 `content_type`의 작업만 claim하고 다른 유형의 작업은 가져가지 않는다.

기존 자동 운영 워커와 세 AI 콘텐츠 워커는 서로 다른 프로세스지만 중앙 API의 동일한 `codex_cli` 리소스 lease 중 `content` workload를 사용한다. 같은 서버에서 실행할 때 비-DM Codex 슬롯 한도를 함께 적용하므로 여러 프로세스가 동시에 이미지 생성 CLI를 실행하지 않는다. 다른 서버로 분리한 뒤 처리량을 늘릴 때는 중앙 리소스 한도만 조정한다.

중앙 API는 생성 요청 검증, DB 저장, 작업 claim·lease, 결과 저장과 조회만 담당한다. 긴 LLM·이미지 생성은 중앙 API 요청 안에서 실행하지 않는다.

## 3. 전체 흐름

```text
React 생성 마법사
  -> 자사 정보 선택 시 generation만 즉시 생성하고 저장 상태 확인
  -> 제품 URL 선택 시에만 제품 페이지 analyze job 생성
  -> 사용자가 타깃·소구점·레퍼런스와 생성 지시 저장
  -> 최종 확인 후 output 슬롯 + 최종 analyze job 생성
  -> 활성 자사 Wiki가 없으면 Wiki 빌드를 먼저 요청하고 최종 analyze job은 대기
  -> 최종 분석 완료 후 output별 generate job 생성
  -> 유형별 워커가 실제 결과 생성
  -> 이미지/HTML/manifest를 Object Storage에 업로드
  -> 워커가 complete API 호출
  -> API가 output과 generation 상태 갱신
  -> React가 상태 조회 후 실제 결과 렌더링
```

자사 정보 선택은 콘텐츠 생성 단계가 아니다. 분석 시작 API는 generation과 현재 저장된 자사 정보 메타데이터만 기록하며 CLI 작업을 만들지 않는다. 활성 Wiki가 없어도 자사 URL이 등록되어 있으면 선택할 수 있다. 제품 URL을 선택한 경우에만 해당 단계에서 제품 페이지 분석 작업을 만든다.

사용자가 최종 확인을 마치면 생성 시작 API가 output 슬롯과 최종 품질 분석 작업을 만든다. 자사 정보를 선택했지만 활성 Wiki가 없으면 즉시 Wiki 빌드를 요청하며, 최종 분석 작업은 활성 Wiki가 준비된 이후에만 claim된다. 최종 분석이 완료된 뒤에만 output별 generate job을 만든다. 두 시작 API는 각자의 idempotency key를 사용하며 같은 요청이 다시 들어오면 새 작업을 만들지 않고 기존 generation을 반환한다.

## 4. 데이터 모델

### 4.1 `ai_content_generations`

한 번의 사용자 생성 요청과 전체 상태를 저장한다.

- `id`, `workspace_id`, `brand_id`
- `type`: `card_news | blog | marketing`
- `title`
- `status`: `draft | analyzing | analysis_ready | queued | planning | generating | completed | partial_failed | failed`
- `current_stage`: 현재 워커 단계
- `draft_json`: 제품 URL, 분석 근거 선택, 타깃, 소구점, 생성 지시의 스냅샷
- `analysis_json`: 실제 제품 분석과 추천 결과
- `analysis_idempotency_key`, `generation_idempotency_key`
- `error_code`, `error_message`
- `created_at`, `updated_at`, `completed_at`

`brand_id + analysis_idempotency_key`와 값이 있는 `brand_id + generation_idempotency_key`는 각각 유일해야 한다.

### 4.2 `ai_content_generation_outputs`

생성 안의 실제 결과 단위를 저장한다.

- `id`, `generation_id`, `output_index`
- `title`
- `status`: `queued | planning | generating | completed | failed`
- `content_json`: 캡션, 해시태그, 블로그 메타, 광고 카피 등 유형별 구조화 결과
- `artifact_manifest_json`: 화면 표시와 다운로드에 필요한 파일 목록
- `manifest_url`: Object Storage manifest 위치
- `failure_code`, `failure_message`
- `downloaded_at`
- `created_at`, `updated_at`, `completed_at`

`generation_id + output_index`는 유일해야 한다. 카드뉴스와 블로그는 기본 한 개, 마케팅 소재는 사용자가 선택한 1~3개의 output을 만든다.

### 4.3 `ai_content_generation_attachments`

사용자가 분석·생성에 첨부한 실제 파일을 저장한다.

- `id`, `generation_id`
- `role`: `product | person | scale | visual_reference | document`
- `file_name`, `mime_type`, `size_bytes`, `checksum`
- `storage_url`, `storage_path`
- `created_at`, `deleted_at`

브라우저는 중앙 API가 발급한 제한된 업로드 토큰으로 Object Storage에 직접 올리고, 업로드 완료 후 API에 파일 메타데이터를 확정한다. 워커에는 읽기 가능한 URL만 전달한다.

### 4.4 `ai_content_generation_jobs`

워커 lease와 재시도를 관리한다.

- `id`, `generation_id`, `output_id` nullable
- `job_type`: `analyze | generate`
- `content_type`: `card_news | blog | marketing`
- `status`: `queued | processing | succeeded | failed`
- `payload_json`
- `attempt_count`, `max_attempts`, `available_at`
- `worker_id`, `lease_token`, `lease_expires_at`, `last_heartbeat_at`
- `error_code`, `error_message`
- `skill_version`
- `created_at`, `updated_at`, `completed_at`

generation에는 처리 가능한 활성 `analyze` job이 하나만 존재하고, 동일 output에는 활성 `generate` job이 하나만 존재한다. 만료된 lease는 다음 claim 시 재큐잉한다. 각 claim 쿼리는 요청한 `content_type`을 반드시 조건으로 사용한다.

### 4.5 `ai_content_generation_references`

선택한 레퍼런스의 순서와 당시 내용을 저장한다.

- `generation_id`, `reference_id`, `position`
- `reference_snapshot_json`

원본 레퍼런스가 나중에 수정되거나 삭제되어도 과거 생성 근거는 유지한다.

### 4.6 `ai_content_usage_ledger`

자동 운영과 분리된 실제 생성·신규 다운로드 사용량을 기록한다.

- `id`, `workspace_id`, `brand_id`, `generation_id`, `output_id`
- `usage_type`: `generation | new_download | reversal`
- `quantity`, `usage_date`, `idempotency_key`
- `created_at`

성공한 output 개수만큼 생성 사용량을 기록한다. 같은 output의 재다운로드는 신규 다운로드 사용량을 추가하지 않는다. 한도 값은 API 환경 설정에서 읽고 프론트에 하드코딩하지 않는다.

### 4.7 기존 테이블과 연결

브랜드 타깃과 소구점은 화면 설계의 `brand_audiences`, `brand_appeals`를 실제 테이블로 추가한다. 게시 관리로 보내기를 실행할 때만 기존 `content_topics`, `channel_outputs`와 게시 그룹을 생성하고 `ai_content_generation_output_id`를 출처로 기록한다.

## 5. 유형별 결과 계약

### 5.1 공통 manifest

```json
{
  "version": "ai-content.v1",
  "type": "card_news",
  "title": "결과 제목",
  "assets": [
    {
      "role": "slide",
      "url": "https://storage.example/result/slide-01.png",
      "fileName": "slide-01.png",
      "mimeType": "image/png",
      "width": 1080,
      "height": 1080,
      "index": 1
    }
  ],
  "content": {}
}
```

프론트는 임의의 URL 규칙을 추론하지 않고 manifest만 사용한다.

### 5.2 카드뉴스

- `assets`: 정방형 PNG 1~5장, `role=slide`
- `content.caption`: 실제 게시 캡션
- `content.hashtags`: 최대 5개
- `content.cta`: CTA 문구
- 슬라이드 수는 워커가 내용에 맞춰 결정한다.
- 프론트는 모든 슬라이드를 순서대로 보여주고 개별·전체 다운로드를 제공한다.

### 5.3 블로그

- `assets`: 대표 이미지 1장, `role=cover`
- 본문 이미지 1~3장, `role=inline`
- HTML 파일 1개, `role=html`
- `content.title`, `summary`, `html`, `metaTitle`, `metaDescription`
- HTML은 저장된 문자열을 직접 DOM에 삽입하지 않고 sandbox iframe의 `srcDoc`로 미리보기한다.
- 다운로드는 HTML, 대표 이미지, 본문 이미지와 전체 ZIP을 제공한다.

### 5.4 마케팅 소재

- output 하나당 이미지 1장
- `content.headline`, `body`, `cta`, `concept`
- 요청한 비율을 manifest의 width·height로 확인한다.
- 결과가 여러 개면 각 output을 독립적으로 완료·실패·재시도할 수 있다.

세 유형의 최종 형식은 카드뉴스·마케팅 소재는 PNG, 블로그는 HTML이다. 블로그는 HTML만 저장하지 않고 제목, 요약, 섹션 구조, meta title·description과 대표 이미지 정보를 `content_json`에 함께 저장한다.

## 6. API 계약

고객 API는 인증된 세션의 workspace·brand 소유권을 항상 검사한다.

- `POST /brands/:brandId/ai-content/generations`
  - 콘텐츠 유형, 분석 근거와 analysis idempotency key를 받아 generation과 analyze job을 만든다.
- `PATCH /brands/:brandId/ai-content/generations/:generationId`
  - 분석 후 사용자가 선택한 타깃·소구점·레퍼런스와 생성 지시를 저장한다.
- `POST /brands/:brandId/ai-content/generations/:generationId/generate`
  - generation idempotency key를 받아 output 슬롯과 generate job을 만든다.
- `GET /brands/:brandId/ai-content/generations`
  - 최근 생성 목록과 output 요약을 반환한다.
- `GET /brands/:brandId/ai-content/generations/:generationId`
  - 실제 draft, 분석, output과 manifest를 반환한다.
- `POST /brands/:brandId/ai-content/outputs/:outputId/retry`
  - 실패 output에 새 job을 하나 생성한다.
- `POST /brands/:brandId/ai-content/outputs/:outputId/download`
  - 최초 다운로드 시각을 기록하고 다운로드 URL 묶음을 반환한다.
- `POST /brands/:brandId/ai-content/outputs/:outputId/send-to-publish`
  - 완성된 카드뉴스를 기존 게시 관리 도메인으로 전달한다.
- `POST /brands/:brandId/ai-content/generations/:generationId/attachments/token`
  - 허용된 파일명, MIME과 크기로 제한한 직접 업로드 토큰을 발급한다.
- `POST /brands/:brandId/ai-content/generations/:generationId/attachments/confirm`
  - 업로드된 파일의 경로, checksum과 역할을 확정한다.
- `GET /brands/:brandId/ai-content/usage`
  - 오늘 생성·신규 다운로드 사용량과 API 환경 설정의 한도를 반환한다.
- `GET/POST /brands/:brandId/ai-content/audiences`
- `GET/POST /brands/:brandId/ai-content/appeals`
- `GET /brands/:brandId/ai-content/references`

워커 API는 기존 `WORKER_API_TOKEN` 인증을 사용한다.

- `POST /worker/ai-content-jobs/card-news/claim`
- `POST /worker/ai-content-jobs/blog/claim`
- `POST /worker/ai-content-jobs/marketing/claim`
- `POST /worker/ai-content-jobs/:jobId/heartbeat`
- `POST /worker/ai-content-jobs/:jobId/complete`
- `POST /worker/ai-content-jobs/:jobId/fail`

complete 요청은 결과 JSON과 manifest URL을 함께 제출한다. API는 manifest의 유형, 필수 자산, 파일 수와 MIME 유형을 확인한 뒤 완료 처리한다.

## 7. 워커 처리

세 AI 콘텐츠 워커는 각각 독립된 Node.js 패키지다. 기존 이미지 워커나 다른 AI 콘텐츠 워커의 런타임 코드를 import하지 않고 자신의 job client, prompt, 결과 parser, Codex Skill, Object Storage 업로드와 실행 진입점을 소유한다. 공통 API 타입은 중앙 계약 문서로만 맞추고 워커 간 런타임 의존성을 만들지 않는다. 이 경계로 한 유형의 프롬프트와 산출물 계약을 변경해도 다른 워커를 재배포하지 않는다.

각 워커의 제작 노하우와 자체 품질검사는 `2026-07-18-ai-content-worker-quality-guidelines.md`를 기준으로 전용 `SKILL.md`에 넣는다. 실행 때마다 인터넷을 검색하지 않고 versioned Skill을 사용한다. job과 완료 결과에 `skill_version`을 저장해 결과의 제작 기준을 추적한다.

실제 고성과 콘텐츠는 분야와 형식이 같은 경우에만 레퍼런스로 사용한다. 카드뉴스는 저장된 Instagram 인기 carousel과 자사 성과 데이터를, 블로그는 검색어·확인일이 기록된 검색 결과 구조를, 마케팅 소재는 사용자가 저장한 레퍼런스와 확인 가능한 자사 광고 성과를 사용한다. 공개 노출만 있고 성과 지표가 없는 콘텐츠를 상위 성과로 간주하지 않는다.

1. 자신의 콘텐츠 유형 전용 endpoint에서 job을 claim한다.
2. `content` workload로 중앙 Codex CLI 리소스 lease를 획득한다.
3. payload의 브랜드 정보, 자사 URL 근거, 제품 URL, 타깃, 소구점, 레퍼런스와 생성 지시를 한국어 prompt로 구성한다.
4. 워커가 전용 Codex Skill을 실행한다.
5. 결과 JSON을 계약에 맞게 검증한다.
6. 실제 이미지와 HTML을 Object Storage에 업로드한다.
7. manifest를 업로드하고 complete API를 호출한다.
8. 리소스 lease를 해제한 뒤 다음 작업을 가져온다.

카드뉴스·마케팅 워커는 기존 이미지 생성 방식과 동일한 Codex `image_gen` 흐름을 각각 구현하되 결과 schema를 공유하지 않는다. 블로그 워커는 구조화된 본문, HTML, 메타 정보, 대표 이미지와 본문 이미지 1~3장을 한 작업 안에서 완성한다. 본문 이미지는 상대 경로로 HTML에 배치한 뒤 업로드 과정에서 공개 저장소 URL로 치환한다. 제품 분석과 타깃·소구점 추천은 사용자가 Step 1에서 선택한 콘텐츠 유형의 워커가 `analyze` 작업으로 수행한다. 중앙 API는 콘텐츠 문구, 이미지 장수나 블로그 구조를 대신 결정하지 않는다.

## 8. 프론트 연결

제품·서비스 분석은 마법사 진입이나 단계 이동만으로 실행하지 않는다. 정규화된 `브랜드 + 유형 + URL` 캐시가 있으면 즉시 보여주고, 캐시가 없을 때 사용자가 `분석 시작`을 눌러야 작업을 만든다. `다시 분석`은 이전 결과를 덮어쓰지 않고 다음 `analysis_version`을 만든다.

분석 워커는 한 프로세스·동시 실행 1개로 시작한다. 단일 작업 제한 시간은 15분, 최대 시도 횟수는 3회다. 주기적 재분석은 하지 않으며 사용자가 명시적으로 요청한 경우만 새 분석 버전을 만든다. 운영자는 큐 깊이, 가장 오래된 대기 작업, 제한 시간을 넘긴 lease를 확인한다.

분석 단계에서 보관한 제품 이미지는 기존 생성물 재현에 필요하므로 분석과 함께 유지한다. 마지막 단계의 제품·인물·크기·시각 참고 첨부는 생성 작업이 끝난 뒤 제거한다. 외부 검색 결과는 VOC·대안·시장 맥락에만 사용하고 출처 URL이 없는 주장은 생성 입력에 포함하지 않는다.

`mockAiContentGateway`는 테스트 fixture 외에서는 사용하지 않는다. 실제 `AiContentApiGateway`가 공통 `apiClient`를 통해 API를 호출한다.

- 마법사의 `생성 시작`은 draft를 POST하고 반환된 generation ID로 이동한다.
- 결과 페이지는 생성 중일 때 3초 간격으로 조회하고 terminal 상태에서 중단한다.
- 페이지를 새로고침해도 URL의 generation ID로 실제 데이터를 다시 조회한다.
- 홈 화면은 실제 생성 목록, 상태와 실제 썸네일을 표시한다.
- 카드뉴스는 이미지 gallery, 블로그는 sandbox HTML preview, 마케팅은 output별 이미지와 카피로 표시한다.
- artifact가 없는 output에는 결과 대신 현재 단계 또는 실패 사유만 표시한다.
- API 오류를 mock 결과로 대체하지 않고 재시도 가능한 오류 상태로 표시한다.

## 9. 실패와 중복 방지

- 생성 버튼은 요청 중 비활성화하고 idempotency key를 유지한다.
- 워커 heartbeat가 끊긴 lease는 만료 후 재큐잉한다.
- complete는 lease token과 현재 상태가 일치할 때 한 번만 반영한다.
- Object Storage 업로드 성공 후 DB 완료 저장이 실패하면 같은 job 재시도에서 같은 경로를 덮어써 중복 파일을 만들지 않는다.
- 결과 중 일부만 실패하면 generation은 `partial_failed`다.
- 재시도는 실패 output만 `queued`로 바꾸며 성공 output은 유지한다.
- 실제 생성 실패 시 샘플 이미지나 샘플 본문을 보여주지 않는다.

## 10. 보안과 표시 규칙

- 고객 API는 현재 사용자에게 속한 brand 데이터만 반환한다.
- 워커에는 API token 외에 DB, Supabase와 Meta credential을 전달하지 않는다.
- 제품 URL과 내부 근거 URL은 prompt에 제공하되 최종 카드 이미지, 캡션, 블로그 본문과 마케팅 카피에 출처 URL을 자동 노출하지 않는다.
- HTML 미리보기는 script 실행, 상위 페이지 탐색과 외부 form 제출을 허용하지 않는다.
- 다운로드 URL은 저장소의 공개 정책을 따르며 결제 기반 다운로드 제한은 후속 과제로 유지한다.

## 11. 검증 기준

### 자동 테스트

- 마이그레이션이 신규 테이블과 유일성·상태 제약을 만든다.
- 생성 API가 draft, output과 job을 한 트랜잭션으로 생성한다.
- 같은 idempotency key 요청은 generation을 중복 생성하지 않는다.
- 워커 claim, heartbeat, complete, fail과 만료 lease 복구가 동작한다.
- 유형별 manifest parser가 정상 결과를 받고 필수 자산 누락을 거부한다.
- 프론트가 API 생성 ID로 이동하고 실제 manifest를 렌더링한다.
- 실패·부분 실패·재시도 상태가 저장 데이터와 일치한다.
- 카드뉴스 게시 전송은 기존 게시 output을 한 번만 만든다.

### 실제 확인

- 카드뉴스 1건을 생성해 실제 PNG 여러 장과 캡션을 확인한다.
- 블로그 1건을 생성해 실제 HTML, 대표 이미지와 본문 이미지가 올바른 위치에 표시되는지 확인한다.
- 마케팅 소재 2건을 생성해 서로 다른 실제 이미지와 카피를 확인한다.
- 생성 중 프론트를 새로고침해도 진행 상태와 최종 결과가 이어진다.
- 워커를 작업 중 종료하고 다시 실행했을 때 lease 만료 후 작업이 복구된다.

## 12. 완료 조건

- 운영 화면에서 mock 생성 항목과 Picsum 이미지가 보이지 않는다.
- 세 콘텐츠 유형 모두 실제 생성 요청, DB 저장, 워커 처리, 결과 조회와 다운로드가 연결된다.
- 성공 결과는 Object Storage의 실제 파일과 DB의 구조화 데이터를 사용한다.
- 실패를 샘플 결과로 숨기지 않는다.
- 기존 Instagram 자동 운영 이미지 워커와 DM 워커의 작업 계약을 깨뜨리지 않는다.
- 카드뉴스, 블로그와 마케팅 소재 작업은 각 전용 워커만 claim하며 기존 이미지 워커나 다른 유형 워커가 가져가지 않는다.
