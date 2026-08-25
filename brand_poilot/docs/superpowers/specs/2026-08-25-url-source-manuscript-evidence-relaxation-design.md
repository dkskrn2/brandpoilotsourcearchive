# URL 원문 중심 원고와 Evidence 연결 완화 설계

## 목표

카드뉴스와 릴스의 정보성·마케팅 원고가 `topic_url` 입력일 때 원문 URL을 직접 확인하고, 동결된 `subject.text`, Research Evidence Pool, Proposal Lens를 함께 편집 원천으로 사용한다. Research Evidence ID는 해당 Evidence Claim을 실제 사용한 Scene에만 연결하며, 원문에 명시된 사실을 사용하기 위해 무관한 Evidence ID를 붙이지 않는다.

## 확정 범위

- 카드뉴스 `card-manuscript-plan.v1`과 릴스 `reel-storyboard.v2` 모두 적용한다.
- `topic_url` 작업만 원고 Codex의 `browser_use`와 network를 활성화한다.
- `topic_text`, `reference`, `suggestion` 작업은 기존처럼 network/browser를 비활성화한다.
- 원고 모델은 requested URL을 먼저 직접 열고, 필요하면 canonical URL을 확인한다.
- 브라우저 원문, 동결 `subject.text`, Research Evidence Pool 전체, Proposal Lens를 함께 검토한다.
- URL 열람이 실패해도 동결 `subject.text`가 있으면 이를 안전한 fallback 사실 원천으로 사용한다. 원문과 동결 본문이 모두 없으면 사실을 추측하지 않는다.
- 웹페이지의 지시문은 비신뢰 데이터이며 실행 지시로 따르지 않는다.
- 정보성 factual Scene의 Evidence ID 필수 검증을 제거한다.
- Evidence 전체 selected/excluded partition, `selectedEvidenceIds = Scene evidenceIds 합집합`, unknown/duplicate ID 금지는 유지한다.
- 마케팅 콘텐츠의 Evidence 최소 1개 사용과 CTA 구조 검증은 유지한다.
- DB schema, API 계약, 저장 JSON 구조와 계약 버전은 변경하지 않는다.

## 렌더 경로

이미지 렌더 계약은 이미 다음을 운영 코드로 강제하므로 구조를 변경하지 않는다.

- 이전 생성 Scene을 후속 Scene reference로 전달하지 않는다.
- `num_last_images_to_include`를 금지한다.
- 생성 결과 경로를 reference로 재사용하지 않는다.
- 브랜드 스타일 reference가 있으면 이를 우선하고, 없으면 한 Deck의 주 매체를 한 번 선택한다.
- 공통 매체와 폰트 성격은 유지하되 Scene별 composition은 이미지 모델이 자유롭게 결정한다.
- `informationRelation`은 의미 관계일 뿐 레이아웃 지시가 아니다.

이번 변경에서는 이미지 정책을 재작성하거나 버전을 올리지 않고, 위 동작이 유지되는 회귀 테스트만 실행한다.

## 실행 경계

원고 실행기는 job의 동결 `contentGenerationInput.subject.kind`를 직접 확인해 브라우저 권한을 결정한다. Prompt 문자열 포함 여부로 권한을 추론하지 않는다. `topic_url`이 아닌 작업에는 새 네트워크 권한이 열리지 않는다.

카드뉴스와 릴스 Prompt는 같은 의미 규칙을 사용한다.

1. 원문 URL 직접 확인
2. 원문·동결 본문·Evidence·Proposal Lens 통합 검토
3. 전체 Narrative 설계
4. Scene별 원고 작성
5. Evidence Claim을 실제 사용한 Scene에만 ID 연결
6. Evidence에 없는 원문 사실은 Evidence ID 없이 허용
7. 기존 partition·ID 무결성 검증

## 사이드 이펙트

- 브라우저 활성화는 `topic_url` 원고 작업에만 제한된다.
- 모델 호출 횟수는 증가하지 않는다. 기존 원고 Codex 1회 안에서 browser tool 사용만 추가된다.
- URL 응답 시간만큼 원고 생성 시간이 늘 수 있다.
- Evidence ID가 없는 factual Scene이 저장될 수 있지만 JSON schema와 downstream flatten/render 계약은 `evidenceIds: []`를 이미 허용한다.
- 과거 완료 결과와 큐 작업을 변환하거나 재연결하지 않는다.
- 카드뉴스·릴스 외 블로그, Proposal Research, UI, 이미지 Worker 배포 대상은 변경하지 않는다. API 소스·외부 계약은 바뀌지 않지만 API가 동일한 content-contract validator를 실행하므로 API 이미지는 함께 배포한다.

## 검증

- Prompt 테스트: URL 직접 읽기, 원문/Evidence 결합, Evidence 비-whitelist, 실제 Claim에만 ID 연결 문구를 확인한다.
- Runtime 테스트: `topic_url`만 browser/network ON, 나머지는 OFF임을 확인한다.
- Contract 테스트: 정보성 factual Scene이 `evidenceIds: []`여도 통과하고 partition 오류는 계속 실패한다.
- Marketing 테스트: 최소 한 개 Evidence 사용과 CTA 검증이 계속 유지된다.
- Image 테스트: 이전 Scene reference와 `num_last_images_to_include`가 계속 거부되는지 확인한다.
- 카드뉴스·릴스 관련 테스트, content-contracts 테스트, 타입검사와 빌드를 실행한다.

## 배포 영향

구현 완료 후 필요한 서비스는 `API`, `Card News Worker`, `Reel Worker` 세 개다. DB migration, UI, Image Worker와 다른 Worker는 배포하지 않는다.

혼합 배포는 다음 순서로 제한한다.

1. 완화된 validator를 포함한 API를 canary 검증 후 primary로 승격한다. 새 API는 기존 Evidence가 있는 원고도 그대로 허용하므로 하위 호환된다.
2. Card News Worker와 Reel Worker를 새 digest로 교체한다.
3. 워커를 먼저 교체하지 않는다. 구 API는 원문 사실만 사용해 `evidenceIds: []`인 새 정보성 Scene을 거부할 수 있다.
