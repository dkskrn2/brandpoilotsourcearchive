# In-app Billing and Pricing Design

**Date:** 2026-07-29

**Status:** Approved design

**Canonical customer route:** `https://app.danbammsg.co.kr/billing`

## 1. Purpose

Move the customer-facing pricing experience into the authenticated Brand Pilot
application without expanding this change into payment implementation.

The existing standalone Next.js page at
`https://www.danbammsg.co.kr/product/pricing` contains the approved pricing
content and visual structure. The React customer UI already contains a
`/billing` route and a billing-summary screen, but the sidebar currently links
to the standalone page instead of the internal route. This design makes the
authenticated `/billing` route canonical, ports the pricing presentation into
that route, and retains the existing billing summary as a separate lower
section.

## 2. Goals

- Make `/billing` an ordinary authenticated route inside the existing
  `AppShell`.
- Change the sidebar's **결제 및 구독** item from an external anchor to an
  internal React Router `NavLink`.
- Port the standalone pricing page's content hierarchy, plan cards, comparison
  information, FAQ, and consultation calls to action into the React customer
  UI.
- Preserve the pricing page's content meaning and layout while translating its
  colors and presentation tokens to the D design system.
- Keep the existing billing summary visible below pricing under the heading
  **내 구독 현황**.
- Let pricing content render even when the billing-summary request is loading
  or fails.
- Preserve current authentication, application shell, and brand-setup gates.
- Preserve responsive behavior, keyboard navigation, semantic structure, and
  visible focus treatment.

## 3. Non-goals

This change does not:

- implement payment, checkout, Toss Payments, billing-key registration,
  recurring charges, cancellation, retry, or refunds;
- add or change API endpoints, backend logic, database schema, migrations,
  environment variables, secrets, or deployment configuration;
- enable billing enforcement or change product entitlements;
- use an iframe to embed the standalone website;
- introduce a shared component package or refactor the Next.js and React
  applications into a shared rendering system;
- remove or modify the standalone pricing page in the same implementation;
- change authentication, OAuth, session, `AppShell`, or `BrandSetupGate`
  behavior;
- create a second customer pricing route.

## 4. Current behavior and compatibility baseline

The React router already maps `/billing` to `BillingPage` beneath `App`,
`AuthGate`, `AppShell`, and `BrandSetupGate`. Direct access therefore has these
existing behaviors:

1. An anonymous browser is redirected by `AuthGate` to
   `https://www.danbammsg.co.kr/`.
2. An authenticated user whose brand setup is incomplete is redirected by
   `BrandSetupGate` to `/onboarding/brand-intelligence`.
3. An authenticated user with completed brand setup can render `BillingPage`.

The sidebar does not currently expose that internal route. Its **결제 및 구독**
item points to `https://www.danbammsg.co.kr/product/pricing`, and `Sidebar`
renders it as a same-tab external anchor.

The standalone Next.js page is a marketing and consultation page. It contains
three operating-plan cards, a custom-operation offer, a comparison table,
pricing FAQs, and `/contact` calls to action. It does not provide checkout.

The existing React billing page calls only
`GET /brands/:brandId/billing/summary`. It displays subscription state,
entitlement context, masked payment-method information, and payment history.
Its start, edit, and add-payment-method buttons are disabled, and it explicitly
states that Toss Payments is not connected.

These behaviors are the compatibility baseline. The implementation may improve
presentation and navigation only; it must not imply that a disabled billing
operation has become available.

## 5. Chosen architecture

Use a React-native port inside the existing customer application.

The standalone pricing page remains the content reference, but its JSX and
styles are adapted to customer-UI conventions rather than imported across
application boundaries. This keeps the change local, avoids an iframe, and
avoids coupling the Next.js and Vite build systems through a new shared package.

The resulting route hierarchy is:

```text
AuthGate
└── AppShell
    └── BrandSetupGate
        └── /billing
            ├── Pricing experience
            │   ├── Intro
            │   ├── Plan cards
            │   ├── Custom operation
            │   ├── Plan comparison
            │   ├── FAQ
            │   └── Consultation CTA
            └── 내 구독 현황
                └── Existing billing summary states
```

There is no new data dependency for the pricing experience. Only the lower
summary section uses the existing billing-summary API.

## 6. Route and navigation behavior

### 6.1 Canonical route

`/billing` is the only canonical authenticated customer route for pricing and
subscription status. The existing router entry remains in place.

### 6.2 Sidebar

The navigation model changes the **결제 및 구독** path from
`https://www.danbammsg.co.kr/product/pricing` to `/billing`.

Because the path begins with `/`, the existing `Sidebar` renders it through
`NavLink`. It participates in active-route styling, mobile drawer close
behavior, collapsed-sidebar labeling, and page-title resolution like other
internal destinations.

The existing brand-setup lock remains unchanged. Before brand setup completes,
the sidebar item remains disabled and direct `/billing` access continues to
redirect through `BrandSetupGate`.

### 6.3 Authentication and shell

`AuthGate`, `AppShell`, and `BrandSetupGate` are preserved without behavioral
changes. The pricing port does not introduce a public rendering exception
inside the customer application.

## 7. Components

The implementation should keep responsibilities small and explicit.

### `BillingPage`

Owns page composition only:

- renders the pricing experience first;
- renders the **내 구독 현황** section second;
- starts the existing summary request;
- passes request state to the summary component.

### `BillingPricing`

Owns static pricing content and layout:

- page introduction;
- three plan cards;
- custom-operation card;
- plan comparison;
- FAQ;
- closing consultation CTA.

It performs no API request and has no payment action.

### `BillingPlanCard`

Renders one plan from a local typed content model. The model preserves the
standalone page's names, descriptions, facts, feature lists, recommendation
state, and CTA labels.

### `BillingComparison`

Renders the standalone comparison content as a semantic table. On narrow
screens it remains horizontally scrollable, with an explicit scroll hint and a
focusable scroll container.

### `BillingFaq`

Uses native `details` and `summary` elements so disclosure behavior works with
keyboard and assistive technologies without a custom state machine.

### `BillingSummarySection`

Contains the current subscription, payment history, empty billing-profile
fields, and masked payment-method presentation. Existing summary status labels
and disabled controls remain truthful.

Loading and error UI are scoped to this component. They do not replace or hide
`BillingPricing`.

The exact file split may follow existing customer-UI conventions, but these
responsibility boundaries must remain visible. A single oversized component
that mixes static pricing, remote state, and summary rendering is not the
intended design.

## 8. Content parity

The React port preserves the standalone page's customer-facing information:

- **운영 시작**, **팀 운영**, and **확장 운영** plan cards;
- the recommended-plan treatment for **팀 운영**;
- each plan's description, quote-based price, scope facts, features, and
  consultation CTA;
- the **맞춤 운영** offer and its organization, approval, security, SLA, and
  integration scope;
- all plan-comparison groups and rows;
- the note that final scope, billing cycle, and refund terms are established in
  a quote, application, or contract;
- all pricing FAQs;
- the final operating-scope consultation CTA.

Content parity means preserving meaning and completeness, not copying Next.js
components or CSS verbatim. React Router navigation replaces Next.js `Link`.

Consultation CTAs remain consultation actions, not subscription or payment
actions. Within the customer application every pricing consultation CTA points
to the existing internal `/support` destination. The implementation must not
invent a checkout URL or silently route a consultation CTA to a disabled
billing control.

## 9. Visual design and D tokens

Preserve the standalone page's information hierarchy and recognizable layout:

- prominent pricing introduction;
- three responsive plan cards;
- visually distinct recommended card;
- separate custom-operation card;
- comparison table;
- FAQ disclosures;
- closing CTA.

Only the color system and local component treatment move to the D palette.
Styles use the existing semantic tokens from `tokens.css`:

- `--bp-color-sidebar`
- `--bp-color-sidebar-raised`
- `--bp-color-primary`
- `--bp-color-primary-strong`
- `--bp-color-ai`
- `--bp-color-human-review`
- `--bp-color-canvas`
- `--bp-color-paper`
- `--bp-color-ink`
- `--bp-color-muted`
- `--bp-color-line`
- `--bp-color-line-strong`
- existing `--bp-radius-*` tokens

The port must not copy the standalone page's blue `--bpp-*` palette or add
hard-coded substitute colors for normal component states. Status badges may
continue using the customer application's established semantic status styles.

## 10. Data flow

Pricing and summary have deliberately separate flows.

```text
Route /billing
  ├─ BillingPricing
  │    └─ local typed content → immediate render
  └─ BillingSummarySection
       └─ api.getBillingSummary(active brand)
            ├─ success → subscription/payment summary
            └─ failure → section-local error
```

The existing active-brand mechanism remains the source of the brand identifier.
No pricing content depends on the summary response. A slow or unavailable API
therefore cannot blank the pricing page.

No form submission, payment token, card data, billing key, checkout session, or
new mutation is introduced.

## 11. Loading, empty, and error states

- Pricing content renders synchronously.
- While the summary request is pending, only **내 구독 현황** shows its
  existing skeleton/loading label.
- If the summary request fails, only **내 구독 현황** shows the existing
  billing error alert.
- A successful unconfigured summary preserves the Toss-not-connected note and
  disabled controls.
- A configured summary preserves active, pending, cancellation, suspended, and
  cancelled labels; payment-history empty and populated states; and masked
  payment-method presentation.
- No state presents a working checkout or payment-management claim.

## 12. Responsive and accessibility requirements

- Plan cards use one column on narrow screens and the intended multi-column
  layout when space permits.
- Text and controls must not overflow at 320 CSS pixels.
- The comparison table uses semantic table elements and a labeled,
  keyboard-focusable horizontal scroll region on narrow screens.
- Recommended status is conveyed in text, not color alone.
- Heading levels form a continuous page outline beneath the route's page
  heading.
- CTA links have descriptive accessible names.
- FAQ disclosures use keyboard-operable native semantics.
- Focus indicators use existing D focus treatment and meet visible contrast
  requirements.
- Color contrast must remain sufficient after replacing the standalone blue
  palette.
- Mobile navigation behavior, focus trapping, and sidebar collapse behavior
  remain owned by the unchanged `AppShell` and `Sidebar`.

## 13. External pricing compatibility

The standalone route
`https://www.danbammsg.co.kr/product/pricing` remains available temporarily.
This prevents existing bookmarks, search results, marketing links, and indexed
URLs from breaking.

This customer-UI change does not edit the website application. Therefore it
does not add a website redirect in the same commit.

A later, explicit website change may choose one of these compatible behaviors:

1. keep the public pricing page for anonymous marketing visitors and add a
   clearly labeled link to `https://app.danbammsg.co.kr/billing` for existing
   customers; or
2. redirect the old pricing route to the authenticated app after product and
   SEO owners explicitly approve the loss of the public marketing page.

The default compatibility recommendation is option 1. A redirect is not
assumed safe because unauthenticated visitors to the app are sent back to the
public website by `AuthGate`, which could otherwise create a redirect loop or
remove the public acquisition page.

No external pricing href remains in the authenticated sidebar after this
change.

## 14. Testing strategy

### Navigation and routing

- Assert that **결제 및 구독** has `href="/billing"`.
- Assert that it is rendered as an internal navigation item and receives active
  route state.
- Assert that no customer navigation item references
  `https://www.danbammsg.co.kr/product/pricing`.
- Preserve tests for brand-setup locking, mobile navigation close behavior, and
  authenticated index routing.

### Pricing content parity

- Assert all three plan names and the custom-operation offer.
- Assert recommended-plan text.
- Assert representative facts and features for every plan.
- Assert every comparison group and row.
- Assert all FAQ questions.
- Assert consultation CTAs use `/support` and do not claim to start payment.

### D palette and styling contract

- Assert pricing components use a dedicated local class namespace.
- Assert pricing CSS references `--bp-color-*` and `--bp-radius-*` tokens.
- Assert the port does not define or reference the standalone `--bpp-*` color
  variables.
- Avoid brittle assertions against computed pixel values unless required for a
  specific responsive regression.

### Billing summary preservation

- Preserve tests for loading, error, unconfigured, active subscription,
  cancellation, suspended, empty history, populated history, and masked
  payment-method states.
- Add an assertion that pricing remains visible during summary loading.
- Add an assertion that pricing remains visible after a summary error.
- Preserve assertions that raw card details are neither requested nor rendered
  and that unavailable controls stay disabled.

### Responsive and accessibility

- Cover plan-card reflow and comparison-table overflow at narrow viewport
  widths.
- Verify semantic headings, table structure, FAQ keyboard behavior, CTA names,
  recommended-plan text, and visible focus states.
- Include the billing route in the existing D responsive and accessibility
  regression suite.

## 15. Rollout

1. Implement and verify the customer-UI-only change.
2. Deploy it through the normal preview and production frontend workflow.
3. Verify authenticated desktop and mobile navigation to `/billing`.
4. Verify pricing renders independently of billing-summary loading and error
   states.
5. Verify the standalone pricing URL still works and that the authenticated
   sidebar contains no external pricing href.
6. Observe navigation errors and support feedback before proposing any website
   redirect.
7. Handle any public website link or redirect in a separate, explicitly
   approved change.

Rollback is a frontend rollback to the prior customer-UI version. It requires
no database or API rollback because this design changes neither.

## 16. Acceptance criteria

- Authenticated users reach pricing and subscription status at `/billing`
  without leaving `app.danbammsg.co.kr`.
- The sidebar uses an internal `/billing` `NavLink`.
- The pricing experience has content parity with the standalone page and uses
  D semantic color/radius tokens.
- **내 구독 현황** preserves the existing summary behavior below pricing.
- Pricing remains visible while the summary loads or fails.
- No payment, checkout, Toss, backend, schema, migration, environment, or
  entitlement behavior changes.
- `AuthGate`, `AppShell`, and `BrandSetupGate` behavior remains intact.
- No iframe, shared-package refactor, or external pricing sidebar href is
  introduced.
- The standalone website route remains compatible until a later explicit
  website decision.
