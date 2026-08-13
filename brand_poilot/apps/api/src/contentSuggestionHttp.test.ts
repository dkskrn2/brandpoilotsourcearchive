import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ContentSuggestionRepository } from "./contentSuggestionRepository.js";
import type { ContentSuggestionOAuthConfig } from "./contentSuggestionOAuth.js";

const brandId = "11111111-1111-4111-8111-111111111111";
const suggestion = {
  id: "22222222-2222-4222-8222-222222222222",
  subcategoryCode: "domestic_travel",
  subcategoryName: "국내여행",
  intent: "trend" as const,
  title: "실내 여행 코스",
  whyNow: "비 예보가 이어집니다.",
  contentBrief: "실내 동선으로 구성합니다.",
};

function contentRepository(): ContentSuggestionRepository {
  return {
    getScope: vi.fn(async () => ({
      contractVersion: "content-suggestion-scope.v1" as const,
      generationDate: "2026-08-09",
      timezone: "Asia/Seoul" as const,
      category: { code: "travel_tourism", name: "여행·관광" },
      subcategories: [{ code: "domestic_travel", name: "국내여행" }],
      intents: ["informational", "trend"] as Array<"informational" | "trend">,
      maxItemsPerSubcategoryIntent: 2 as const,
      maxSourcesPerItem: 3 as const,
    })),
    publish: vi.fn(async (input) => ({
      contractVersion: "content-suggestion-publish-result.v1" as const,
      status: "published" as const,
      batchId: "33333333-3333-4333-8333-333333333333",
      savedCount: input.items.length,
      generationDate: input.generationDate,
    })),
    listForBrand: vi.fn(async () => ({
      category: { code: "travel_tourism", name: "여행·관광" },
      personal: [suggestion],
      general: [],
    })),
    getForBrand: vi.fn(async (_brandId, suggestionId) => (
      suggestionId === suggestion.id ? suggestion : null
    )),
  };
}

const oauthConfig: ContentSuggestionOAuthConfig = {
  issuer: "https://login.example.com/",
  jwksUri: "https://login.example.com/.well-known/jwks.json",
  audience: "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp",
  resource: "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp",
  allowedSubjects: ["11111111-1111-4111-8111-111111111111"],
};

function appWithSuggestions(options: { permitted?: boolean; oauth?: boolean } = {}) {
  const suggestions = contentRepository();
  const kakaoAuth = {
    getSession: vi.fn(async (token: string) => token === "session-token" ? {
      userId: "user-1",
      displayName: "사용자",
      email: "user@example.com",
      workspaceId: "workspace-1",
      workspaceName: "워크스페이스",
      brandId,
      brandName: "브랜드",
    } : null),
    canAccessBrand: vi.fn(async () => options.permitted ?? true),
  };
  const app = createServer({
    repository: { health: vi.fn(async () => ({ database: "ok" })) } as any,
    kakaoAuth: kakaoAuth as any,
    contentSuggestions: {
      repository: suggestions,
      ...(options.oauth === false ? {} : {
        oauth: {
          config: oauthConfig,
          verifier: {
            verifyAccessToken: vi.fn(async (token: string) => {
              if (token !== "valid-access-token") throw new Error("invalid_token");
              return {
                token,
                clientId: "chatgpt-scheduled-task",
                scopes: ["email"],
                resource: new URL(oauthConfig.resource),
              };
            }),
          },
        },
      }),
    },
    logger: false,
  });
  return { app, suggestions, kakaoAuth };
}

describe("content suggestion HTTP routes", () => {
  it.each([
    undefined,
    "Bearer invalid-token",
    "Basic credentials",
  ])("returns an OAuth challenge for an invalid MCP credential: %s", async (authorization) => {
    const { app } = appWithSuggestions();
    const response = await app.inject({
      method: "POST",
      url: "/plugins/content-suggestions/mcp",
      headers: authorization ? { authorization } : {},
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain("Bearer");
    expect(response.headers["www-authenticate"]).toContain("resource_metadata=");
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("publishes OAuth protected-resource metadata", async () => {
    const { app } = appWithSuggestions();
    const response = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      resource: oauthConfig.resource,
      authorization_servers: [oauthConfig.issuer],
      scopes_supported: ["email"],
      bearer_methods_supported: ["header"],
    });
  });

  it("keeps customer routes but disables MCP when OAuth is not configured", async () => {
    const { app } = appWithSuggestions({ oauth: false });
    const mcp = await app.inject({
      method: "POST",
      url: "/plugins/content-suggestions/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    const customer = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions`,
      headers: { cookie: "bp_session=session-token" },
    });
    expect(mcp.statusCode).toBe(503);
    expect(customer.statusCode).toBe(200);
  });

  it("initializes stateless MCP with a verified OAuth token", async () => {
    const { app } = appWithSuggestions();
    const response = await app.inject({
      method: "POST",
      url: "/plugins/content-suggestions/mcp",
      headers: {
        authorization: "Bearer valid-access-token",
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "http-test", version: "1.0.0" },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("brand-pilot-content-suggestions");
  });

  it("accepts a contract-valid publish request larger than 256 KiB", async () => {
    const { app, suggestions } = appWithSuggestions();
    const longUrl = `https://example.com/${"a".repeat(2000)}`;
    const payload = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "publish_content_suggestion_batch",
        arguments: {
          contractVersion: "content-suggestion-batch.v1",
          categoryCode: "travel_tourism",
          generationDate: "2026-08-09",
          items: Array.from({ length: 28 }, (_, index) => ({
            subcategoryCode: `subcategory_${index}`,
            intent: index % 2 === 0 ? "informational" : "trend",
            position: index % 2 === 0 ? 1 : 2,
            title: "가".repeat(120),
            whyNow: "나".repeat(300),
            contentBrief: "다".repeat(500),
            sources: Array.from({ length: 3 }, () => ({
              url: longUrl,
              title: "라".repeat(300),
              publisher: "마".repeat(120),
              publishedAt: null,
            })),
          })),
        },
      },
    };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(256 * 1024);
    const response = await app.inject({
      method: "POST",
      url: "/plugins/content-suggestions/mcp",
      headers: {
        authorization: "Bearer valid-access-token",
        accept: "application/json, text/event-stream",
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(suggestions.publish).toHaveBeenCalledOnce();
  });

  it("requires the existing customer session for suggestion reads", async () => {
    const { app } = appWithSuggestions();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "authentication_required" });
  });

  it("returns brand-scoped suggestions without dates or sources", async () => {
    const { app, suggestions } = appWithSuggestions();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions`,
      headers: { cookie: "bp_session=session-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      category: { code: "travel_tourism", name: "여행·관광" },
      personal: [suggestion],
      general: [],
    });
    expect(response.body).not.toContain("sources");
    expect(response.body).not.toContain("generationDate");
    expect(suggestions.listForBrand).toHaveBeenCalledWith(brandId);
  });

  it("hides a missing or cross-category suggestion", async () => {
    const { app } = appWithSuggestions();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions/44444444-4444-4444-8444-444444444444`,
      headers: { cookie: "bp_session=session-token" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "content_suggestion_not_found" });
  });

  it("rejects a malformed suggestion id before querying Postgres", async () => {
    const { app, suggestions } = appWithSuggestions();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions/not-a-uuid`,
      headers: { cookie: "bp_session=session-token" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "content_suggestion_not_found" });
    expect(suggestions.getForBrand).not.toHaveBeenCalled();
  });

  it("preserves the global brand access boundary", async () => {
    const { app, suggestions } = appWithSuggestions({ permitted: false });
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/content-suggestions`,
      headers: { cookie: "bp_session=session-token" },
    });
    expect(response.statusCode).toBe(403);
    expect(suggestions.listForBrand).not.toHaveBeenCalled();
  });
});
