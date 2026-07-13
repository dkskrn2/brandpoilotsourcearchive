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
  it("creates only core channel rows when creating a new user brand", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("from user_identities")) return { rowCount: 0, rows: [] };
      if (sql.includes("insert into app_users")) return { rowCount: 1, rows: [{ id: "user-1", display_name: "사용자", email: "user@example.com" }] };
      if (sql.includes("insert into workspaces")) return { rowCount: 1, rows: [{ id: "workspace-1", name: "사용자 Brand Pilot" }] };
      if (sql.includes("insert into brands")) return { rowCount: 1, rows: [{ id: "brand-1", name: "내 브랜드" }] };
      return { rowCount: 1, rows: [] };
    });
    const store = createKakaoAuthStore(createPool(query) as any);

    await store.createOrLoadUser({ subject: "kakao-1", nickname: "사용자", email: "user@example.com" });

    const channelInsert = calls.find((sql) => sql.includes("insert into brand_channels"));
    expect(channelInsert).toContain("'instagram'");
    expect(channelInsert).toContain("'threads'");
    expect(channelInsert).not.toContain("'tiktok'");
    expect(channelInsert).not.toContain("'youtube'");
    expect(channelInsert).not.toContain("'x'");
    expect(channelInsert).not.toContain("'webflow'");
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
  });
});
