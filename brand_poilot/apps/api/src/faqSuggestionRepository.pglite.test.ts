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
    if (sql.startsWith("-- requires: pgvector")
      || file === "027_wiki_search_v2.sql"
      || file >= "075_") continue;
    await database.exec(sql);
  }
  const faqMigration = await readFile(
    resolve(migrationDirectory, "078_faq_utterance_matching.sql"),
    "utf8",
  );
  const ownershipBoundary = faqMigration.lastIndexOf("\ndo $$\ndeclare\n  schema_owner_role_name");
  if (ownershipBoundary < 0) throw new Error("faq_pglite_ownership_boundary_missing");
  await database.exec(`${faqMigration.slice(0, ownershipBoundary)}\ncommit;`);
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
         answer, evidence_json, confidence, example_utterances
       ) values ($1, $2, $3, $4, 'shipping', $5, $6, $7::jsonb, 0.91, $8)`,
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
        [`배송 언제 와요? ${position}`, `발송 일정 ${position}`, `언제 보내나요? ${position}`],
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
  it("installs tenant-safe utterance suggestion and confirmation storage", async () => {
    const scope = await seedBrand();
    const schema = await (database as PGlite).query<{
      manual_aliases: string[];
      example_utterances: string[];
      run_kind: string;
      alias_results_table: string | null;
      confirmations_table: string | null;
    }>(
      `select
         entry.manual_aliases,
         item.example_utterances,
         run.run_kind,
         to_regclass('public.faq_alias_suggestion_results')::text as alias_results_table,
         to_regclass('public.dm_faq_confirmations')::text as confirmations_table
       from knowledge_entries entry
       cross join faq_suggestion_items item
       cross join faq_suggestion_runs run
       where false`,
    );
    expect(schema.rows).toEqual([]);
    const relations = await (database as PGlite).query<{
      alias_results_table: string | null;
      confirmations_table: string | null;
    }>(
      `select
         to_regclass('public.faq_alias_suggestion_results')::text as alias_results_table,
         to_regclass('public.dm_faq_confirmations')::text as confirmations_table`,
    );
    expect(relations.rows[0]).toEqual({
      alias_results_table: "faq_alias_suggestion_results",
      confirmations_table: "dm_faq_confirmations",
    });

    const defaults = await (database as PGlite).query<{
      manual_aliases: string[];
      run_kind: string;
    }>(
      `with entry as (
         insert into knowledge_entries (
           workspace_id, brand_id, normalized_question, question, answer,
           entry_type, title, content, origin, status, enabled, direct_reply_enabled
         ) values ($1, $2, '배송 문의', '배송 문의', '배송 답변',
           'faq', '배송 문의', '배송 답변', 'manual', 'active', true, true)
         returning manual_aliases
       ), run as (
         insert into faq_suggestion_runs (
           workspace_id, brand_id, input_fingerprint, source_snapshot_json,
           created_by_user_id
         ) values ($1, $2, $3, $4::jsonb, $5)
         returning run_kind
       )
       select entry.manual_aliases, run.run_kind from entry cross join run`,
      [
        scope.workspaceId,
        scope.brandId,
        "a".repeat(64),
        JSON.stringify({
          contractVersion: "faq-suggestion-sources.v1",
          sources: [{
            sourceType: "brand_core",
            sourceId: scope.coreId,
            contentHash: "b".repeat(64),
            label: "브랜드 코어",
          }],
        }),
        scope.actorUserId,
      ],
    );
    expect(defaults.rows).toEqual([{ manual_aliases: [], run_kind: "full_faq" }]);
  });

  it("rejects cross-tenant alias suggestion targets", async () => {
    const owner = await seedBrand();
    const attacker = await seedBrand();
    const entryId = randomUUID();
    const inserted = await (database as PGlite).query<{ updated_at: string }>(
      `insert into knowledge_entries (
         id, workspace_id, brand_id, normalized_question, question, answer,
         entry_type, title, content, origin, status, enabled, direct_reply_enabled
       ) values ($1, $2, $3, '운영시간', '운영시간', '오전 9시입니다.',
         'faq', '운영시간', '오전 9시입니다.', 'manual', 'active', true, true)
       returning updated_at`,
      [entryId, owner.workspaceId, owner.brandId],
    );

    await expect((database as PGlite).query(
      `insert into faq_suggestion_runs (
         workspace_id, brand_id, input_fingerprint, source_snapshot_json,
         created_by_user_id, run_kind, target_knowledge_entry_id,
         target_knowledge_entry_updated_at
       ) values ($1, $2, $3, $4::jsonb, $5, 'alias_only', $6, $7)`,
      [
        attacker.workspaceId,
        attacker.brandId,
        "c".repeat(64),
        JSON.stringify({
          contractVersion: "faq-suggestion-sources.v1",
          sources: [{
            sourceType: "faq",
            sourceId: entryId,
            contentHash: "d".repeat(64),
            label: "운영시간",
          }],
        }),
        attacker.actorUserId,
        entryId,
        inserted.rows[0]!.updated_at,
      ],
    )).rejects.toThrow(/foreign key|violates/i);
  });

  it("limits stored FAQ utterance arrays to eight entries", async () => {
    const scope = await seedBrand();
    const run = await repository.createFaqSuggestionRun(scope);
    const tooMany = Array.from({ length: 9 }, (_, index) => `표현 ${index + 1}`);

    await expect((database as PGlite).query(
      `insert into faq_suggestion_items (
         workspace_id, brand_id, run_id, position, category, question,
         answer, evidence_json, confidence, example_utterances
       ) values ($1, $2, $3, 0, 'service', '문의', '답변', $4::jsonb, 0.9, $5)`,
      [
        scope.workspaceId,
        scope.brandId,
        run.run.id,
        JSON.stringify([{
          sourceType: "brand_core",
          sourceId: scope.coreId,
          label: "브랜드 코어",
        }]),
        tooMany,
      ],
    )).rejects.toThrow(/check constraint|violates/i);

    await expect((database as PGlite).query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, question, answer,
         entry_type, title, content, origin, status, enabled,
         direct_reply_enabled, manual_aliases
       ) values ($1, $2, '문의', '문의', '답변', 'faq', '문의', '답변',
         'manual', 'active', true, true, $3)`,
      [scope.workspaceId, scope.brandId, tooMany],
    )).rejects.toThrow(/check constraint|violates/i);
  });

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
      exampleUtterances: ["배송 언제 와요?", "언제 발송해요?", "발송 일정 알려줘"],
      expectedUpdatedAt: item.updatedAt,
    });
    expect(edited.question).toBe("배송은 언제 시작하나요?");
    expect(edited.exampleUtterances).toEqual([
      "배송 언제 와요?",
      "언제 발송해요?",
      "발송 일정 알려줘",
    ]);

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
      exampleUtterances: ["배송 언제 와요?", "언제 발송해요?", "발송 일정 알려줘"],
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
      manual_aliases: string[];
      provenance_json: { source: string; runId: string; itemId: string };
    }>(
      `select origin, status, enabled, direct_reply_enabled, manual_aliases, provenance_json
         from knowledge_entries where id = $1`,
      [approved.item.approvedKnowledgeEntryId],
    );
    expect(stored.rows[0]).toMatchObject({
      origin: "manual",
      status: "active",
      enabled: true,
      direct_reply_enabled: true,
      manual_aliases: ["배송 언제 와요?", "언제 발송해요?", "발송 일정 알려줘"],
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

  it("marks a proposed expression that collides with an existing FAQ alias as duplicate", async () => {
    const scope = await seedBrand();
    const run = await makeReviewRun(scope);
    const item = run.items[0]!;
    const existingId = randomUUID();
    await (database as PGlite).query(
      `insert into knowledge_entries (
         id, workspace_id, brand_id, normalized_question, question, answer,
         entry_type, title, content, origin, status, enabled, direct_reply_enabled,
         aliases
       ) values ($1, $2, $3, '영업시간', '영업시간이 어떻게 되나요?', '평일 9시부터 운영합니다.',
         'faq', '영업시간이 어떻게 되나요?', '평일 9시부터 운영합니다.',
         'manual', 'active', true, true, $4)`,
      [existingId, scope.workspaceId, scope.brandId, ["배송 언제 와요?"]],
    );
    const edited = await repository.updateFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      category: item.category,
      question: item.question,
      answer: item.answer,
      exampleUtterances: ["배송 언제 와요?", "발송일 알려줘", "언제 보내요?"],
      expectedUpdatedAt: item.updatedAt,
    });

    const approved = await repository.approveFaqSuggestionItem({
      ...scope,
      runId: run.id,
      itemId: item.id,
      expectedUpdatedAt: edited.updatedAt,
    });
    expect(approved.item).toMatchObject({
      status: "duplicate",
      duplicateOfKnowledgeEntryId: existingId,
    });
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

  it("creates, reads, and applies an alias-only run without changing FAQ content", async () => {
    const scope = await seedBrand();
    const faqId = randomUUID();
    await (database as PGlite).query(
      `insert into knowledge_entries (
         id, workspace_id, brand_id, normalized_question, question, answer,
         entry_type, title, content, origin, status, enabled, direct_reply_enabled
       ) values ($1, $2, $3, '운영시간', '운영시간이 어떻게 되나요?', '평일 9시부터 운영합니다.',
         'faq', '운영시간이 어떻게 되나요?', '평일 9시부터 운영합니다.',
         'manual', 'active', true, true)`,
      [faqId, scope.workspaceId, scope.brandId],
    );

    const created = await repository.createFaqAliasSuggestionRun({ ...scope, itemId: faqId });
    expect(created.created).toBe(true);
    expect(created.run).toMatchObject({
      status: "queued",
      targetKnowledgeEntryId: faqId,
      exampleUtterances: null,
    });
    const reused = await repository.createFaqAliasSuggestionRun({ ...scope, itemId: faqId });
    expect(reused).toMatchObject({ created: false, run: { id: created.run.id } });

    await (database as PGlite).query(
      `insert into faq_alias_suggestion_results(
         workspace_id, brand_id, run_id, knowledge_entry_id, example_utterances
       ) values($1, $2, $3, $4, $5)`,
      [scope.workspaceId, scope.brandId, created.run.id, faqId,
        ["몇 시에 열어요?", "영업시간 알려줘", "오늘 문 열어요?"]],
    );
    await (database as PGlite).query(
      "update faq_suggestion_runs set status='completed', completed_at=now() where id=$1",
      [created.run.id],
    );
    const latest = await repository.getLatestFaqAliasSuggestionRun({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      itemId: faqId,
    });
    expect(latest).toMatchObject({
      id: created.run.id,
      exampleUtterances: ["몇 시에 열어요?", "영업시간 알려줘", "오늘 문 열어요?"],
    });

    const applied = await repository.applyFaqAliasSuggestionRun({
      ...scope,
      itemId: faqId,
      runId: created.run.id,
      expectedUpdatedAt: created.run.targetKnowledgeEntryUpdatedAt,
      exampleUtterances: ["몇 시에 문 열어요?", "오늘 영업해요?", "운영 시간 알려줘"],
    });
    expect(applied).toMatchObject({
      title: "운영시간이 어떻게 되나요?",
      content: "평일 9시부터 운영합니다.",
      manualAliases: ["몇 시에 문 열어요?", "오늘 영업해요?", "운영 시간 알려줘"],
    });
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
