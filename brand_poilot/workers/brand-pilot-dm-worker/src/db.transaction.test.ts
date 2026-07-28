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
  committed: boolean;
  rolledBack: boolean;
}

const harness = vi.hoisted(() => ({
  state: null as DatabaseState | null,
}));

function cloneState(state: DatabaseState): DatabaseState {
  return structuredClone(state);
}

vi.mock("pg", () => ({
  Pool: class TransactionalPool {
    async connect() {
      const state = harness.state;
      if (!state) throw new Error("transaction_test_state_missing");
      let snapshot: DatabaseState | null = null;
      return {
        async query(sql: string, values: unknown[] = []) {
          const normalized = sql.trim();
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
            state.buildRequestStatus = "succeeded";
            return { rowCount: 1, rows: [] };
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
    committed: false,
    rolledBack: false,
    ...overrides,
  };
}

describe("completeWikiValidationItem transaction", () => {
  beforeEach(() => {
    harness.state = initialState();
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
});
