# Single-scene Free-layout Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 릴스를 자유 레이아웃의 정보 이미지 한 장과 BGM으로 생성한다.

**Architecture:** `worker-reel.v3`를 워커와 API의 공통 계약으로 사용한다. 프롬프트는 콘텐츠 품질만 규정하고 레이아웃은 워커에 위임하며, 워커 manifest, API result, renderer 세 계층에서 정확히 한 장을 검증한다.

**Tech Stack:** TypeScript, Vitest, Codex image worker, Python/FFmpeg

---

### Task 1: Failing contract tests

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/manifest.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
- Modify: `apps/api/src/imageRenderJobs.test.ts`
- Modify: `apps/api/src/instagramFormats.test.ts`

- [x] `worker-reel.v3`, 정확히 한 장, 레이아웃 비강제 조건을 기대하도록 테스트를 변경한다.
- [x] 관련 테스트를 실행해 기존 `v2` 및 1~2장 구현 때문에 실패하는지 확인한다.

### Task 2: Implement v3 prompt and validation

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/promptBuilder.ts`
- Modify: `workers/brand-pilot-image-worker/src/manifest.ts`
- Modify: `workers/brand-pilot-image-worker/src/reelRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`
- Modify: `apps/api/src/instagramFormats.ts`
- Modify: `apps/api/src/imageRenderJobs.ts`
- Modify: `apps/api/src/types.ts`
- Modify: version references in affected tests and worker adapters

- [x] 모든 릴스 버전을 `worker-reel.v3`로 맞춘다.
- [x] 릴스 프롬프트에서 레이아웃 강제 문구를 제거하고 워커 자율 결정을 명시한다.
- [x] 워커, API, renderer에서 릴스 한 장만 허용한다.
- [x] 집중 테스트를 실행해 통과를 확인한다.

### Task 3: Full verification

**Files:**
- Verify only

- [x] 워커 전체 테스트와 빌드를 실행한다.
- [x] API 전체 테스트와 빌드를 실행한다.
- [x] `git diff --check`와 잔여 `worker-reel.v2` 참조를 확인한다.
