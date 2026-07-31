# Onboarding Review Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 온보딩 Step 2의 회사명 필드를 분석 결과 폼에 통합하고 근거 상세 패널을 숨긴다.

**Architecture:** 라이브 온보딩이 회사명 상태를 계속 소유하되 `BrandAnalysisReviewStep`에 값과 변경 콜백을 전달한다. 리뷰 컴포넌트는 회사명을 첫 필드로 렌더링하고, evidence/sourceGaps 데이터는 유지한 채 해당 표시 패널만 제거하며 저장 오류와 버튼은 독립 작업 영역에 남긴다.

**Tech Stack:** React 18, TypeScript, Testing Library, Vitest

---

### Task 1: 검토 화면 회귀 테스트

**Files:**
- Modify: `apps/customer-ui/src/__tests__/brandCenterLiveOnboarding.test.tsx`

- [x] **Step 1: 회사명 위치와 숨김 영역을 검증하는 실패 단언 작성**

```tsx
const companyInput = screen.getByRole("textbox", { name: "회사명" });
const reviewPanel = screen.getByRole("heading", { name: "분석 결과 확인" }).closest(".panel");
expect(reviewPanel).toContainElement(companyInput);
expect(screen.queryByRole("heading", { name: "근거와 추가 확인 항목" })).not.toBeInTheDocument();
expect(screen.queryByText(/기업 근거/)).not.toBeInTheDocument();
expect(screen.queryByText(/가격 정보 부족/)).not.toBeInTheDocument();
expect(screen.getAllByRole("link", { name: "근거 보기" }).length).toBeGreaterThan(0);
```

- [x] **Step 2: 대상 테스트가 현재 구조 때문에 실패하는지 확인**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandCenterLiveOnboarding.test.tsx -t "uploads real files, polls until review, preserves the complete Step 2 draft, then saves and confirms"
```

Expected: 회사명 입력이 `분석 결과 확인` 패널 밖에 있거나 근거 패널이 노출되어 FAIL.

### Task 2: 회사명 통합과 근거 패널 제거

**Files:**
- Modify: `apps/customer-ui/src/components/brand-intelligence/BrandAnalysisReviewStep.tsx`
- Modify: `apps/customer-ui/src/pages/LiveBrandCenterOnboarding.tsx`

- [x] **Step 1: 리뷰 컴포넌트에 선택적 회사명 제어 속성 추가**

```tsx
companyName?: string;
onCompanyNameChange?(value: string): void;
```

- [x] **Step 2: 분석 결과 패널의 첫 필드로 회사명 렌더링**

```tsx
{companyName !== undefined && onCompanyNameChange && (
  <label className="field-stack">
    <span className="field-label">회사명</span>
    <input
      value={companyName}
      maxLength={100}
      onChange={(event) => onCompanyNameChange(event.currentTarget.value)}
    />
  </label>
)}
```

- [x] **Step 3: 근거 표시만 제거하고 저장 작업 영역 유지**

```tsx
{error && <Alert title="저장하지 못했습니다" variant="bad">{error}</Alert>}
<div className="form-actions">
  <button type="button" className="button primary" disabled={!canConfirm || saving} onClick={() => void onConfirm()}>
    {saving ? "저장하는 중" : "확인하고 저장"}
  </button>
</div>
```

- [x] **Step 4: 라이브 페이지의 별도 회사명 카드를 제거하고 제어 속성 전달**

```tsx
<LiveResultEditor
  companyName={companyName}
  onCompanyNameChange={setCompanyName}
  draft={draft}
  saving={saving}
  error={analysisError}
  onChange={setDraft}
  onComplete={() => void complete()}
/>
```

- [x] **Step 5: 대상 테스트 통과 확인**

Run:

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandCenterLiveOnboarding.test.tsx
```

Expected: 모든 테스트 PASS.

### Task 3: 전체 검증

**Files:**
- Verify: `apps/customer-ui`

- [x] **Step 1: 리뷰 컴포넌트 관련 테스트 실행**

```powershell
npm test --workspace @brand-pilot/customer-ui -- --run src/__tests__/brandIntelligenceOnboarding.test.tsx
```

Expected: 모든 테스트 PASS.

- [x] **Step 2: 고객 UI 프로덕션 빌드 실행**

```powershell
npm run build --workspace @brand-pilot/customer-ui
```

Expected: TypeScript 검사와 Vite 빌드 exit code 0.

- [x] **Step 3: 변경 범위와 공백 오류 확인**

```powershell
git diff --check
git status --short
```

Expected: 이번 UI 변경 파일과 앞서 승인된 온보딩 수정만 표시되고 공백 오류 없음.
