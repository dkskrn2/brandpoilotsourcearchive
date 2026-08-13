import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  parseContentSuggestionBatch,
  type ContentSuggestionBatchInput,
} from "./contentSuggestionContracts.js";
import type { ContentSuggestionRepository } from "./contentSuggestionRepository.js";
import { contentSuggestionOAuthScopes } from "./contentSuggestionOAuth.js";

const sourceSchema = z.object({
  url: z.string().url().max(2048),
  title: z.string().min(1).max(300),
  publisher: z.string().min(1).max(120),
  publishedAt: z.string().date().nullable(),
}).strict();

const itemSchema = z.object({
  subcategoryCode: z.string().min(1).max(64),
  intent: z.enum(["informational", "trend"]),
  position: z.union([z.literal(1), z.literal(2)]),
  title: z.string().min(1).max(120),
  whyNow: z.string().min(1).max(300),
  contentBrief: z.string().min(1).max(500),
  sources: z.array(sourceSchema).min(1).max(3),
}).strict();

const batchSchema = z.object({
  contractVersion: z.literal("content-suggestion-batch.v1"),
  categoryCode: z.string().min(1).max(64),
  generationDate: z.string().date(),
  items: z.array(itemSchema).min(1).max(28),
}).strict();

const scopeInputSchema = z.object({
  categoryCode: z.string().min(1).max(64),
}).strict();

const scopeOutputSchema = z.object({
  contractVersion: z.literal("content-suggestion-scope.v1"),
  generationDate: z.string(),
  timezone: z.literal("Asia/Seoul"),
  category: z.object({ code: z.string(), name: z.string() }),
  subcategories: z.array(z.object({ code: z.string(), name: z.string() })),
  intents: z.array(z.enum(["informational", "trend"])),
  maxItemsPerSubcategoryIntent: z.literal(2),
  maxSourcesPerItem: z.literal(3),
});

const publishOutputSchema = z.object({
  contractVersion: z.literal("content-suggestion-publish-result.v1"),
  status: z.literal("published"),
  batchId: z.string(),
  savedCount: z.number().int().min(1).max(28),
  generationDate: z.string(),
});

function asStructuredContent(value: object): Record<string, unknown> {
  return { ...value };
}

export interface ContentSuggestionPublishLog {
  categoryCode: string;
  generationDate: string;
  batchId: string;
  savedCount: number;
  durationMs: number;
}

function requireScope(
  authInfo: AuthInfo | undefined,
  scope: typeof contentSuggestionOAuthScopes[number],
): CallToolResult | null {
  if (authInfo?.scopes.includes(scope)) return null;
  const resource = authInfo?.resource
    ?? new URL("https://api.danbammsg.co.kr/plugins/content-suggestions/mcp");
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", resource).toString();
  return {
    isError: true,
    content: [{ type: "text", text: `Authentication required: insufficient_scope (${scope})` }],
    _meta: {
      "mcp/www_authenticate": [
        `Bearer resource_metadata="${metadataUrl}", error="insufficient_scope", error_description="Required OAuth scope: ${scope}"`,
      ],
    },
  };
}

export function createContentSuggestionMcpServer(
  repository: ContentSuggestionRepository,
  options: { onPublished?: (event: ContentSuggestionPublishLog) => void } = {},
) {
  const server = new McpServer(
    { name: "brand-pilot-content-suggestions", version: "1.0.0" },
    {
      instructions: "항상 분야 스코프를 먼저 조회한 뒤 유효한 배치만 게시합니다. 게시 성공 응답 전에는 완료로 보고하지 않습니다.",
    },
  );

  server.registerTool(
    "get_content_suggestion_scope",
    {
      title: "콘텐츠 제안 분야 스코프 조회",
      description: "지정 분야의 오늘 날짜와 활성 세부분야, 허용 분류, 저장 한도를 조회합니다. 콘텐츠 조사 전에 먼저 호출합니다.",
      inputSchema: scopeInputSchema,
      outputSchema: scopeOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ categoryCode }, extra) => {
      const authError = requireScope(extra.authInfo, "email");
      if (authError) return authError;
      const scope = await repository.getScope(categoryCode);
      return {
        structuredContent: asStructuredContent(scope),
        content: [{
          type: "text",
          text: `${scope.category.name} 분야의 활성 세부분야 ${scope.subcategories.length}개를 확인했습니다.`,
        }],
      };
    },
  );

  server.registerTool(
    "publish_content_suggestion_batch",
    {
      title: "오늘의 콘텐츠 제안 배치 게시",
      description: "조사 완료된 한 분야의 정보성·트렌드성 제안을 원자적으로 검증하고 Brand Pilot DB에 게시합니다.",
      inputSchema: batchSchema,
      outputSchema: publishOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (rawInput, extra) => {
      const authError = requireScope(extra.authInfo, "email");
      if (authError) return authError;
      const startedAt = Date.now();
      const input = parseContentSuggestionBatch(rawInput) as ContentSuggestionBatchInput;
      const published = await repository.publish(input);
      options.onPublished?.({
        categoryCode: input.categoryCode,
        generationDate: input.generationDate,
        batchId: published.batchId,
        savedCount: published.savedCount,
        durationMs: Date.now() - startedAt,
      });
      return {
        structuredContent: asStructuredContent(published),
        content: [{
          type: "text",
          text: `${input.categoryCode} 분야의 콘텐츠 제안 ${published.savedCount}개를 저장했습니다. 배치 ID: ${published.batchId}`,
        }],
      };
    },
  );

  // MCP SDK 1.30 predates the protocol field, so advertise the current
  // OpenAI-required top-level securitySchemes through the low-level list handler.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "get_content_suggestion_scope",
        title: "콘텐츠 제안 분야 스코프 조회",
        description: "지정 분야의 오늘 날짜와 활성 세부분야, 허용 분류, 저장 한도를 조회합니다. 콘텐츠 조사 전에 먼저 호출합니다.",
        inputSchema: z.toJSONSchema(scopeInputSchema),
        outputSchema: z.toJSONSchema(scopeOutputSchema),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        execution: { taskSupport: "forbidden" },
        securitySchemes: [{ type: "oauth2", scopes: ["email"] }],
      },
      {
        name: "publish_content_suggestion_batch",
        title: "오늘의 콘텐츠 제안 배치 게시",
        description: "조사 완료된 한 분야의 정보성·트렌드성 제안을 원자적으로 검증하고 Brand Pilot DB에 게시합니다.",
        inputSchema: z.toJSONSchema(batchSchema),
        outputSchema: z.toJSONSchema(publishOutputSchema),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
        execution: { taskSupport: "forbidden" },
        securitySchemes: [{ type: "oauth2", scopes: ["email"] }],
      },
    ],
  }) as unknown as ListToolsResult);

  return server;
}
