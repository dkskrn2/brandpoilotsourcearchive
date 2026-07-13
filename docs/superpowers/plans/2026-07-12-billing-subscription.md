# Brand Pilot Billing Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a customer-facing single monthly subscription menu with workspace access control that can later activate Toss Payments billing.

**Architecture:** PostgreSQL stores plan, subscription, payment, and entitlement records. The API exposes a billing summary and subscription actions; React renders one `/billing` screen. Toss SDK, live key handling, and monthly charging are introduced only after the plan price and automatic-billing contract are available. Product-route entitlement enforcement remains behind `BILLING_ENFORCEMENT_ENABLED` until a configured plan and a customer migration path exist.

**Tech Stack:** PostgreSQL 16, Fastify 5, TypeScript, React 18, React Router 6, Vitest.

---

### Task 1: Add billing persistence and DTOs

**Files:**
- Create: `db/migrations/013_billing_subscriptions.sql`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
expect(await repository.getBillingSummary("brand-1")).toMatchObject({
  subscription: { status: "none" },
  entitlement: { active: false }
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test --workspace @brand-pilot/api -- src/repository.test.ts`

Expected: FAIL because `getBillingSummary` is not present on `ApiRepository`.

- [ ] **Step 3: Add the migration and DTO boundary**

```sql
create table plans (...);
create table subscriptions (...);
create table billing_customers (...);
create table payment_orders (...);
create table payments (...);
create table payment_webhook_events (...);
create table workspace_entitlements (...);
```

Define `BillingSummaryDto` and `getBillingSummary(brandId)` in `apps/api/src/types.ts`.

- [ ] **Step 4: Re-run the focused test**

Run: `npm run test --workspace @brand-pilot/api -- src/repository.test.ts`

Expected: PASS.

### Task 2: Expose the billing summary and subscription actions

**Files:**
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/types.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] **Step 1: Write failing route tests**

```ts
const response = await app.inject({ method: "GET", url: "/brands/brand-1/billing/summary" });
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({ subscription: { status: "none" } });
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test --workspace @brand-pilot/api -- src/server.test.ts`

Expected: FAIL with a 404 response.

- [ ] **Step 3: Add authenticated billing routes**

```ts
app.get("/brands/:brandId/billing/summary", async (request) => repository.getBillingSummary(request.params.brandId));
app.post("/brands/:brandId/billing/subscription/cancel", async (request) => repository.scheduleSubscriptionCancellation(request.params.brandId));
app.post("/brands/:brandId/billing/subscription/resume", async (request) => repository.resumeSubscription(request.params.brandId));
```

The routes must return a safe error when no configured active plan exists and must not accept a client-supplied price.

- [ ] **Step 4: Re-run API tests**

Run: `npm run test --workspace @brand-pilot/api`

Expected: PASS.

### Task 3: Add the customer billing menu and page

**Files:**
- Create: `apps/customer-ui/src/pages/BillingPage.tsx`
- Modify: `apps/customer-ui/src/routes.tsx`
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/billing.test.tsx`

- [ ] **Step 1: Write a failing billing-page test**

```tsx
render(<BillingPage />);
expect(await screen.findByRole("heading", { name: "결제 및 구독" })).toBeVisible();
expect(screen.getByText("구독을 시작하면 콘텐츠 자동화 기능을 사용할 수 있습니다.")).toBeVisible();
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/billing.test.tsx`

Expected: FAIL because `BillingPage` and the billing API client are absent.

- [ ] **Step 3: Implement the page**

```tsx
{summary.subscription.status === "none" ? <Button>구독 시작</Button> : null}
{summary.subscription.status === "cancel_scheduled" ? <Button>해지 취소</Button> : null}
{summary.subscription.status === "suspended" ? <Button>결제수단 변경 후 재결제</Button> : null}
```

Render summary, payment method masking, the cancellation state, and payment history. Add `/billing` to the sidebar and router.

- [ ] **Step 4: Re-run the focused test**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/billing.test.tsx`

Expected: PASS.

### Task 4: Gate product access by entitlement

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] **Step 1: Write failing entitlement tests**

```ts
const response = await app.inject({ method: "GET", url: "/brands/brand-1/sources", headers: { cookie: authenticatedCookie } });
expect(response.statusCode).toBe(402);
expect(response.json()).toEqual({ error: "subscription_required" });
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test --workspace @brand-pilot/api -- src/server.test.ts`

Expected: FAIL because product routes do not check an active entitlement.

- [ ] **Step 3: Add the entitlement guard**

```ts
if (process.env.BILLING_ENFORCEMENT_ENABLED === "true" && isBillableProductRoute(request) && !(await repository.hasActiveEntitlement(request.params.brandId))) {
  reply.code(402).send({ error: "subscription_required" });
  return reply;
}
```

Exclude `/billing`, `/auth/*`, `/health`, webhooks, and internal Cron endpoints from this guard.

- [ ] **Step 4: Re-run API tests**

Run: `npm run test --workspace @brand-pilot/api`

Expected: PASS.

### Task 5: Add Toss billing activation after contract setup

**Files:**
- Create: `apps/api/src/tossBilling.ts`
- Modify: `apps/api/src/httpServer.ts`
- Modify: `apps/api/src/repository.ts`
- Modify: `apps/customer-ui/src/pages/BillingPage.tsx`
- Test: `apps/api/src/tossBilling.test.ts`

- [ ] **Step 1: Write a failing approval test**

```ts
await expect(confirmInitialBillingPayment({ orderId: "order-1", amount: 29000 })).resolves.toMatchObject({ status: "DONE" });
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test --workspace @brand-pilot/api -- src/tossBilling.test.ts`

Expected: FAIL because the Toss billing client is absent.

- [ ] **Step 3: Add the server-only Toss adapter**

```ts
const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
```

Load the secret key only from the API environment, encrypt the billing key before persistence, verify the server order amount before approval, and use an idempotency key for each POST request.

- [ ] **Step 4: Re-run API tests**

Run: `npm run test --workspace @brand-pilot/api`

Expected: PASS.

### Task 6: Verify the complete customer app

**Files:**
- Verify: `apps/customer-ui`
- Verify: `apps/api`

- [ ] **Step 1: Run all test suites**

Run: `npm test`

Expected: Every workspace test passes.

- [ ] **Step 2: Build every workspace**

Run: `npm run build`

Expected: API, customer UI, and worker builds succeed.
