# Brand Center and Onboarding Live Integration Design

**Date:** 2026-07-29

**Status:** Approved for implementation

**Supersedes for this surface:** the mock-only interaction assumptions in
`2026-07-29-brand-center-ui-preview-design.md` and the four-tab Brand Center
navigation in `2026-07-24-d-hybrid-brand-center-implementation-plan.md`

## 1. Goal

Replace the old customer onboarding screen with the approved new onboarding
screen, connect it to the existing upload, extraction, analysis, review, and
confirmation services, and make the canonical Brand Center a six-tab live
workspace without removing existing product, Wiki, rules, or avatar
capabilities.

The approved screen and the decisions recorded in the 2026-07-29 conversation
are the design authority. This integration does not add a second onboarding
flow, a second Wiki, or a second asset store.

## 2. Non-negotiable decisions

1. `/onboarding/brand-intelligence` renders the new live onboarding UI.
2. Existing upload sessions, source extraction, brand analysis workers, and
   `brand_analysis_runs` remain canonical.
3. Step 1 saves the analysis identifier in a workspace/user/brand-scoped
   resume key and mirrors it in the query string.
4. Polling is bounded, abortable, visibility-aware, and non-overlapping.
5. Step 2 shows the five primary brand fields plus only `대표 분야` and
   `세부 분야` as additional detail fields.
6. Hidden legacy analysis data remains in the complete draft and is preserved
   through PATCH and confirmation.
7. `/brand-center` has exactly six top-level tabs:
   `core`, `faq`, `how_to`, `guide`, `products`, and `style`.
8. Every editable surface has an explicit view mode, edit action, dirty state,
   save, cancel, saving feedback, saved feedback, and actionable error state.
9. Existing policy knowledge, Wiki issues/build status, and Brand Rules remain
   available as secondary controls; they do not regain old top-level tabs.
10. Style is a reference-image registration board, not a text-first design
    questionnaire and not an avatar/model uploader.
11. Avatar repository, API, upload, and content-generation integration remain
    intact but the avatar library is not mounted in the canonical six-tab
    Brand Center.
12. Onboarding confirmation does not enqueue or build a Wiki.
13. The first attempt to enable Instagram DM provisions the first Wiki when it
    is missing, then the existing readiness gate remains the final authority.
14. Product/service changes after the first active Wiki are coalesced into the
    next 03:00 Asia/Seoul Wiki build window.
15. No production data is deleted, no production environment value is changed,
    and no secret is rotated by this work.

## 3. Existing systems reused

| Concern | Canonical implementation |
| --- | --- |
| Brand evidence upload | `brandIntelligenceGateway.uploadFile` and existing analysis upload API |
| Analysis request/status | `brandIntelligenceGateway.requestAnalysis/getAnalysis` |
| Analysis persistence | `brand_analysis_runs.result_json/edited_result_json` |
| Brand Core revisions | `brand_core_versions` and `brandCoreRepository` |
| Brand Rules | `brand_rule_sets.rules_json` |
| FAQ/policy/how-to/guide | `knowledge_entries` through Wiki management contracts |
| Product/service revisions | `product_services` and `product_service_versions` |
| Style image binary storage | reference upload session → Vercel Blob → reference confirmation |
| Wiki build | `wiki_build_requests` and the Wiki worker lane |
| Avatar/model assets | existing avatar repository and upload lifecycle, unmounted only |

No parallel table, upload endpoint, or client-only persistence layer is added.

## 4. Live onboarding

### 4.1 Step 1: evidence intake and resume

The screen accepts the formats already supported by the brand-intelligence
upload contract. It validates locally, uploads each file through the existing
gateway, and requests one analysis with the owned URL, upload identifiers, and
an idempotency key.

After the request succeeds:

- the analysis identifier is stored at
  `brand-pilot:brand-intelligence:<workspaceId>:<userId>:<brandId>`;
- the same identifier is written to `?analysisId=<id>`;
- the query identifier takes precedence over the scoped local value;
- another workspace, user, or brand cannot resume the identifier;
- a transient error retains the identifier;
- confirmed, terminal failed, and not-found analyses clear both pointers;
- `review_ready` retains both pointers until confirmation succeeds.

Cancelling or retrying uses the existing source-entry screen. It does not erase
uploaded source records or analysis history.

### 4.2 Bounded analysis polling

The status loop issues one request at a time. It starts immediately and uses
the following base delays after pending responses:

`2 seconds → 4 seconds → 8 seconds → 15 seconds → 15 seconds`

Each scheduled delay adds positive jitter of up to 20 percent. A polling run
has all of these bounds:

- 15-minute wall-clock deadline;
- 63 status requests maximum;
- 15-second timeout for each request;
- no overlapping status request.

Every GET owns an `AbortController`. The active request and timer are cancelled
when the component unmounts, the analysis identifier changes, the tab becomes
hidden, or the request/deadline expires. A visible tab resumes after a jittered
delay instead of producing an immediate multi-tab burst.

Network failures, request timeouts, HTTP 408, HTTP 429, and HTTP 5xx retry while
the remaining budget permits. Terminal client errors stop. A stale analysis
identifier returns HTTP 404 and clears the resume pointers. Budget exhaustion
shows that analysis is taking longer than expected and keeps the resume
identifier so re-entry begins a fresh bounded status check.

### 4.3 Step 2: visible and preserved fields

The main review grid keeps these editable fields:

- 기업 개요
- 사업 소개
- 핵심 타깃
- 차별점
- 핵심 소구점

The only additional visible detail fields are:

- 대표 분야: `primaryCategory.name`
- 세부 분야: `subcategories[].name`

The UI does not render:

- `primaryCategory.code`
- `subcategories[].code`
- `sourceGaps`
- competitors, descriptions, or competitor source URLs
- evidence claims, identifiers, or evidence links

Hiding is not deletion. The editor starts from a structured clone of
`effectiveResult`; editing names changes only the named fields. Saving PATCHes
the complete `BrandIntelligenceResult`, including every hidden field and code,
then confirmation runs only after PATCH succeeds. A PATCH or confirm error
keeps the draft and resume pointers. Confirmation remains replay-safe.

Onboarding confirmation creates or updates Brand Core through the existing
confirmation transaction. It does not request a Wiki build.

## 5. Canonical Brand Center

### 5.1 Shared interaction contract

The top-level route is `/brand-center?tab=<tab>`. Invalid or missing tabs
normalize to `core`. Switching tabs with unsaved changes asks once for
confirmation. Browser unload uses the same dirty truth.

Each tab follows the same state model:

`loading → view → editing(clean|dirty) → saving → saved | error`

- View mode is read-only.
- Edit creates or opens the canonical draft.
- Save is disabled when clean and while saving.
- Cancel restores the persisted version without a network write.
- A failed save stays in edit mode with the draft intact.
- Successful save returns to view mode and reports what was saved.
- Loading, empty, unavailable, stale, and error states are distinct.

### 5.2 Core tab

The Core tab shows the approved Brand Core, an existing draft when present, and
the revision history. Editing an approved revision creates the next draft;
editing never mutates the approved row. Save uses optimistic concurrency.
Approval remains owner/admin-only and supersedes the previous approved version
inside the repository transaction.

Brand Rules remain available from a secondary `운영 규칙` control inside Core.
The existing required phrases, forbidden phrases, exaggeration rules, CTA
rules, channel rules, colors/fonts/logo rules, and auto-approval conditions
remain editable and approvable. Moving them from an old navigation structure
does not remove or reinterpret them.

### 5.3 FAQ, how-to, and guide tabs

These tabs use the existing Wiki management API:

- `faq` shows FAQ entries;
- `how_to` shows the `how_to` management projection;
- `guide` shows guide entries and provides a secondary `정책` filter for
  `policy` entries.

Each entry supports create, view, edit, save, cancel, activate, and deactivate.
Deactivation is the removal behavior; no hard-delete endpoint is introduced.
Read-only product/service Wiki projections are never edited here.

The guide area also exposes secondary controls for knowledge issues and build
state. Users can see `draft`, `pending`, `building`, `active`, `stale`, and
`failed`, connect a corrective source to an issue, and resolve it only after a
successful active build includes that source. Existing active Wiki content
remains available when a later build fails.

### 5.4 Products tab

The list requests drafts as well as approved items. An approved product or
service opens read-only. `수정` creates or opens the next draft revision. Save
persists the draft; cancel restores the persisted profile; approval supersedes
the previous approved revision and switches the active pointer.

Archiving remains the existing soft archive. Product/service approval never
blocks on Wiki completion.

### 5.5 Style tab

Style is a board of up to five reference images. It supports drag/drop and a
file picker, local upload progress, confirmed previews, selecting an image,
detaching an image, and optional short description/tags stored with the board
entry. The primary value stored in Brand Rules is the confirmed reference item
identifier, never an object URL or an unverified external URL.

Allowed files exactly match the image subset of the reusable reference upload
contract:

| MIME type | Maximum |
| --- | ---: |
| `image/png` | 5 MiB |
| `image/jpeg` | 5 MiB |
| `image/webp` | 5 MiB |

Each file uses one 10-minute reference upload session:

1. reserve `/brands/:brandId/references/upload-token`;
2. upload directly with the returned client token;
3. confirm `/brands/:brandId/references/confirm`;
4. receive a canonical `ReferenceItem`;
5. add its identifier to the rule draft.

The server verifies scope, path, nonce, expiry, MIME, exact size, checksum, and
canonical storage URL before confirmation. Cancelling an unfinished upload
uses the existing upload-session cancellation endpoint.

The additive rule field is:

```ts
interface BrandStyleReferenceImage {
  referenceItemId: string;
  description: string;
  tags: string[];
}

designRules: {
  colors: string[];
  fonts: string[];
  notes: string[];
  referenceImages: BrandStyleReferenceImage[];
}
```

Legacy rule fields are preserved when the board saves. Missing
`referenceImages` parses as `[]`. The parser enforces at most five unique UUID
identifiers, description length, tag length/count, and no unknown keys. The
repository additionally verifies that every identifier belongs to the same
workspace and brand, is unarchived, is a confirmed uploaded reference, and is
PNG/JPEG/WebP.

Removing an image from Style detaches it from the rule draft. It does not
hard-delete the blob or archive a reference that another workflow may use.
The JSONB rule column needs no structural database migration.

### 5.6 Avatar preservation

Avatar components, routes, repository records, upload sessions, and content
generation selection remain unchanged. The six-tab Brand Center simply does
not mount `AvatarLibraryPanel`. No migration, deletion, or archive is performed
for avatar data.

## 6. Wiki provisioning and scheduled refresh

### 6.1 First Wiki during Instagram enable

Onboarding does not build a Wiki. The first request to enable Instagram DM is
the provisioning trigger:

1. load the current readiness state;
2. if no active Wiki exists, idempotently enqueue an immediate
   `wiki_build_request`;
3. keep Instagram DM disabled and return the existing activation-blocked
   response; the next settings read reports `wikiStatus=building`;
4. the Wiki worker builds and atomically activates the first valid Wiki;
5. a subsequent enable attempt passes only when Brand Core, active Wiki,
   Instagram message permission, webhook, and worker readiness all pass.

The provisioning step does not weaken the final gate and does not create a
synthetic confirmed-brand-intelligence Wiki item.

### 6.2 Later product/service changes

After an active Wiki exists, product/service approval marks the Wiki dirty and
coalesces repeated changes into one pending request scheduled for the next
03:00 Asia/Seoul boundary. The request revision increments, but only one
pending/building request exists per brand. Product approval succeeds even if
the scheduled Wiki build later fails.

Manual Wiki entry activation/deactivation remains an explicit knowledge action
and may request an immediate build. A failed refresh never deactivates the last
active Wiki.

### 6.3 Existing nightly maintenance

The existing 03:00 KST maintenance lane remains separate. It considers active
Wikis with at least five `knowledge_gap` or `low_confidence` retrievals and runs
at most once per brand per day. Successful maintenance may enqueue a rebuild.
This integration does not invent a blanket nightly rebuild.

## 7. Error and safety boundaries

- Invalid files are rejected before reservation and again on the server.
- Upload cancellation and garbage collection retain their durable receipt
  behavior.
- Cross-workspace and cross-brand identifiers are rejected.
- Drafts never become execution truth until their existing approval action.
- Style references are inspiration assets and cannot become product facts.
- No production environment or secret is changed.
- No account, OAuth, session, permission, workspace, brand, source, Wiki,
  product, reference, avatar, analysis, or generated record is deleted.
- Deployment and browser production QA occur only after development and local
  regression gates finish.

## 8. Acceptance criteria

1. The canonical onboarding route uses the new live UI and existing backend.
2. A pending analysis cannot cause unbounded GET requests.
3. Hidden tabs issue no polling requests and unmount aborts the active GET.
4. Resume pointers follow the terminal/transient rules in this design.
5. Step 2 exposes only the approved fields and preserves the complete payload.
6. Brand Center renders exactly six top-level tabs.
7. Every tab has consistent view/edit/dirty/save/cancel/error behavior.
8. Policy, Wiki issues/build status, Brand Rules, products, and avatar backend
   functionality are preserved without old top-level tabs.
9. Style accepts only confirmed PNG/JPEG/WebP references, at most five, and
   persists canonical reference identifiers.
10. Product revisions and Wiki scheduling do not block each other.
11. Instagram enable provisions the first Wiki but cannot bypass readiness.
12. Existing active Wiki remains usable through a failed later build.
13. Tests, type checks, builds, diff checks, and local browser QA pass before
    deployment work begins.

## 9. Explicitly out of scope

- A new visual editor or image-generation tool
- Avatar/model creation or deletion
- Hard deletion of Wiki items or reference blobs
- A second Wiki scheduler
- Building Wiki content during onboarding
- Production deployment, environment edits, or secret rotation
- Replacing existing upload, analysis, repository, or worker infrastructure
