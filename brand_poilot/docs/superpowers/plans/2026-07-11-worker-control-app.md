# Worker Control App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a localhost-only control app on the worker PC for starting, stopping, running once, and observing the image worker.

**Architecture:** A Node HTTP server owns one child worker process and exposes fixed local control routes. A dependency-free HTML page polls the server for process and central API health state. Existing worker execution remains in `src/index.ts`; the control app only invokes it with fixed modes.

**Tech Stack:** Node.js HTTP server, TypeScript, existing `tsx` worker runtime, Vitest.

---

### Task 1: Add local process controller

**Files:**
- Create: `workers/brand-pilot-image-worker/src/control/processController.ts`
- Create: `workers/brand-pilot-image-worker/src/control/processController.test.ts`

- [x] Write failing tests for start, one-shot completion, conflicting starts, and stop.
- [x] Implement a controller that launches `tsx src/index.ts` with only fixed `watch` and `run-once` arguments, captures stdout/stderr, parses worker result JSON, and kills the managed process tree.
- [x] Run the targeted controller tests.

### Task 2: Add localhost control server and UI

**Files:**
- Create: `workers/brand-pilot-image-worker/src/control/server.ts`
- Create: `workers/brand-pilot-image-worker/src/control/server.test.ts`
- Create: `workers/brand-pilot-image-worker/src/control/index.ts`
- Modify: `workers/brand-pilot-image-worker/package.json`

- [x] Write failing route tests for `GET /api/status`, `POST /api/worker/start`, `POST /api/worker/stop`, and `POST /api/worker/run-once`.
- [x] Implement a `127.0.0.1` HTTP server, central `/health` probing, JSON route handling, and a static single-page UI with Start, Stop, and Run Once controls.
- [x] Add `npm run control` and document the local port.
- [x] Run all worker tests and type checks.

### Task 3: Document worker-PC operation

**Files:**
- Modify: `workers/brand-pilot-image-worker/README.md`
- Modify: `workers/brand-pilot-image-worker/SETUP_OTHER_PC.md`

- [x] Document `npm run control`, local-only access, state meanings, and clean shutdown behavior.
- [x] Confirm documentation does not contain real tokens or credentials.
