# Dashboard feature suggestion and collapsible sidebar design

## Goal

Add a persistent, icon-based desktop sidebar collapse control and a dashboard feature-suggestion banner that opens Customer Support with the feature category already selected.

## Scope

- Add a Lucide icon to every customer sidebar destination.
- Allow only the desktop sidebar to switch between the existing 248 px width and a compact 72 px icon rail.
- Persist the desktop preference in browser local storage and restore it on the next page load.
- Keep the mobile full-menu layout expanded and unchanged.
- Add a feature-suggestion banner near the bottom of the dashboard content.
- Route the banner to `/support?category=feature#support-request-form`.
- Initialize the support category as `feature`, move to the form, and preserve normal support-page behavior for all other entries.

## Interaction design

The sidebar header contains an accessible toggle using the panel-close/panel-open icon. Expanded mode retains the current logo, group headings, text labels, badges, help copy, and brand profile. Collapsed mode displays destination icons, active styling, compact badges, and icon-only help/profile controls. Every icon-only control exposes an `aria-label` and native tooltip text.

The dashboard banner uses the existing blue product palette, a lightbulb icon, one sentence inviting suggestions, and a primary `기능 제안하기` link. It is visually secondary to dashboard operational cards and remains usable on mobile.

## State and data flow

`AppShell` owns the desktop collapsed state because it controls both the sidebar and main grid. It reads a versioned local-storage key defensively, falls back to expanded mode, and writes only after a user toggle. The state is passed to `Sidebar`; no server data or API change is required.

`SupportPage` derives its initial category from the `category` query parameter. Only the supported `feature` value is preselected for this entry point; unknown values fall back to the existing empty selection. The form section has a stable anchor and is scrolled into view after navigation.

## Accessibility and responsive behavior

- The collapse button reports `aria-expanded` and a descriptive Korean label.
- Collapsed navigation links retain accessible names even when visible text is hidden.
- Keyboard focus styling remains visible.
- Desktop grid width follows the sidebar state without overlaying content.
- At the existing mobile breakpoint, the persistent desktop state does not alter the mobile drawer.

## Verification

- Component test: all visible navigation destinations render icons and retain accessible link names.
- Component test: toggling collapse changes the desktop state and persists it across a remount.
- Component test: `/support?category=feature` preselects `기능 건의`; a normal `/support` visit remains unselected.
- Dashboard test: the feature-suggestion link has the expected destination.
- Browser test: desktop expand/collapse, reload persistence, active route, dashboard banner navigation, selected support category, and mobile menu behavior.

## Out of scope

- Hover-to-expand behavior.
- Per-user server-side sidebar preferences.
- Redesigning dashboard cards, customer-support history, or the mobile navigation hierarchy.
