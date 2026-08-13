import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { FastifyInstance } from "fastify";
import { createContentSuggestionMcpServer } from "./contentSuggestionMcp.js";
import type { ContentSuggestionRepository } from "./contentSuggestionRepository.js";
import {
  contentSuggestionOAuthScopes,
  type ContentSuggestionOAuthConfig,
} from "./contentSuggestionOAuth.js";

export const CONTENT_SUGGESTION_MCP_PATH = "/plugins/content-suggestions/mcp";
export const CONTENT_SUGGESTION_PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

function protectedResourceMetadataUrl(config: ContentSuggestionOAuthConfig): string {
  return new URL(CONTENT_SUGGESTION_PROTECTED_RESOURCE_PATH, config.resource).toString();
}

function oauthChallenge(config: ContentSuggestionOAuthConfig): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(config)}", error="invalid_token"`;
}

export function registerContentSuggestionRoutes(
  app: FastifyInstance,
  options: {
    repository: ContentSuggestionRepository;
    oauth?: { config: ContentSuggestionOAuthConfig; verifier: OAuthTokenVerifier };
  },
) {
  app.get(CONTENT_SUGGESTION_PROTECTED_RESOURCE_PATH, async (_request, reply) => {
    if (!options.oauth) {
      reply.code(503);
      return { error: "content_suggestion_oauth_unavailable" };
    }
    return {
      resource: options.oauth.config.resource,
      authorization_servers: [options.oauth.config.issuer],
      scopes_supported: [...contentSuggestionOAuthScopes],
      bearer_methods_supported: ["header"],
    };
  });

  app.post(CONTENT_SUGGESTION_MCP_PATH, { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    if (!options.oauth) {
      reply.code(503);
      return { error: "content_suggestion_oauth_unavailable" };
    }
    const token = bearerToken(request.headers.authorization);
    let authInfo: AuthInfo;
    try {
      if (!token) throw new Error("invalid_token");
      authInfo = await options.oauth.verifier.verifyAccessToken(token);
    } catch {
      reply.header("www-authenticate", oauthChallenge(options.oauth.config));
      reply.code(401);
      return { error: "invalid_token" };
    }
    (request.raw as typeof request.raw & { auth?: AuthInfo }).auth = authInfo;

    const server = createContentSuggestionMcpServer(options.repository, {
      onPublished: (event) => request.log.info({
        event: "content_suggestion_batch_published",
        ...event,
      }, "content_suggestion_batch_published"),
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.on("close", () => {
        void transport.close();
        void server.close();
      });
      return reply;
    } catch (error) {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }));
      }
      request.log.error({ event: "content_suggestion_mcp_failed" }, "content_suggestion_mcp_failed");
      return reply;
    }
  });

  app.get<{ Params: { brandId: string } }>(
    "/brands/:brandId/content-suggestions",
    async (request) => options.repository.listForBrand(request.params.brandId),
  );

  app.get<{ Params: { brandId: string; suggestionId: string } }>(
    "/brands/:brandId/content-suggestions/:suggestionId",
    async (request, reply) => {
      if (!uuidPattern.test(request.params.suggestionId)) {
        reply.code(404);
        return { error: "content_suggestion_not_found" };
      }
      const suggestion = await options.repository.getForBrand(
        request.params.brandId,
        request.params.suggestionId,
      );
      if (!suggestion) {
        reply.code(404);
        return { error: "content_suggestion_not_found" };
      }
      return suggestion;
    },
  );
}
