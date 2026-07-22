# Channel Connection Guides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a detailed, platform-specific OAuth preparation and troubleshooting guide to every customer channel card.

**Architecture:** Keep channel documentation in a typed data module and render it through one reusable accessible dialog. `ChannelsPage` owns only the selected channel state, so connection and activation behavior remains unchanged.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, existing Brand Pilot CSS and modal patterns.

---

### Task 1: Define the channel guide contract and content

**Files:**
- Create: `apps/customer-ui/src/features/channels/channelGuides.ts`
- Test: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] Add a failing test that expects six `연결 가이드` buttons and Instagram-specific preparation text after opening its guide.
- [ ] Run `npm test -- --run src/__tests__/channels.test.tsx` and verify it fails because guide buttons are absent.
- [ ] Define `ChannelConnectionGuide`, guide sections, troubleshooting items, official links, and a complete `Record<ChannelType, ChannelConnectionGuide>` for all six channels.

### Task 2: Implement the accessible guide dialog

**Files:**
- Create: `apps/customer-ui/src/components/channels/ChannelConnectionGuideDialog.tsx`
- Modify: `apps/customer-ui/src/styles/prototype.css`
- Test: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] Add failing assertions for dialog title, close button, Escape close, and a channel other than Instagram.
- [ ] Render status, prerequisites, setup steps, OAuth steps, permissions, completion checks, troubleshooting, and official links.
- [ ] Reuse the existing modal visual language, add a sticky header, a scrollable body, and responsive single-column sections.
- [ ] Implement initial focus, focus restoration, focus trapping, Escape close, and backdrop close.

### Task 3: Connect every channel card to its guide

**Files:**
- Modify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Test: `apps/customer-ui/src/__tests__/channels.test.tsx`

- [ ] Add selected guide state to `ChannelsPage`.
- [ ] Add `연결 가이드` to each channel card without changing its OAuth or activation actions.
- [ ] Open `ChannelConnectionGuideDialog` with the matching guide data and close it through the shared callback.
- [ ] Run `npm test -- --run src/__tests__/channels.test.tsx` and verify all channel tests pass.

### Task 4: Verify production behavior

**Files:**
- Verify: `apps/customer-ui/src/pages/ChannelsPage.tsx`
- Verify: `apps/customer-ui/src/components/channels/ChannelConnectionGuideDialog.tsx`

- [ ] Run `npm run build` in `apps/customer-ui` and verify TypeScript and Vite pass.
- [ ] Open `/channels`, inspect Instagram and one prepared channel guide at desktop and mobile widths, and confirm the existing Meta OAuth link still points to the configured API URL.
