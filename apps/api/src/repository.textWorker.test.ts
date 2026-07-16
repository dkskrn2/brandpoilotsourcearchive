import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository";

type SqlCall = [sql: string, values?: unknown[]];

function findSqlCall(calls: ReadonlyArray<readonly unknown[]>, predicate: (sql: string) => boolean): SqlCall | undefined {
  for (const [sql, values] of calls) {
    if (typeof sql === "string" && predicate(sql)) {
      return [sql, Array.isArray(values) ? values : undefined];
    }
  }
  return undefined;
}

const renderedResult = {
  deliveryFormat: "threads_text",
  promptVersion: "worker-threads.v1",
  title: "판매 전에 확인할 것",
  text: "고객이 상품을 이해하는 순서부터 확인하세요.",
  sourceMode: "direct_url",
  fetchStatus: "fetched",
  model: "codex-cli"
};

describe("Threads text worker repository", () => {
  it("claims only queued Threads text render jobs", async () => {
    const query = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("update jobs job")) return {
        rowCount: 1,
        rows: [{
          id: "job-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel_output_id: "output-1",
          lease_token: "lease-1",
          payload_json: { deliveryFormat: "threads_text", promptVersion: "worker-threads.v1" },
          attempt_count: "1"
        }]
      };
      return { rowCount: 0, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query, release: vi.fn() }))
    } as any);

    await expect(repository.claimTextRenderJob("worker-1")).resolves.toMatchObject({
      id: "job-1",
      channelOutputId: "output-1"
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("job_type = 'threads_text_render'"))).toBe(true);
  });

  it("terminalizes expired text jobs that exhausted their attempts before claiming", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("text_render_job_attempts_exhausted")) {
        return { rowCount: 1, rows: [{ channel_output_id: "output-expired" }] };
      }
      if (sql.includes("update jobs job")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query, release: vi.fn() }))
    } as any);

    await expect(repository.claimTextRenderJob("worker-1")).resolves.toBeNull();

    const terminalOutput = findSqlCall(query.mock.calls, (sql) => sql.includes("update channel_outputs"));
    expect(terminalOutput?.[1]).toEqual([
      ["output-expired"],
      "text_render_job_attempts_exhausted",
      "text_render_job_attempts_exhausted"
    ]);
    expect(terminalOutput?.[0]).toContain("status = 'generation_failed'");
    const outputIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes("update channel_outputs"));
    const claimIndex = query.mock.calls.findIndex(([sql]) => String(sql).includes("update jobs job"));
    expect(outputIndex).toBeGreaterThan(-1);
    expect(outputIndex).toBeLessThan(claimIndex);
  });

  it("stores worker text and leaves manual-review content out of the publish queue", async () => {
    const clientQuery = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs job")) return {
        rowCount: 1,
        rows: [{
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel_output_id: "output-1",
          output_status: "generating",
          topic_publish_group_id: "group-1",
          brand_channel_id: "threads-channel-1",
          auto_approval_enabled: false
        }]
      };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await expect(repository.completeTextRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      result: renderedResult
    })).resolves.toEqual({ id: "job-1", status: "succeeded" });

    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("update channel_outputs"), [
      renderedResult.title,
      renderedResult.text,
      expect.stringContaining('"sourceMode":"direct_url"'),
      "pending_review",
      "output-1"
    ]);
    const outputUpdate = String(clientQuery.mock.calls.find(([sql]) => String(sql).includes("update channel_outputs"))?.[0]);
    expect(outputUpdate).toContain("approved_at = case when status = 'generating' and $4 = 'auto_approved' then now()");
    expect(outputUpdate).not.toContain("threads_content_pending");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into publish_queue"))).toBe(false);
  });

  it("queues an auto-approved Threads result once", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs job")) return {
        rowCount: 1,
        rows: [{
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel_output_id: "output-1",
          output_status: "generating",
          topic_publish_group_id: "group-1",
          brand_channel_id: "threads-channel-1",
          auto_approval_enabled: true
        }]
      };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await repository.completeTextRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      result: renderedResult
    });

    const queueInsert = clientQuery.mock.calls.find(([sql]) => String(sql).includes("insert into publish_queue"));
    expect((queueInsert as unknown[] | undefined)?.[1]).toEqual([
      "workspace-1",
      "brand-1",
      "output-1",
      "group-1",
      "threads-channel-1",
      "auto",
      "auto:output-1"
    ]);
  });

  it("leaves the output generating while a failed text job can retry", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("update jobs")) {
        return { rowCount: 1, rows: [{ id: "job-1", status: "queued", channel_output_id: "output-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await expect(repository.failTextRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      error: "temporary text runner outage",
      retryable: true,
      retryAfterMs: 5_000
    })).resolves.toEqual({ id: "job-1", status: "queued" });

    const jobUpdate = findSqlCall(clientQuery.mock.calls, (sql) => sql.includes("update jobs"));
    expect(jobUpdate?.[0]).toContain("locked_until > now()");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("update channel_outputs"))).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith("commit");
  });

  it("rejects an expired text worker lease without changing the job or output", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("update jobs")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await expect(repository.failTextRenderJob("job-1", {
      workerId: "stale-worker",
      leaseToken: "stale-lease",
      error: "late failure",
      retryable: false,
      retryAfterMs: 0
    })).rejects.toThrow("text_render_job_lease_invalid");

    const jobUpdate = findSqlCall(clientQuery.mock.calls, (sql) => sql.includes("update jobs"));
    expect(jobUpdate?.[0]).toContain("locked_until > now()");
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("update channel_outputs"))).toBe(false);
    expect(clientQuery).toHaveBeenCalledWith("rollback");
    expect(clientQuery).not.toHaveBeenCalledWith("commit");
  });

  it("marks the linked output generation failed when text retries are exhausted", async () => {
    const unsafeMessage = `text runner failed\u0000${"x".repeat(2_100)}`;
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("update jobs")) {
        return { rowCount: 1, rows: [{ id: "job-1", status: "failed", channel_output_id: "output-1" }] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await expect(repository.failTextRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      error: unsafeMessage,
      retryable: false,
      retryAfterMs: 0
    })).resolves.toEqual({ id: "job-1", status: "failed" });

    const outputUpdate = findSqlCall(clientQuery.mock.calls, (sql) => sql.includes("update channel_outputs"));
    expect(String(outputUpdate?.[0])).toContain("status = 'generation_failed'");
    expect(String(outputUpdate?.[0])).toContain("'{generationError}'");
    expect(String(outputUpdate?.[0])).toContain("jsonb_build_object('code', $2, 'message', $3, 'failedAt', now())");
    expect(String(outputUpdate?.[0])).toContain("block_reasons ? 'generation_failed'");
    expect(outputUpdate?.[1]?.[0]).toEqual(["output-1"]);
    expect(outputUpdate?.[1]?.[1]).toBe("text_render_failed");
    expect(String(outputUpdate?.[1]?.[2])).not.toContain("\u0000");
    expect(String(outputUpdate?.[1]?.[2]).length).toBeLessThanOrEqual(2_000);
    expect(clientQuery).toHaveBeenCalledWith("commit");
  });
});
