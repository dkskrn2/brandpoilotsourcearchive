# Sidebar Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app sidebar feedback modal with call-booking access, persist feedback separately from support requests, and expose a dedicated admin feedback list API.

**Architecture:** A focused `FeedbackDialog` owns modal interaction while `AppShell` owns open state shared by desktop and mobile sidebars. Customer feedback uses a new repository contract and `feedback_submissions` table; the admin repository reads the same table through a separate `/admin/v1/feedback` resource so support requests remain independent.

**Tech Stack:** React 18, React Router, Testing Library/Vitest, Fastify, PostgreSQL, TypeScript, Playwright CLI.

---

### Task 1: Feedback persistence contract

**Files:**
- Create: `db/migrations/054_feedback_submissions.sql`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/repository.ts`
- Test: `apps/api/src/repository.test.ts`
- Test: `scripts/migrations.integration.test.mjs`

- [ ] **Step 1: Write a failing repository test**

Add a test that calls `createFeedbackSubmission("brand-1", { message: "  개선 의견  " })`, expects the brand workspace lookup, an insert into `feedback_submissions`, and a DTO containing the trimmed message and `new` status.

- [ ] **Step 2: Run the repository test and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- repository.test.ts -t "stores feedback separately"`

Expected: FAIL because `createFeedbackSubmission` does not exist.

- [ ] **Step 3: Add the migration and minimal repository contract**

Create a table with UUID primary key, workspace/brand foreign keys, a 1–2,000 character trimmed-message constraint, `new|reviewed|archived` status constraint, timestamps, soft delete, and a `(created_at desc, id desc)` index. Add `FeedbackSubmissionDto`, `FeedbackSubmissionInput`, and `createFeedbackSubmission` to `ApiRepository`; map and insert the row in `repository.ts`.

- [ ] **Step 4: Run focused persistence tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/api -- repository.test.ts`

Expected: PASS.

### Task 2: Customer feedback endpoint

**Files:**
- Modify: `apps/api/src/httpServer.ts`
- Test: `apps/api/src/server.test.ts`

- [ ] **Step 1: Write failing endpoint tests**

Cover a successful `POST /brands/:brandId/feedback`, blank content, content over 2,000 characters, and verify the repository receives a trimmed message.

- [ ] **Step 2: Run the endpoint tests and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- server.test.ts -t "feedback"`

Expected: FAIL with route not found.

- [ ] **Step 3: Implement the validated endpoint**

Register `POST /brands/:brandId/feedback`, validate `message`, call `createFeedbackSubmission`, return status 201, and use the existing error envelope for validation and missing-brand failures.

- [ ] **Step 4: Run the endpoint tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/api -- server.test.ts -t "feedback"`

Expected: PASS.

### Task 3: Dedicated admin feedback resource

**Files:**
- Modify: `apps/api/src/adminTypes.ts`
- Modify: `apps/api/src/adminRepository.ts`
- Modify: `apps/api/src/adminServer.ts`
- Test: `apps/api/src/adminRepository.test.ts`
- Test: `apps/api/src/adminServer.test.ts`

- [ ] **Step 1: Write failing admin repository and route tests**

Assert `listFeedback` filters by status, brand, and text query, returns brand/workspace names with cursor pagination, and is exposed only at `GET /admin/v1/feedback` under existing admin authentication.

- [ ] **Step 2: Run admin tests and verify RED**

Run: `npm run test --workspace @brand-pilot/api -- adminRepository.test.ts adminServer.test.ts -t "feedback"`

Expected: FAIL because the resource is absent.

- [ ] **Step 3: Implement DTO, query, and route**

Add `AdminFeedbackListItemDto`, `listFeedback(input)`, a parameterized query against `feedback_submissions`, and the authenticated route using existing `listInput` and `pageEnvelope` helpers.

- [ ] **Step 4: Run admin tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/api -- adminRepository.test.ts adminServer.test.ts`

Expected: PASS.

### Task 4: Customer API client and modal behavior

**Files:**
- Modify: `apps/customer-ui/src/types.ts`
- Modify: `apps/customer-ui/src/lib/apiClient.ts`
- Test: `apps/customer-ui/src/lib/apiClient.test.ts`
- Create: `apps/customer-ui/src/components/feedback/FeedbackDialog.tsx`
- Create: `apps/customer-ui/src/components/feedback/FeedbackDialog.test.tsx`

- [ ] **Step 1: Write failing client and dialog tests**

Assert the client posts `{ message }` to `/brands/:brandId/feedback`. Assert the dialog renders `통화 문의 예약하기`, opens the configured booking URL, rejects whitespace, disables duplicate submission, reports errors, clears on success, closes on Escape/backdrop/close button, and restores focus through its caller.

- [ ] **Step 2: Run the focused UI tests and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/lib/apiClient.test.ts src/components/feedback/FeedbackDialog.test.tsx`

Expected: FAIL because the API method and component do not exist.

- [ ] **Step 3: Implement the client and accessible dialog**

Add `FeedbackSubmission`, `createFeedbackSubmission`, and a dialog with `role="dialog"`, labelled title, 2,000-character textarea, pending/success/error live state, configured booking link with support-form fallback, initial focus, Escape handling, scroll locking, and backdrop handling.

- [ ] **Step 4: Run the focused UI tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/lib/apiClient.test.ts src/components/feedback/FeedbackDialog.test.tsx`

Expected: PASS.

### Task 5: Sidebar and shell integration

**Files:**
- Modify: `apps/customer-ui/src/components/layout/Sidebar.tsx`
- Modify: `apps/customer-ui/src/components/layout/AppShell.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Modify: `apps/customer-ui/src/__tests__/navigation.test.tsx`

- [ ] **Step 1: Write a failing navigation integration test**

Assert desktop and mobile sidebars expose a button named `피드백`, the button opens the dialog without navigation, mobile navigation closes before the dialog appears, and collapsed desktop mode retains an accessible name.

- [ ] **Step 2: Run the navigation test and verify RED**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/navigation.test.tsx -t "피드백"`

Expected: FAIL because the sidebar action is absent.

- [ ] **Step 3: Integrate open state and styles**

Add a `MessageSquareText` utility button to `Sidebar`, pass `onOpenFeedback` from `AppShell`, render one shared `FeedbackDialog`, and style the overlay, rounded panel, booking card, feedback card, responsive layout, focus, disabled, success, and error states in the existing visual system.

- [ ] **Step 4: Run navigation and dialog tests and verify GREEN**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/navigation.test.tsx src/components/feedback/FeedbackDialog.test.tsx`

Expected: PASS.

### Task 6: Full verification and browser QA

**Files:**
- Modify: `apps/customer-ui/e2e/customer-ui.spec.ts`

- [ ] **Step 1: Add an end-to-end feedback case and verify it fails before final wiring**

Cover opening the sidebar item, entering text, submitting through the live API, seeing success, reopening with a cleared input, and verifying the admin API returns the submitted record separately from support requests.

- [ ] **Step 2: Run complete automated verification**

Run: `npm run test --workspace @brand-pilot/api`

Run: `npm run test --workspace @brand-pilot/customer-ui`

Run: `npm run build --workspace @brand-pilot/api`

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: all tests and builds PASS.

- [ ] **Step 3: Verify in the real browser**

Open `http://localhost:5173`, test expanded, collapsed, and mobile sidebar entry points, submit a Korean feedback message, confirm the success state and persistence, test the booking button fallback/configured link, and capture screenshots of the modal and admin API result.

