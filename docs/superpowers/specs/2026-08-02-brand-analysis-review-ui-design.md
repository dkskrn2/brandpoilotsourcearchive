# Brand Analysis Review UI Design

## Goal

Redesign the live Brand Center analysis review screen from the production baseline at commit `e125195`. The screen remains directly editable and keeps the result and persistence schemas intact. The live workflow additionally loads the existing category registry, and the analysis job supplies that registry to the worker so generated category codes come from the same source as the review UI.

## Production Baseline

- Route: `/onboarding/brand-intelligence`
- Route component: `BrandCenterPreviewPage` with `mode="live"`
- Live workflow: `LiveBrandCenterOnboarding`
- Review component: `BrandAnalysisReviewStep`
- Confirmation remains `gateway.confirm(brandId, analysisId, companyName, draft)`.
- The `BrandIntelligenceResult` v1/v2 API shapes remain unchanged.

The previous prototype from the archive repository is not a merge source. It omits fields and actions that exist in production.

## Scope

### Included

- Reorganize the existing review fields into a tabbed workspace.
- Keep inputs immediately editable; there is no separate edit mode or edit button.
- Replace newline-delimited editing for v2 string arrays with one editable row per array item.
- Load the existing category registry in the live onboarding workflow and render the representative category as a select and registry subcategories as multi-select checkboxes.
- Preserve user-entered custom subcategories separately from registry selections.
- Include the category registry in the worker job contract and constrain worker-generated categories to exact registry entries.
- Give array rows the same textarea border, background, radius, and focus treatment as the narrative textareas.
- Remove offering reordering controls and place an icon-only delete action beside each offering title.
- Add a development-only fixture page for visual review; it must not create a production route.
- Preserve responsive and keyboard-accessible behavior.

### Excluded

- No database schema changes and no changes to the `BrandIntelligenceResult` v1/v2 payload shape.
- No changes to polling, retry, cancellation, storage keys, confirmation, or navigation.
- No changes to Brand Center approval/versioning behavior.
- No production deployment as part of the UI preview step.
- No removal or renaming of fields returned by the analysis contract.

## Information Architecture

The review workspace has a compact section navigation and one active panel:

1. **브랜드 핵심**
   - 회사명
   - 한 줄 정의 (v2)
   - 기업 개요
   - 사업 소개
   - 대표 분야
   - 세부 분야
2. **고객·니즈**
   - 핵심 타깃
   - 보조 타깃 (v2, item editor)
   - 고객 니즈 (v2, item editor)
3. **가치·소구**
   - 가치 제안 (v2)
   - 차별점 (v2 item editor; v1 remains a text value)
   - 핵심 소구점
   - 보조 소구점 (v2, item editor)
   - 핵심 키워드 (v2, item editor)
   - 관찰된 브랜드 톤 (v2)
4. **상품·서비스** (v2)
   - 유형, 이름, 설명, 대상 고객, 핵심 효익, 가격, 구매 URL
   - Add and remove actions; analysis order remains fixed
5. **경쟁사**
   - Name, description, and evidence links

The save action remains visible at the bottom of the workspace. Changing tabs never resets or reconstructs the draft.

## Component Design

### `BrandAnalysisReviewStep`

- Continues to receive the current controlled props: company name, draft, saving state, error, callbacks, and categories.
- Owns only presentation state such as the active tab.
- Uses focused field components for narrative text, item arrays, offering cards, and category selection.
- Sends all edits through the existing `onChange` callback using the unchanged result type.
- Retains the current v1/v2 conditional behavior.

### Item Array Editor

- Displays one row per string item with an explicit delete control.
- Provides an item-add control.
- Preserves item order.
- Empty newly added rows keep confirmation disabled until filled or removed.
- On blur, surrounding whitespace is normalized; empty rows are removed.
- The parent result still contains `string[]`; no serialization format changes.

### Category Preview

- `LiveBrandCenterOnboarding` loads the registry with the existing `listContentCategories()` endpoint and passes it through the existing `categories` prop.
- A registry request failure keeps the existing direct-input fallback so analysis review remains usable.
- Selecting a representative category keeps only registry subcategories allowed by the new category while preserving custom subcategories.
- Registry subcategories use checkboxes and custom subcategories remain editable separately.

### Worker Category Selection

- The API claim response includes an ordered category registry assembled from the existing `content_categories` and `content_subcategories` tables.
- The worker job and runner input carry this registry to the brand-core stage.
- The brand-core prompt requires `primaryCategory` and coded `subcategories` to match an exact registry `code` and `name` pair.
- The API validates returned coded categories against the registry before accepting completion. A mismatched primary category becomes a contract error; mismatched coded subcategories are rejected.
- When no registry entry fits, the worker returns `primaryCategory: null` or an empty `subcategories` array. Only the user can add a custom subcategory with `code: null` during review.

### Development Preview

- A fixture-backed preview renders the production `BrandAnalysisReviewStep` inside the production preview shell.
- It uses the v2 result shape and representative category fixtures that exercise every field and control.
- Its route is registered only when `import.meta.env.DEV` is true, so production routing and bundles do not expose the preview page.
- Preview save updates only local component state and performs no API request.

## Data Flow

1. The API includes the existing category registry when a worker claims an analysis job.
2. The worker selects categories from the registry and returns the unchanged `BrandIntelligenceResult` shape.
3. The live workflow restores or receives that result and independently loads the same category registry for review.
4. The review component receives `draft` and `categories` as controlled data.
5. Every edit produces a new `BrandIntelligenceResult` through `onChange`.
6. Confirmation uses the existing company-name normalization and `gateway.confirm` call.

## Error Handling

- Existing analysis, polling, cancellation, and save error messages remain unchanged.
- The save button remains disabled while saving or when required fields are invalid.
- Item-array validation prevents blank items from being submitted.
- No tab switch triggers network activity or persistence.

## Visual and Responsive Behavior

- Desktop: vertical section navigation beside the active editing panel.
- Narrow screens: section navigation becomes a horizontally scrollable tab row above the panel.
- Field labels remain visible; text areas grow with their content without forcing manual resize.
- Item rows have clear numbering and use the same textarea stroke and focus treatment as narrative fields.
- Each product/service card shows its sequence and type at left and an accessible trash icon at right. There is no lower action row.
- Focus, selected-tab, disabled, and error states use existing design tokens and button styles.

## Compatibility and Regression Boundary

The following production behavior must remain intact:

- Company-name editing and normalization
- v1 and v2 result handling
- All current required-field checks
- Maximum five offerings
- Offering type editing and add/delete behavior
- Competitor evidence links
- Existing confirm payload and navigation
- Analysis resume, local-storage pointer, polling, retry, and cancellation

## Verification

- Component tests cover tab navigation and visibility of every production field.
- Tests edit, add, and delete each array-backed field and assert the controlled result shape.
- Tests verify category selection and subcategory filtering with registry data.
- Focused UI tests cover category loading success/failure, category selection, item styling hooks, offering removal, and the absence of reorder controls.
- Focused API and worker tests cover registry transport, exact category selection, and rejection of unknown coded categories.
- Type checking and the affected customer UI, API, and worker tests must pass. The user requested this targeted verification instead of another full repository test run.
- The development preview is inspected at desktop and narrow widths before any deployment decision.
