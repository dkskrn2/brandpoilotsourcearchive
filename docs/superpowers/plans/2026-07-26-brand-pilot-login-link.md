# Brand Pilot Login Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both public homepage header login controls navigate in the current tab to the Brand Pilot login page.

**Architecture:** Keep `SiteHeader` as the single owner of desktop and mobile navigation. Replace only the two disabled login buttons with ordinary anchors styled by the existing `site-login` class; do not introduce client-side JavaScript or modify authentication.

**Tech Stack:** Next.js, React, Node.js test runner, ESLint

---

### Task 1: Activate the desktop and mobile login links

**Files:**
- Modify: `tests/content-parity.test.js`
- Modify: `components/site-header.tsx`

- [ ] **Step 1: Change the regression test so it requires active Brand Pilot links**

Replace the existing public-header test with:

```js
test("public header links desktop and mobile login controls to Brand Pilot", () => {
  const header = read("components/site-header.tsx");
  const styles = read("app/globals.css");
  assert.equal((header.match(/className="site-login"/g) || []).length, 2);
  assert.equal((header.match(/href="https:\/\/app\.danbammsg\.co\.kr\/login"/g) || []).length, 2);
  assert.doesNotMatch(header, /disabled>로그인/);
  assert.doesNotMatch(header, /target="_blank"/);
  assert.match(styles, /\.mobile-menu nav \.site-login/, "mobile login must use the same menu-row layout as mobile links");
});
```

- [ ] **Step 2: Run the focused test and confirm that it fails**

Run:

```bash
node --test --test-name-pattern="public header links" tests/content-parity.test.js
```

Expected: FAIL because the header still contains disabled buttons and no Brand Pilot login URL.

- [ ] **Step 3: Replace both disabled buttons with links**

In `components/site-header.tsx`, replace each login button with:

```tsx
<a className="site-login" href="https://app.danbammsg.co.kr/login">로그인</a>
```

Use the same markup in the desktop navigation and mobile menu. Do not add `target`, `rel`, an on-click handler, or a new component.

- [ ] **Step 4: Run the focused test and confirm that it passes**

Run:

```bash
node --test --test-name-pattern="public header links" tests/content-parity.test.js
```

Expected: PASS.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all tests pass, ESLint exits successfully, and the Next.js production build completes.

- [ ] **Step 6: Review the diff and commit only the login-link files**

Run:

```bash
git diff --check
git diff -- tests/content-parity.test.js components/site-header.tsx
git add tests/content-parity.test.js components/site-header.tsx
git commit -m "feat: link homepage login to Brand Pilot"
```

Expected: the unrelated existing modification in `app/layout.tsx` is not staged or committed.

