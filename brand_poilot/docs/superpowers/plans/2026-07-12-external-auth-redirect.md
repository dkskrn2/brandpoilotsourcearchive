# External Authentication Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect unauthenticated visitors from protected customer UI routes to the Danbam site while retaining the internal Kakao login entry at `/login`.

**Architecture:** Keep session resolution in `AuthGate`. When a protected route's session request fails, an injected redirect callback performs a full-browser navigation to the fixed Danbam URL. The `/login` route remains an internal Kakao login entry. The callback injection keeps browser navigation testable without changing production behavior.

**Tech Stack:** React 18, React Router 6, TypeScript, Vitest, Testing Library.

---

### Task 1: Protect anonymous UI access

**Files:**
- Modify: `apps/customer-ui/src/lib/auth.tsx`
- Create: `apps/customer-ui/src/__tests__/auth.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("redirects an anonymous visitor to Danbam", async () => {
  const redirect = vi.fn();
  render(<MemoryRouter><AuthGate loadSession={async () => { throw new Error("401"); }} redirect={redirect}><div>Protected</div></AuthGate></MemoryRouter>);
  await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://www.danbammsg.co.kr/"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/auth.test.tsx`

Expected: FAIL because `AuthGate` does not accept session/redirect dependencies and routes to `/login`.

- [ ] **Step 3: Write minimal implementation**

```tsx
export const DANBAM_LOGIN_URL = "https://www.danbammsg.co.kr/";

function ExternalRedirect({ redirect }: { redirect: (url: string) => void }) {
  useEffect(() => redirect(DANBAM_LOGIN_URL), [redirect]);
  return null;
}
```

Use the component when `AuthGate` reaches the anonymous state and make the default redirect call `window.location.assign`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/auth.test.tsx`

Expected: PASS.

### Task 2: Retain the internal login entry

**Files:**
- Modify: `apps/customer-ui/src/pages/LoginPage.tsx`
- Modify: `apps/customer-ui/src/__tests__/auth.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("keeps the internal Kakao login entry available", () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  expect(screen.getByRole("link", { name: /카카오로 시작하기/ })).toHaveAttribute(
    "href",
    "http://localhost:4000/auth/kakao/login"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/auth.test.tsx`

Expected: FAIL because the login page redirects away instead of rendering the Kakao entry.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function LoginPage() {
  return <a className="kakao-login" href={`${apiBaseUrl()}/auth/kakao/login`}>카카오로 시작하기</a>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @brand-pilot/customer-ui -- src/__tests__/auth.test.tsx`

Expected: PASS.

### Task 3: Verify the customer UI

**Files:**
- Verify: `apps/customer-ui/src/lib/auth.tsx`
- Verify: `apps/customer-ui/src/pages/LoginPage.tsx`

- [ ] **Step 1: Run the full customer UI test suite**

Run: `npm run test --workspace @brand-pilot/customer-ui`

Expected: PASS.

- [ ] **Step 2: Build the customer UI**

Run: `npm run build --workspace @brand-pilot/customer-ui`

Expected: TypeScript validation and Vite build succeed.
