# Source-Grounded Content Value Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan step-by-step.

**Goal:** URL 원문을 상세히 반영하면서 사용자 효용, 공감, 저장, 공유 가치를 갖는 콘텐츠를 생성하도록 공통 워커 프롬프트를 강화한다.

**Architecture:** 형식별 지침은 그대로 유지한다. `buildWorkerPrompt`의 공통 규칙에만 소스 충실도와 사용자 가치 계약을 추가해 현재 및 향후 형식에서 재사용한다.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: 공통 콘텐츠 품질 계약

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/promptBuilder.ts`
- Test: `workers/brand-pilot-image-worker/src/promptBuilder.test.ts`

- [x] 직접 URL 맥락에서 핵심 주장, 논리, 근거, 예시, 단계, 주의사항을 상세히 반영하도록 요구하는 실패 테스트를 작성한다.
- [x] 사용자 효용, 공감, 저장, 공유 가치 중 하나 이상을 갖도록 요구하는 실패 테스트를 작성한다.
- [x] 특정 형식이나 채널 이름을 새 공통 규칙에 추가하지 않는다.
- [x] `promptBuilder.test.ts`를 실행해 새 계약이 없는 이유로 실패하는지 확인한다.
- [x] `buildWorkerPrompt` 공통 규칙에 최소 문구를 추가한다.
- [x] 워커 전체 테스트와 타입 검사를 실행한다.
