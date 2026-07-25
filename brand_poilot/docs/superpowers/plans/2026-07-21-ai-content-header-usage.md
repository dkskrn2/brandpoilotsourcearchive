# AI 콘텐츠 헤더 사용량 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 콘텐츠 홈 헤더에서 오늘 남은 생성 및 다운로드 횟수를 확인하고 기존 대형 사용량 카드를 제거한다.

**Architecture:** 기존 `AiContentUsage` 응답을 `AiContentHomePage`에서 그대로 사용한다. `AiContentUsageSummary`는 잔여량만 보여주는 헤더용 컴팩트 컴포넌트로 변경하고 추가 API 호출은 만들지 않는다.

**Tech Stack:** React 18, TypeScript, lucide-react, Vitest, Testing Library

---

### Task 1: 헤더 잔여 사용량 계약

**Files:**
- Modify: `apps/customer-ui/src/__tests__/aiContentHome.test.tsx`
- Modify: `apps/customer-ui/src/components/ai-content/AiContentUsageSummary.tsx`
- Modify: `apps/customer-ui/src/pages/AiContentHomePage.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`

- [ ] **Step 1: 실패하는 화면 테스트 작성**

기존 `오늘 사용량` 기대값을 제거하고 다음 계약을 추가한다.

```tsx
expect(screen.getByLabelText("오늘 AI 콘텐츠 잔여 사용량")).toHaveTextContent("생성 3회 남음");
expect(screen.getByLabelText("오늘 AI 콘텐츠 잔여 사용량")).toHaveTextContent("다운로드 7회 남음");
expect(screen.queryByRole("heading", { name: "오늘 사용량" })).not.toBeInTheDocument();
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- --run src/__tests__/aiContentHome.test.tsx`

Expected: `오늘 AI 콘텐츠 잔여 사용량`을 찾지 못해 실패한다.

- [ ] **Step 3: 헤더용 컴팩트 사용량 컴포넌트 구현**

```tsx
import { Download, Sparkles } from "lucide-react";

const remaining = (used: number, limit: number) => Math.max(limit - used, 0);

export function AiContentUsageSummary({ usage }: AiContentUsageSummaryProps) {
  return (
    <div className="ai-content-header-usage" aria-label="오늘 AI 콘텐츠 잔여 사용량">
      <span><Sparkles size={15} aria-hidden="true" />생성 <strong>{remaining(usage.generationUsed, usage.generationLimit)}회</strong> 남음</span>
      <span><Download size={15} aria-hidden="true" />다운로드 <strong>{remaining(usage.newDownloadUsed, usage.newDownloadLimit)}회</strong> 남음</span>
    </div>
  );
}
```

`AiContentHomePage`의 `PageHeader.actions` 안에 사용량 컴포넌트와 기존 생성 버튼을 함께 배치하고 본문의 사용량 컴포넌트는 제거한다.

- [ ] **Step 4: 반응형 스타일 적용**

```css
.ai-content-header-usage { display: flex; align-items: center; gap: 6px; }
.ai-content-header-usage > span { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--muted); font-size: 12px; white-space: nowrap; }
.ai-content-header-usage strong { color: var(--text); }
```

좁은 화면에서는 `.page-head .actions`와 `.ai-content-header-usage`가 줄바꿈되도록 기존 모바일 구간에 폭 규칙을 추가한다.

- [ ] **Step 5: 테스트와 빌드 확인**

Run: `npm test -- --run src/__tests__/aiContentHome.test.tsx`

Expected: PASS

Run: `npm run build`

Expected: TypeScript 및 Vite build PASS
