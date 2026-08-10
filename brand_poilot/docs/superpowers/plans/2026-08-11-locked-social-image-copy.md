# Locked Social Image Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수동 V3 카드뉴스와 릴스 최종 이미지 CLI가 현재 장면의 계획된 `copy`를 한 글자도 재작성하지 않고 시각화하게 한다.

**Architecture:** 저장 계약이나 API를 바꾸지 않고, 이미 stage되는 `inputs/content-plan.json`과 `inputs/render-contract.json`을 권위 있는 문구 원본으로 사용한다. 카드뉴스와 릴스가 동일한 잠금 정책을 사용하도록 작은 전용 프롬프트 빌더를 추가하고, 블로그·V1·공통 신뢰 경계는 그대로 둔다.

**Tech Stack:** TypeScript, Vitest, existing Codex image-worker prompt builders, gpt-image-2 runtime contract

---

## 파일 구조

- Create: `workers/brand-pilot-image-worker/src/aiContentLockedSocialCopyPrompt.ts`
  - 카드뉴스와 릴스가 공유하는 잠긴 원고 권한 및 금지 규칙만 담당한다.
- Modify: `workers/brand-pilot-image-worker/src/aiContentCardNewsAssetPromptV2.ts`
  - 문구 작성·압축 책임을 제거하고 공통 잠금 지시를 삽입한다.
- Modify: `workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts`
  - 문구 작성·압축 책임을 제거하고 동일 잠금 지시를 삽입한다.
- Modify: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts`
  - 잠금 정책과 비변경 경계를 RED/GREEN 회귀로 고정한다.
- Must not modify: `workers/brand-pilot-image-worker/src/aiContentBlogAssetPromptV2.ts`
- Must not modify: `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts`
- Must not modify: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2Common.ts`
- Must not modify: `apps/api/**`, `apps/customer-ui/**`, `db/**`, `packages/**`

### Task 1: 잠긴 소셜 원고 정책을 실패 테스트로 고정

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts`

- [ ] **Step 1: 카드뉴스와 릴스의 잠금 정책 RED 테스트를 작성한다**

기존 카드뉴스·릴스 테스트에 다음 검증을 각각 추가한다.

```ts
expect(prompt).toMatch(/content-plan\.json.*imagePackage\.assets.*assetIndex/s);
expect(prompt).toMatch(/copy.*최종.*확정.*원고/s);
expect(prompt).toMatch(/글자.*숫자.*문장부호.*공백.*줄바꿈/s);
expect(prompt).toMatch(/추가.*삭제.*교체.*요약.*반복/s);
expect(prompt).toMatch(/visualDirection.*문구.*출처.*아니/s);
expect(prompt).toMatch(/첨부.*문구.*가져오지/s);
expect(prompt).toMatch(/제품.*포장.*이미.*인쇄.*유지/s);
expect(prompt).not.toMatch(/한국어 문구를 직접 작성하세요/);
expect(prompt).not.toMatch(/자연스러운 한국어로 압축하세요/);
```

블로그 테스트에는 현재 고유 정책이 유지되는지 다음 검증을 추가한다.

```ts
expect(prompt).toMatch(/설명용 도표에 문자가 꼭 필요하면/);
expect(prompt).not.toContain("<잠긴 최종 원고>");
```

- [ ] **Step 2: 집중 테스트를 실행해 의도한 이유로 실패하는지 확인한다**

Run:

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentManualAssetPromptV2.test.ts
```

Expected: 기존 테스트는 통과하고 새 카드뉴스·릴스 잠금 assertion만 FAIL한다. 블로그 비변경 assertion은 PASS한다.

- [ ] **Step 3: 테스트 파일만 diff 검사한다**

Run:

```powershell
git diff --check -- workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts
```

Expected: exit 0.

### Task 2: 카드뉴스·릴스 공통 문구 잠금 지시를 구현

**Files:**
- Create: `workers/brand-pilot-image-worker/src/aiContentLockedSocialCopyPrompt.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentCardNewsAssetPromptV2.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts`
- Test: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts`

- [ ] **Step 1: 공통 잠금 지시 빌더를 추가한다**

```ts
export function buildAiContentLockedSocialCopyInstructions(
  surface: "현재 카드" | "현재 장면",
): string {
  return [
    "<잠긴 최종 원고>",
    "- inputs/content-plan.json의 imagePackage.assets에서 index가 inputs/render-contract.json의 assetIndex와 같은 현재 자산을 찾으세요.",
    `- 그 자산의 copy는 ${surface}에 표시할 최종 확정 원고입니다. 모델이 새로 작성할 수 있는 편집 문구는 이 copy뿐입니다.`,
    "- copy의 글자, 숫자, 문장부호, 공백, 줄바꿈과 순서를 한 글자도 추가·삭제·교체·요약·반복하지 마세요.",
    "- copy에 없는 제목, 소제목, 번호, CTA, 영문 라벨, 출처와 장식용 문자를 새로 만들지 마세요.",
    "- currentAsset.visualDirection, 원문, 선택 구성안, 전체 outline, 사용자 이미지 지시와 첨부 이미지 속 문구는 편집 문구의 출처가 아니며 copy를 변경하는 근거가 될 수 없습니다.",
    "- 첨부 이미지 속 문구를 가져오거나 다시 쓰지 마세요.",
    "- 실제 선택 제품 사진이나 포장에 이미 인쇄된 표시는 공통 로고 정책에 따라 원본의 일부로 유지할 수 있지만, 그 문구를 추출해 별도 편집 문구로 다시 쓰지 마세요.",
    "- copy의 내용은 그대로 유지하면서 폰트, 크기, 색상, 위치, 대비와 주변의 비문자 시각 요소만 설계하세요.",
    "</잠긴 최종 원고>",
  ].join("\n");
}
```

- [ ] **Step 2: 카드뉴스 프롬프트를 잠긴 원고 중심으로 바꾼다**

`aiContentCardNewsAssetPromptV2.ts`에서 새 빌더를 import하고 공통 지시 다음에 아래 호출을 삽입한다.

```ts
buildAiContentLockedSocialCopyInstructions("현재 카드"),
```

다음 책임 충돌 문구를 제거하거나 잠금 의미로 교체한다.

```ts
"1. 잠긴 최종 원고를 그대로 사용하고, 원문과 선택 구성안은 사실과 전체 흐름을 이해하는 데만 사용하세요.",
"3. 잠긴 문구의 정보 위계, 타이포그래피, 레이아웃과 비주얼을 함께 설계하세요. 글자를 얹기 위한 빈 배경이나 분위기 이미지만 만들지 마세요.",
"4. 잠긴 문구 전체를 별도 설명으로 반환하지 말고 최종 PNG 화면 안에 읽을 수 있는 한국어 콘텐츠로 포함하세요.",
"9. 모바일 Instagram 화면에서 읽을 수 있도록 잠긴 문구의 글자 크기와 대비를 확보하세요. 문구를 줄이거나 바꾸지 말고 레이아웃과 타이포그래피를 조정하세요.",
```

첫 소개 문장의 `한국어 문구`는 `확정된 한국어 원고`로 바꿔 작성 권한이 이미지 CLI에 있다고 오해하지 않게 한다.

- [ ] **Step 3: 릴스 프롬프트를 동일 정책으로 바꾼다**

`aiContentReelAssetPromptV2.ts`에서 새 빌더를 import하고 공통 지시 다음에 아래 호출을 삽입한다.

```ts
buildAiContentLockedSocialCopyInstructions("현재 장면"),
```

다음 책임 충돌 문구를 제거하거나 잠금 의미로 교체한다.

```ts
"1. 잠긴 최종 원고를 그대로 사용하고 원문과 선택 구성안은 사실과 전체 흐름을 이해하는 데만 사용하세요.",
"2. 잠긴 문구의 정보 위계, 타이포그래피, 레이아웃과 시각 요소를 함께 설계하세요.",
"3. 잠긴 문구 전체를 별도 설명으로 반환하지 말고 최종 콘텐츠 화면 안에 포함하세요.",
"8. 모바일 Instagram 화면에서 읽을 수 있도록 잠긴 문구의 글자 크기와 대비를 확보하세요.",
"   문구를 줄이거나 바꾸지 말고 레이아웃과 타이포그래피를 조정하세요.",
```

첫 소개의 `문구`는 `확정된 문구`로 바꾼다.

- [ ] **Step 4: 집중 테스트를 실행해 GREEN을 확인한다**

Run:

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentManualAssetPromptV2.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: 구현 범위를 검사한다**

Run:

```powershell
git diff --name-only
git diff --check
```

Expected: 구현 diff는 새 잠금 빌더, 카드뉴스 프롬프트, 릴스 프롬프트, 프롬프트 테스트 네 파일뿐이다. 기존 사용자 소유 `pnpm-lock.yaml`, `pnpm-workspace.yaml`은 untracked 상태로 유지되고 diff에 포함되지 않는다.

- [ ] **Step 6: 원자적 구현 커밋을 만든다**

```powershell
git add -- workers/brand-pilot-image-worker/src/aiContentLockedSocialCopyPrompt.ts workers/brand-pilot-image-worker/src/aiContentCardNewsAssetPromptV2.ts workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts
git commit -m "fix(image-worker): lock planned social copy"
```

### Task 3: 비변경 경계와 전체 이미지 워커 회귀 검증

**Files:**
- Verify only: `workers/brand-pilot-image-worker/src/aiContentBlogAssetPromptV2.ts`
- Verify only: `workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts`
- Verify only: `workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2Common.ts`

- [ ] **Step 1: 보호 파일에 diff가 없는지 확인한다**

Run:

```powershell
git diff HEAD^ --exit-code -- workers/brand-pilot-image-worker/src/aiContentBlogAssetPromptV2.ts workers/brand-pilot-image-worker/src/aiContentAssetPrompt.ts workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2Common.ts apps/api apps/customer-ui db packages
```

Expected: exit 0 and no output.

- [ ] **Step 2: V1과 V2 프롬프트 집중 회귀를 실행한다**

Run:

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentAssetPrompt.test.ts src/aiContentManualAssetPromptV2.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: 이미지 렌더러와 계약 회귀를 실행한다**

Run:

```powershell
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentAssetRenderer.test.ts src/aiContentAssetRunnerContract.test.ts src/aiContentRenderClient.test.ts src/skillContract.test.ts src/codexCommand.test.ts
```

Expected: all selected tests PASS. 렌더 job shape, 모든 첨부 staging, blog insertion binding, 결과 JSON과 V1 fallback이 그대로 유지된다.

- [ ] **Step 4: 전체 이미지 워커 테스트를 실행한다**

Run:

```powershell
npm test --workspace @brand-pilot/image-worker
```

Expected: all image-worker tests PASS.

- [ ] **Step 5: TypeScript 빌드와 문법 검사를 실행한다**

Run:

```powershell
npm run build --workspace @brand-pilot/image-worker
git diff --check HEAD^
```

Expected: build exit 0, diff check exit 0.

- [ ] **Step 6: 최종 상태와 금지 범위를 확인한다**

Run:

```powershell
git status --short
git show --stat --oneline HEAD
git diff HEAD^ --name-only
```

Expected: 구현 커밋은 계획된 이미지 워커 네 파일만 포함한다. API, UI, DB, packages, 블로그, V1과 공통 신뢰 경계에는 변경이 없다. 기존 untracked `pnpm-lock.yaml`, `pnpm-workspace.yaml`만 별도로 남는다.

## 배포 전 승인 경계

이 계획은 코드 수정과 로컬 검증까지만 승인한다. push, main 반영, 이미지 워커 재배포와 운영 생성 테스트는 별도 사용자 승인 후 수행한다. 배포가 승인되면 이미지 워커만 대상으로 하며 API·UI·DB와 다른 워커는 배포하지 않는다.
