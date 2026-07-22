# 대시보드 기능 제안과 접이식 사이드바 구현 계획

> **에이전트 작업 필수 절차:** `superpowers:executing-plans`를 사용해 아래 작업을 순서대로 실행한다. 모든 기능 변경은 실패 테스트부터 작성한다.

**목표:** 아이콘이 있는 데스크톱 사이드바를 접고 펼칠 수 있게 하고 그 상태를 유지하며, 대시보드 기능 제안 배너에서 기능 건의가 선택된 고객센터 작성 폼으로 이동한다.

**구조:** `AppShell`이 저장된 데스크톱 접기 상태와 본문 그리드를 관리하고 `Sidebar`는 전달받은 상태에 따라 같은 탐색 구조를 두 너비로 표현한다. 대시보드 링크는 검색 매개변수와 앵커를 전달하고 `SupportPage`가 이를 읽어 최초 문의 유형과 스크롤 위치를 설정한다. 서버와 API는 변경하지 않는다.

**기술 구성:** React 18, React Router, Lucide React, CSS, Vitest, Testing Library, Playwright CLI

---

### 작업 1: 사이드바 아이콘과 저장되는 접기 상태

**변경 파일:**
- `apps/customer-ui/src/__tests__/navigation.test.tsx`
- `apps/customer-ui/src/components/layout/AppShell.tsx`
- `apps/customer-ui/src/components/layout/Sidebar.tsx`
- `apps/customer-ui/src/styles/prototype.css`

- [ ] **1단계: 실패 테스트 작성**

`navigation.test.tsx`에 모든 메뉴가 `data-nav-icon`을 가진다는 검증과 다음 접기 상태 테스트를 추가한다.

```tsx
localStorage.clear();
render(<MemoryRouter><AppShell><div>페이지 내용</div></AppShell></MemoryRouter>);
await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
expect(screen.getByRole("complementary")).toHaveClass("sidebar--collapsed");
expect(localStorage.getItem("mojong:desktop-sidebar:v1")).toBe("collapsed");
cleanup();
render(<MemoryRouter><AppShell><div>페이지 내용</div></AppShell></MemoryRouter>);
expect(screen.getByRole("complementary")).toHaveClass("sidebar--collapsed");
```

- [ ] **2단계: 실패 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx`

예상: `사이드바 접기` 버튼과 `sidebar--collapsed` 클래스 및 메뉴 아이콘이 없어 실패한다.

- [ ] **3단계: 최소 구현**

`AppShell`에 `mojong:desktop-sidebar:v1` 값을 안전하게 읽는 초기 상태와 토글 저장 로직을 추가하고 `.app--sidebar-collapsed` 클래스를 적용한다. `Sidebar`에 `collapsed`, `onToggleCollapsed` 속성을 추가한다. 각 경로에 다음 아이콘을 배정한다.

```text
/dashboard=LayoutDashboard, /ai-content=Sparkles, /sources=Database,
/archive=Bookmark, /instagram-trends=TrendingUp, /publish-queue=Send,
/channels=Share2, /dm-automation=MessageCircleReply, /brand-settings=Settings2,
결제 및 구독=CreditCard, /support=Headphones, 브랜드 분석=ScanSearch
```

접기·펼치기에는 `PanelLeftClose`와 `PanelLeftOpen`을 사용한다. CSS에서 펼친 너비 248px, 접힌 너비 72px을 정의하고 접힌 상태에서 텍스트를 시각적으로 숨기되 접근성 이름은 보존한다. 모바일 사이드바에는 접기 버튼과 접힘 클래스를 적용하지 않는다.

- [ ] **4단계: 통과 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx`

예상: 모든 탐색 및 접기 상태 테스트가 통과한다.

### 작업 2: 대시보드 기능 제안 배너

**변경 파일:**
- `apps/customer-ui/src/__tests__/dashboard.test.tsx`
- `apps/customer-ui/src/pages/DashboardPage.tsx`
- `apps/customer-ui/src/styles/prototype.css`

- [ ] **1단계: 실패 테스트 작성**

```tsx
await renderDashboardPage();
expect(await screen.findByRole("link", { name: "기능 제안하기" })).toHaveAttribute(
  "href",
  "/support?category=feature#support-request-form"
);
```

- [ ] **2단계: 실패 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx`

예상: 기능 제안 링크가 없어 실패한다.

- [ ] **3단계: 최소 구현**

`DashboardContent`의 마지막 운영 섹션 다음에 `Lightbulb` 아이콘, `원하는 기능을 모종 팀에게 제안해 주세요.` 문구, `기능 제안하기` 링크로 구성된 배너를 추가한다. CSS는 데스크톱에서 한 줄, 모바일에서 문구와 버튼이 세로로 배치되게 한다.

- [ ] **4단계: 통과 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- dashboard.test.tsx`

예상: 대시보드 테스트가 모두 통과한다.

### 작업 3: 고객센터 기능 건의 자동 선택과 폼 이동

**변경 파일:**
- `apps/customer-ui/src/__tests__/support.test.tsx`
- `apps/customer-ui/src/pages/SupportPage.tsx`

- [ ] **1단계: 실패 테스트 작성**

테스트 도우미가 `MemoryRouter initialEntries`를 받을 수 있게 하고 다음 두 경우를 검증한다.

```tsx
await renderSupportPage({}, ["/support?category=feature#support-request-form"]);
expect(screen.getByLabelText(/문의 유형/)).toHaveValue("feature");

cleanup();
await renderSupportPage({}, ["/support"]);
expect(screen.getByLabelText(/문의 유형/)).toHaveValue("");
```

- [ ] **2단계: 실패 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- support.test.tsx`

예상: `SupportPage`가 라우터 검색 매개변수를 읽지 않아 기능 건의 자동 선택 검증이 실패한다.

- [ ] **3단계: 최소 구현**

`useLocation`으로 최초 `category=feature`를 읽어 `category` 상태를 초기화한다. 문의 작성 패널에 `id="support-request-form"`과 `tabIndex={-1}`을 추가하고 해당 해시로 진입했을 때 `scrollIntoView({ behavior: "smooth", block: "start" })`를 호출한다. 알 수 없는 카테고리는 빈 선택값으로 둔다.

- [ ] **4단계: 통과 확인**

실행: `npm test --workspace @brand-pilot/customer-ui -- support.test.tsx`

예상: 고객센터 테스트가 모두 통과한다.

### 작업 4: 통합 검증

**검증 대상:**
- `apps/customer-ui/src`
- `apps/customer-ui/output/playwright`

- [ ] **1단계: 관련 회귀 테스트 실행**

실행: `npm test --workspace @brand-pilot/customer-ui -- navigation.test.tsx dashboard.test.tsx support.test.tsx`

예상: 관련 테스트가 모두 통과한다.

- [ ] **2단계: 프로덕션 빌드 실행**

실행: `npm run build --workspace @brand-pilot/customer-ui`

예상: TypeScript 검사와 Vite 빌드가 성공한다.

- [ ] **3단계: 브라우저 검증**

Playwright CLI 로그인 세션에서 `/dashboard`를 열고 다음을 확인한다.

```text
사이드바 접기 → 72px 아이콘 레일 → 새로고침 후 유지 → 다시 펼치기
기능 제안하기 클릭 → /support?category=feature#support-request-form
문의 유형 기능 건의 선택 → 모바일 390x844에서 전체 메뉴가 펼친 구조로 표시
```

- [ ] **4단계: 변경 범위 검사**

실행: `git diff --check -- apps/customer-ui/src docs/superpowers`

예상: 공백 오류가 없다.
