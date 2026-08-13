import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";

export const contentSuggestionOAuthScopes = [
  "email",
] as const;

export interface ContentSuggestionOAuthConfig {
  issuer: string;
  jwksUri: string;
  audience: string;
  resource: string;
  allowedSubjects: string[];
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  const value = typeof payload.scope === "string" ? payload.scope : payload.scp;
  const scopes = typeof value === "string"
    ? value.split(/\s+/)
    : Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string") : [];
  return [...new Set(scopes.filter(Boolean))];
}

export class ContentSuggestionOAuthTokenVerifier implements OAuthTokenVerifier {
  private readonly keySet: JWTVerifyGetKey;

  constructor(
    private readonly config: ContentSuggestionOAuthConfig,
    keySet: JWTVerifyGetKey = createRemoteJWKSet(new URL(config.jwksUri)),
  ) {
    this.keySet = keySet;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      const clientId = [payload.client_id, payload.azp]
        .find((value): value is string => typeof value === "string" && value.length > 0);
      const subject = typeof payload.sub === "string" ? payload.sub : null;
      if (
        !clientId
        || !subject
        || !this.config.allowedSubjects.includes(subject)
        || typeof payload.exp !== "number"
      ) throw new Error("required_claim_missing");
      return {
        token,
        clientId,
        scopes: tokenScopes(payload),
        expiresAt: payload.exp,
        resource: new URL(this.config.resource),
        extra: { subject },
      };
    } catch {
      throw new InvalidTokenError("invalid_token");
    }
  }
}

export function createContentSuggestionOAuthTokenVerifier(config: ContentSuggestionOAuthConfig) {
  return new ContentSuggestionOAuthTokenVerifier(config);
}
