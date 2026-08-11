# AI 콘텐츠 1~3단계 UI와 실제 진행률 설계

## 목표

이전 로컬 시안의 정보 위계와 시각 구조를 운영 중인 1~3단계 화면에 반영하되, 기존 생성 요청·구성안 선택·스타일 자동 전달·첨부 lifecycle·생성 worker 동작은 변경하지 않는다. 3단계는 기존 DB의 canonical plan과 render job을 읽어 실제 진행 상태만 표시한다.

## 확정된 불변조건

- URL은 `/ai-content/new`, `/ai-content/:generationId`를 그대로 유지한다.
- 1단계의 기존 입력 state, validation, proposal batch 요청 body를 유지한다.
- 2단계의 proposal ID 선택과 최종 생성 요청을 유지한다.
- 승인된 브랜드 스타일 이미지는 기존처럼 모두 자동 전달한다. UI는 선택 control이 아니라 `자동 적용` 목록으로 표시한다.
- 아바타 역할 선택과 첨부 업로드·삭제·재시도 규칙은 유지한다.
- 동일 asset 재시도 render job은 `assetIndex`별 현재 유효 상태 하나로 축약한다.
- canonical plan 또는 render job이 없는 기존 생성은 오류로 처리하지 않고 `progress`를 생략한다.
- prompt, CLI, worker, DB schema, 자동 카드뉴스 경로는 변경하지 않는다.

## 선택한 구조

### 1단계

기존 `ContentProposalFlow`의 state와 자식 컴포넌트를 그대로 사용하면서 목적, 원문·자료, 형식·채널을 번호 카드로 배치한다. 우측 입력 요약은 기존 값으로만 구성한다. 사전 URL 분석 결과나 근거 개수처럼 현재 API가 제공하지 않는 값은 만들지 않는다.

### 2단계

`ContentProposalV2`에 이미 저장된 제목, 의도, 차별점, 훅, 핵심 메시지, 대상, 제공 가치, outline을 비교 카드에 표시한다. 브랜드 스타일은 읽기 전용 자동 적용 목록, 아바타는 radio 선택, 첨부는 기존 uploader를 그대로 사용한다.

### 3단계

기존 generation 상세 응답에 optional `progress`를 추가한다. API는 generation 상세 조회에서만 canonical plan과 render job을 읽고 다음 DTO로 축약한다.

```ts
interface AiContentGenerationProgress {
  phase: "queued" | "planning" | "rendering" | "finalizing";
  totalAssets: number | null;
  completedAssets: number;
  failedAssets: number;
  items: Array<{
    index: number;
    role: string;
    status: "queued" | "processing" | "completed" | "failed";
  }>;
  startedAt: string | null;
  updatedAt: string;
}
```

render job이 재시도된 경우 생성 시각과 attempt를 기준으로 동일 asset index의 최신 유효 row만 선택한다. terminal completed asset은 뒤늦은 stale row로 되돌리지 않는다. plan이나 index binding을 검증할 수 없으면 `progress`를 생략한다.

## 오류 처리

- 기존 생성: progress 없음 → 현재 단순 상태 패널 유지.
- 손상된 plan 또는 불연속 index: API 요청 실패가 아니라 progress 없음.
- 진행 조회 SQL 실패: generation 본문 조회를 실패시키지 않고 서버에서 기존 응답을 반환하되 진단 로그를 남긴다.
- 부분 실패: 완료·실패 수와 item 상태를 그대로 표시하며 100%로 만들지 않는다.
- API 구버전: UI에서 progress optional fallback.
- UI 구버전: 추가 API 필드를 무시한다.

## 배포 호환성

API를 먼저 배포하고 UI를 나중에 배포한다. 새 API 응답은 additive optional field라 기존 UI가 무시한다. 새 UI는 progress가 없으면 기존 상태 패널을 사용한다. DB migration은 없다.

## 테스트 기준

- 동일 index에 queued, processing, failed, completed 재시도 row가 섞여도 item 하나만 반환한다.
- 완료 수가 전체 수보다 커질 수 없다.
- plan/render job이 없는 기존 generation은 progress가 없다.
- card_news, reel, blog의 0~N 이미지 계획을 구분한다.
- 1·2단계 API request body와 handler 호출 횟수가 변경되지 않는다.
- 브랜드 스타일 목록에는 선택 input이 없고 아바타에만 radio가 있다.
- 390px, 768px, 1440px에서 가로 overflow가 없다.

## CI와 출시

PR에서 release impact는 customer UI와 API를 활성화한다. UI 전체 테스트·빌드, API 전체 테스트·빌드와 기존 release tooling 검증을 통과해야 한다. 테스트를 삭제하거나 visibility 기대를 완화해 통과시키지 않는다. 메인 병합 후 API 이미지 publish가 실행되는 것은 이번 변경 범위상 정상이다.
