import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  ContentSuggestionOAuthTokenVerifier,
  contentSuggestionOAuthScopes,
  type ContentSuggestionOAuthConfig,
} from "./contentSuggestionOAuth.js";

const config: ContentSuggestionOAuthConfig = {
  issuer: "https://login.example.com/",
  jwksUri: "https://login.example.com/.well-known/jwks.json",
  audience: "authenticated",
  resource: "https://api.danbammsg.co.kr/plugins/content-suggestions/mcp",
  allowedSubjects: ["11111111-1111-4111-8111-111111111111"],
};

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] });
  const sign = (overrides: {
    audience?: string;
    issuer?: string;
    scope?: string;
    expiresIn?: string;
    subject?: string;
  } = {}) => (
    new SignJWT({
      client_id: "chatgpt-scheduled-task",
      scope: overrides.scope ?? contentSuggestionOAuthScopes.join(" "),
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(overrides.issuer ?? config.issuer)
      .setAudience(overrides.audience ?? config.audience)
      .setSubject(overrides.subject ?? config.allowedSubjects[0])
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(privateKey)
  );
  return { keySet, sign };
}

describe("content suggestion OAuth token verifier", () => {
  it("verifies signature, issuer, audience, expiry and scopes", async () => {
    const { keySet, sign } = await signer();
    const token = await sign();
    const verifier = new ContentSuggestionOAuthTokenVerifier(config, keySet);

    await expect(verifier.verifyAccessToken(token)).resolves.toMatchObject({
      token,
      clientId: "chatgpt-scheduled-task",
      scopes: contentSuggestionOAuthScopes,
      resource: new URL(config.resource),
    });
  });

  it.each([
    { audience: "https://api.danbammsg.co.kr/other" },
    { issuer: "https://attacker.example.com/" },
    { expiresIn: "-1s" },
    { subject: "22222222-2222-4222-8222-222222222222" },
  ])("rejects a token outside the configured trust boundary: %o", async (override) => {
    const { keySet, sign } = await signer();
    const verifier = new ContentSuggestionOAuthTokenVerifier(config, keySet);
    await expect(verifier.verifyAccessToken(await sign(override))).rejects.toThrow("invalid_token");
  });
});
