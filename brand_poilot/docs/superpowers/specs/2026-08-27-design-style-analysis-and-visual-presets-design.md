# 디자인 스타일 분석·비주얼 프리셋 설계

**승인일:** 2026-08-27  
**기준 소스:** `codex-deploy/main` at `a77e83abe3c8478ffa78ea70119ea56b31f54658`  
**상태:** 사용자 승인 완료

## 목표

브랜드센터의 시각 자산을 사용자가 이해하는 개념대로 다시 나눈다.

- 디자인 스타일: 사용자가 올린 디자인 참고 이미지와 그 이미지의 비동기 분석 결과
- 아바타: 사용자가 올린 캐릭터·인물 참고 이미지
- 비주얼 프리셋: 디자인 스타일 하나와 선택적 아바타 하나의 조합
- 구성안 전략: 디자인 스타일과 분리하여 구성안 워커가 표현방식과 강조 관점을 자동 선택

콘텐츠 생성 최초 설정에는 프리셋을 노출하지 않는다. 사용자가 구성안을 선택한 뒤에만 비주얼 프리셋을 선택하고, 분석이 끝나지 않은 디자인 스타일을 포함한 프리셋은 생성에 사용할 수 없다.

## 승인된 결정

1. 브랜드센터의 디자인 스타일과 아바타는 모두 이미지 등록 중심 UI다.
2. 디자인 스타일의 색상·폰트·레이아웃·그래픽 특성은 사용자가 작성하지 않고 분석 워커가 추출한다.
3. 디자인 스타일이 분석 중이어도 그 스타일을 포함한 프리셋은 저장할 수 있다.
4. 분석 중이거나 분석에 실패한 스타일을 포함한 프리셋은 콘텐츠 생성에서 선택·사용할 수 없다.
5. 사용 가능한 프리셋만 기본 프리셋으로 지정할 수 있다. 이미 기본인 프리셋의 스타일을 수정하면 기본 표시는 유지하지만 분석이 끝날 때까지 자동 선택하지 않는다.
6. 콘텐츠 생성 최초 설정에는 프리셋, 표현방식, 강조 관점 입력을 추가하지 않는다.
7. 구성안 워커가 각 구성안의 표현방식과 강조 관점을 내부적으로 자동 선택한다.
8. 같은 표현방식이나 강조 관점을 여러 구성안이 사용할 수 있지만 내용·핵심 메시지·근거·전개·결론이 실질적으로 같아서는 안 된다.
9. 표현방식과 강조 관점은 디자인 스타일 분석 결과가 아니다. 둘은 구성안 전략 카탈로그에 속한다.
10. 프리셋은 구성안 선택 후 고르며 `프리셋 사용 안 함`을 허용한다.
11. 기존 `디자인 프리셋 보관` UI와 API 동작을 제거한다.
12. 운영 규칙의 `designRules`는 UI·신규 저장·자동 생성·콘텐츠 소비 경로에서 제거한다.
13. 과거 콘텐츠 생성에 동결된 입력 스냅샷은 감사·재현을 위해 변경하지 않는다.
14. CTA는 필요한 경우에만 보조적으로 허용하고, 카드·릴스 원고의 밀도 상한은 새로 만들지 않는다.
15. 카드·릴스 편집 규칙은 첫 장면·중간 장면·마지막 장면 기준을 유지하며 두 번째 장면 전용 규칙은 만들지 않는다.

## 현재 구현과 변경 이유

현재 `brand_style_presets`는 이름, 설명, 사용자가 직접 입력하는 `visual_tokens_json`, 참고 이미지와 기본 여부를 한 객체에 저장한다. 콘텐츠 생성에서는 이 스타일 프리셋과 아바타를 각각 선택한다. 브랜드센터 하단의 스타일 이미지 보드는 별도 스타일 객체가 아니라 `brand_rule_sets.rules_json.designRules.referenceImages`를 편집한다.

이 구조에는 세 가지 문제가 있다.

- 디자인 스타일과 프리셋이 같은 객체라서 스타일 재사용과 아바타 조합이 분리되지 않는다.
- 같은 디자인 정보가 스타일 프리셋과 운영 규칙 `designRules`에 중복 저장된다.
- 사용자가 색상·폰트·레이아웃을 직접 작성하므로 업로드한 이미지와 저장된 텍스트가 어긋날 수 있다.

새 구조는 이미지 원본, 분석 결과, 조합 프리셋, 생성 시점 동결 데이터를 서로 분리한다.

## 사용자 흐름

```text
브랜드센터 / 스타일
  ├─ 디자인 스타일 생성
  │    ├─ 이름 입력
  │    ├─ 이미지 1~5개 업로드
  │    └─ 저장 즉시 분석 대기 → 분석 중 → 사용 가능/분석 실패
  ├─ 아바타 생성
  │    ├─ 이름 입력
  │    └─ 이미지 1~5개 업로드
  └─ 비주얼 프리셋 생성
       ├─ 디자인 스타일 선택(분석 중이어도 저장 가능)
       ├─ 아바타 선택 또는 사용 안 함
       └─ 사용 가능한 프리셋만 기본 설정 가능

콘텐츠 생성
  최초 설정 → 구성안 3개 생성 → 구성안 선택 → 비주얼 프리셋 선택 → 원고/이미지 생성
```

최초 설정은 주제, 목적, 제품·서비스, 결과 형식, 채널, 자료와 추가 요청만 다룬다. 프리셋은 구성안 생성 입력에 포함되지 않는다.

## 디자인 스타일 상태 모델

디자인 스타일은 다음 상태만 가진다.

| 상태 | 의미 | 프리셋 저장 | 콘텐츠 생성 사용 |
|---|---|---:|---:|
| `queued` | 분석 작업 대기 | 가능 | 불가 |
| `processing` | 분석 워커가 처리 중 | 가능 | 불가 |
| `ready` | 현재 revision 분석 완료 | 가능 | 가능 |
| `failed` | 현재 revision 분석 실패 | 가능 | 불가 |

이미지를 추가·교체·삭제하면 디자인 스타일 revision을 증가시키고 상태를 `queued`로 되돌린다. 이전 revision을 이미 동결한 실행 중 작업은 계속 진행하지만, 새 콘텐츠 생성은 새 revision 분석이 완료될 때까지 차단한다.

프리셋의 사용 가능 여부는 별도 수동 상태가 아니라 다음 값에서 서버가 계산한다.

```ts
type VisualPresetUsability =
  | { usable: true; reason: null }
  | { usable: false; reason: "style_analyzing" | "style_analysis_failed" | "avatar_unavailable" };
```

UI는 사용할 수 없는 프리셋을 숨기지 않고 비활성 상태와 사유를 표시한다. 생성 API는 UI 상태를 신뢰하지 않고 다시 검사한다.

## 데이터 모델

### 디자인 스타일

```ts
type DesignStyle = {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  revision: number;
  analysisStatus: "queued" | "processing" | "ready" | "failed";
  analysisContractVersion: "design-style-analysis.v1" | null;
  analysis: DesignStyleAnalysisV1 | null;
  analysisSha256: string | null;
  analysisErrorCode: string | null;
  referenceItemIds: string[];
};
```

이미지는 기존의 확인된 브랜드 소유 `reference_items`를 재사용하고 `brand_design_style_references`가 순서를 보관한다. 임의 URL이나 클라이언트 제공 저장 경로는 받지 않는다.

### 분석 결과

분석 결과는 이미지에 보이는 시각 문법만 기술한다. 이미지 속 콘텐츠 주제나 특정 제품의 효익을 사실처럼 추론하지 않는다.

```ts
type DesignStyleAnalysisV1 = {
  contractVersion: "design-style-analysis.v1";
  layout: {
    composition: string[];
    hierarchy: string[];
    spacing: string[];
    alignment: string[];
    recurringModules: string[];
  };
  typography: {
    families: string[];
    weightHierarchy: string[];
    scale: string[];
    placement: string[];
  };
  color: {
    palette: string[];
    contrast: string[];
    background: string[];
    accentUsage: string[];
  };
  graphics: {
    media: string[];
    shapes: string[];
    icons: string[];
    texture: string[];
  };
  visualCues: {
    comparison: string[];
    humor: string[];
    practicality: string[];
    empathy: string[];
  };
  promptGuidance: { use: string[]; avoid: string[] };
};
```

`visualCues`는 예를 들어 좌우 분할, 과장된 표정, 체크리스트 배치처럼 화면에서 관찰한 표현 단서다. “비교형 콘텐츠를 만들라” 또는 “유머를 강조하라”는 구성안 결정으로 사용하지 않는다.

### 비주얼 프리셋

```ts
type VisualPreset = {
  id: string;
  workspaceId: string;
  brandId: string;
  name: string;
  designStyleId: string;
  avatarId: string | null;
  revision: number;
  isDefault: boolean;
  usability: VisualPresetUsability;
};
```

기존 `brand_style_presets` 테이블은 비주얼 프리셋 역할로 전환한다. 기존 행마다 디자인 스타일을 하나 만들고 참고 이미지를 복사한 뒤 분석 작업을 큐에 넣는다. 기존 프리셋은 분석이 끝날 때까지 새 생성에서 비활성화된다.

현재 기능은 운영 사용자 데이터가 아니라 개발 단계이므로 미동결 `manual-visual-selection.v1` 개발 초안을 위한 호환 저장 구조는 만들지 않는다. 기존 preset의 설명·수동 visual token·reference junction은 디자인 스타일로 필요한 이미지와 이름을 이관한 뒤 제거한다. 이미 job payload에 완전히 동결된 V1은 재시도 회귀를 위해 읽을 수 있지만, V1 초안을 새로 저장하거나 현재 preset 테이블에서 다시 동결하지 않는다.

### 생성 시점 동결

신규 수동 생성은 `manual-visual-selection.v2`만 쓴다.

```ts
type ManualVisualSelectionV2 = {
  contractVersion: "manual-visual-selection.v2";
  product: null | { productServiceId: string; versionId: string };
  preset: null | { presetId: string; revision: number };
};
```

서버가 시작 직전에 프리셋, 디자인 스타일의 분석 결과와 이미지 ID, 선택적 아바타와 이미지 ID를 하나의 `manual-visual-selection-frozen.v2`로 동결한다. 기존 V1은 이미 대기·실행 중인 작업을 읽는 데만 유지하고 새로 쓰지 않는다.

## 비동기 분석 처리

새 운영 서비스를 추가하지 않고 현재 Brand Intelligence Worker에 디자인 스타일 작업 큐를 추가한다.

1. 디자인 스타일 저장 트랜잭션이 현재 revision의 분석 작업을 생성한다.
2. Brand Intelligence Worker가 브랜드 분석 작업이 없을 때 디자인 스타일 분석 작업을 claim한다.
3. API가 소유권이 확인된 이미지 메타데이터와 checksum을 전달한다.
4. 워커가 이미지를 임시 디렉터리에 다운로드하고 MIME, 크기, SHA-256을 다시 확인한다.
5. 워커는 한 번의 Codex CLI 호출에 모든 스타일 이미지를 `--image`로 첨부하고 닫힌 JSON Schema를 요구한다.
6. 결과가 `design-style-analysis.v1`을 통과하면 같은 revision일 때만 `ready`로 저장한다.
7. 사용자가 분석 중 이미지를 변경해 revision이 달라졌다면 이전 결과는 저장하지 않는다.
8. 실패하면 제한된 기존 작업 재시도 정책을 적용하고 최종 실패 시 `failed`와 안전한 오류 코드만 저장한다.
9. 임시 이미지는 성공·실패와 관계없이 삭제한다.

이미지 분석에는 웹 검색, 셸 도구, 브라우저, 이미지 생성 도구를 허용하지 않는다. 원본 이미지는 모델 입력으로만 쓰고 결과 JSON에 URL·스토리지 경로·checksum을 노출하지 않는다.

## 운영 규칙 V2

`brand_rule_sets.rules_json`은 물리 컬럼이 아니라 JSON 계약이다. 새 `brand-rules.v2`에서 `designRules`를 제거한다.

```ts
type BrandRulesV2 = {
  contractVersion: "brand-rules.v2";
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  exaggerationRules: string[];
  ctaRules: { defaultCta: string; allowed: string[] };
  channelRules: Record<string, string[]>;
  autoApprovalRules: { enabled: boolean; conditions: string[] };
};
```

마이그레이션은 `brand_rule_sets`의 모든 현재 행에서 `designRules`를 제거하고 계약 버전을 V2로 바꾼다. 신규 초기 설정, readiness 보정, 초안 저장과 승인도 V2만 생성한다. 반면 이미 콘텐츠 생성 입력에 동결된 V1 스냅샷은 변경하지 않고 V1 읽기 파서를 유지한다.

카드·릴스·블로그 워커는 신규 V2 운영 규칙에서 문구, 금칙어, CTA, 채널 규칙만 읽는다. 디자인 정보는 선택한 동결 프리셋에서만 읽는다. 블로그의 콘텐츠 전략은 바꾸지 않으며 V2 계약 호환과 비주얼 입력 교체만 수행한다.

## 구성안 표현방식과 강조 관점

구성안 UI에는 새 선택 항목이나 배지를 추가하지 않는다. 구성안 출력 스키마도 늘리지 않는다.

구성안 워커 프롬프트에 버전 관리되는 내부 카탈로그를 제공한다.

표현방식 후보:

- 비교·선택
- 문제 제시·해결
- 수치·데이터 해석
- 단계·튜토리얼
- 체크리스트
- 오해·사실 교정
- 전후 변화
- 사례·상황
- 질문·답변
- 적합한 카탈로그 항목이 없을 때 자유 구성

강조 관점 후보:

- 실용성
- 공감
- 유머
- 신뢰
- 효율
- 경제성
- 차별성
- 위험 회피
- 새로운 발견

워커는 각 안을 작성하기 전에 적합한 조합을 내부적으로 선택한다. 같은 조합의 중복 사용은 허용하지만 시작 질문, 중심 Evidence, 핵심 메시지, 전개, 결론 중 실질적 차이를 만들도록 한다. 기존의 `conceptKey`, semantic fingerprint, `differentiationAxes` 검증은 유지하고 별도 검증 모델이나 추가 호출을 만들지 않는다.

## 최종 원고·이미지 적용

- 구성안 선택 전: 디자인 스타일과 프리셋은 관여하지 않는다.
- 구성안 선택 후: 사용자가 비주얼 프리셋을 선택한다.
- 카드·릴스 원고 계획: 구성안의 전략과 디자인 스타일 분석의 레이아웃·위계 정보를 함께 받는다.
- 이미지 생성: 분석 결과와 실제 디자인 참고 이미지를 함께 받고, 선택적 아바타 이미지를 별도 역할로 받는다.
- 카드·릴스의 첫 장면·중간·마지막 장면 편집 규칙, 필요한 정보 표시, 선택적 CTA, 밀도 무제한 결정은 유지한다.

디자인 스타일은 콘텐츠의 사실이나 주장 근거가 아니다. 원고 모델은 디자인 스타일 분석을 화면 구성에만 사용하며, 근거·제품·주제 스냅샷에서 콘텐츠 내용을 가져온다.

## 오류와 경합 처리

- 프리셋 저장 시 분석 중 스타일 참조: 성공
- 기본 프리셋 설정 시 분석 중/실패 스타일 참조: `visual_preset_not_usable`
- 생성 시작 시 분석 중/실패 스타일 참조: `visual_preset_not_usable`
- 선택 후 스타일 revision 변경: `visual_preset_revision_stale`
- 분석 완료 직전 스타일 revision 변경: 완료 결과 폐기, 새 revision 작업 유지
- 분석 작업 최종 실패: 스타일 `failed`, 연결 프리셋 비활성, UI 재분석 제공
- 아바타가 비활성/삭제 상태: 연결 프리셋 비활성
- 기본 프리셋이 비활성: 콘텐츠 화면은 자동 선택하지 않고 `프리셋 사용 안 함` 상태로 시작

## 배포 경계

변경 대상은 DB migration, API, Customer UI, Brand Intelligence Worker, 콘텐츠 계약, Proposal Worker, Card/Reel Worker, Image Worker이며 Blog Worker는 계약 호환 변경만 포함한다.

배포는 다음 순서를 지킨다.

1. 운영 SHA·이미지 digest·미병합 hotfix 확인 및 rollback digest 보존
2. 호환 파서를 포함한 API/워커 후보 이미지 빌드
3. migration 적용과 application role 검증
4. API canary 후 승격
5. Brand Intelligence Worker 교체 및 기존 스타일 backfill 분석 진행
6. UI, Proposal, Card, Reel, Image 및 계약상 필요한 Blog Worker 교체
7. 외부 health/ready, heartbeat, digest, restart, 오류 로그 확인
8. 운영 브라우저에서 스타일 등록 → 분석 상태 → 프리셋 등록/차단 → 구성안 선택 후 프리셋 선택 → 카드·릴스 정보성·마케팅 생성 확인

분석 대기 중인 기존 프리셋은 일시적으로 생성에 사용할 수 없다. 분석 완료 전에는 자동 선택되지 않으며, 프리셋 없이 콘텐츠 생성은 계속 가능하다.

## 영향도와 사이드 이펙트

| 영역 | 현재 동작 | 변경 후 위험 | 방지책과 검증 |
|---|---|---|---|
| 브랜드센터 스타일 | 프리셋에 수동 색상·폰트·메모와 참고 이미지를 함께 저장 | 기존 입력 데이터가 사라지거나 스타일과 프리셋 의미가 섞일 수 있음 | 기존 행을 1:1 디자인 스타일로 이관하고 V1 필드는 읽기 전용 보존; 이미지 개수·순서·소유권 migration 검증 |
| 운영 규칙 | `rules_json.designRules`를 저장하고 readiness가 없으면 다시 만듦 | UI만 제거하면 DB와 워커에서 계속 재생성·소비 | V2 계약, onboarding/readiness/save/approve 전체 신규 쓰기 테스트, SQL source scan |
| 구성안 이전 화면 | 스타일 API를 호출하지 않음 | 프리셋 로딩을 앞당기면 구성안 생성에 시각 입력이 섞임 | 기존 호출 순서 테스트 유지; proposal 선택 전 style/preset API 호출 0회 |
| 구성안 선택 후 | style preset과 avatar를 각각 선택 | 조합 전환 중 서로 다른 revision이 섞이거나 이중 선택 가능 | V2는 preset ID/revision 하나만 전송; 서버가 preset→style/avatar를 한 transaction에서 동결 |
| 기본값 | style와 avatar가 각각 default 가능 | 분석 중 default가 선택되거나 avatar default가 다시 개입 | usable preset만 UI 자동 선택; avatar default 미사용 테스트; 서버 default 설정 재검증 |
| 기존 V1 개발 초안 | 선택 JSON만 있고 아직 frozen JSON이 없을 수 있음 | 새 구조로 시작할 수 없음 | 운영 데이터가 아닌 개발 상태이므로 호환 계층 제외; 신규 흐름은 V2로 다시 선택하며 migration/배포 전에 건수만 보고 |
| 실행·대기 중 작업 | job payload와 input snapshot에 V1이 동결됨 | 신규 worker가 V2만 읽으면 claim/재시도 실패 | 모든 consumer가 V1/V2 union을 읽고 신규 API만 V2 작성; V1 retry/render fixture 유지 |
| 재시도 | 부모 job의 `manualVisualSelection`을 자식 job에 복사 | 재시도 때 현재 preset을 재조회하면 결과가 바뀜 | 부모 frozen V1/V2를 그대로 복사하고 현재 style/default를 조회하지 않는 테스트 |
| 온보딩 자동 생성 | provisional brand rules를 사용하며 style image는 원래 빈 배열 | 새 default preset을 자동 주입하면 승인되지 않은 동작 변경 | 온보딩에는 preset을 자동 주입하지 않음; 기존 no-style 결과 계약 유지 |
| 예약 크롤링 | proposal까지만 자동 생성하고 최종 선택은 사용자 수행 | background job이 default를 임의 사용하면 선택 단계 의미 변경 | 예약 proposal에는 preset 없음; 사용자가 proposal 선택한 뒤 동일 visual step 사용 |
| 프리셋 없음 | 운영 규칙 style image가 공통 fixed input에 들어갈 수 있음 | `designRules` 제거 후 시각 스타일이 없어져 결과 외형 변화 | 이는 승인된 단일 소스 전환; `프리셋 사용 안 함`은 의도적으로 무스타일이며 숨은 fallback 금지 |
| Card/Reel | rules와 manual visual 두 경로의 시각 정보가 존재 | 중복·충돌 또는 사실과 디자인 지시 혼합 | rules design 제거; frozen preset만 사용; style analysis는 factual evidence가 아니라는 prompt test |
| Blog | rules.designRules를 prompt에 직접 포함 | V2 적용 시 parser/prompt 실패 | 콘텐츠 전략은 유지하고 V2 rules와 frozen preset 계약 호환만 수정·검증 |
| Image Worker | 여러 source 역할을 로컬 staging | style/avatar가 같은 역할로 섞이거나 잘못된 URL을 모델에 노출 | 디자인 스타일·아바타 역할 분리, checksum 재검증, prompt에서 URL/path/checksum 제거 |
| 이미지 수정 중 분석 | 현재 별도 분석 상태 없음 | 늦게 끝난 구 revision 결과가 최신 스타일을 덮음 | completion update에 `style_id + revision + lease_token` fence; stale 결과 폐기 테스트 |
| 분석 worker 자원 | Brand Intelligence Worker가 기존 브랜드 분석을 처리 | 스타일 분석이 온보딩 브랜드 분석을 지연 | 브랜드 분석 claim을 우선하고 비어 있을 때만 스타일 claim; shared Codex lease; queue priority 테스트 |
| 참고 이미지 삭제 | `reference_items`가 여러 기능에서 재사용 | 분석 중/ready style의 원본이 사라져 생성 실패 | style junction FK `on delete restrict`; 변경은 style 편집 transaction으로만 수행 |
| DB 권한 | application role의 세밀한 grant 사용 | owner test만 통과하고 운영 role에서 job/preset transaction 실패 | 실제 PostgreSQL application role로 migration, claim, completion, freeze transaction 실행 |
| API/UI 순차 배포 | 브라우저에 이전 UI bundle이 남을 수 있음 | 구 UI가 V1 payload를 신규 API에 보내 오류 | worker union 배포 → API → UI 순서; V1 write는 허용하지 않고 구 UI 오류는 새로고침 안내 |
| rollback | migration 후 새 V2 데이터가 생김 | 구 API/worker digest로 단순 복귀하면 V2를 읽지 못함 | rollback 후보에도 V1/V2 read compatibility 포함; migration은 유지하고 서비스만 호환 digest로 복구 |
| 품질 | 분석 결과가 원고 내용까지 지시할 수 있음 | 근거 누락, 비교 결론 왜곡, 스타일 과적용 | proposal 전략과 style analysis 분리; 정보 표시·첫/중간/마지막·선택 CTA 회귀 생성 확인 |

### 영향도 검증 순서

1. 정적 소비 지점: `designRules`, V1/V2 manual visual, preset/default/archive 호출부를 source scan으로 고정한다.
2. 계약: V1 historical read와 V2 new write를 같은 test matrix에서 확인한다.
3. DB: migration 전후 행 수, reference 순서, default 개수, rules JSON key와 application-role transaction을 검증한다.
4. API: queued/processing/ready/failed, concurrent revision, default, V1 draft, V2 freeze를 검증한다.
5. Worker: brand-analysis 우선순위, image checksum, stale completion, lost lease와 cleanup을 검증한다.
6. UI: 최초 설정, proposal 선택 이후 로딩, disabled reason, default, none, stale refresh를 검증한다.
7. 콘텐츠: Card/Reel 정보성·마케팅, Blog 계약 호환, Image role/staging, retry를 검증한다.
8. 배포: digest·health·ready·heartbeat·restart·오류 로그와 운영 브라우저 생성 ID로 확인한다.

## 제외 사항

- 구성안 최초 설정에 프리셋, 표현방식, 강조 관점 선택 UI 추가
- 디자인 이미지 분석으로 콘텐츠 사실·제품 효익·비교 결론 생성
- 별도 유사도 검증 모델 또는 자연스러움 검수 모델 호출
- 원고 밀도 상한, 두 번째 장면 전용 규칙, 필수 CTA
- 과거 동결 콘텐츠 스냅샷 수정
- 새 스타일 분석 전용 운영 서비스 추가

## 참고 근거

- TikTok for Business, `6 Storytelling Frameworks`: product story, results-first, elevator pitch, step-by-step, routine, easy/fast/reliable 등 숏폼 전개를 하나의 고정 공식이 아닌 선택 가능한 프레임으로 제시한다. https://ads.tiktok.com/business/en-US/blog/get-creative-6-storytelling-frameworks/
- TikTok for Business, `Short Video Best Practice`: trend, problem/solution, tips/hacks, product demo, unboxing 등 주제에 따른 표현방식 선택을 뒷받침한다. https://ads.tiktok.com/business/en/blog/tiktok-short-video-best-practice
- TikTok for Business, `Creative Best Practices`: hook/body/close 구조를 설명하며 현재 승인된 첫 장면·중간·마지막 장면 규칙과 일치한다. https://ads.tiktok.com/business/en-US/blog/creative-best-practices-top-performing-ads
- 국내 카드뉴스 연구는 정보 요소(표현·내용·흥미·효용·소통)와 디자인 요소(레이아웃·색상·그래픽·타이포그래피)를 구분한다. 이 구분을 표현방식/강조 관점과 디자인 스타일 분석을 분리하는 근거로 사용했다. https://www.dbpia.co.kr/journal/detail?nodeId=T16662105
