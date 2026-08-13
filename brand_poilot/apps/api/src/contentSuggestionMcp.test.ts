import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentSuggestionRepository } from "./contentSuggestionRepository.js";
import { createContentSuggestionMcpServer } from "./contentSuggestionMcp.js";
import { contentSuggestionOAuthScopes } from "./contentSuggestionOAuth.js";

const scope = {
  contractVersion: "content-suggestion-scope.v1" as const,
  generationDate: "2026-08-09",
  timezone: "Asia/Seoul" as const,
  category: { code: "travel_tourism", name: "여행·관광" },
  subcategories: [{ code: "domestic_travel", name: "국내여행" }],
  intents: ["informational", "trend"] as const,
  maxItemsPerSubcategoryIntent: 2 as const,
  maxSourcesPerItem: 3 as const,
};

function repository(): ContentSuggestionRepository {
  return {
    getScope: vi.fn(async () => ({ ...scope, intents: [...scope.intents] })),
    publish: vi.fn(async (input) => ({
      contractVersion: "content-suggestion-publish-result.v1" as const,
      status: "published" as const,
      batchId: "11111111-1111-4111-8111-111111111111",
      savedCount: input.items.length,
      generationDate: input.generationDate,
    })),
    listForBrand: vi.fn(async () => ({ category: null, personal: [], general: [] })),
    getForBrand: vi.fn(async () => null),
  };
}

async function connectedClient(
  contentRepository = repository(),
  scopes: string[] = [...contentSuggestionOAuthScopes],
  serverOptions: Parameters<typeof createContentSuggestionMcpServer>[1] = {},
) {
  const server = createContentSuggestionMcpServer(contentRepository, serverOptions);
  const client = new Client({ name: "content-suggestion-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const rawServerMessages: Array<Record<string, unknown>> = [];
  const serverSend = serverTransport.send.bind(serverTransport);
  serverTransport.send = (message, options) => {
    rawServerMessages.push(message as Record<string, unknown>);
    return serverSend(message, options);
  };
  const send = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message, options) => send(message, {
    ...options,
    authInfo: {
      token: "test-token",
      clientId: "test-client",
      scopes,
      resource: new URL("https://api.danbammsg.co.kr/plugins/content-suggestions/mcp"),
    },
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, contentRepository, rawServerMessages };
}

const resources: Array<{ client: Client; server: ReturnType<typeof createContentSuggestionMcpServer> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ client, server }) => {
    await client.close();
    await server.close();
  }));
});

describe("Brand Pilot content suggestion MCP app", () => {
  it("advertises exactly the two focused tools with accurate annotations", async () => {
    const connection = await connectedClient();
    resources.push(connection);
    const listed = await connection.client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "get_content_suggestion_scope",
      "publish_content_suggestion_batch",
    ]);
    expect(listed.tools[0].annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(listed.tools[1].annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    const rawToolList = connection.rawServerMessages
      .map((message) => message.result as { tools?: Array<Record<string, unknown>> } | undefined)
      .find((result) => Array.isArray(result?.tools));
    const readTool = rawToolList?.tools?.[0] as typeof listed.tools[number] & {
      securitySchemes?: Array<{ type: string; scopes?: string[] }>;
    };
    const writeTool = rawToolList?.tools?.[1] as typeof listed.tools[number] & {
      securitySchemes?: Array<{ type: string; scopes?: string[] }>;
    };
    expect(readTool.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["email"] },
    ]);
    expect(writeTool.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["email"] },
    ]);
    expect(readTool._meta?.securitySchemes).toBeUndefined();
    expect(writeTool._meta?.securitySchemes).toBeUndefined();
  });

  it("returns structured scope data", async () => {
    const connection = await connectedClient();
    resources.push(connection);
    const response = await connection.client.callTool({
      name: "get_content_suggestion_scope",
      arguments: { categoryCode: "travel_tourism" },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual(scope);
    expect(connection.contentRepository.getScope).toHaveBeenCalledWith("travel_tourism");
  });

  it("publishes only a contract-valid batch and returns the DB result", async () => {
    const connection = await connectedClient();
    resources.push(connection);
    const response = await connection.client.callTool({
      name: "publish_content_suggestion_batch",
      arguments: {
        contractVersion: "content-suggestion-batch.v1",
        categoryCode: "travel_tourism",
        generationDate: "2026-08-09",
        items: [{
          subcategoryCode: "domestic_travel",
          intent: "trend",
          position: 1,
          title: "실내 여행 코스",
          whyNow: "비 예보가 이어집니다.",
          contentBrief: "실내 동선으로 구성합니다.",
          sources: [{
            url: "https://example.org/travel",
            title: "여행 자료",
            publisher: "예시 기관",
            publishedAt: null,
          }],
        }],
      },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      contractVersion: "content-suggestion-publish-result.v1",
      status: "published",
      batchId: "11111111-1111-4111-8111-111111111111",
      savedCount: 1,
      generationDate: "2026-08-09",
    });
    expect(connection.contentRepository.publish).toHaveBeenCalledOnce();
  });

  it("rejects unknown publish fields before repository access", async () => {
    const connection = await connectedClient();
    resources.push(connection);
    const response = await connection.client.callTool({
      name: "publish_content_suggestion_batch",
      arguments: {
        contractVersion: "content-suggestion-batch.v1",
        categoryCode: "travel_tourism",
        generationDate: "2026-08-09",
        items: [],
        sql: "select * from users",
      },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("Unrecognized key");
    expect(connection.contentRepository.publish).not.toHaveBeenCalled();
  });

  it("rejects publish when the access token lacks the supported identity scope", async () => {
    const contentRepository = repository();
    const connection = await connectedClient(contentRepository, ["openid"]);
    resources.push(connection);
    const response = await connection.client.callTool({
      name: "publish_content_suggestion_batch",
      arguments: {
        contractVersion: "content-suggestion-batch.v1",
        categoryCode: "travel_tourism",
        generationDate: "2026-08-09",
        items: [{
          subcategoryCode: "domestic_travel",
          intent: "trend",
          position: 1,
          title: "실내 여행 코스",
          whyNow: "비 예보가 이어집니다.",
          contentBrief: "실내 동선으로 구성합니다.",
          sources: [{
            url: "https://example.org/travel",
            title: "여행 자료",
            publisher: "예시 기관",
            publishedAt: null,
          }],
        }],
      },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("insufficient_scope");
    expect(response._meta?.["mcp/www_authenticate"]).toEqual([
      expect.stringContaining('error="insufficient_scope"'),
    ]);
    expect(JSON.stringify(response._meta)).toContain("error_description=");
    expect(contentRepository.publish).not.toHaveBeenCalled();
  });

  it("reports structured publish success without token or prompt data", async () => {
    const onPublished = vi.fn();
    const connection = await connectedClient(repository(), undefined, { onPublished });
    resources.push(connection);
    await connection.client.callTool({
      name: "publish_content_suggestion_batch",
      arguments: {
        contractVersion: "content-suggestion-batch.v1",
        categoryCode: "travel_tourism",
        generationDate: "2026-08-09",
        items: [{
          subcategoryCode: "domestic_travel",
          intent: "trend",
          position: 1,
          title: "실내 여행 코스",
          whyNow: "비 예보가 이어집니다.",
          contentBrief: "실내 동선으로 구성합니다.",
          sources: [{
            url: "https://example.org/travel",
            title: "여행 자료",
            publisher: "예시 기관",
            publishedAt: null,
          }],
        }],
      },
    });
    expect(onPublished).toHaveBeenCalledWith({
      categoryCode: "travel_tourism",
      generationDate: "2026-08-09",
      batchId: "11111111-1111-4111-8111-111111111111",
      savedCount: 1,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(onPublished.mock.calls)).not.toContain("test-token");
  });
});
