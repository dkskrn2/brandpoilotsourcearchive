# Brand Pilot Customer UI React Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Brand Pilot customer UI static HTML prototype into a React + TypeScript app without changing the approved IA or visual direction.

**Architecture:** Create a new Vite React app under `apps/customer-ui` and keep the current HTML prototype under `docs/prototypes/brand-pilot-customer-ui` as the visual reference. Convert repeated HTML patterns into typed React components, route each page with React Router, and use local mock data until API integration starts.

**Tech Stack:** React 18, TypeScript, Vite, React Router, Vitest, Testing Library, Playwright, CSS copied from the approved prototype, lucide-react for icons where icons are needed.

---

## Source References

- Prototype entry: `docs/prototypes/brand-pilot-customer-ui/index.html`
- Prototype pages:
  - `docs/prototypes/brand-pilot-customer-ui/pages/onboarding.html`
  - `docs/prototypes/brand-pilot-customer-ui/pages/content.html`
  - `docs/prototypes/brand-pilot-customer-ui/pages/publish-queue.html`
  - `docs/prototypes/brand-pilot-customer-ui/pages/sources.html`
  - `docs/prototypes/brand-pilot-customer-ui/pages/channels.html`
  - `docs/prototypes/brand-pilot-customer-ui/pages/brand-settings.html`
- Prototype styles: `docs/prototypes/brand-pilot-customer-ui/assets/prototype.css`
- Prototype behavior: `docs/prototypes/brand-pilot-customer-ui/assets/prototype.js`
- Product spec: `docs/specs/BRAND_PILOT_MANAGED_CONTENT_AUTOMATION_MVP.md`
- Functional spec: `docs/specs/BRAND_PILOT_CUSTOMER_UI_FUNCTIONAL_SPEC.md`
- Wireframes: `docs/specs/BRAND_PILOT_CUSTOMER_UI_WIREFRAMES.md`
- Design system: `docs/specs/BRAND_PILOT_CUSTOMER_UI_DESIGN_SYSTEM.md`

## File Structure

Create this app structure:

```text
apps/customer-ui/
  index.html
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  src/
    main.tsx
    App.tsx
    routes.tsx
    types.ts
    data/
      mockData.ts
    styles/
      prototype.css
    components/
      layout/
        AppShell.tsx
        Sidebar.tsx
        Topbar.tsx
        PageHeader.tsx
      ui/
        Alert.tsx
        Badge.tsx
        ButtonLink.tsx
        Card.tsx
        ChecklistItem.tsx
        EmptyState.tsx
        Field.tsx
        RowCard.tsx
        SquareCarouselPreview.tsx
        Switch.tsx
        Tabs.tsx
    pages/
      OnboardingPage.tsx
      ContentPage.tsx
      PublishQueuePage.tsx
      SourcesPage.tsx
      ChannelsPage.tsx
      BrandSettingsPage.tsx
    test/
      setup.ts
      renderWithRouter.tsx
    __tests__/
      navigation.test.tsx
      brandSettings.test.tsx
      channels.test.tsx
  e2e/
    customer-ui.spec.ts
```

Keep these legacy files as reference until React parity is verified:

```text
docs/prototypes/brand-pilot-customer-ui/
```

Do not delete the HTML prototype in this conversion phase.

## Route Map

```text
/                  -> /onboarding redirect
/onboarding        -> OnboardingPage
/content           -> ContentPage
/publish-queue     -> PublishQueuePage
/sources           -> SourcesPage
/channels          -> ChannelsPage
/brand-settings    -> BrandSettingsPage
```

## Behavioral Decisions To Preserve

- No dashboard route.
- Customer-only IA: onboarding, content, publish queue, sources, channels, brand settings.
- No direct content editor.
- Instagram preview is square card news format.
- Auto approval is controlled globally from brand settings, not per channel.
- Channels page manages connections, tokens, Webflow mapping, and health checks only.
- Publishing times are policy slots; users cannot edit posting time.
- Buttons that only navigate should use React Router links.
- Tabs must be keyboard accessible with left/right arrow behavior.

---

### Task 1: Create Vite React App Skeleton

**Files:**
- Create: `apps/customer-ui/package.json`
- Create: `apps/customer-ui/index.html`
- Create: `apps/customer-ui/tsconfig.json`
- Create: `apps/customer-ui/tsconfig.node.json`
- Create: `apps/customer-ui/vite.config.ts`
- Create: `apps/customer-ui/vitest.config.ts`
- Create: `apps/customer-ui/playwright.config.ts`
- Create: `apps/customer-ui/src/main.tsx`
- Create: `apps/customer-ui/src/App.tsx`
- Create: `apps/customer-ui/src/routes.tsx`
- Create: `apps/customer-ui/src/test/setup.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@brand-pilot/customer-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.4",
    "lucide-react": "^0.468.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.16",
    "@types/react-dom": "^18.3.5",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Add Vite config**

```ts
// apps/customer-ui/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
```

- [ ] **Step 3: Add Vitest config**

```ts
// apps/customer-ui/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 4: Add TypeScript configs**

```json
// apps/customer-ui/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

```json
// apps/customer-ui/tsconfig.node.json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 5: Add app entry**

```html
<!-- apps/customer-ui/index.html -->
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Brand Pilot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// apps/customer-ui/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import "./styles/prototype.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
```

- [ ] **Step 6: Add placeholder pages and router**

```tsx
// apps/customer-ui/src/App.tsx
import { Outlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";

export function App() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
```

```tsx
// apps/customer-ui/src/routes.tsx
import { createBrowserRouter, Navigate } from "react-router-dom";
import { App } from "./App";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ContentPage } from "./pages/ContentPage";
import { PublishQueuePage } from "./pages/PublishQueuePage";
import { SourcesPage } from "./pages/SourcesPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { BrandSettingsPage } from "./pages/BrandSettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/onboarding" replace /> },
      { path: "onboarding", element: <OnboardingPage /> },
      { path: "content", element: <ContentPage /> },
      { path: "publish-queue", element: <PublishQueuePage /> },
      { path: "sources", element: <SourcesPage /> },
      { path: "channels", element: <ChannelsPage /> },
      { path: "brand-settings", element: <BrandSettingsPage /> },
    ],
  },
]);
```

- [ ] **Step 7: Run install and first build**

Run:

```bash
cd apps/customer-ui
npm install
npm run build
```

Expected:

```text
vite v...
✓ built in ...
```

---

### Task 2: Move Prototype CSS Into React App

**Files:**
- Create: `apps/customer-ui/src/styles/prototype.css`
- Source copy: `docs/prototypes/brand-pilot-customer-ui/assets/prototype.css`

- [ ] **Step 1: Copy the approved CSS**

Copy the full content of:

```text
docs/prototypes/brand-pilot-customer-ui/assets/prototype.css
```

into:

```text
apps/customer-ui/src/styles/prototype.css
```

- [ ] **Step 2: Add React app root guard**

At the top of `apps/customer-ui/src/styles/prototype.css`, ensure the app can fill the viewport:

```css
#root {
  min-height: 100vh;
}
```

- [ ] **Step 3: Run visual smoke build**

Run:

```bash
cd apps/customer-ui
npm run build
```

Expected: build succeeds with no CSS import errors.

---

### Task 3: Define Types And Mock Data

**Files:**
- Create: `apps/customer-ui/src/types.ts`
- Create: `apps/customer-ui/src/data/mockData.ts`

- [ ] **Step 1: Add shared types**

```ts
// apps/customer-ui/src/types.ts
export type BadgeVariant = "neutral" | "info" | "ok" | "warn" | "bad" | "auto";

export type ChannelType = "instagram" | "threads" | "webflow";

export type ChannelStatus =
  | "connected"
  | "not_connected"
  | "needs_attention"
  | "expired"
  | "insufficient_permissions"
  | "mapping_required"
  | "publish_failed";

export type ReviewStatus =
  | "pending_review"
  | "approved"
  | "auto_approved"
  | "auto_approval_blocked"
  | "regenerating"
  | "rejected";

export interface NavItem {
  label: string;
  path: string;
  badge?: string;
  status?: BadgeVariant;
}

export interface BrandProfile {
  name: string;
  industry: string;
  primaryCustomer: string;
  description: string;
  tone: string;
  defaultCta: string;
  mainLink: string;
  autoApprovalEnabled: boolean;
}

export interface ChannelConnection {
  type: ChannelType;
  label: string;
  status: ChannelStatus;
  accountLabel: string;
  lastHealthyAt: string;
  lastPublishedAt: string;
  alertTitle?: string;
  alertBody?: string;
}

export interface ContentOutput {
  id: string;
  title: string;
  channel: ChannelType;
  status: ReviewStatus;
  topicId: string;
  generatedAt: string;
  sourceSummary: string;
  previewTitle: string;
  previewBody: string;
  blockReasons?: string[];
}

export interface PublishSlot {
  id: string;
  channel: ChannelType;
  time: string;
  title: string;
  approvalType: "manual" | "auto" | "empty";
  status: "scheduled" | "published" | "failed" | "empty";
}
```

- [ ] **Step 2: Add mock data**

```ts
// apps/customer-ui/src/data/mockData.ts
import type { BrandProfile, ChannelConnection, ContentOutput, NavItem, PublishSlot } from "../types";

export const navItems: NavItem[] = [
  { label: "온보딩", path: "/onboarding", badge: "3", status: "warn" },
  { label: "콘텐츠", path: "/content", badge: "5", status: "info" },
  { label: "게시 큐", path: "/publish-queue", badge: "1", status: "warn" },
  { label: "소스", path: "/sources" },
  { label: "채널", path: "/channels", badge: "!", status: "bad" },
  { label: "브랜드 설정", path: "/brand-settings" },
];

export const brandProfile: BrandProfile = {
  name: "제주 여행 상담 브랜드",
  industry: "여행 서비스",
  primaryCustomer: "일본 여행을 처음 준비하는 20-40대",
  description: "제주와 일본 여행 일정을 상담하고 숙소, 이동, 예산 정보를 정리해주는 여행 브랜드입니다.",
  tone: "친절하지만 과장하지 않는 전문가 톤",
  defaultCta: "무료 상담 신청하기",
  mainLink: "https://example.com",
  autoApprovalEnabled: true,
};

export const channels: ChannelConnection[] = [
  {
    type: "instagram",
    label: "Instagram",
    status: "needs_attention",
    accountLabel: "@jeju_trip",
    lastHealthyAt: "어제 21:10",
    lastPublishedAt: "-",
    alertTitle: "게시 권한 확인 필요",
    alertBody: "토큰은 저장되어 있지만 정방형 카드뉴스 컨테이너 생성 테스트가 필요합니다.",
  },
  {
    type: "threads",
    label: "Threads",
    status: "not_connected",
    accountLabel: "연결 전",
    lastHealthyAt: "-",
    lastPublishedAt: "-",
    alertTitle: "토큰 필요",
    alertBody: "Threads 자동 게시를 위해 계정 토큰과 권한 확인이 필요합니다.",
  },
  {
    type: "webflow",
    label: "Webflow",
    status: "connected",
    accountLabel: "제주 여행 블로그",
    lastHealthyAt: "오늘 09:50",
    lastPublishedAt: "오늘 11:28",
  },
];

export const contentOutputs: ContentOutput[] = [
  {
    id: "co-1",
    title: "제주 가족여행 숙소 선택법",
    channel: "instagram",
    status: "pending_review",
    topicId: "topic-18",
    generatedAt: "오늘 10:03",
    sourceSummary: "자사 FAQ, 숙소 추천 페이지, 주제표 target_customer 값을 사용했습니다.",
    previewTitle: "숙소 위치가 여행 만족도를 바꿉니다",
    previewBody: "정방형 1:1 카드뉴스 5장 구성",
  },
  {
    id: "co-2",
    title: "여행 전 체크리스트",
    channel: "webflow",
    status: "auto_approved",
    topicId: "topic-20",
    generatedAt: "오늘 10:04",
    sourceSummary: "브랜드 URL만 사용했고 금지 표현이 없습니다.",
    previewTitle: "여행 전 체크리스트",
    previewBody: "Webflow 블로그 글 초안",
  },
  {
    id: "co-3",
    title: "비 오는 날 제주 일정 짜는 방법",
    channel: "threads",
    status: "auto_approval_blocked",
    topicId: "topic-21",
    generatedAt: "오늘 10:05",
    sourceSummary: "외부 참고 URL 의존도가 높아 수동 검토가 필요합니다.",
    previewTitle: "비가 와도 일정은 무너지지 않습니다",
    previewBody: "Threads 본문 길이 조정 필요",
    blockReasons: ["외부 참고 URL 의존도가 높습니다.", "Threads 본문 길이가 정책 범위를 초과했습니다."],
  },
];

export const publishSlots: PublishSlot[] = [
  { id: "slot-1", channel: "instagram", time: "11:34 예정", title: "초보자를 위한 도쿄 3박4일", approvalType: "manual", status: "scheduled" },
  { id: "slot-2", channel: "instagram", time: "14:27 예정", title: "일본 여행 경비 줄이는 법", approvalType: "auto", status: "scheduled" },
  { id: "slot-3", channel: "webflow", time: "11:28 완료", title: "여행 초보자가 숙소 고르는 법", approvalType: "auto", status: "published" },
  { id: "slot-4", channel: "webflow", time: "14:41 예정", title: "도쿄 교통패스 비교", approvalType: "manual", status: "scheduled" },
];
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
cd apps/customer-ui
npm run build
```

Expected: TypeScript accepts all exported data.

---

### Task 4: Build Layout And UI Components

**Files:**
- Create: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Create: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Create: `apps/customer-ui/src/components/layout/Topbar.tsx`
- Create: `apps/customer-ui/src/components/layout/PageHeader.tsx`
- Create: `apps/customer-ui/src/components/ui/Badge.tsx`
- Create: `apps/customer-ui/src/components/ui/ButtonLink.tsx`
- Create: `apps/customer-ui/src/components/ui/Card.tsx`
- Create: `apps/customer-ui/src/components/ui/Alert.tsx`
- Create: `apps/customer-ui/src/components/ui/Tabs.tsx`
- Create: `apps/customer-ui/src/components/ui/Switch.tsx`
- Create: `apps/customer-ui/src/test/renderWithRouter.tsx`
- Create: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: Add `Badge`**

```tsx
// apps/customer-ui/src/components/ui/Badge.tsx
import type { BadgeVariant } from "../../types";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  const className = variant === "neutral" ? "badge" : `badge ${variant}`;
  return <span className={className}>{children}</span>;
}
```

- [ ] **Step 2: Add navigation layout**

```tsx
// apps/customer-ui/src/components/layout/Sidebar.tsx
import { NavLink } from "react-router-dom";
import { navItems } from "../../data/mockData";
import { Badge } from "../ui/Badge";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-badge">BP</span>
        <span>Brand Pilot</span>
      </div>
      <nav className="nav" aria-label="고객 메뉴">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/onboarding"}>
            <span>{item.label}</span>
            {item.badge ? <Badge variant={item.status}>{item.badge}</Badge> : null}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

```tsx
// apps/customer-ui/src/components/layout/Topbar.tsx
import { Badge } from "../ui/Badge";

export function Topbar() {
  return (
    <header className="topbar">
      <div>
        <strong>제주 여행 상담 브랜드</strong>
        <span>마지막 생성: 오늘 10:02</span>
      </div>
      <Badge variant="warn">3개 항목 필요</Badge>
    </header>
  );
}
```

```tsx
// apps/customer-ui/src/components/layout/AppShell.tsx
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Topbar />
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Add `Tabs` with keyboard behavior**

```tsx
// apps/customer-ui/src/components/ui/Tabs.tsx
import { useId, useState } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface TabsProps {
  items: TabItem[];
  defaultId: string;
}

export function Tabs({ items, defaultId }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultId);
  const baseId = useId();

  function move(currentId: string, direction: 1 | -1) {
    const index = items.findIndex((item) => item.id === currentId);
    const next = items[(index + direction + items.length) % items.length];
    setActiveId(next.id);
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${next.id}`)?.focus();
    });
  }

  return (
    <div data-tabs>
      <div className="tabs" role="tablist">
        {items.map((item) => (
          <button
            key={item.id}
            id={`${baseId}-tab-${item.id}`}
            className="tab"
            type="button"
            role="tab"
            aria-selected={activeId === item.id}
            aria-controls={`${baseId}-panel-${item.id}`}
            tabIndex={activeId === item.id ? 0 : -1}
            onClick={() => setActiveId(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(item.id, 1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(item.id, -1);
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <section
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={activeId !== item.id}
        >
          {item.content}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add tests for navigation and tabs**

```tsx
// apps/customer-ui/src/test/setup.ts
import "@testing-library/jest-dom/vitest";
```

```tsx
// apps/customer-ui/src/test/renderWithRouter.tsx
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { App } from "../App";

export function renderWithRouter(path = "/onboarding") {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <App />,
        children: [{ path: "*", element: <div>Test page</div> }],
      },
    ],
    { initialEntries: [path] }
  );

  return render(<RouterProvider router={router} />);
}
```

```tsx
// apps/customer-ui/src/__tests__/navigation.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithRouter } from "../test/renderWithRouter";

describe("AppShell navigation", () => {
  it("renders customer IA without dashboard", () => {
    renderWithRouter();

    expect(screen.getByRole("link", { name: /온보딩/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /콘텐츠/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /게시 큐/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /소스/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /채널/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /브랜드 설정/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /대시보드/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run component tests**

Run:

```bash
cd apps/customer-ui
npm test
```

Expected: navigation test passes.

---

### Task 5: Convert Brand Settings Page First

**Reason:** Brand settings now owns the global auto approval switch. Convert it first so later pages can link to it.

**Files:**
- Create: `apps/customer-ui/src/pages/BrandSettingsPage.tsx`
- Create: `apps/customer-ui/src/__tests__/brandSettings.test.tsx`

- [ ] **Step 1: Write test for global auto approval**

```tsx
// apps/customer-ui/src/__tests__/brandSettings.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandSettingsPage } from "../pages/BrandSettingsPage";

describe("BrandSettingsPage", () => {
  it("renders one global auto approval switch and no channel-specific auto approval text", () => {
    render(<BrandSettingsPage />);

    expect(screen.getByRole("heading", { name: "브랜드 설정" })).toBeInTheDocument();
    expect(screen.getByText("브랜드 전체 자동 승인")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "브랜드 전체 자동 승인" })).toBeChecked();
    expect(screen.getByText(/Instagram, Threads, Webflow에 동일하게 적용합니다/)).toBeInTheDocument();
    expect(screen.queryByText("채널별 자동 승인")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement the page**

```tsx
// apps/customer-ui/src/pages/BrandSettingsPage.tsx
import { brandProfile } from "../data/mockData";
import { Badge } from "../components/ui/Badge";
import { Switch } from "../components/ui/Switch";

export function BrandSettingsPage() {
  return (
    <section className="content">
      <div className="page-head">
        <div>
          <h1>브랜드 설정</h1>
          <p>모든 콘텐츠 생성에 사용할 기준 정보와 브랜드 전체 자동 승인을 관리합니다.</p>
        </div>
        <div className="actions">
          <button className="button">변경 취소</button>
          <button className="button primary">저장</button>
        </div>
      </div>

      <div className="grid two">
        <section className="panel">
          <div className="panel-head">
            <h2>브랜드 프로필</h2>
            <Badge variant="ok">필수 입력 완료</Badge>
          </div>
          <div className="panel-body form-grid">
            <label className="field">
              <span>브랜드명</span>
              <input defaultValue={brandProfile.name} />
            </label>
            <label className="field">
              <span>업종</span>
              <input defaultValue={brandProfile.industry} />
            </label>
            <label className="field">
              <span>핵심 고객</span>
              <input defaultValue={brandProfile.primaryCustomer} />
            </label>
            <label className="field">
              <span>제품/서비스 설명</span>
              <textarea defaultValue={brandProfile.description} />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>생성 기준</h2>
            <Badge variant="info">콘텐츠 공통</Badge>
          </div>
          <div className="panel-body form-grid">
            <label className="field">
              <span>톤앤매너</span>
              <textarea defaultValue={brandProfile.tone} />
            </label>
            <label className="field">
              <span>기본 CTA</span>
              <input defaultValue={brandProfile.defaultCta} />
            </label>
            <label className="field">
              <span>주요 링크</span>
              <input defaultValue={brandProfile.mainLink} />
            </label>
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>자동 승인</h2>
          <Badge variant="auto">전체 켜짐</Badge>
        </div>
        <div className="panel-body grid">
          <div className="toggle-row">
            <div>
              <strong>브랜드 전체 자동 승인</strong>
              <p className="muted">
                켜면 자동 승인 조건을 통과한 콘텐츠가 검토 없이 게시 큐로 들어갑니다. 끄면 모든 채널 결과물이 수동 검토 대상으로 생성됩니다.
              </p>
            </div>
            <Switch label="브랜드 전체 자동 승인" defaultChecked={brandProfile.autoApprovalEnabled} />
          </div>
          <div className="alert info">
            <strong>적용 범위</strong>
            <span>Instagram, Threads, Webflow에 동일하게 적용합니다. MVP에서는 채널마다 다른 예외 설정을 제공하지 않습니다.</span>
          </div>
          <div className="alert warn">
            <strong>자동 승인 차단 조건</strong>
            <span>금지 표현, 외부 URL 문장 재사용 위험, 근거 부족, 채널 연결 오류, 이미지 렌더링 실패가 있으면 자동 승인하지 않습니다.</span>
          </div>
        </div>
      </section>
    </section>
  );
}
```

- [ ] **Step 3: Add accessible `Switch`**

```tsx
// apps/customer-ui/src/components/ui/Switch.tsx
interface SwitchProps {
  label: string;
  defaultChecked?: boolean;
}

export function Switch({ label, defaultChecked = false }: SwitchProps) {
  return (
    <label className="switch" aria-label={label}>
      <input role="switch" type="checkbox" defaultChecked={defaultChecked} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd apps/customer-ui
npm test -- brandSettings.test.tsx
```

Expected: global auto approval test passes.

---

### Task 6: Convert Channels Page

**Files:**
- Create: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Create: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] **Step 1: Write test to prevent channel-level auto approval regression**

```tsx
// apps/customer-ui/src/__tests__/channels.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChannelsPage } from "../pages/ChannelsPage";

describe("ChannelsPage", () => {
  it("shows connection tabs and no auto approval settings tab", async () => {
    render(<ChannelsPage />);

    expect(screen.getByRole("heading", { name: "채널" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "연결 상태" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "토큰 정보" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Webflow 매핑" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /자동 승인/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Webflow 매핑" }));
    expect(screen.getByText("Webflow 필드 매핑")).toBeVisible();
  });
});
```

- [ ] **Step 2: Implement channels page**

```tsx
// apps/customer-ui/src/pages/ChannelsPage.tsx
import { channels } from "../data/mockData";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    connected: "연결됨",
    not_connected: "미연결",
    needs_attention: "확인 필요",
    expired: "만료",
    insufficient_permissions: "권한 부족",
    mapping_required: "매핑 필요",
    publish_failed: "게시 실패",
  };
  return labels[status] ?? status;
}

export function ChannelsPage() {
  return (
    <section className="content">
      <div className="page-head">
        <div>
          <h1>채널</h1>
          <p>Instagram, Threads, Webflow 연결 상태와 게시 권한을 확인합니다.</p>
        </div>
      </div>

      <Tabs
        defaultId="overview"
        items={[
          {
            id: "overview",
            label: "연결 상태",
            content: (
              <div className="grid three">
                {channels.map((channel) => (
                  <article className="panel" key={channel.type}>
                    <div className="panel-head">
                      <h2>{channel.label}</h2>
                      <Badge variant={channel.status === "connected" ? "ok" : channel.status === "not_connected" ? "bad" : "warn"}>
                        {statusLabel(channel.status)}
                      </Badge>
                    </div>
                    <div className="panel-body grid">
                      <p>연결 계정: {channel.accountLabel}</p>
                      <p className="muted">마지막 정상 확인: {channel.lastHealthyAt}</p>
                      <p className="muted">마지막 게시 성공: {channel.lastPublishedAt}</p>
                      {channel.alertTitle ? (
                        <div className="alert warn">
                          <strong>{channel.alertTitle}</strong>
                          <span>{channel.alertBody}</span>
                        </div>
                      ) : null}
                      <div className="actions">
                        <button className="button">연결 확인</button>
                        <button className="button">설정</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ),
          },
          {
            id: "tokens",
            label: "토큰 정보",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>토큰 정보</h2>
                  <Badge variant="warn">운영자 확인 필요</Badge>
                </div>
                <div className="panel-body grid">
                  <div className="alert info">
                    <strong>OAuth 전환 전 입력 정보</strong>
                    <span>초기에는 API 토큰과 계정 ID를 받아 저장하고, 이후 OAuth 연결로 전환합니다.</span>
                  </div>
                </div>
              </section>
            ),
          },
          {
            id: "webflow",
            label: "Webflow 매핑",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>Webflow 필드 매핑</h2>
                  <Badge variant="ok">매핑됨</Badge>
                </div>
                <div className="panel-body">
                  <table className="table">
                    <thead>
                      <tr><th>내부 필드</th><th>Webflow 필드</th><th>상태</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>title</td><td>name</td><td>정상</td></tr>
                      <tr><td>body</td><td>post-body</td><td>정상</td></tr>
                      <tr><td>cover_image</td><td>main-image</td><td>정상</td></tr>
                    </tbody>
                  </table>
                </div>
              </section>
            ),
          },
        ]}
      />
    </section>
  );
}
```

- [ ] **Step 3: Run tests**

Run:

```bash
cd apps/customer-ui
npm test -- channels.test.tsx
```

Expected: test passes and no auto approval tab exists.

---

### Task 7: Convert Content Review Page

**Files:**
- Create: `apps/customer-ui/src/pages/ContentPage.tsx`
- Create: `apps/customer-ui/src/components/ui/SquareCarouselPreview.tsx`

- [ ] **Step 1: Implement square Instagram preview component**

```tsx
// apps/customer-ui/src/components/ui/SquareCarouselPreview.tsx
interface SquareCarouselPreviewProps {
  title: string;
}

export function SquareCarouselPreview({ title }: SquareCarouselPreviewProps) {
  return (
    <div className="square-carousel-preview" aria-label="Instagram 정방형 카드뉴스 미리보기">
      <div className="square-slide">{title}</div>
      <div className="slide-strip" aria-label="슬라이드 번호">
        <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
      </div>
      <p className="muted small">Instagram 카드뉴스 · 1080 x 1080 정방형 슬라이드</p>
    </div>
  );
}
```

- [ ] **Step 2: Implement content page tabs**

`ContentPage` must include these tabs:

```text
검토 필요
자동 승인됨
자동 승인 차단
재생성 중
거절됨
```

Use `contentOutputs` filtered by `status`.

- [ ] **Step 3: Add actions**

Each pending review detail must show these actions:

```text
승인
재생성
거절
게시 큐 보기
```

Use buttons only for prototype state. Do not add direct edit buttons.

- [ ] **Step 4: Run browser smoke**

Run:

```bash
cd apps/customer-ui
npm run dev
```

Open:

```text
http://127.0.0.1:5173/content
```

Expected:

- Instagram preview is square.
- `자동 승인 차단` tab shows block reasons above actions.
- There is no content editor or text editing control.

---

### Task 8: Convert Remaining Pages

**Files:**
- Create: `apps/customer-ui/src/pages/OnboardingPage.tsx`
- Create: `apps/customer-ui/src/pages/PublishQueuePage.tsx`
- Create: `apps/customer-ui/src/pages/SourcesPage.tsx`
- Create: `apps/customer-ui/src/components/ui/ChecklistItem.tsx`
- Create: `apps/customer-ui/src/components/ui/EmptyState.tsx`
- Create: `apps/customer-ui/src/components/ui/Field.tsx`

- [ ] **Step 1: Convert onboarding page**

Preserve these sections:

```text
온보딩 체크리스트
완료된 항목
현재 차단 사유
다음 실행
```

Every checklist action must link to an existing route:

```text
브랜드 설정 -> /brand-settings
URL 추가 -> /sources
Instagram 확인 -> /channels
Threads 연결 -> /channels
검토함 -> /content
```

- [ ] **Step 2: Convert publish queue page**

Preserve policy slot presentation:

```text
11:30 기준 ±10분
14:30 기준 ±10분
17:30 기준 ±10분
20:30 기준 ±10분
```

Do not render any button that implies time editing.

- [ ] **Step 3: Convert sources page**

Preserve source tabs:

```text
자사 URL
참고 URL
주제표 업로드
주제 큐
```

Topic upload screen must link to:

```text
docs/prototypes/brand-pilot-customer-ui/templates/topic-template.csv
```

until a React-served template asset is added.

- [ ] **Step 4: Run full unit test suite**

Run:

```bash
cd apps/customer-ui
npm test
```

Expected: all tests pass.

---

### Task 9: Add End-To-End QA

**Files:**
- Create: `apps/customer-ui/e2e/customer-ui.spec.ts`
- Create: `apps/customer-ui/playwright.config.ts`

- [ ] **Step 1: Add Playwright config**

```ts
// apps/customer-ui/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
```

- [ ] **Step 2: Add E2E test**

```ts
// apps/customer-ui/e2e/customer-ui.spec.ts
import { expect, test } from "@playwright/test";

test("customer IA routes are reachable", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: /온보딩/ })).toBeVisible();

  await page.getByRole("link", { name: /콘텐츠/ }).click();
  await expect(page.getByRole("heading", { name: "콘텐츠" })).toBeVisible();

  await page.getByRole("link", { name: /게시 큐/ }).click();
  await expect(page.getByRole("heading", { name: "게시 큐" })).toBeVisible();

  await page.getByRole("link", { name: /소스/ }).click();
  await expect(page.getByRole("heading", { name: "소스" })).toBeVisible();

  await page.getByRole("link", { name: /채널/ }).click();
  await expect(page.getByRole("heading", { name: "채널" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /자동 승인/ })).toHaveCount(0);

  await page.getByRole("link", { name: /브랜드 설정/ }).click();
  await expect(page.getByRole("switch", { name: "브랜드 전체 자동 승인" })).toBeVisible();
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const path of ["/onboarding", "/content", "/publish-queue", "/sources", "/channels", "/brand-settings"]) {
    await page.goto(path);
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow, `${path} should not overflow horizontally`).toBe(false);
  }
});
```

- [ ] **Step 3: Run E2E**

Run:

```bash
cd apps/customer-ui
npm run e2e
```

Expected: both desktop and mobile projects pass.

---

### Task 10: Visual Parity And Legacy Cleanup Decision

**Files:**
- Modify: `docs/prototypes/brand-pilot-customer-ui/finalized.json`
- Create: `docs/specs/BRAND_PILOT_REACT_CONVERSION_NOTES.md`

- [ ] **Step 1: Add conversion notes**

```md
# Brand Pilot React Conversion Notes

## React App

- App path: `apps/customer-ui`
- Stack: Vite, React, TypeScript, React Router
- Source prototype: `docs/prototypes/brand-pilot-customer-ui`

## Preserved Decisions

- No dashboard.
- Customer-only IA.
- Auto approval is global in brand settings.
- Channels page has no auto approval tab.
- Instagram preview remains square card news format.
- Posting time is not user-editable.

## Deferred

- API integration.
- Real authentication.
- Real file upload.
- Real channel OAuth.
- Backend publish queue.
```

- [ ] **Step 2: Update finalized metadata**

Change `docs/prototypes/brand-pilot-customer-ui/finalized.json` to include:

```json
{
  "reactApp": "apps/customer-ui",
  "sourcePrototype": "docs/prototypes/brand-pilot-customer-ui",
  "conversionStatus": "planned"
}
```

Do not remove the existing page list.

- [ ] **Step 3: Final verification**

Run:

```bash
cd apps/customer-ui
npm run build
npm test
npm run e2e
```

Expected:

```text
build passes
unit tests pass
e2e tests pass
```

---

## Implementation Order

1. Task 1: React app skeleton
2. Task 2: CSS migration
3. Task 3: Types and mock data
4. Task 4: Layout and shared UI components
5. Task 5: Brand settings page
6. Task 6: Channels page
7. Task 7: Content review page
8. Task 8: Onboarding, publish queue, sources
9. Task 9: E2E QA
10. Task 10: Conversion notes and metadata

## Acceptance Criteria

- `apps/customer-ui` runs with `npm run dev`.
- All six customer pages exist as React routes.
- No dashboard route exists.
- Brand settings has exactly one global auto approval switch.
- Channels page has no auto approval tab, switch, or channel-level auto approval setting.
- Instagram content preview uses a square card-news layout.
- Posting queue does not expose time editing.
- Mobile width 390px has no horizontal overflow.
- `npm run build`, `npm test`, and `npm run e2e` pass.

## Risks

- The current HTML is a prototype, so some text may need UTF-8 validation during migration.
- Existing CSS is global. Keep it for parity first, then split or migrate to Tailwind/shadcn after React behavior is stable.
- This folder is currently not a Git repository. If Git is initialized later, commit after each task.

## Self-Review

- Spec coverage: all six customer IA pages are covered.
- Auto approval policy: global brand-level on/off is covered in Task 5 and regression-tested in Task 6 and Task 9.
- Prototype behavior: tabs, navigation, square Instagram preview, and mobile overflow are covered.
- Exclusions preserved: dashboard, direct editor, user-editable posting time, and channel-level auto approval controls are excluded.
