import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository.js";

describe("worker resource leases", () => {
  it("atomically enforces total and non-DM Codex slot limits", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("insert into worker_resource_leases")) {
        return { rowCount: 1, rows: [{ id: "lease-1", lease_token: "token-1", expires_at: new Date("2026-07-16T00:01:00.000Z") }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const release = vi.fn();
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query, release })),
    } as any, { workerResourceLimits: { total: 2, dmReserved: 1 } });

    await expect(repository.acquireWorkerResourceLease("codex_cli", "wiki-1", "wiki")).resolves.toMatchObject({ id: "lease-1" });

    const insert = query.mock.calls.find(([sql]) => String(sql).includes("insert into worker_resource_leases"));
    expect(String(insert?.[0])).toContain("active_total < $4");
    expect(String(insert?.[0])).toContain("active_non_dm < $5");
    expect(insert?.[1]).toEqual(["codex_cli", "wiki-1", "wiki", 2, 1]);
    expect(release).toHaveBeenCalledOnce();
  });
});
