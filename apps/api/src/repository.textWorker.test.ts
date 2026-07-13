import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository";

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
    const query = vi.fn(async () => ({
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
    }));
    const repository = createRepository({ query } as any);

    await expect(repository.claimTextRenderJob("worker-1")).resolves.toMatchObject({
      id: "job-1",
      channelOutputId: "output-1"
    });
    expect(String((query.mock.calls as unknown[][])[0]?.[0])).toContain("job_type = 'threads_text_render'");
  });

  it("stores worker text and leaves manual-review content out of the publish queue", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs job")) return {
        rowCount: 1,
        rows: [{
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel_output_id: "output-1",
          output_status: "auto_approval_blocked",
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
          output_status: "auto_approval_blocked",
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
});
