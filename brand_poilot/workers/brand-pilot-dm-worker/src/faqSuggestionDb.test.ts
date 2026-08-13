import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDmWorkerDbFromPool } from "./db.js";

let database: PGlite;
let db: ReturnType<typeof createDmWorkerDbFromPool>;

function pool(database: PGlite) {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  };
  return {
    query,
    async connect() { return { query, release() {} }; },
  } as unknown as Pick<Pool, "query" | "connect">;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hash(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector")
      || file === "027_wiki_search_v2.sql"
      || file >= "075_") continue;
    await database.exec(sql);
  }
  db = createDmWorkerDbFromPool(pool(database));
}, 90_000);

afterAll(async () => {
  await database.close();
});

async function seedRun() {
  const workspaceId = randomUUID();
  const brandId = randomUUID();
  const actorUserId = randomUUID();
  const sourceId = randomUUID();
  const runId = randomUUID();
  const core = {
    contractVersion: 1,
    summary: { oneLine: "FAQ 브랜드", description: "배송 상담을 제공합니다." },
  };
  const contentHash = hash(core);
  await database.query("insert into app_users(id,email) values($1,$2)", [actorUserId, `${actorUserId}@example.com`]);
  await database.query("insert into workspaces(id,name,slug) values($1,'FAQ',$2)", [workspaceId, `faq-${workspaceId}`]);
  await database.query("insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')", [workspaceId, actorUserId]);
  await database.query("insert into brands(id,workspace_id,name) values($1,$2,'FAQ Brand')", [brandId, workspaceId]);
  await database.query("insert into brand_profiles(workspace_id,brand_id) values($1,$2)", [workspaceId, brandId]);
  await database.query(
    `insert into brand_core_versions(
       id,workspace_id,brand_id,version,status,core_json,evidence_json,
       review_state_json,created_by,approved_at
     ) values($1,$2,$3,1,'approved',$4::jsonb,'[]','{}','user',now())`,
    [sourceId, workspaceId, brandId, JSON.stringify(core)],
  );
  await database.query("update brand_profiles set active_brand_core_id=$1 where brand_id=$2", [sourceId, brandId]);
  await database.query(
    `insert into faq_suggestion_runs(
       id,workspace_id,brand_id,input_fingerprint,source_snapshot_json,created_by_user_id
     ) values($1,$2,$3,$4,$5::jsonb,$6)`,
    [runId, workspaceId, brandId, "f".repeat(64), JSON.stringify({
      contractVersion: "faq-suggestion-sources.v1",
      sources: [{ sourceType: "brand_core", sourceId, contentHash, label: "FAQ 브랜드" }],
    }), actorUserId],
  );
  return { workspaceId, brandId, actorUserId, sourceId, runId, contentHash };
}

describe("FAQ suggestion DB leases", () => {
  it("claims with a token, reloads tenant sources, and requires the token for heartbeat", async () => {
    const seeded = await seedRun();
    const claimed = await db.claimFaqSuggestionRun("faq-worker-1");
    expect(claimed).toMatchObject({
      contractVersion: "faq-suggestion-input.v1",
      runId: seeded.runId,
      workspaceId: seeded.workspaceId,
      brandId: seeded.brandId,
      sources: [{ sourceId: seeded.sourceId, contentHash: seeded.contentHash }],
    });
    expect(claimed?.leaseToken).toMatch(/^[0-9a-f-]{36}$/);
    await expect(db.heartbeatFaqSuggestionRun(
      seeded.runId, "faq-worker-1", randomUUID(),
    )).rejects.toThrow("faq_suggestion_lease_lost");
    await expect(db.heartbeatFaqSuggestionRun(
      seeded.runId, "faq-worker-1", claimed!.leaseToken,
    )).resolves.toBeUndefined();
  });

  it("completes items and clears the lease atomically", async () => {
    const seeded = await seedRun();
    const claimed = await db.claimFaqSuggestionRun("faq-worker-2");
    await db.completeFaqSuggestionRun(
      seeded.runId,
      "faq-worker-2",
      claimed!.leaseToken,
      {
        suggestions: [{
          category: "shipping",
          question: "배송은 언제 시작하나요?",
          answer: "결제 후 안내된 일정에 발송합니다.",
          evidence: [{ sourceType: "brand_core", sourceId: seeded.sourceId, label: "FAQ 브랜드" }],
          confidence: 0.9,
        }],
        rejections: [],
      },
    );
    const run = await database.query<{ status: string; lease_owner: string | null }>(
      "select status,lease_owner from faq_suggestion_runs where id=$1",
      [seeded.runId],
    );
    expect(run.rows[0]).toEqual({ status: "review_ready", lease_owner: null });
    const items = await database.query<{ question: string }>(
      "select question from faq_suggestion_items where run_id=$1",
      [seeded.runId],
    );
    expect(items.rows).toEqual([{ question: "배송은 언제 시작하나요?" }]);
  });

  it("retries at 5 seconds and records an FAQ worker heartbeat", async () => {
    const seeded = await seedRun();
    const claimed = await db.claimFaqSuggestionRun("faq-worker-3");
    await db.failFaqSuggestionRun(
      seeded.runId, "faq-worker-3", claimed!.leaseToken, "cli_timeout", true,
    );
    const run = await database.query<{ status: string; delay: number }>(
      `select status, extract(epoch from (available_at - updated_at))::int as delay
         from faq_suggestion_runs where id=$1`,
      [seeded.runId],
    );
    expect(run.rows[0]).toEqual({ status: "queued", delay: 5 });
    await db.heartbeatFaqSuggestionWorker("faq-worker-3");
    const worker = await database.query<{ worker_type: string }>(
      "select worker_type from worker_instances where worker_id='faq-worker-3'",
    );
    expect(worker.rows).toEqual([{ worker_type: "faq" }]);
  });

  it("fails before CLI when a frozen source hash has changed", async () => {
    const seeded = await seedRun();
    await database.query(
      `update brand_core_versions set core_json=$1::jsonb where id=$2`,
      [JSON.stringify({ contractVersion: 1, summary: { oneLine: "변경됨" } }), seeded.sourceId],
    );
    await expect(db.claimFaqSuggestionRun("faq-worker-changed"))
      .rejects.toThrow("faq_suggestion_source_changed");
    const run = await database.query<{ status: string; error_code: string }>(
      "select status,error_code from faq_suggestion_runs where id=$1",
      [seeded.runId],
    );
    expect(run.rows[0]).toEqual({
      status: "failed",
      error_code: "faq_suggestion_source_changed",
    });
  });

  it("ends in failed when the retry budget is exhausted", async () => {
    const seeded = await seedRun();
    await database.query(
      "update faq_suggestion_runs set max_attempts=1 where id=$1",
      [seeded.runId],
    );
    const claimed = await db.claimFaqSuggestionRun("faq-worker-exhausted");
    await db.failFaqSuggestionRun(
      seeded.runId,
      "faq-worker-exhausted",
      claimed!.leaseToken,
      "cli_timeout",
      true,
    );
    const run = await database.query<{ status: string; completed_at: string | null }>(
      "select status,completed_at from faq_suggestion_runs where id=$1",
      [seeded.runId],
    );
    expect(run.rows[0]?.status).toBe("failed");
    expect(run.rows[0]?.completed_at).not.toBeNull();
  });
});
