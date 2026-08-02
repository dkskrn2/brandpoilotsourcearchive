# Instagram DM FAQ and LLM UI Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 FAQ-first 설계를 기존 고객 화면에 UI 프리뷰로 구현하되 API, DB, 작업자, DM 라우팅을 변경하지 않는다.

**Architecture:** 기존 `DmAutomationPage`, `KnowledgeCategoryEditorPanel`, `AutoResponseKnowledgePanel`, `ChannelsPage`를 보존형으로 확장한다. 새 UI 상호작용은 컴포넌트 로컬 상태만 사용하며 새 API를 호출하지 않는다. 기존 자동답변 토글과 수동응답은 그대로 유지한다.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, 기존 CSS 토큰과 UI 컴포넌트

---

## 파일 구조

- Create: `apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.tsx`
  - FAQ 자동 제안 실행 전 상태와 편집 가능한 제안 검토 상태를 로컬 UI로 제공한다.
- Create: `apps/customer-ui/src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx`
  - CTA, textarea, 로컬 검토 상태, API 비의존성을 검증한다.
- Create: `apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.test.tsx`
  - URL·문서 소스 영역과 명시적 생성 CTA를 검증한다.
- Modify: `apps/customer-ui/src/components/brand-center/KnowledgeCategoryEditorPanel.tsx`
  - `kind="faq"`일 때만 FAQ 제안 프리뷰를 기존 편집기 위에 배치한다.
- Modify: `apps/customer-ui/src/components/brand-center/AutoResponseKnowledgePanel.tsx`
  - 기존 확정 지식 개요 위에 소스와 LLM 정보 생성 상태를 추가한다.
- Modify: `apps/customer-ui/src/pages/DmAutomationPage.tsx`
  - 기존 상단 패널을 FAQ-first 제어 구조로 재배치하고 LLM 답변 UI-only 보조 토글을 추가한다.
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
  - 중복된 Instagram DM 자동답변 패널과 관련 조회·토글 UI 책임을 제거한다.
- Modify: `apps/customer-ui/src/__tests__/dmAutomation.test.tsx`
  - 두 토글, 브랜드 센터 링크, 기존 수동응답 보존을 검증한다.
- Modify: `apps/customer-ui/src/__tests__/channels.test.tsx`
  - 자동답변 패널이 없고 연결 UI는 남는 것을 검증한다.
- Modify: `apps/customer-ui/src/styles/prototype.css`
  - DM 상단 제어 영역과 반응형 상태 UI 스타일을 추가한다.
- Modify: `apps/customer-ui/src/styles/brand-center.css`
  - FAQ 제안 검토와 LLM 소스·생성 UI 스타일을 추가한다.

### Task 1: DM 제어 영역 계약

- [ ] **Step 1: 실패 테스트 작성**

`dmAutomation.test.tsx`에 다음 기대를 추가한다.

```tsx
expect(await screen.findByRole("heading", { name: "자동답변 설정" })).toBeInTheDocument();
expect(screen.getByText("FAQ 답변")).toBeInTheDocument();
expect(screen.getByText("LLM 답변")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /FAQ 관리/ })).toHaveAttribute("href", "/brand-center?tab=faq");
expect(screen.getByRole("link", { name: /LLM 답변 정보 관리/ })).toHaveAttribute("href", "/brand-center?tab=knowledge");
```

- [ ] **Step 2: RED 확인**

Run: `npm test -- src/__tests__/dmAutomation.test.tsx`

Expected: 새 제목과 링크를 찾지 못해 FAIL.

- [ ] **Step 3: 최소 UI 구현**

기존 `settings.enabled` 토글은 유지한다. 신규 LLM 토글은 로컬 상태로만 표현하며 화면에 `미리보기, 저장되지 않음` 설명을 제공한다. 준비 상태를 FAQ, LLM 정보, Instagram 연결 세 그룹으로 표시한다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test -- src/__tests__/dmAutomation.test.tsx`

Expected: PASS, 기존 수동응답 테스트 포함.

### Task 2: 채널 중복 제거

- [ ] **Step 1: 실패 테스트 작성**

```tsx
expect(screen.queryByRole("heading", { name: "Instagram DM 자동답변" })).not.toBeInTheDocument();
expect(screen.getByText("Instagram")).toBeInTheDocument();
```

- [ ] **Step 2: RED 확인**

Run: `npm test -- src/__tests__/channels.test.tsx`

Expected: 기존 중복 패널이 남아 있어 FAIL.

- [ ] **Step 3: 최소 UI 구현**

`ChannelsPage`에서 `InstagramDmSettings`, DM readiness helper, DM 설정 state/effect, `toggleDm`, 중복 패널 JSX를 제거한다. 채널 연결과 가이드 코드는 변경하지 않는다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test -- src/__tests__/channels.test.tsx`

Expected: PASS.

### Task 3: FAQ 자동 제안 프리뷰

- [ ] **Step 1: 신규 실패 테스트 작성**

```tsx
render(<FaqSuggestionPreviewPanel />);
await user.click(screen.getByRole("button", { name: "FAQ 자동 제안" }));
expect(screen.getByRole("heading", { name: "제안된 FAQ 검토" })).toBeInTheDocument();
expect(screen.getAllByLabelText(/질문/)[0]).toHaveValue("제품은 어떻게 구매하나요?");
expect(screen.getAllByLabelText(/답변/)[0].tagName).toBe("TEXTAREA");
```

- [ ] **Step 2: RED 확인**

Run: `npm test -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx`

Expected: 컴포넌트가 없어 FAIL.

- [ ] **Step 3: 최소 UI 구현**

로컬 fixture 3개를 사용한다. 버튼을 누르면 편집 가능한 검토 영역이 열린다. 승인·제외 버튼은 시각 상태만 바꾸며 API를 호출하지 않는다. 기존 FAQ 편집기 위에 배치한다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test -- src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/__tests__/wikiLibrary.test.tsx`

Expected: PASS.

### Task 4: LLM 답변 정보 프리뷰

- [ ] **Step 1: 신규 실패 테스트 작성**

```tsx
expect(await screen.findByRole("heading", { name: "LLM 답변 정보" })).toBeInTheDocument();
expect(screen.getByLabelText("참고 URL")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "문서 추가" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "LLM 답변 정보 생성" })).toBeInTheDocument();
```

- [ ] **Step 2: RED 확인**

Run: `npm test -- src/components/brand-center/AutoResponseKnowledgePanel.test.tsx`

Expected: 소스·생성 UI가 없어 FAIL.

- [ ] **Step 3: 최소 UI 구현**

기존 `listWikiItems` 조회와 확정 지식 개요를 유지한다. 상단에 URL 입력, 문서 추가 버튼, 소스 상태, 명시적 생성 CTA를 로컬 프리뷰로 추가한다. 파일 선택과 생성은 서버 요청을 만들지 않는다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test -- src/components/brand-center/AutoResponseKnowledgePanel.test.tsx src/__tests__/brandCenter.test.tsx`

Expected: PASS.

### Task 5: 스타일과 반응형 계약

- [ ] **Step 1: 실패 테스트 또는 CSS 계약 추가**

```ts
expect(css).toContain(".dm-control-grid");
expect(css).toContain(".faq-suggestion-review");
expect(css).toContain("@media (max-width: 620px)");
```

- [ ] **Step 2: RED 확인**

Run: `npm test -- src/__tests__/responsiveStyles.test.ts src/__tests__/brandCenterVisualContracts.test.ts`

Expected: 신규 selector가 없어 FAIL.

- [ ] **Step 3: 최소 스타일 구현**

기존 토큰을 사용한다. 카드 radius는 12px, 입력은 기존 field 스타일, 강조색은 `--bp-color-primary`, LLM 구분은 기존 `--bp-color-ai`를 상태 라벨에만 사용한다. 800px에서 1열, 620px에서 액션·textarea를 전체 너비로 쌓는다.

- [ ] **Step 4: GREEN 확인**

Run: `npm test -- src/__tests__/responsiveStyles.test.ts src/__tests__/brandCenterVisualContracts.test.ts`

Expected: PASS.

### Task 6: 전체 검증과 로컬 브라우저 확인

- [ ] **Step 1: 관련 테스트 실행**

Run: `npm test -- src/__tests__/dmAutomation.test.tsx src/__tests__/channels.test.tsx src/__tests__/wikiLibrary.test.tsx src/components/brand-center/FaqSuggestionPreviewPanel.test.tsx src/components/brand-center/AutoResponseKnowledgePanel.test.tsx`

Expected: 모든 테스트 PASS.

- [ ] **Step 2: 전체 빌드 실행**

Run: `npm run build`

Expected: TypeScript와 Vite build exit 0.

- [ ] **Step 3: 브라우저 검증**

로컬 최신 앱에서 다음 경로를 확인한다.

- `/dm-automation`
- `/brand-center?tab=faq`
- `/brand-center?tab=knowledge`
- `/channels`

데스크톱과 390px 모바일에서 overflow, 포커스, textarea, 수동응답 보존을 확인한다. 콘솔 오류가 없어야 한다.

- [ ] **Step 4: 배포 안전 확인**

`git status`, `git diff --check`, 변경 파일 목록을 확인한다. push, PR, 배포, DB 명령은 실행하지 않는다.
