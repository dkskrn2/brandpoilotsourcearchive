import { describe, expect, it, vi } from "vitest";
import { encryptCredential } from "./credentialCrypto.js";
import { parseDmWorkerResult } from "./dmTypes.js";
import { createRepository } from "./repository.js";

function fakePool(query: ReturnType<typeof vi.fn>) {
  return {
    query,
    connect: vi.fn(async () => ({ query, release: vi.fn() })),
  };
}

const directFaqId = "00000000-0000-4000-8000-000000000003";
const leaseToken = "00000000-0000-4000-8000-000000000010";

function directFaqCompletionFixture(entry: { id: string; answer: string } | null) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values });
    if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
    if (sql.includes("from jobs job") && sql.includes("instagram_dm_conversations conversation")) {
      return {
        rowCount: 1,
        rows: [{
          id: "job-1", workspace_id: "workspace-1", brand_id: "brand-1",
          payload_json: {
            conversationId: "conversation-1", turnId: "turn-1", senderId: "sender-1",
            messageId: "message-1", question: "운영 시간은?", route: "knowledge",
            policyReasonCode: "wiki_answer", forceAttentionType: null,
          },
          job_status: "running", locked_by: "worker-1", lease_token: leaseToken,
          locked_until_valid: true, conversation_id: "conversation-1", brand_channel_id: "channel-1",
          external_account_id: "ig-account-1", encrypted_payload: encryptCredential("meta-token"),
          auth_mode: "instagram_login", error_message: "error", attempt_id: null, attempt_status: null,
          attempt_decision: null,
        }],
      };
    }
    if (sql.includes("from knowledge_entries")) {
      return { rowCount: entry ? 1 : 0, rows: entry ? [entry] : [] };
    }
    if (sql.includes("from wiki_chunks")) return { rowCount: 0, rows: [] };
    if (sql.includes("insert into dm_delivery_attempts")) return { rowCount: 1, rows: [{ id: "attempt-1", status: "prepared" }] };
    if (sql.includes("set status = 'sending'")) return { rowCount: 1, rows: [{ id: "attempt-1" }] };
    return { rowCount: 1, rows: [{ id: "row-1" }] };
  });
  const sendInstagramDirectMessage = vi.fn(async () => ({ externalMessageId: "outbound-1" }));
  const repository = createRepository(
    { query, connect: vi.fn(async () => ({ query, release: vi.fn() })) } as any,
    { sendInstagramDirectMessage },
  );
  return { repository, statements, sendInstagramDirectMessage };
}

describe("DM Wiki repository", () => {
  it("creates a manual Wiki draft with nullable import provenance and its author", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from workspace_members")) return { rowCount: 1, rows: [{ role: "member" }] };
      if (sql.includes("insert into knowledge_entries")) return {
        rowCount: 1,
        rows: [{
          id: directFaqId,
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          item_type: "faq",
          title: "배송 안내",
          content: "영업일 2일 안에 발송합니다.",
          status: "draft",
          origin: "manual",
          provenance_json: { note: "상담 검토" },
          created_by_user_id: "user-1",
          approved_by_user_id: null,
          approved_at: null,
          source_kind: "faq",
          source_id: directFaqId,
          active_version_id: null,
          last_built_at: null,
          build_status: "draft",
        }],
      };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const created = await repository.createWikiItem!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "user-1" },
      {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: "배송 안내",
        content: "영업일 2일 안에 발송합니다.",
        provenance: { note: "상담 검토" },
      },
    );

    expect(created).toMatchObject({
      sourceKind: "faq",
      sourceId: directFaqId,
      status: "draft",
      origin: "manual",
      createdByUserId: "user-1",
      activeVersionId: null,
      buildStatus: "draft",
    });
    const insert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(insert?.sql).toContain("last_import_id");
    expect(insert?.sql).toContain("'manual'");
    expect(insert?.sql).toContain("'draft'");
    expect(insert?.values).toContain("user-1");
    expect(insert?.values).toContain(JSON.stringify({ note: "상담 검토" }));
  });

  it("allows members to edit drafts but requires an owner or admin to activate or deactivate", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const memberQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from workspace_members")) return { rowCount: 1, rows: [{ role: "member" }] };
      if (sql.includes("update knowledge_entries")) return {
        rowCount: 1,
        rows: [{
          id: directFaqId,
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          item_type: "faq",
          title: "수정 배송",
          content: "수정 내용",
          status: "draft",
          origin: "manual",
          provenance_json: {},
          created_by_user_id: "user-1",
          approved_by_user_id: null,
          approved_at: null,
          source_kind: "faq",
          source_id: directFaqId,
          active_version_id: null,
          last_built_at: null,
          build_status: "draft",
        }],
      };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePool(memberQuery) as any);

    await expect(repository.updateWikiItem!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "user-1", itemId: directFaqId },
      { title: "수정 배송", content: "수정 내용" },
    )).resolves.toMatchObject({ status: "draft", title: "수정 배송" });
    await expect(repository.updateWikiItem!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "user-1", itemId: directFaqId },
      { status: "active" },
    )).rejects.toThrow("wiki_item_approval_forbidden");
    expect(statements.some((statement) => statement.sql.includes("insert into wiki_build_requests"))).toBe(false);
  });

  it("keeps issue resolution pending until an admin-linked source reaches an active build", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from workspace_members")) return { rowCount: 1, rows: [{ role: "admin" }] };
      if (sql.includes("from wiki_issues") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "issue-1", detail_json: {}, status: "open" }] };
      }
      if (sql.includes("from knowledge_entries") && sql.includes("source_id")) {
        return { rowCount: 1, rows: [{ source_id: directFaqId }] };
      }
      if (sql.includes("update wiki_issues")) return {
        rowCount: 1,
        rows: [{
          id: "issue-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          issue_type: "knowledge_gap",
          severity: "warning",
          status: "pending_build",
          question: "제주 배송",
          detail_json: {
            resolutionSourceKind: "faq",
            resolutionSourceId: directFaqId,
            resolutionRequestedByUserId: "admin-1",
          },
          source_kind: "faq",
          source_id: directFaqId,
          active_version_id: "active-v1",
          last_built_at: new Date("2026-07-26T00:00:00.000Z"),
          build_status: "pending",
          resolved_at: null,
        }],
      };
      if (sql.includes("insert into wiki_build_requests")) {
        return { rowCount: 1, rows: [{ id: "request-1", status: "pending" }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.resolveWikiIssue!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "admin-1", issueId: "issue-1" },
      { sourceKind: "faq", sourceId: directFaqId },
    );

    expect(result).toMatchObject({
      status: "pending_build",
      sourceKind: "faq",
      sourceId: directFaqId,
      buildStatus: "pending",
      resolvedAt: null,
    });
    const update = statements.find((statement) => statement.sql.includes("update wiki_issues"));
    expect(update?.sql).not.toContain("status = 'resolved'");
    expect(update?.sql).toContain("resolutionRequestedByUserId");
    expect(statements.some((statement) => statement.sql.includes("insert into wiki_build_requests"))).toBe(true);
  });

  it.each([
    {
      label: "unapproved canonical product",
      sourceKind: "product_service" as const,
      sourceId: "00000000-0000-4000-8000-000000000021",
      eligible(sql: string) {
        return sql.includes("join product_service_versions active")
          && sql.includes("active.status = 'approved'")
          && sql.includes("item.status = 'active'");
      },
    },
    {
      label: "disabled manual FAQ",
      sourceKind: "faq" as const,
      sourceId: directFaqId,
      eligible(sql: string) {
        return sql.includes("entry.entry_type in ('faq', 'policy', 'guide')")
          && sql.includes("entry.enabled")
          && sql.includes("entry.status in ('approved', 'active')");
      },
    },
    {
      label: "superseded owned snapshot",
      sourceKind: "owned_snapshot" as const,
      sourceId: "00000000-0000-4000-8000-000000000022",
      eligible(sql: string) {
        return sql.includes("get_wiki_refresh_sources");
      },
    },
  ])("rejects a $label that the next worker build cannot collect", async ({ sourceKind, sourceId, eligible }) => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from workspace_members")) return { rowCount: 1, rows: [{ role: "admin" }] };
      if (sql.includes("from wiki_issues") && sql.includes("for update")) {
        return { rowCount: 1, rows: [{ id: "issue-1", detail_json: {}, status: "open" }] };
      }
      if (sql.includes("from product_services item")
        || sql.includes("from knowledge_entries entry")
        || sql.includes("from source_snapshots snapshot")
        || sql.includes("get_wiki_refresh_sources")) {
        return eligible(sql)
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [{ source_id: sourceId }] };
      }
      if (sql.includes("update wiki_issues")) return {
        rowCount: 1,
        rows: [{
          id: "issue-1", workspace_id: "workspace-1", brand_id: "brand-1",
          issue_type: "knowledge_gap", severity: "warning", status: "pending_build",
          question: "질문", detail_json: {}, source_kind: sourceKind, source_id: sourceId,
          active_version_id: null, last_built_at: null, build_status: "pending", resolved_at: null,
        }],
      };
      return { rowCount: 1, rows: [{ id: "request-1", status: "pending" }] };
    });
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.resolveWikiIssue!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "admin-1", issueId: "issue-1" },
      { sourceKind, sourceId },
    )).rejects.toThrow("wiki_issue_source_ineligible");
    expect(statements.some((statement) => statement.sql.includes("insert into wiki_build_requests"))).toBe(false);
  });

  it("records the admin who deactivates an approved manual source", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from workspace_members")) return { rowCount: 1, rows: [{ role: "owner" }] };
      if (sql.includes("update knowledge_entries")) return {
        rowCount: 1,
        rows: [{
          id: directFaqId,
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          item_type: "faq",
          title: "배송 안내",
          content: "배송 내용",
          status: "inactive",
          origin: "manual",
          provenance_json: { deactivatedByUserId: "owner-1" },
          created_by_user_id: "user-1",
          approved_by_user_id: null,
          approved_at: null,
          source_kind: "faq",
          source_id: directFaqId,
          active_version_id: null,
          last_built_at: null,
          build_status: "inactive",
        }],
      };
      if (sql.includes("insert into wiki_build_requests")) {
        return { rowCount: 1, rows: [{ id: "request-1", status: "pending" }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.updateWikiItem!(
      { workspaceId: "workspace-1", brandId: "brand-1", actorUserId: "owner-1", itemId: directFaqId },
      { status: "inactive" },
    )).resolves.toMatchObject({ status: "inactive" });

    const update = statements.find((statement) => statement.sql.includes("update knowledge_entries"));
    expect(update?.sql).toContain("deactivatedByUserId");
    expect(update?.values).toContain("owner-1");
  });

  it("lists product-library sources first and reports failed refreshes as stale", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("with active_version as")) return {
        rowCount: 2,
        rows: [
          {
            id: "product-1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            item_type: "product",
            title: "정기 구독",
            content: "승인된 제품 설명",
            status: "read_only",
            origin: "product_service",
            provenance_json: {},
            created_by_user_id: null,
            approved_by_user_id: "admin-1",
            approved_at: new Date("2026-07-25T00:00:00.000Z"),
            source_kind: "product_service",
            source_id: "product-1",
            active_version_id: "version-1",
            last_built_at: new Date("2026-07-26T00:00:00.000Z"),
            build_status: "stale",
          },
          {
            id: "faq-1",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            item_type: "faq",
            title: "배송",
            content: "이틀",
            status: "inactive",
            origin: "manual",
            provenance_json: {},
            created_by_user_id: "member-1",
            approved_by_user_id: null,
            approved_at: null,
            source_kind: "faq",
            source_id: "faq-1",
            active_version_id: null,
            last_built_at: null,
            build_status: "inactive",
          },
        ],
      };
      return {
        rowCount: 1,
        rows: [{
          active_version_id: "version-1",
          last_built_at: new Date("2026-07-26T00:00:00.000Z"),
          request_status: "failed",
          item_count: 2,
          issue_count: 1,
          has_draft: false,
        }],
      };
    });
    const repository = createRepository(fakePool(query) as any);

    const items = await repository.listWikiItems!({ workspaceId: "workspace-1", brandId: "brand-1" });
    expect(items.map((entry) => [entry.sourceKind, entry.buildStatus])).toEqual([
      ["product_service", "stale"],
      ["faq", "inactive"],
    ]);
    await expect(repository.summarizeWiki!({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toMatchObject({
        state: "stale",
        activeVersionId: "version-1",
        buildStatus: "stale",
        itemCount: 2,
        issueCount: 1,
      });
    const listSql = String(query.mock.calls[0]?.[0]);
    expect(listSql).toContain("order by case when sources.source_kind = 'product_service' then 0");
    expect(listSql).not.toContain("entry.entry_type in ('product', 'service'");
  });

  it("counts active approved canonical products in the Wiki aggregate without legacy projections", async () => {
    const query = vi.fn(async (_sql: string) => ({
      rowCount: 1,
      rows: [{
        active_version_id: null,
        last_built_at: null,
        request_status: null,
        item_count: 1,
        issue_count: 0,
        has_draft: false,
      }],
    }));
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.summarizeWiki!({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toMatchObject({ state: "building", buildStatus: "pending", itemCount: 1 });

    const summarySql = String(query.mock.calls[0]?.[0]);
    expect(summarySql).toContain("from product_services item");
    expect(summarySql).toContain("join product_service_versions active");
    expect(summarySql).toContain("active.status = 'approved'");
    expect(summarySql).toContain("item.status = 'active'");
    expect(summarySql).toContain("entry.status <> 'legacy_projection'");
  });

  it("reports an empty Wiki aggregate as idle instead of building", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        active_version_id: null,
        last_built_at: null,
        request_status: null,
        item_count: 0,
        issue_count: 0,
        has_draft: false,
      }],
    }));
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.summarizeWiki!({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toEqual({
        state: "empty",
        activeVersionId: null,
        lastBuiltAt: null,
        buildStatus: "idle",
        itemCount: 0,
        issueCount: 0,
      });
  });

  it("does not claim a second DM job for the same brand", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    await repository.claimDmReplyJob("dm-worker-2");

    const claim = statements.find((sql) => sql.includes("with candidate as") && sql.includes("instagram_dm_reply"));
    expect(claim).toContain("active.brand_id = job.brand_id");
    expect(claim).toContain("active.status = 'running'");
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("reports approved Brand Core and active-or-stale Wiki readiness without legacy projections", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      return {
        rowCount: 1,
        rows: [{
          enabled: false,
          fallback_message: "fallback",
          error_message: "error",
          brand_core_ready: true,
          wiki_ready: true,
          wiki_status: "stale",
          message_permission_ready: true,
          worker_online: true,
        }],
      };
    });
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.getInstagramDmSettings("brand-1")).resolves.toMatchObject({
      brandCoreReady: true,
      wikiReady: true,
      wikiStatus: "stale",
      messagePermissionReady: true,
      workerStatus: "online",
    });

    const sql = statements[0];
    expect(sql).toContain("from brand_profiles profile");
    expect(sql).toContain("join brand_core_versions core");
    expect(sql).toContain("core.status = 'approved'");
    expect(sql).toContain("core.workspace_id = brand.workspace_id");
    expect(sql).toContain("core.brand_id = brand.id");
    expect(sql).toContain("version.status = 'active'");
    expect(sql).toContain("entry.status = 'legacy_projection'");
  });

  it("does not activate automatic replies without every repository readiness gate", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select settings.enabled")) {
        return {
          rowCount: 1,
          rows: [{
            enabled: false,
            fallback_message: "fallback",
            error_message: "error",
            brand_core_ready: false,
            wiki_ready: true,
            wiki_status: "active",
            message_permission_ready: true,
            worker_online: true,
          }],
        };
      }
      return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
    });
    const repository = createRepository(fakePool(query) as any);

    await expect(repository.updateInstagramDmSettings("brand-1", { enabled: true }))
      .rejects.toThrow("dm_activation_blocked");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("insert into instagram_dm_settings"))).toBe(false);
  });

  it("resolves a direct FAQ answer from the owned enabled entry and ignores worker answer text", async () => {
    const fixture = directFaqCompletionFixture({ id: directFaqId, answer: "평일 9시부터 18시까지 운영합니다." });
    const result = parseDmWorkerResult({
      decision: "answer", answer: "worker text must be ignored", wikiChunkIds: [],
      knowledgeEntryId: directFaqId, confidence: 0.91, reasonCode: "direct_faq",
      needsAttention: false, reason: "embedding_direct_faq",
    });

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      workerId: "worker-1", leaseToken, result,
    })).resolves.toMatchObject({ status: "succeeded", decision: "answer" });

    const entryLookup = fixture.statements.find((statement) => statement.sql.includes("from knowledge_entries"));
    expect(entryLookup?.sql).toContain("workspace_id = $2");
    expect(entryLookup?.sql).toContain("brand_id = $3");
    expect(entryLookup?.sql).toContain("entry_type = 'faq'");
    expect(entryLookup?.sql).toContain("enabled");
    expect(entryLookup?.sql).toContain("direct_reply_enabled");
    expect(entryLookup?.values).toEqual([directFaqId, "workspace-1", "brand-1"]);
    const delivery = fixture.statements.find((statement) => statement.sql.includes("insert into dm_delivery_attempts"));
    expect(delivery?.values).toContain("평일 9시부터 18시까지 운영합니다.");
    expect(delivery?.values).not.toContain("worker text must be ignored");
  });

  it("rejects direct FAQ completion when the owned enabled entry cannot be resolved", async () => {
    const fixture = directFaqCompletionFixture(null);
    const result = parseDmWorkerResult({
      decision: "answer", answer: null, wikiChunkIds: [], knowledgeEntryId: directFaqId,
      confidence: 1, reasonCode: "direct_faq", needsAttention: false, reason: "payload_exact_faq",
    });

    await expect(fixture.repository.completeDmReplyJob("job-1", {
      workerId: "worker-1", leaseToken, result,
    })).rejects.toThrow("dm_knowledge_entry_not_owned");
    expect(fixture.sendInstagramDirectMessage).not.toHaveBeenCalled();
  });

  it("upserts only the final valid duplicate FAQ row and coalesces one Wiki build request", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("select workspace_id from brands")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into knowledge_imports")) return {
        rowCount: 1,
        rows: [{
          id: "import-1",
          file_name: values[2],
          status: "succeeded",
          result_json: JSON.parse(String(values[4])),
          created_at: new Date("2026-07-14T00:00:00.000Z"),
        }],
      };
      if (sql.includes("insert into wiki_build_requests")) return { rowCount: 1, rows: [{ id: "request-1", status: "pending" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.createKnowledgeImport("brand-1", {
      fileName: "faq.csv",
      fileBase64: Buffer.from("question,answer\n운영 시간,09-18\n운영   시간,10-19\n,잘못된 행\n").toString("base64"),
    });

    expect(result).toMatchObject({ entryType: "faq", totalRows: 3, validRows: 2, duplicateRows: 1, invalidRows: 1, updatedRows: 1 });
    const entryInsert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(entryInsert?.values).toContain("10-19");
    expect(entryInsert?.values).not.toContain("09-18");
    expect(entryInsert?.sql).toContain("on conflict (brand_id, normalized_question)");
    const buildRequest = statements.find((statement) => statement.sql.includes("insert into wiki_build_requests"));
    expect(buildRequest?.sql).toContain("requested_revision");
    expect(buildRequest?.sql).toContain("interval '2 minutes'");
    expect(buildRequest?.values).toContain("brand-1");
  });

  it("upserts products by a brand-scoped product key and coalesces a build without checking DM settings", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("select workspace_id from brands")) return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      if (sql.includes("insert into knowledge_imports")) return {
        rowCount: 1,
        rows: [{
          id: "import-2",
          file_name: values[2],
          status: "succeeded",
          result_json: JSON.parse(String(values[4])),
          created_at: new Date("2026-07-14T00:00:00.000Z"),
        }],
      };
      if (sql.includes("insert into wiki_build_requests")) return { rowCount: 1, rows: [{ id: "request-2", status: "pending" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository(fakePool(query) as any);

    const result = await repository.createKnowledgeImport("brand-1", {
      entryType: "product",
      fileName: "products.csv",
      fileBase64: Buffer.from([
        "name,description,price,currency,product_url,sku",
        "Mug,Old description,28000,KRW,https://example.com/old,MUG-1",
        " mug ,New description,29000,KRW,https://example.com/new,MUG-2",
      ].join("\n")).toString("base64"),
    });

    expect(result).toMatchObject({ entryType: "product", validRows: 2, duplicateRows: 1, updatedRows: 1 });
    const entryInsert = statements.find((statement) => statement.sql.includes("insert into knowledge_entries"));
    expect(entryInsert?.sql).toContain("on conflict (brand_id, normalized_question)");
    expect(entryInsert?.values).toContain("product:mug");
    expect(entryInsert?.values).toContain("New description");
    expect(entryInsert?.values).not.toContain("Old description");
    expect(entryInsert?.values).toContain(JSON.stringify({
      price: "29000",
      currency: "KRW",
      productUrl: "https://example.com/new",
      sku: "MUG-2",
    }));
    expect(statements.some((statement) => statement.sql.includes("instagram_dm_settings"))).toBe(false);
    expect(statements.find((statement) => statement.sql.includes("insert into wiki_build_requests"))?.values).toContain("brand-1");
  });

  it("queues a manual Wiki refresh immediately in the coalesced request table", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql, values });
      if (sql.includes("select workspace_id from brands")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace-1" }] };
      }
      return { rowCount: 1, rows: [{ id: "job-1", status: "queued" }] };
    });
    const repository = createRepository(fakePool(query) as any);

    await repository.enqueueWikiRefresh("brand-1");

    const buildRequest = statements.find((statement) => statement.sql.includes("insert into wiki_build_requests"));
    expect(buildRequest?.sql).toContain("$2::uuid");
    expect(buildRequest?.sql).toContain("quiet_until");
    expect(buildRequest?.sql).toContain("now()");
  });
});
