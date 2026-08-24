# 제품 URL 이미지 참조 구현 계획

> 승인 범위: 선택 제품의 등록 이미지와 사용자 첨부 이미지를 유지하면서, 제품/서비스 `sourceUrls`의 상품 페이지에서 제품 이미지 후보를 찾아 카드뉴스와 릴스 이미지 생성에 참조로 전달한다. 운영 배포는 별도 승인 전 진행하지 않는다.

## 고정 결정

- 우선순위는 `product_image 첨부 > 등록 제품 이미지 > URL 추출 이미지`이다.
- 최종 제품 참조 이미지는 합계 최대 5장이다. 스타일·아바타·일반 보조 이미지는 이 5장 계산에서 제외한다.
- 원고 계약과 원고 워커 입력은 변경하지 않는다. 원고에는 이미 동결된 제품 설명·기능·효익을 계속 사용하고, `sourceUrls`는 이미지 참조 획득에만 쓴다.
- 실제 HTML 분석, 이미지 다운로드, 후보 선택, 이미지 모델 전달은 이미지 바이트를 소비하고 임시 작업공간을 소유한 이미지 워커가 담당한다.
- URL 이미지가 없거나 수집에 실패해도 콘텐츠 생성을 재시도하거나 실패시키지 않는다. 다른 참조가 있으면 그것을 쓰고, 전혀 없으면 이미지 없이 계속한다.
- 다운로드한 파일은 현재 visual session 임시 작업공간에만 저장하고 성공·실패·취소 모두 기존 `finally` 정리에서 삭제한다.
- `manual-visual-selection-frozen.v1`, 기존 콘텐츠 입력 계약, DB 스키마는 변경하지 않는다. 새 정보는 private versioned sidecar로 격리한다.
- 카드뉴스와 릴스에만 같은 규칙을 적용한다. 블로그의 현재 동작은 바꾸지 않는다.

## 데이터 흐름

1. API가 선택된 승인 제품 버전에서 `sourceUrls`를 읽는다.
2. API가 `product-visual-source-snapshot.v1` sidecar로 제품 ID, 버전 ID, 종류, 정규화된 HTTPS URL을 동결한다.
3. 원고 완료 뒤 API가 동일 sidecar를 기존 visual session claim의 private hydration field로 전달한다. 저장 render job v1 계약은 변경하지 않는다.
5. 이미지 워커가 먼저 첨부와 등록 이미지를 계산한다. 5장이 찼으면 URL을 가져오지 않는다.
6. 남은 수만큼 URL 페이지를 안전하게 읽어 이미지 후보를 추출·검증·중복 제거한다.
7. 선택된 제품 참조를 visual session 작업공간에 stage하고 `product-visual-reference-snapshot.v1` 감사 파일과 구조화 로그를 남긴다.
8. 이미지 생성 hook은 선택된 제품 참조 경로가 실제 `referenced_image_paths`에 포함됐는지 검사한다.
9. visual session 종료 시 URL 다운로드 파일과 감사 파일을 작업공간과 함께 삭제한다. 로그에는 경로 대신 출처·hash·선택/제외 사유를 남긴다.

## 후보 추출 규칙

- 우선 탐색: JSON-LD `Product.image` → 상품 gallery/main 영역 → `og:image` → 본문 대표 이미지.
- 고해상도 `srcset`, `data-src`, 원본 URL을 썸네일보다 우선한다.
- 제외: 로고, 파비콘, 아이콘, 배너, 소셜 버튼, 추천/관련 상품 영역, 추적 픽셀, 256px 미만, 극단 비율, 지원하지 않는 MIME.
- 이미지 내용의 텍스트 과다는 OCR 없이 완전 판정할 수 없으므로, DOM 영역·파일명·alt/class·비율로 명백한 상세 설명/배너만 제외한다. 이를 완전한 텍스트 검출로 표현하지 않는다.
- 이미지 byte hash로 중복을 제거하고 후보 목록은 bounded cap을 둔다.
- SSRF 방어는 기존 image worker source reader의 DNS/public-unicast/redirect/timeout/body-limit 규칙을 재사용한다.

## 작업 항목

### Task 1: Private sidecar 계약

- 수정: `packages/brand-pilot-content-contracts/src/productVisualReferences.ts`
- 수정: `packages/brand-pilot-content-contracts/src/index.ts`
- 테스트: `packages/brand-pilot-content-contracts/src/productVisualReferences.test.ts`
- `product-visual-source-snapshot.v1`과 `product-visual-reference-snapshot.v1`의 strict parser/hash 입력을 추가한다.
- 기존 공개 계약 파일은 수정하지 않는다.

### Task 2: API 동결 및 재시도 전달

- 수정: `apps/api/src/aiContentManualVisualSelection.ts`
- 수정: `apps/api/src/aiContentRepository.ts`
- 수정: `apps/api/src/aiContentRenderJobs.ts`
- 테스트: 관련 API unit/runtime/retry 테스트
- 승인 제품 버전의 `sourceUrls`를 start 시점에 sidecar로 동결하고 새 작업·재시도·render enqueue 전 구간에서 동일 값을 전달한다.
- JSONB job payload만 사용하며 DB migration은 추가하지 않는다.

### Task 3: 안전한 이미지 수집과 선택

- 추가: `workers/brand-pilot-image-worker/src/productVisualReferenceAcquisition.ts`
- 필요 시 수정: `workers/brand-pilot-image-worker/src/sourceReader.ts`
- 테스트: `workers/brand-pilot-image-worker/src/productVisualReferenceAcquisition.test.ts`
- fixture 기반으로 gallery 우선, 관련상품/로고 제외, small/extreme ratio 제외, content hash dedupe, 최대 5장, SSRF/redirect 차단을 검증한다.
- 선택 우선순위와 URL fetch 생략 조건을 별도 순수 함수로 검증한다.

### Task 4: Visual session stage 및 실제 도구 전달 강제

- 수정: `workers/brand-pilot-image-worker/src/aiContentRenderClient.ts`
- 수정: `workers/brand-pilot-image-worker/src/aiContentVisualSessionRenderer.ts`
- 수정: `workers/brand-pilot-image-worker/scripts/visualSessionImageAudit.mjs`
- 수정: 관련 renderer/hook/audit 테스트
- 저장 render job v1은 유지한다. API는 generation job의 private source sidecar를 claim 시점에만 hydrate하고, image worker는 없으면 기존처럼 동작한다.
- `visual-session-job.json`에 scene별 필수 제품 참조 경로를 기록한다.
- hook은 실제 tool call의 `referenced_image_paths`에서 필수 제품 참조 누락을 거부한다.
- 제품 참조는 제품 외형 유지용이며 모든 scene에 제품을 반드시 표시하라는 뜻은 아님을 prompt에 명시한다.

### Task 5: 감사 로그와 정리

- 구조화 로그에 generation/output ID, 후보 URL의 안전한 표기, discovery 방식, 크기/MIME/hash, 선택 순위, 선택/제외 사유를 기록한다.
- 인증정보·query secret·로컬 경로·image bytes는 로그에 남기지 않는다.
- 성공·실패·취소 테스트에서 임시 URL 파일이 남지 않는지 확인한다.

### Task 6: 회귀와 사이드 이펙트 검증

- 기존 첨부 이미지, 등록 제품 이미지, 스타일, 아바타, 일반 보조 이미지 동작을 각각 검증한다.
- 제품 이미지 없음, 서비스 URL에 이미지 없음, URL 차단/timeout, 잘못된 MIME, 중복 이미지, 5장 초과를 검증한다.
- 카드뉴스와 릴스는 동일 우선순위/한도/도구 전달 규칙을 검증한다.
- 블로그·Research·Proposal·UI·게시·DB migration diff가 없는지 확인한다.
- contracts/API/card/reel/image worker test와 build, `git diff --check`를 실행한다.

## 배포 영향(추후 승인 시)

- 변경 서비스: API, Image Worker. 카드뉴스와 릴스가 공유하는 visual session 경로에 함께 적용된다.
- 변경 없음: Customer UI, DB migration, Content Proposal Worker, Subject Analysis Worker, Blog Worker, 게시 서비스.
- 저장 render job 계약은 바뀌지 않고 private hydration 값은 optional이다. 따라서 API/Image Worker 순차 교체 중에도 기존 생성은 유지된다.
- 운영 배포 전 실제 운영 SHA/digest와 다른 hotfix를 다시 확인하고, 변경 서비스별 직전 digest를 rollback 대상으로 보존한다.

## 완료 조건

- 실제 image generation 인자에 선택 제품 참조가 들어간다는 테스트 증거가 있다.
- 첨부·등록·URL 참조 우선순위와 최대 5장이 코드로 강제된다.
- URL 후보와 선택/제외 이유를 생성 ID로 추적할 수 있다.
- URL 수집 실패가 별도 재시도나 생성 실패를 만들지 않는다.
- 임시 이미지가 visual session 종료 후 남지 않는다.
- 카드뉴스·릴스 외 현재 운영 기능의 계약과 동작은 변경되지 않는다.
