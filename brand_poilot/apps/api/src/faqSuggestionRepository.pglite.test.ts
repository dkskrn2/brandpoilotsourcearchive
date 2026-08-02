import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFaqSuggestionRepository } from "./faqSuggestionRepository.js";

let database: PGlite | undefined;
let repository: ReturnType<typeof createFaqSuggestionRepository>;

function pglitePool(db: PGlite): Pool {
  const query = async (text: string, values: unknown[] = []) => {
    const result = await db.query(text, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  };
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  repository = createFaqSuggestionRepository(pglitePool(database));
}, 90_000);

afterAll(async () => {
  await database?.close();
});

async function seedBrand(options: { withSource?: boolean; role?: "owner" | "admin" | "member" } = {}) {
  const db = database as PGlite;
  const workspaceId = randomUUID();
  const brandId = randomUUID();
  const actorUserId = randomUUID();
  const coreId = randomUUID();
  await db.query(
    `insert into app_users (id, email) values ($1, $2)`,
    [actorUserId, `faq-${actorUserId}@example.com`],
  );
  await db.query(
    `insert into workspaces (id, name, slug) values ($1, 'FAQ Workspace', $2)`,
    [workspaceId, `faq-${workspaceId}`],
  );
  await db.query(
    `insert into workspace_members (workspace_id, user_id, role, status)
     values ($1, $2, $3, 'active')`,
    [workspaceId, actorUserId, options.role ?? "owner"],
  );
  await db.query(
    `insert into brands (id, workspace_id, name) values ($1, $2, 'FAQ Brand')`,
    [brandId, workspaceId],
  );
  await db.query(
    `insert into brand_profiles (workspace_id, brand_id) values ($1, $2)`,
    [workspaceId, brandId],
  );
  if (options.withSource !== false) {
    await db.query(
      `insert into brand_core_versions (
         id, workspace_id, brand_id, version, status, core_json,
         evidence_json, review_state_json, created_by, approved_at
       ) values ($1, $2, $3, 1, 'approved', $4::jsonb, '[]'::jsonb,
         '{}'::jsonb, 'user', now())`,
      [
        coreId,
        workspaceId,
        brandId,
        JSON.stringify({
          contractVersion: 1,
          summary: { oneLine: "신뢰할 수 있는 브랜드", description: "고객 상담을 제공합니다." },
        }),
      ],
    );
    await db.query(
      `update brand_profiles set active_brand_core_id = $1
       where workspace_id = $2 and brand_id = $3`,
      [coreId, workspaceId, brandId],
    );
  }
  return { workspaceId, brandId, actorUserId, coreId };
}

async function makeReviewRun(scope: Awaited<ReturnType<typeof seedBrand>>, itemCount = 1) {
  const db = database as PGlite;
  const created = await repository.createFaqSuggestionRun(scope);
  await db.query(
    `update faq_suggestion_runs
        set status = 'review_ready', completed_at = now()
      where id = $1`,
    [created.run.id],
  );
  for (let position = 0; position < itemCount; position += 1) {
    await db.query(
      `insert into faq_suggestion_items (
         workspace_id, brand_id, run_id, position, category, question,
         answer, evidence_json, confidence
       ) values ($1, $2, $3, $4, 'shipping', $5, $6, $7::jsonb, 0.91)`,
      [
        scope.workspaceId,
        scope.brandId,
        created.run.id,
        position,
        `배송은 언제 시작하나요? ${position}`,
        `결제 후 안내된 일정에 발송합니다. ${position}`,
        JSON.stringify([{
          sourceType: "brand_core",
          sourceId: scope.coreId,
          label: "브랜드 코어",
        }]),
      ],
    );
  }
  return (await repository.getFaqSuggestionRun({
    workspaceId: scope.workspaceId,
    brandId: scope.brandId,
    runId: created.run.id,
  }))!;
}

describe("FAQ suggestion repository", () => {
  it("reuses the active run and keeps tenant reads scoped", async () => {
    const firstScope = await seedBrand();
    const secondScope = await seedBrand();
    const first = await repository.createFaqSuggestionRun(firstScope);
    const reused = await repository.createFaqSuggestionRun(firstScope);

    expect(reused.run.id).toBe(first.run.id);
    expect(reused.created).toBe(false);
    await expect(repository.getFaqSuggestionRun({
      workspaceId: secondScope.workspaceId,
      brandId: secondScope.brandId,
      runId: first.run.id,
    })).resolves.toBeNull();
  });

  it("rejects a brand without approved or active sources", async () => {
    const scope = await seedBrand({ withSource: false });
    await expect(repository.createFaqSuggestionRun(scope))
      .rejects.toThrow("faq_suggestion_sources_missing");
  });

  it("stores source descriptors and hashes without copying source content", async () => {
    const scope = await seedBrand();
    const created = await repository.createFaqSuggestionRun(scope);
    const result = await (database as PGlite).query<{ source_snapshot_json: unknown }>(
      `select source_snapshot_json from faq_suggestion_runs where id = $1`,
      [created.run.id],
    );
    const snapshot = result.rows[0]?.source_snapshot_json as {
      contractVersion: string;
      sources: Array<Record<string, unknown>>;
    };
    expect(snapshot.contractVersion).toBe("faq-suggestion-sources.v1");
    expect(snapshot.sources).toHaveLength(1);
    expect(Object.keys(snapshot.sources[0]!).sort()).toEqual([
      "contentHash",
      "label",
      "sourceId",
      "sourceType",
    ]);
    expect(snapshot.sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(snapshot)).not.toContain("고객 상담을 제공합니다");
  });

  it("keeps review edits out of knowledge_entries and enforces concurrency", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope);
    const item = run.items[0]!;
    const edited = await repository.updateFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      category: "shipping",
      question: "배송은 언제 시작하나요?",
      answer: "결제 후 안내된 일정에 발송합니다.",
      expectedUpdatedAt: item.updatedAt,
    });
    expect(edited.question).toBe("배송은 언제 시작하나요?");

    const knowledge = await (database as PGlite).query(
      `select id from knowledge_entries
       where provenance_json->>'source' = 'faq_suggestion'`,
    );
    expect(knowledge.rows).toHaveLength(0);

    await expect(repository.updateFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      category: "shipping",
      question: "오래된 수정",
      answer: "허용되지 않아야 합니다.",
      expectedUpdatedAt: item.updatedAt,
    })).rejects.toThrow("faq_suggestion_item_conflict");
  });

  it("approves edited text without a Wiki build and remains idempotent", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope);
    const item = run.items[0]!;
    const edited = await repository.updateFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      category: "shipping",
      question: "수정한 배송 질문",
      answer: "수정한 배송 답변입니다.",
      expectedUpdatedAt: item.updatedAt,
    });
    const approved = await repository.approveFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      expectedUpdatedAt: edited.updatedAt,
    });

    expect(approved.item.status).toBe("approved");
    expect(approved.wikiItem?.title).toBe("수정한 배송 질문");
    expect(approved.wikiItem?.content).toBe("수정한 배송 답변입니다.");
    const stored = await (database as PGlite).query<{
      origin: string;
      status: string;
      enabled: boolean;
      direct_reply_enabled: boolean;
      provenance_json: { source: string; runId: string; itemId: string };
    }>(
      `select origin, status, enabled, direct_reply_enabled, provenance_json
         from knowledge_entries where id = $1`,
      [approved.item.approvedKnowledgeEntryId],
    );
    expect(stored.rows[0]).toMatchObject({
      origin: "manual",
      status: "active",
      enabled: true,
      direct_reply_enabled: true,
      provenance_json: {
        source: "faq_suggestion",
        runId: run.id,
        itemId: item.id,
      },
    });
    const builds = await (database as PGlite).query(
      `select id from wiki_build_requests where brand_id = $1`,
      [scope.brandId],
    );
    const outbox = await (database as PGlite).query(
      `select id from wiki_refresh_outbox where brand_id = $1`,
      [scope.brandId],
    );
    expect(builds.rows).toHaveLength(0);
    expect(outbox.rows).toHaveLength(0);

    const repeated = await repository.approveFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      expectedUpdatedAt: edited.updatedAt,
    });
    expect(repeated.item.approvedKnowledgeEntryId)
      .toBe(approved.item.approvedKnowledgeEntryId);
  });

  it("marks an existing normalized question as duplicate", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope);
    const item = run.items[0]!;
    const existingId = randomUUID();
    await (database as PGlite).query(
      `insert into knowledge_entries (
         id, workspace_id, brand_id, normalized_question, question, answer,
         entry_type, title, content, origin, status, enabled, direct_reply_enabled
       ) values ($1, $2, $3, $4, $5, '기존 답변', 'faq', $5, '기존 답변',
         'manual', 'active', true, true)`,
      [existingId, scope.workspaceId, scope.brandId, item.question.normalize("NFKC").trim().toLowerCase(), item.question],
    );

    const result = await repository.approveFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      expectedUpdatedAt: item.updatedAt,
    });
    expect(result.item.status).toBe("duplicate");
    expect(result.item.duplicateOfKnowledgeEntryId).toBe(existingId);
  });

  it("treats a normalized-question insert race as duplicate", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope);
    const item = run.items[0]!;
    const edited = await repository.updateFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      category: "shipping",
      question: "동시 승인 질문",
      answer: "검토자가 승인한 답변입니다.",
      expectedUpdatedAt: item.updatedAt,
    });
    const competingId = randomUUID();
    const db = database as PGlite;
    await db.exec(`
      create function inject_faq_approval_conflict()
      returns trigger language plpgsql as $$
      begin
        if new.normalized_question = '동시 승인 질문'
          and new.provenance_json->>'source' = 'faq_suggestion' then
          insert into knowledge_entries (
            id, workspace_id, brand_id, normalized_question, question, answer,
            entry_type, title, content, origin, provenance_json, status,
            enabled, direct_reply_enabled
          ) values (
            '${competingId}', new.workspace_id, new.brand_id,
            new.normalized_question, new.question, '먼저 승인된 답변입니다.',
            'faq', new.question, '먼저 승인된 답변입니다.', 'manual',
            '{}'::jsonb, 'active', true, true
          );
        end if;
        return new;
      end;
      $$;
      create trigger inject_faq_approval_conflict_trigger
      before insert on knowledge_entries
      for each row execute function inject_faq_approval_conflict();
    `);

    try {
      const result = await repository.approveFaqSuggestionItem({
        ...scope,
        runId: run.id,
        itemId: item.id,
        expectedUpdatedAt: edited.updatedAt,
      });
      expect(result.item.status).toBe("duplicate");
      expect(result.item.duplicateOfKnowledgeEntryId).toBe(competingId);
      expect(result.wikiItem?.content).toBe("먼저 승인된 답변입니다.");
    } finally {
      await db.exec(`
        drop trigger if exists inject_faq_approval_conflict_trigger on knowledge_entries;
        drop function if exists inject_faq_approval_conflict();
      `);
    }
  });

  it("completes a run only after every item is terminal", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope, 2);
    const first = await repository.dismissFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: run.items[0]!.id,
      expectedUpdatedAt: run.items[0]!.updatedAt,
    });
    expect(first.status).toBe("dismissed");
    await expect(repository.dismissFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: run.items[0]!.id,
      expectedUpdatedAt: run.items[0]!.updatedAt,
    })).resolves.toMatchObject({ status: "dismissed", id: run.items[0]!.id });
    expect((await repository.getFaqSuggestionRun({ ...scope, runId: run.id }))?.status)
      .toBe("review_ready");

    await repository.dismissFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: run.items[1]!.id,
      expectedUpdatedAt: run.items[1]!.updatedAt,
    });
    expect((await repository.getFaqSuggestionRun({ ...scope, runId: run.id }))?.status)
      .toBe("completed");
  });
});
