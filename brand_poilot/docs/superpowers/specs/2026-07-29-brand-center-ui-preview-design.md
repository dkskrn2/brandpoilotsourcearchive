# Brand Center UI Preview Design

**Date:** 2026-07-29
**Status:** Approved preview design
**Scope:** Local/authenticated UI preview only

## 1. Goal

Create an isolated preview of the simplified Brand Center journey so the interaction
and information hierarchy can be reviewed before changing the production experience.

The preview route is `/brand-center-preview`.

- It uses the existing authenticated customer shell.
- It is not added to the production sidebar or primary navigation.
- It does not replace or modify `/brand-center`.
- Reloading the page resets every mock interaction.
- It makes no API, database, worker, migration, environment, or deployment change.

`ZET - 참고/1.png` and `ZET - 참고/2.png` are visual references only. Their assets are
not copied into the application.

## 2. Experience Principles

The preview presents one guided operating flow:

```text
URL·파일 등록
→ AI 분석
→ Brand Core·지식 검토와 승인
→ 카드뉴스 자동 생성과 결과 확인
```

Only user-facing concepts appear. Wiki generation, Wiki versions, build state, workers,
execution rules, and internal orchestration terminology are never shown.

AI-created information is always a draft that needs approval. Information entered and
saved directly by the user is immediately marked confirmed.

## 3. Visual Direction

Use the ZET-reference visual language without copying its assets:

- narrow left icon rail;
- top four-step progress indicator;
- left source-context card;
- centered white main card;
- light-cyan analysis and editor surfaces;
- navy primary CTA;
- wide whitespace and restrained borders;
- compact status chips instead of infrastructure details.

Desktop keeps the source context beside the main card. Tablet and mobile collapse the
rail and place source context above the main card. The primary action remains visible
without hiding content behind a fixed footer.

## 4. Route and Isolation

Add an explicit authenticated route for `/brand-center-preview`. The route imports only
the preview page and its local preview modules.

Do not:

- add a sidebar item;
- redirect existing Brand Center links;
- alter `/brand-center`;
- reuse production mutations;
- persist mock state to storage or URL parameters.

The preview is reached only by entering its URL. A browser reload reconstructs the
initial fixture state.

## 5. Screen Structure

### 5.1 Shared Frame

`BrandCenterPreviewPage` owns the reducer and renders:
`PreviewIconRail`, `PreviewStepProgress`, `SourceContextCard`, the active step inside
`PreviewMainCard`, and an `aria-live` status region.

The top progress control labels all four steps but permits navigation only to steps
unlocked by the state machine.

### 5.2 Step 1 — Sources

`SourceIntakeStep` contains:
- one HTTPS URL field;
- a file picker for business plans, company introductions, product material, and
  equivalent supported documents;
- removable file chips with name, size, and local mock status;
- an empty state explaining that at least one URL or file is required;
- a primary `분석 시작` action.

Selecting files creates local metadata only. No bytes are uploaded.

### 5.3 Step 2 — Mock AI Analysis

`AnalysisStep` shows deterministic progress states, then a light-cyan analysis summary:
- brand overview;
- primary target and customer problem;
- value proposition and differentiators;
- tone and priority messages;
- proposed FAQ, policy, guide, how-to, and product/service knowledge.

Every generated row carries an `AI 초안` status. Analysis failure offers retry and does
not unlock approval.

### 5.4 Step 3 — Review and Approval

`ReviewApprovalStep` combines two review areas:
- editable Brand Core;
- unified knowledge library.

The knowledge tabs are exactly:

`전체 / FAQ / 정책 / 사용법 / 가이드 / 제품·서비스`

`KnowledgeTable` supports filtering and selection. `KnowledgeItemDrawer` or
`KnowledgeItemModal` supports create, read, update, and delete against local fixtures.
The editing surface distinguishes:
- AI draft: requires item approval or `모두 승인`;
- direct user entry: confirmed immediately on save.

Brand Core approval and all required knowledge approvals unlock step 4. The screen
shows validation errors beside the relevant field or item, not as a generic failure.

### 5.5 Step 4 — Card-News Generation

`CardGenerationStep` uses the approved local snapshot to show:
ready, generation progress, deterministic success previews, and failure with retry.

A generation failure blocks completion. Retry returns to loading and then follows the
fixture-selected success or failure scenario. Success shows the approved source
summary used for the result without exposing internal Wiki or execution-rule concepts.

## 6. Components and Boundaries

Preview-only modules separate the page and shell, progress and source context,
source/analysis/review/generation steps, Brand Core editor, knowledge tabs/table/drawer,
card preview, typed fixtures, reducer, and adapter.

Components receive typed state and callbacks. They do not call customer API gateways
directly.

## 7. State and Adapter Contract

Use typed fixtures, a local reducer, and a small adapter boundary.

```ts
type PreviewStep = "sources" | "analysis" | "approval" | "generation";
type AsyncState = "idle" | "loading" | "succeeded" | "failed";
type ReviewStatus = "ai_draft" | "confirmed" | "approved";
```

The reducer owns sources, analysis status, editable Brand Core, knowledge items,
approval state, generation state, active tab, and open drawer.

`PreviewAdapter` exposes async-shaped operations such as `analyze`, `saveKnowledge`,
`approveAll`, and `generateCardNews`. The mock implementation resolves deterministic
fixtures. A later API adapter can replace it without changing page layout, component
contracts, or state-machine semantics.

## 8. State Machine and Gates

```text
sources.idle
  → sources.valid
  → analysis.loading
  → analysis.succeeded
  → approval.reviewing
  → approval.complete
  → generation.ready
  → generation.loading
  → generation.succeeded
```

Failure branches:
- invalid source input remains in step 1;
- analysis failure remains in step 2;
- incomplete approval remains in step 3;
- generation failure remains in step 4 and cannot become complete until retry succeeds.

Users may return to unlocked earlier steps. Changing a source after analysis clears
analysis, approvals, and generated results. Editing approved review data invalidates
the generation result and requires approval again.

## 9. Loading, Empty, and Error States

Source empty disables analysis with instructional copy. Analysis uses a labeled,
non-interactive loading skeleton and inline retry on failure. Each empty knowledge tab
offers `항목 추가`; drawer validation focuses the first invalid field. Generation
loading disables duplicate submission, while failure retains approved inputs and
offers retry without completing the flow.

Mock delays are short but non-zero so loading behavior is testable and visible.

## 10. Responsive and Accessibility Requirements

- Full keyboard access for progress, tabs, drawer/modal, CRUD, and retry.
- Correct `tablist`, `tab`, `tabpanel`, dialog/drawer labeling, focus trap, and focus
  restoration.
- Disabled steps expose `aria-disabled` and do not rely on color.
- Status changes use a polite `aria-live` region.
- File chips have explicit remove labels.
- All text and controls meet existing contrast and focus-visible standards.
- Reduced-motion preference removes decorative transitions.
- Mobile layout avoids horizontal page scrolling; wide knowledge rows become stacked
  cards or a labeled scroll region.

## 11. Test Strategy

Component and reducer tests cover:
- initial reset-on-mount state;
- source validation and file chip removal;
- strict step gating and backward navigation;
- deterministic analysis loading, success, failure, and retry;
- all six knowledge tabs;
- local create, read, update, delete behavior;
- AI-draft approval versus direct-user confirmation;
- single-item and approve-all behavior;
- approval invalidation after editing;
- card generation loading, success, failure, blocked completion, and retry;
- responsive structure and core accessibility roles;
- absence from the production sidebar.

Route regression tests verify `/brand-center` still renders unchanged and its existing
tests continue to pass.

## 12. Acceptance Criteria

The preview is accepted when:

1. `/brand-center-preview` is authenticated and directly reachable but absent from the
   production sidebar.
2. Reload resets all preview interactions.
3. Only the four approved user-facing steps are visible.
4. Navigation cannot bypass source, analysis, approval, or generation gates.
5. AI items require approval; direct user saves are confirmed.
6. The unified knowledge tabs and local CRUD interactions work.
7. Generation failure blocks completion and retry works.
8. Wiki generation and execution rules never appear.
9. The layout follows the approved ZET-reference direction responsively and accessibly.
10. No API, DB, worker, environment, deployment, or existing Brand Center behavior is
    changed.

## 13. Out of Scope

Production redesign, persistence, real uploads/AI, API/DB/migration/worker/environment
work, Wiki build or execution-rule UI, navigation rollout, deployment, production QA,
and copying ZET or third-party assets are out of scope.

## 2026-07-29 UI simplification addendum

This addendum supersedes the preview-only approval and knowledge-type details above
where they conflict.

- Remove every `AI 초안` chip from the registered-information and AI-proposal UI.
- In Step 2, render each knowledge item's content as an editable textarea. Edits made
  before `검토 시작` persist into Step 3.
- Remove policy from visible preview knowledge types, tabs, and initial mock data.
- Seed three FAQ items and three product/service items in the initial mock.
- Step 3 exposes section-level approval only, named `브랜드 코어 승인` and
  `브랜드 지식 승인`. Per-item approval is removed; per-item edit and delete remain.
- This is UI/mock-only work. No API, database, worker, environment, or deployment
  behavior changes.
- Preserve local knowledge CRUD and the generation gate: generation unlocks only
  after both the brand-core section and the knowledge section are approved.
