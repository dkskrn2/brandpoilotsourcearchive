# In-app Billing and Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authenticated `/billing` the canonical in-app pricing destination, port the approved standalone pricing content into the React customer UI with D tokens, and preserve the existing billing summary as an independently loading lower section.

**Architecture:** Keep the existing `AuthGate → AppShell → BrandSetupGate → /billing` route hierarchy. Render static pricing from a typed local content model, then render the existing remote billing summary in a focused child component below it so summary loading or failure cannot hide pricing. Treat the standalone Next pricing component and CSS as read-only parity sources.

**Tech Stack:** React 18, TypeScript, React Router 6, Vite 8, Vitest 4, Testing Library, Playwright, axe-core, lucide-react, existing D semantic CSS tokens.

---

## Scope and execution rules

Approved design: `docs/superpowers/specs/2026-07-29-in-app-billing-pricing-design.md`.
Read-only parity sources: `app/product/pricing/brand-pilot-pricing-page.tsx:10-202`
and `app/globals.css:4037-4584`.
Do not modify `app/product/pricing/page.tsx`,
`app/product/pricing/brand-pilot-pricing-page.tsx`, `app/globals.css`, or any API,
worker, database, migration, schema, environment, deployment, or redirect file.
Do not add checkout, Toss, entitlement enforcement, iframes, card inputs, or a
shared package. Pricing CTAs are `/support` consultation links, never payments.

Use strict RED → GREEN. Stop after each task, run its gate, and commit that slice.

## Task 1: Route billing navigation internally

**Files:** Modify `apps/customer-ui/src/features/navigation/navigationModel.ts`;
test `apps/customer-ui/src/features/navigation/navigationModel.test.ts` and
`apps/customer-ui/src/features/navigation/Sidebar.test.tsx`.

- [ ] **Step 1: Add the navigation-model RED assertion**

In the existing primary-navigation test, locate the item labeled `결제 및 구독`
and require the customer route:

```ts
const billingItem = primaryNavigationItems.find(
  (item) => item.label === "결제 및 구독",
);

expect(billingItem).toMatchObject({
  to: "/billing",
  label: "결제 및 구독",
});
```

- [ ] **Step 2: Add the rendered-link RED assertion**

In `Sidebar.test.tsx`, render the sidebar with its existing router/helper and add:

```ts
expect(
  screen.getByRole("link", { name: /결제 및 구독/ }),
).toHaveAttribute("href", "/billing");
```

- [ ] **Step 3: Run both tests and confirm RED**

Run from the project root:

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/navigation/navigationModel.test.ts `
  src/features/navigation/Sidebar.test.tsx
```

Expected: both new assertions fail because the current target is
`https://www.danbammsg.co.kr/product/pricing`.

- [ ] **Step 4: Change only the navigation target**

In `navigationModel.ts`, preserve label, icon, placement, and permission behavior.
Change only:

```ts
to: "/billing",
```

Do not add a second pricing link. `Sidebar.tsx` already renders `/...` targets with
`NavLink`, so no production sidebar change is required.

- [ ] **Step 5: Run the focused tests and confirm GREEN**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/navigation/navigationModel.test.ts `
  src/features/navigation/Sidebar.test.tsx
```

Expected: both files pass.

- [ ] **Step 6: Commit the internal-navigation slice**

```powershell
git add apps/customer-ui/src/features/navigation/navigationModel.ts `
  apps/customer-ui/src/features/navigation/navigationModel.test.ts `
  apps/customer-ui/src/features/navigation/Sidebar.test.tsx
git diff --cached --check
git commit -m "feat(billing): route pricing navigation in app"
```

## Task 2: Port static pricing content and presentation

**Files:** Create `apps/customer-ui/src/features/billing/billingPricingContent.ts`,
`apps/customer-ui/src/features/billing/BillingPricing.tsx`, and
`apps/customer-ui/src/styles/billing-pricing.css`; modify
`apps/customer-ui/src/main.tsx`; test
`apps/customer-ui/src/features/billing/billing.test.tsx`.

Copy plans from `brand-pilot-pricing-page.tsx:10-41`, comparisons from `:43-68`,
FAQs from `:70-101`, UI copy from `:103-202`, and CSS intent from
`app/globals.css:4037-4584`.

- [ ] **Step 1: Add a static-pricing RED test**

In `billing.test.tsx`, keep the existing API helper and render `/billing` through
`MemoryRouter`. Add a test that verifies pricing is visible while the billing
summary promise is unresolved:

```ts
expect(
  await screen.findByRole("heading", {
    level: 1,
    name: "운영 범위에 맞는 플랜을 선택하세요.",
  }),
).toBeVisible();

expect(screen.getByText("운영 시작")).toBeVisible();
expect(screen.getByText("팀 운영")).toBeVisible();
expect(screen.getByText("확장 운영")).toBeVisible();
expect(screen.getByText("추천 플랜")).toBeVisible();
expect(screen.getByRole("heading", { name: "플랜별 운영 범위" })).toBeVisible();
expect(screen.getByRole("heading", { name: "자주 묻는 질문" })).toBeVisible();
expect(screen.getByRole("heading", { name: "맞춤 운영" })).toBeVisible();
```

Assert all five approved consultation links:

```ts
for (const name of [
  "운영 시작 상담",
  "팀 운영 상담",
  "확장 운영 상담",
  "맞춤 운영 상담",
  "운영 범위 상담",
]) {
  expect(screen.getByRole("link", { name })).toHaveAttribute("href", "/support");
}
```

- [ ] **Step 2: Run the pricing test and confirm RED**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/billing/billing.test.tsx
```

Expected: H1 and pricing sections are absent.

- [ ] **Step 3: Create the complete pricing data contracts**

Create `billingPricingContent.ts` with these complete exported contracts:

```ts
export interface BillingPlan {
  readonly name: "운영 시작" | "팀 운영" | "확장 운영";
  readonly recommended: boolean;
  readonly description: string;
  readonly price: string;
  readonly note: string;
  readonly facts: readonly [label: string, value: string][];
  readonly features: readonly string[];
  readonly cta: "운영 시작 상담" | "팀 운영 상담" | "확장 운영 상담";
}

export interface BillingComparisonRow {
  readonly feature: string;
  readonly start: string;
  readonly team: string;
  readonly expand: string;
  readonly custom: string;
}

export interface BillingComparisonGroup {
  readonly label: string;
  readonly rows: readonly BillingComparisonRow[];
}

export interface BillingFaq {
  readonly question: string;
  readonly answer: string;
}
```

Use `satisfies readonly BillingPlan[]` and the corresponding comparison/FAQ types.
This is the required shape of one complete representative record:

```ts
export const billingPlans = [
  {
    name: "운영 시작",
    recommended: false,
    description: "한 브랜드의 기준을 세우고, 첫 콘텐츠 발행 흐름을 연결합니다.",
    price: "별도 견적",
    note: "첫 운영 범위 기준",
    facts: [
      ["브랜드", "1개"],
      ["검토", "담당자 1명"],
      ["게시", "Instagram"],
    ],
    features: [
      "브랜드 자료와 참고 링크 등록",
      "브랜드 기준을 반영한 콘텐츠 초안",
      "카드뉴스와 문구 검토",
      "승인 후 게시 흐름 연결",
    ],
    cta: "운영 시작 상담",
  },
] satisfies readonly BillingPlan[];
```

Before adding 팀 운영 and 확장 운영, compare the representative record byte-for-byte
with the canonical source. Then copy every remaining plan, comparison, and FAQ
record exactly from canonical
`app/product/pricing/brand-pilot-pricing-page.tsx:10-101`. Do not rewrite,
shorten, translate, or invent marketing copy.

- [ ] **Step 4: Add explicit content-model parity assertions**

Extend `billing.test.tsx` or add a colocated test block that imports the arrays:

```ts
expect(billingPlans.map((plan) => plan.name)).toEqual([
  "운영 시작",
  "팀 운영",
  "확장 운영",
]);
expect(billingPlans.map((plan) => plan.cta)).toEqual([
  "운영 시작 상담",
  "팀 운영 상담",
  "확장 운영 상담",
]);
expect(billingPlans.find((plan) => plan.name === "팀 운영")?.recommended).toBe(true);

expect(billingComparisonGroups.map((group) => group.label)).toEqual([
  "기본 운영",
  "검토와 발행",
  "확장 범위",
]);
expect(billingComparisonGroups.flatMap((group) => group.rows)).toHaveLength(9);
expect(billingFaqs.map((faq) => faq.question)).toEqual([
  "왜 정해진 금액 대신 견적으로 안내하나요?",
  "도입 전에 어떤 정보를 준비해야 하나요?",
  "초기 설정 비용과 월 운영 비용은 어떻게 구분되나요?",
  "운영 중에 플랜 범위를 바꿀 수 있나요?",
  "Instagram 외 채널도 연결할 수 있나요?",
]);
```

If canonical source values differ from the assertions, the canonical source wins;
update the assertion to the exact source string and record that correction in the
task commit message body.

- [ ] **Step 5: Build `BillingPricing` in three small passes**

Create `BillingPricing.tsx`. First render the eyebrow, one H1, subtitle, pricing
note, and three `<article>` plan cards by mapping `billingPlans`.

Each card must expose its name as an `<h2>`, render facts/features as semantic
lists, render the 팀 운영 badge as visible text, and render each consultation CTA
as an internal router link:

```tsx
<Link className="billing-pricing__plan-cta" to="/support">
  {plan.cta}
</Link>
```

Next add comparison markup. Use `운영 항목`, `운영 시작`, `팀 운영`,
`확장 운영`, and `맞춤 운영` as column headers.
Wrap the table in a keyboard-scrollable named region:

```tsx
<div
  className="billing-pricing__comparison-scroll"
  role="region"
  aria-label="플랜별 운영 범위 표"
  tabIndex={0}
>
</div>
```

Inside the region, render a `table` labeled `플랜별 운영 범위` by mapping every
typed group and row. Finally add FAQ `<details>` items and two inquiry surfaces.
All five consultation links use internal `/support` as required by the approved
design, overriding the standalone site's `/contact` destination.

- [ ] **Step 6: Port styling with D semantic tokens**

Create `billing-pricing.css`, preserving the standalone hierarchy and responsive
behavior but replacing standalone colors/radii with existing tokens from
`apps/customer-ui/src/styles/tokens.css:1-20`.

Required selectors:

```css
.billing-pricing
.billing-pricing__hero
.billing-pricing__plans
.billing-pricing__plan
.billing-pricing__plan--recommended
.billing-pricing__plan-badge
.billing-pricing__comparison-scroll
.billing-pricing__comparison
.billing-pricing__faq-list
.billing-pricing__custom
.billing-pricing__closing
```

Required rules:

- desktop plans: three equal columns;
- 팀 운영: visible `추천 플랜` text plus non-color border/background distinction;
- table wrapper: `overflow-x: auto`;
- keyboard focus: `:focus-visible` using `--bp-color-primary`;
- `@media (max-width: 900px)`: plans become one column;
- `@media (max-width: 640px)`: reduce padding and keep CTAs full-width;
- no literal hex colors, standalone CSS custom properties, or copied Next classes;
- use only `--bp-color-*` and `--bp-radius-*` tokens for colors and radii.

- [ ] **Step 7: Import CSS and mount pricing**

Add exactly one global import in `main.tsx` with the other feature styles:

```ts
import "./styles/billing-pricing.css";
```

Temporarily render `<BillingPricing />` at the top of the existing `BillingPage`
without deleting or changing its billing-summary markup. Task 3 will perform the
behavior-preserving extraction.

- [ ] **Step 8: Run focused tests and confirm GREEN**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/billing/billing.test.tsx
```

Expected: pricing content/parity assertions and existing billing tests pass.

- [ ] **Step 9: Commit the static pricing slice**

```powershell
git add apps/customer-ui/src/features/billing/billingPricingContent.ts `
  apps/customer-ui/src/features/billing/BillingPricing.tsx `
  apps/customer-ui/src/features/billing/billing.test.tsx `
  apps/customer-ui/src/styles/billing-pricing.css `
  apps/customer-ui/src/main.tsx
git diff --cached --check
git commit -m "feat(billing): add in-app pricing presentation"
```

## Task 3: Isolate and preserve the existing billing summary

**Files:** Create
`apps/customer-ui/src/features/billing/BillingSummarySection.tsx`; modify
`apps/customer-ui/src/pages/BillingPage.tsx`; test
`apps/customer-ui/src/features/billing/BillingSummarySection.test.tsx` and
`apps/customer-ui/src/features/billing/billing.test.tsx`.

- [ ] **Step 1: Make billing-summary timing deterministic**

In the existing test helper, allow the summary GET request to resolve, reject, or
remain pending. Keep the existing default summary fixture unchanged. Use one
deferred promise per test; reset handlers and mocks in `beforeEach`.

- [ ] **Step 2: Add independent-state RED tests**

Create `features/billing/BillingSummarySection.test.tsx`, import the not-yet
created component, and reproduce the existing resolved summary assertion.

In `billing.test.tsx`, add three integration tests:

1. pending summary: pricing H1 and all three cards are visible, summary skeleton is
   visible below them;
2. rejected summary: pricing remains visible and the existing summary error alert
   appears below it;
3. resolved summary: existing headings `현재 구독`, `사용량`, `결제 내역`,
   `청구 정보`, and `결제 방법` are all visible with existing values.

For document order, use:

```ts
const pricingHeading = await screen.findByRole("heading", {
  level: 1,
  name: "운영 범위에 맞는 플랜을 선택하세요.",
});
const summaryHeading = await screen.findByRole("heading", {
  name: "현재 구독",
});

expect(
  pricingHeading.compareDocumentPosition(summaryHeading) &
    Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy();
```

- [ ] **Step 3: Run the isolation tests and confirm RED**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/billing/billing.test.tsx `
  src/features/billing/BillingSummarySection.test.tsx
```

Expected: at least the explicit pricing-before-summary composition fails because
`BillingSummarySection` does not exist yet.

- [ ] **Step 4: Extract the summary contract and remote state**

Create `BillingSummarySection.tsx`. Move these items without semantic or copy
changes from the current `BillingPage.tsx`:

- `BillingPageProps`;
- `defaultLoadBillingSummary`;
- `formatDate`;
- summary request state/effect;
- pending skeleton;
- error alert;
- configured and unconfigured summary rendering.

Export `BillingSummarySectionProps` with optional
`readonly loadBillingSummary?: typeof getBillingSummary`, and export
`BillingSummarySection` with `getBillingSummary` as that prop's default.

The body must contain the complete existing implementation, not a rewritten
version. Preserve abort handling, loading/error branches, text, disabled controls,
dates, usage values, billing history, billing profile, and payment-method display.
Do not enable actions or add mutation calls.

- [ ] **Step 5: Reduce `BillingPage` to explicit composition**

Replace the moved code with:

```tsx
import type { BillingSummary } from "@brand-pilot/contracts";
import { getBillingSummary } from "../features/billing/billingApi";
import { BillingPricing } from "../features/billing/BillingPricing";
import { BillingSummarySection } from "../features/billing/BillingSummarySection";

interface BillingPageProps {
  readonly loadBillingSummary?: (
    options?: { readonly signal?: AbortSignal },
  ) => Promise<BillingSummary>;
}

export function BillingPage({
  loadBillingSummary = getBillingSummary,
}: BillingPageProps) {
  return (
    <>
      <BillingPricing />
      <BillingSummarySection loadBillingSummary={loadBillingSummary} />
    </>
  );
}
```

Retaining the page prop preserves current tests and callers.

- [ ] **Step 6: Run focused tests and confirm GREEN**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/billing/billing.test.tsx `
  src/features/billing/BillingSummarySection.test.tsx
```

Expected: pending, error, resolved, preservation, and order tests pass.

- [ ] **Step 7: Commit the isolated summary slice**

```powershell
git add apps/customer-ui/src/features/billing/BillingSummarySection.tsx `
  apps/customer-ui/src/features/billing/BillingSummarySection.test.tsx `
  apps/customer-ui/src/features/billing/billing.test.tsx `
  apps/customer-ui/src/pages/BillingPage.tsx
git diff --cached --check
git commit -m "refactor(billing): isolate subscription summary"
```

## Task 4: Lock responsive and accessibility regressions

**Files:** Create `apps/customer-ui/src/styles/billingPricingStyles.test.ts`;
modify `apps/customer-ui/src/styles/billing-pricing.css`; test
`apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts`.

- [ ] **Step 1: Add a guaranteed RED narrow-screen contract**

Follow the text-based CSS-test pattern in
`apps/customer-ui/src/styles/responsiveStyles.test.ts`. Read
`billing-pricing.css` and require the final narrow viewport and reduced-motion
contracts, which Task 2 deliberately does not add:

```ts
expect(css).toContain("@media (max-width: 470px)");
expect(css).toMatch(
  /\.billing-pricing__comparison-scroll\s*\{[^}]*max-width:\s*100%/s,
);
expect(css).toMatch(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition:\s*none/,
);
expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
```

- [ ] **Step 2: Run the style test and confirm RED**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/styles/billingPricingStyles.test.ts
```

Expected: missing `470px` and reduced-motion rules fail.

- [ ] **Step 3: Add minimal 320px and motion safeguards**

Add a `470px` media block that sets comparison wrapper `max-width: 100%`, removes
remaining horizontal page overflow sources, and keeps plan/custom/closing CTAs
within their containers. Add a reduced-motion media block that sets transitions
on pricing interactive elements to `none`.

Do not hide table columns; horizontal scrolling remains available.

- [ ] **Step 4: Add deterministic billing coverage to the axe suite**

In `d-hybrid-accessibility.spec.ts`, add `/billing` to `operationPages`. Extend the
existing API fixture with the same configured `BillingSummary` shape used by unit
tests so the browser does not depend on backend state.

Add a billing-specific test at 320 × 800 that:

- opens `/billing`;
- confirms H1, 운영 시작, 팀 운영, 확장 운영, comparison, FAQ, and `현재 구독`;
- confirms `document.documentElement.scrollWidth <= window.innerWidth`;
- focuses the comparison region and checks it is keyboard reachable;
- runs the suite's existing axe helper and expects no serious/critical violations.

- [ ] **Step 5: Run unit and style regression gates**

```powershell
pnpm --filter @brand-pilot/customer-ui test --run `
  src/features/navigation/navigationModel.test.ts `
  src/features/navigation/Sidebar.test.tsx `
  src/features/billing/billing.test.tsx `
  src/styles/billingPricingStyles.test.ts `
  src/styles/responsiveStyles.test.ts
```

Expected: all focused files pass.

- [ ] **Step 6: Run typecheck and production build**

```powershell
pnpm --filter @brand-pilot/customer-ui typecheck
pnpm --filter @brand-pilot/customer-ui build
```

Expected: both exit zero.

- [ ] **Step 7: Run the billing browser gate**

Start or reuse the documented customer UI E2E server, then run:

```powershell
pnpm --filter @brand-pilot/customer-ui exec playwright test `
  e2e/d-hybrid-accessibility.spec.ts --grep "billing"
```

Expected: desktop accessibility coverage and the 320px billing scenario pass.
If the repository's E2E script owns server startup, use that script with the same
file and grep arguments rather than starting an extra server.

- [ ] **Step 8: Verify scope and commit the final gate**

```powershell
git status --short
git diff --check
git diff --name-only HEAD~3..HEAD
```

Before committing, confirm no read-only parity source, backend, schema, migration,
environment, deployment, or redirect file appears.

```powershell
git add apps/customer-ui/src/styles/billingPricingStyles.test.ts `
  apps/customer-ui/src/styles/billing-pricing.css `
  apps/customer-ui/e2e/d-hybrid-accessibility.spec.ts
git diff --cached --check
git commit -m "test(billing): lock pricing responsive accessibility"
```

- [ ] **Step 9: Record final evidence**

```powershell
git status --short
git log -4 --oneline
```

Expected: clean status and exactly four implementation commits for Tasks 1–4.
Do not deploy, push, modify environment values, or add payment integration as part
of this plan.

## Plan completion criteria

Completion requires internal `/billing`; source-exact 운영 시작, 팀 운영, 확장 운영;
non-color recommendation; all comparison, FAQ, inquiry,
CTA, subscription, usage, history, profile, and payment-method states; independent
pricing/summary loading; keyboard-safe 320px rendering; passing focused unit, style,
typecheck, build, and axe gates; and no out-of-scope file changes.
