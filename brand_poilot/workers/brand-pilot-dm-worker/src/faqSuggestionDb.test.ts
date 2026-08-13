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
    let sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector")
      || file === "027_wiki_search_v2.sql"
      || (file >= "075_" && file !== "078_faq_utterance_matching.sql")) continue;
    if (file === "078_faq_utterance_matching.sql") {
      const ownershipBlock = sql.lastIndexOf("\ndo $$\ndeclare\n  schema_owner_role_name");
      if (ownershipBlock < 0) throw new Error("faq_utterance_migration_fixture_invalid");
      sql = `${sql.slice(0, ownershipBlock)}\ncommit;\n`;
    }
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

async function seedAliasRun() {
  const seeded = await seedRun();
  const entryId = randomUUID();
  const question = "배송은 언제 시작하나요?";
  const answer = "결제 후 안내된 일정에 발송합니다.";
  const inserted = await database.query<{ updated_at: string }>(
    `insert into knowledge_entries (
       id,workspace_id,brand_id,normalized_question,question,answer,
       entry_type,title,content,origin,status,enabled,direct_reply_enabled
     ) values($1,$2,$3,'배송은 언제 시작하나요', $4,$5,
       'faq',$4,$5,'manual','active',true,true)
     returning updated_at`,
    [entryId, seeded.workspaceId, seeded.brandId, question, answer],
  );
  const updatedAt = new Date(inserted.rows[0]!.updated_at).toISOString();
  await database.query(
    `update faq_suggestion_runs
        set run_kind='alias_only',target_knowledge_entry_id=$1,
            target_knowledge_entry_updated_at=$2,source_snapshot_json=$3::jsonb
      where id=$4`,
    [entryId, updatedAt, JSON.stringify({
      contractVersion: "faq-suggestion-sources.v1",
      sources: [{
        sourceType: "faq",
        sourceId: entryId,
        contentHash: hash({ question, answer }),
        label: question,
      }],
    }), seeded.runId],
  );
  return { ...seeded, entryId, question, answer, updatedAt };
}

describe("FAQ suggestion DB leases", () => {
  it("claims with a token, reloads tenant sources, and requires the token for heartbeat", async () => {
    const seeded = await seedRun();
    const claimed = await db.claimFaqSuggestionRun("faq-worker-1");
    expect(claimed).toMatchObject({
      contractVersion: "faq-suggestion-input.v2",
      mode: "full_faq",
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
          exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
        }],
        rejections: [],
      },
    );
    const run = await database.query<{ status: string; lease_owner: string | null }>(
      "select status,lease_owner from faq_suggestion_runs where id=$1",
      [seeded.runId],
    );
    expect(run.rows[0]).toEqual({ status: "review_ready", lease_owner: null });
    const items = await database.query<{ question: string; example_utterances: string[] }>(
      "select question,example_utterances from faq_suggestion_items where run_id=$1",
      [seeded.runId],
    );
    expect(items.rows).toEqual([{
      question: "배송은 언제 시작하나요?",
      example_utterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
    }]);
  });

  it("claims and completes an alias-only run without regenerating FAQ content", async () => {
    const seeded = await seedAliasRun();

    const claimed = await db.claimFaqSuggestionRun("faq-worker-alias");
    expect(claimed).toEqual(expect.objectContaining({
      contractVersion: "faq-suggestion-input.v2",
      mode: "alias_only",
      runId: seeded.runId,
      targetFaq: {
        id: seeded.entryId,
        question: seeded.question,
        answer: seeded.answer,
        updatedAt: seeded.updatedAt,
      },
    }));

    await db.completeFaqSuggestionRun(
      seeded.runId,
      "faq-worker-alias",
      claimed!.leaseToken,
      {
        mode: "alias_only",
        exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
      },
    );
    const stored = await database.query(
      `select knowledge_entry_id,example_utterances
         from faq_alias_suggestion_results where run_id=$1`,
      [seeded.runId],
    );
    expect(stored.rows).toEqual([{
      knowledge_entry_id: seeded.entryId,
      example_utterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
    }]);
  });

  it("fails an alias-only completion when the target FAQ changed after claim", async () => {
    const seeded = await seedAliasRun();
    const claimed = await db.claimFaqSuggestionRun("faq-worker-stale-alias");
    await database.query(
      `update knowledge_entries set manual_aliases=array['새 표현'] where id=$1`,
      [seeded.entryId],
    );

    await expect(db.completeFaqSuggestionRun(
      seeded.runId,
      "faq-worker-stale-alias",
      claimed!.leaseToken,
      {
        mode: "alias_only",
        exampleUtterances: ["배송 언제 와요?", "언제 발송돼요?", "배송 일정 알려줘"],
      },
    )).rejects.toThrow("faq_suggestion_source_changed");

    const run = await database.query<{ status: string; lease_owner: string | null }>(
      "select status,lease_owner from faq_suggestion_runs where id=$1",
      [seeded.runId],
    );
    expect(run.rows).toEqual([{ status: "failed", lease_owner: null }]);
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
