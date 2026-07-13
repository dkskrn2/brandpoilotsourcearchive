# Brand Pilot Database Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local PostgreSQL schema for Brand Pilot that can later move to Supabase Postgres.

**Architecture:** Add Docker Compose for local Postgres, a single initial SQL migration for all MVP tables, and a smoke-test SQL file that validates table creation. The schema uses UUID primary keys, JSONB, timestamptz, check constraints, foreign keys, partial unique indexes, and an `updated_at` trigger.

**Tech Stack:** PostgreSQL 16, Docker Compose, SQL migrations.

---

### Task 1: Local Postgres Runtime

**Files:**
- Create: `docker-compose.yml`
- Create: `db/README.md`

- [ ] Add a local PostgreSQL service named `postgres`.
- [ ] Expose it on host port `54329`.
- [ ] Mount migration and smoke SQL folders into the container.
- [ ] Document commands for start, migrate, smoke check, and reset.

### Task 2: Initial Schema Migration

**Files:**
- Create: `db/migrations/001_initial_schema.sql`

- [ ] Create `pgcrypto` extension.
- [ ] Add `set_updated_at()` trigger function.
- [ ] Create tenant tables: `app_users`, `workspaces`, `workspace_members`, `brands`, `brand_profiles`.
- [ ] Create storage table: `storage_artifacts`.
- [ ] Create source/topic tables: `source_urls`, `source_snapshots`, `topic_uploads`, `topic_rows`.
- [ ] Create channel tables: `brand_channels`, `channel_credentials`, `webflow_mappings`.
- [ ] Create generation/review tables: `content_topics`, `master_drafts`, `channel_outputs`, `auto_approval_checks`, `llm_runs`, `review_events`, `regeneration_requests`.
- [ ] Create publishing tables: `publish_slots`, `publish_queue`, `publish_attempts`.
- [ ] Create worker/audit tables: `jobs`, `audit_events`.
- [ ] Add check constraints, foreign keys, indexes, and partial unique indexes.

### Task 3: Schema Smoke Test

**Files:**
- Create: `db/smoke/001_schema_smoke.sql`

- [ ] Verify all expected public tables exist.
- [ ] Verify important partial unique indexes exist.
- [ ] Verify important FK constraints exist.
- [ ] Verify status check constraints exist.

### Task 4: Apply and Verify

**Commands:**

```powershell
docker compose up -d postgres
docker compose exec -T postgres psql -U brand_pilot -d brand_pilot -v ON_ERROR_STOP=1 -f /migrations/001_initial_schema.sql
docker compose exec -T postgres psql -U brand_pilot -d brand_pilot -v ON_ERROR_STOP=1 -f /smoke/001_schema_smoke.sql
```

Expected:

- migration exits with code `0`
- smoke test returns `table_count = 25`
- required indexes, constraints, and foreign keys are present
