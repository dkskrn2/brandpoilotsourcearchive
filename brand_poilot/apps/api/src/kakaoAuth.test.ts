import { describe, expect, it, vi } from "vitest";
import { createKakaoAuthStore } from "./kakaoAuth.js";

function existingSessionRow() {
  return {
    user_id: "user-1",
    display_name: "사용자",
    email: "user@example.com",
    workspace_id: "workspace-1",
    workspace_name: "사용자 Brand Pilot",
    brand_id: "brand-1",
    brand_name: "내 브랜드"
  };
}

function createPool(query: ReturnType<typeof vi.fn>) {
  return {
    connect: vi.fn(async () => ({
      query,
      release: vi.fn()
    }))
  };
}

describe("createKakaoAuthStore", () => {
  it("creates all supported channel rows when creating a new user brand", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes("from user_identities")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into app_users")) return { rowCount: 1, rows: [{ id: "user-1", display_name: "사용자", email: "user@example.com" }] };
      if (sql.includes("insert into workspaces")) return { rowCount: 1, rows: [{ id: "workspace-1", name: String(params?.[0]) }] };
      if (sql.includes("insert into brands")) return { rowCount: 1, rows: [{ id: "brand-1", name: "내 브랜드" }] };
      return { rowCount: 1, rows: [] };
    });
    const store = createKakaoAuthStore(createPool(query) as any);

    const session = await store.createOrLoadUser({
      subject: "kakao-1",
      nickname: "사용자",
      email: "user@example.com",
    });

    const channelInsert = calls.find((sql) => sql.includes("insert into brand_channels"));
    const subscriptionInsertIndex = calls.findIndex((sql) => sql.includes("insert into brand_subscriptions"));
    const brandInsertIndex = calls.findIndex((sql) => sql.includes("insert into brands"));
    const commitIndex = calls.findIndex((sql) => sql === "commit");
    const workspaceInsert = query.mock.calls.find(([sql]) => sql.includes("insert into workspaces"));
    const brandInsert = query.mock.calls.find(([sql]) => sql.includes("insert into brands"));
    const subscriptionInsert = query.mock.calls.find(([sql]) => sql.includes("insert into brand_subscriptions"));
    expect(workspaceInsert?.[1]?.[0]).toBe("사용자의 모종");
    expect(String(brandInsert?.[0])).toContain("__provisional__:");
    expect(session.displayName).toBe("사용자");
    expect(session.brandName).toBe("");
    expect(channelInsert).toContain("'instagram'");
    expect(channelInsert).toContain("'threads'");
    expect(channelInsert).toContain("'x'");
    expect(channelInsert).toContain("'linkedin'");
    expect(channelInsert).toContain("'youtube'");
    expect(channelInsert).toContain("'tiktok'");
    expect(channelInsert).not.toContain("'webflow'");
    expect(subscriptionInsert?.[1]).toEqual(["brand-1"]);
    expect(String(subscriptionInsert?.[0])).toContain("'free','active'");
    expect(subscriptionInsertIndex).toBeGreaterThan(brandInsertIndex);
    expect(commitIndex).toBeGreaterThan(subscriptionInsertIndex);
  });

  it("rolls back the whole signup when the FREE subscription cannot be created", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      if (sql.includes("from user_identities")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into app_users")) return { rowCount: 1, rows: [{ id: "user-1", display_name: "사용자", email: "user@example.com" }] };
      if (sql.includes("insert into workspaces")) return { rowCount: 1, rows: [{ id: "workspace-1", name: String(params?.[0]) }] };
      if (sql.includes("insert into brands")) return { rowCount: 1, rows: [{ id: "brand-1", name: "내 브랜드" }] };
      if (sql.includes("insert into brand_subscriptions")) throw new Error("free plan unavailable");
      return { rowCount: 1, rows: [] };
    });
    const store = createKakaoAuthStore(createPool(query) as any);

    await expect(store.createOrLoadUser({
      subject: "kakao-1",
      nickname: "사용자",
      email: "user@example.com",
    })).rejects.toThrow("free plan unavailable");

    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });

  it("does not write channel rows while loading an existing Kakao user", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("from user_identities")) return { rowCount: 1, rows: [existingSessionRow()] };
      return { rowCount: 1, rows: [] };
    });
    const store = createKakaoAuthStore(createPool(query) as any);

    await store.createOrLoadUser({ subject: "kakao-1", nickname: "사용자", email: "user@example.com" });

    expect(calls.some((sql) => sql.includes("insert into brand_channels"))).toBe(false);
    expect(calls.find((sql) => sql.includes("from user_identities"))).toContain("company_name_state");
  });

  it("does not write channel rows while loading an existing session", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("from user_sessions")) return { rowCount: 1, rows: [existingSessionRow()] };
      return { rowCount: 1, rows: [] };
    });
    const store = createKakaoAuthStore({ query } as any);

    await store.getSession("session-token");

    expect(calls.some((sql) => sql.includes("insert into brand_channels"))).toBe(false);
    expect(calls.find((sql) => sql.includes("from user_sessions"))).toContain("company_name_state");
  });

  it("authorizes a content output against the channel_outputs table", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowCount: 1, rows: [{ '?column?': 1 }] }));
    const store = createKakaoAuthStore({ query } as any);

    await store.canAccessResource("user-1", "content_outputs", "output-1");

    expect(query).toHaveBeenCalledOnce();
    expect(String(query.mock.calls[0]?.[0])).toContain("from channel_outputs resource");
    expect(String(query.mock.calls[0]?.[0])).not.toContain("from content_outputs resource");
  });
});
