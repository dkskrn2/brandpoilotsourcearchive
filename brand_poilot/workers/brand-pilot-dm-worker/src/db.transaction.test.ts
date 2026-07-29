import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedWikiValidationItem } from "./compiledWikiFinalize.js";

type VersionStatus = "building" | "ready" | "active" | "superseded";
type IssueStatus = "open" | "resolved";

interface IssueState {
  workspaceId: string;
  brandId: string;
  sourceKind: string;
  sourceId: string;
  status: IssueStatus;
  resolutionActiveVersionId: string | null;
}

interface DatabaseState {
  activationSucceeds: boolean;
  previousVersionStatus: VersionStatus;
  candidateVersionStatus: VersionStatus;
  compilationItemStatus: "processing" | "succeeded";
  buildRequestStatus: "building" | "succeeded";
  issues: IssueState[];
  sourceUnits: Array<{
    workspaceId: string;
    brandId: string;
    wikiVersionId: string;
    sourceKind: string;
    sourceId: string;
  }>;
  outboxScheduleFails: boolean;
  outboxCompletionSucceeds: boolean;
  committed: boolean;
  rolledBack: boolean;
}

const harness = vi.hoisted(() => ({
  state: null as DatabaseState | null,
  queries: [] as string[],
}));

function cloneState(state: DatabaseState): DatabaseState {
  return structuredClone(state);
}

vi.mock("pg", () => ({
  Pool: class TransactionalPool {
    async query(sql: string, values: unknown[] = []) {
      const client = await this.connect();
      try {
        return await client.query(sql, values);
      } finally {
        client.release();
      }
    }

    async connect() {
      const state = harness.state;
      if (!state) throw new Error("transaction_test_state_missing");
      let snapshot: DatabaseState | null = null;
      return {
        async query(sql: string, values: unknown[] = []) {
          const normalized = sql.trim();
          harness.queries.push(normalized);
          if (normalized === "begin") {
            snapshot = cloneState(state);
            return { rowCount: 0, rows: [] };
          }
          if (normalized === "commit") {
            state.committed = true;
            snapshot = null;
            return { rowCount: 0, rows: [] };
          }
          if (normalized === "rollback") {
            if (snapshot) Object.assign(state, cloneState(snapshot), { rolledBack: true });
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("select id from wiki_compilation_items")) {
            return { rowCount: 1, rows: [{ id: values[0] }] };
          }
          if (sql.includes("as has_overview")) {
            return {
              rowCount: 1,
              rows: [{
                has_overview: true,
                has_catalog: true,
                has_incomplete_page: false,
                has_unlinked_offering: false,
              }],
            };
          }
          if (sql.includes("update wiki_compilation_items") && sql.includes("status = 'succeeded'")) {
            state.compilationItemStatus = "succeeded";
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("update wiki_versions") && sql.includes("set status = 'ready'")) {
            state.candidateVersionStatus = "ready";
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("activate_compiled_wiki_version")) {
            state.previousVersionStatus = "superseded";
            state.candidateVersionStatus = "active";
            return { rowCount: 1, rows: [{ activated: state.activationSucceeds }] };
          }
          if (sql.includes("update wiki_issues issue")) {
            const [wikiVersionId, workspaceId, brandId] = values.map(String);
            for (const issue of state.issues) {
              const matchedUnit = state.sourceUnits.some((unit) =>
                unit.wikiVersionId === wikiVersionId
                && unit.workspaceId === issue.workspaceId
                && unit.brandId === issue.brandId
                && unit.sourceKind === issue.sourceKind
                && unit.sourceId === issue.sourceId);
              if (issue.status === "open"
                && issue.workspaceId === workspaceId
                && issue.brandId === brandId
                && state.candidateVersionStatus === "active"
                && matchedUnit) {
                issue.status = "resolved";
                issue.resolutionActiveVersionId = wikiVersionId;
              }
            }
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("update wiki_build_requests")) {
            if (sql.includes("insert into wiki_build_requests") && state.outboxScheduleFails) {
              throw new Error("forced_wiki_enqueue_failure");
            }
            state.buildRequestStatus = "succeeded";
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("update wiki_refresh_outbox") && sql.includes("lease_expires_at < now()")) {
            return { rowCount: 0, rows: [] };
          }
          if (sql.includes("update wiki_refresh_outbox event")
            && sql.includes("status = 'processing'")) {
            return {
              rowCount: 1,
              rows: [{
                id: "48000000-0000-4000-8000-000000000008",
                workspace_id: workspaceId,
                brand_id: brandId,
                lease_token: "49000000-0000-4000-8000-000000000009",
                created_at: new Date("2026-07-28T17:59:00.000Z"),
              }],
            };
          }
          if (sql.includes("insert into wiki_build_requests")) {
            if (state.outboxScheduleFails) throw new Error("forced_wiki_enqueue_failure");
            return { rowCount: 1, rows: [] };
          }
          if (sql.includes("update wiki_refresh_outbox")
            && (sql.includes("status = 'succeeded'") || sql.includes("last_error"))) {
            return {
              rowCount: sql.includes("status = 'succeeded'") && !state.outboxCompletionSucceeds ? 0 : 1,
              rows: [],
            };
          }
          if (sql.includes("insert into wiki_maintenance_runs")) {
            return { rowCount: 0, rows: [] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    }
  },
}));

const workspaceId = "41000000-0000-4000-8000-000000000001";
const brandId = "42000000-0000-4000-8000-000000000002";
const candidateVersionId = "44000000-0000-4000-8000-000000000004";
const sourceId = "45000000-0000-4000-8000-000000000005";
const item: ClaimedWikiValidationItem = {
  id: "46000000-0000-4000-8000-000000000006",
  workspaceId,
  brandId,
  wikiVersionId: candidateVersionId,
  leaseToken: "47000000-0000-4000-8000-000000000007",
};

function initialState(overrides: Partial<DatabaseState> = {}): DatabaseState {
  return {
    activationSucceeds: true,
    previousVersionStatus: "active",
    candidateVersionStatus: "building",
    compilationItemStatus: "processing",
    buildRequestStatus: "building",
    issues: [{
      workspaceId,
      brandId,
      sourceKind: "faq",
      sourceId,
      status: "open",
      resolutionActiveVersionId: null,
    }],
    sourceUnits: [{
      workspaceId,
      brandId,
      wikiVersionId: candidateVersionId,
      sourceKind: "faq",
      sourceId,
    }],
    outboxScheduleFails: false,
    outboxCompletionSucceeds: true,
    committed: false,
    rolledBack: false,
    ...overrides,
  };
}

describe("completeWikiValidationItem transaction", () => {
  beforeEach(() => {
    harness.state = initialState();
    harness.queries = [];
  });

  it("commits activation before resolving an issue linked to the activated source", async () => {
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await db.completeWikiValidationItem(item, [], "brand core");

    expect(harness.state).toMatchObject({
      previousVersionStatus: "superseded",
      candidateVersionStatus: "active",
      compilationItemStatus: "succeeded",
      buildRequestStatus: "succeeded",
      committed: true,
      rolledBack: false,
      issues: [{
        status: "resolved",
        resolutionActiveVersionId: candidateVersionId,
      }],
    });
    expect(harness.queries.findIndex((sql) => sql.includes("activate_compiled_wiki_version")))
      .toBeLessThan(harness.queries.findIndex((sql) => sql.includes("update wiki_issues issue")));
  });

  it("keeps a later scheduled refresh target when a rebuild was requested during the build", async () => {
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await db.completeWikiValidationItem(item, [], "brand core");

    const completion = harness.queries.find((sql) =>
      sql.includes("update wiki_build_requests")
      && sql.includes("requested_revision > coalesce(building_revision, 0)"));
    expect(completion).toContain("greatest(quiet_until, now() + interval '2 minutes')");
  });

  it("rolls back activation failure, preserving the prior active version and pending issue", async () => {
    harness.state = initialState({ activationSucceeds: false });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await expect(db.completeWikiValidationItem(item, [], "brand core"))
      .rejects.toThrow("wiki_activation_failed");

    expect(harness.state).toMatchObject({
      previousVersionStatus: "active",
      candidateVersionStatus: "building",
      compilationItemStatus: "processing",
      buildRequestStatus: "building",
      committed: false,
      rolledBack: true,
      issues: [{
        status: "open",
        resolutionActiveVersionId: null,
      }],
    });
  });

  it("does not resolve cross-tenant or source-mismatched issues", async () => {
    harness.state = initialState({
      issues: [
        {
          workspaceId: "51000000-0000-4000-8000-000000000001",
          brandId: "52000000-0000-4000-8000-000000000002",
          sourceKind: "faq",
          sourceId,
          status: "open",
          resolutionActiveVersionId: null,
        },
        {
          workspaceId,
          brandId,
          sourceKind: "faq",
          sourceId: "53000000-0000-4000-8000-000000000003",
          status: "open",
          resolutionActiveVersionId: null,
        },
      ],
    });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await db.completeWikiValidationItem(item, [], "brand core");

    expect(harness.state?.issues).toEqual([
      expect.objectContaining({ status: "open", resolutionActiveVersionId: null }),
      expect.objectContaining({ status: "open", resolutionActiveVersionId: null }),
    ]);
    expect(harness.state).toMatchObject({
      candidateVersionStatus: "active",
      committed: true,
      rolledBack: false,
    });
  });

  it("claims 03:00 KST maintenance only after five gaps and at most once per brand day", async () => {
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await expect(db.claimWikiMaintenance()).resolves.toBeNull();

    const claim = harness.queries.find((sql) => sql.includes("insert into wiki_maintenance_runs"));
    expect(claim).toContain("reason_code in ('knowledge_gap', 'low_confidence')");
    expect(claim).toContain("having count(*) >= 5");
    expect(claim).toContain("Asia/Seoul");
    expect(claim).toContain("not exists");
    expect(claim).toContain("date_trunc('day'");
  });

  it("recovers expired outbox leases and succeeds only after scheduling the Wiki request", async () => {
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await expect(db.dispatchWikiRefreshOutboxOnce("wiki-worker-1"))
      .resolves.toMatchObject({ status: "completed" });

    const recovery = harness.queries.find((sql) =>
      sql.includes("update wiki_refresh_outbox") && sql.includes("lease_expires_at < now()"));
    const claim = harness.queries.find((sql) =>
      sql.includes("update wiki_refresh_outbox event") && sql.includes("status = 'processing'"));
    const scheduleIndex = harness.queries.findIndex((sql) => sql.includes("insert into wiki_build_requests"));
    const successIndex = harness.queries.findIndex((sql) =>
      sql.includes("update wiki_refresh_outbox") && sql.includes("status = 'succeeded'"));
    expect(recovery).toContain("status = 'pending'");
    expect(claim).toContain("for update skip locked");
    expect(claim).toContain("next_attempt_at <= now()");
    expect(scheduleIndex).toBeGreaterThan(-1);
    expect(successIndex).toBeGreaterThan(scheduleIndex);
  });

  it("returns a failed outbox dispatch to pending with observable bounded backoff", async () => {
    harness.state = initialState({ outboxScheduleFails: true });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await expect(db.dispatchWikiRefreshOutboxOnce("wiki-worker-1"))
      .resolves.toMatchObject({ status: "retry", error: "forced_wiki_enqueue_failure" });

    const failure = harness.queries.find((sql) =>
      sql.includes("update wiki_refresh_outbox")
      && sql.includes("last_error")
      && sql.includes("attempt_count = least"));
    expect(failure).toContain("status = 'pending'");
    expect(failure).toContain("least(3600");
    expect(failure).toContain("attempt_count");
  });

  it("rolls back Wiki scheduling when the outbox completion lease is lost", async () => {
    harness.state = initialState({ outboxCompletionSucceeds: false });
    const { createDmWorkerDb } = await import("./db.js");
    const db = createDmWorkerDb("postgresql://transaction-test");

    await expect(db.dispatchWikiRefreshOutboxOnce("wiki-worker-1"))
      .resolves.toMatchObject({ status: "retry", error: "wiki_refresh_outbox_lease_lost" });

    expect(harness.queries).toContain("rollback");
    expect(harness.state).toMatchObject({ committed: false, rolledBack: true });
  });
});
