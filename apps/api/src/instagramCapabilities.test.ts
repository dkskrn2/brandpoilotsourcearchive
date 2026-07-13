import { describe, expect, it } from "vitest";
import { evaluateInstagramStoryCapability } from "./instagramCapabilities";

const baseInput = {
  channelStatus: "connected",
  externalAccountId: "17890000000000000",
  credentialId: "credential-1",
  credentialStatus: "active",
  credentialExpiresAt: "2026-08-01T00:00:00.000Z",
  scopes: ["instagram_basic", "instagram_content_publish"],
  apiVersion: "v20.0",
  capabilityMetadata: {
    scopesVerified: true,
    storyPublishVerified: true,
    verifiedCredentialId: "credential-1"
  },
  now: new Date("2026-07-13T00:00:00.000Z")
};

describe("evaluateInstagramStoryCapability", () => {
  it.each([
    {
      name: "the Instagram channel is not connected",
      input: { channelStatus: "not_connected" },
      status: "unavailable",
      reason: "channel_not_connected"
    },
    {
      name: "a professional account ID is missing",
      input: { externalAccountId: null },
      status: "needs_attention",
      reason: "professional_account_required"
    },
    {
      name: "a credential is missing",
      input: { credentialStatus: null },
      status: "needs_attention",
      reason: "credential_missing"
    },
    {
      name: "a credential is invalid",
      input: { credentialStatus: "invalid" },
      status: "needs_attention",
      reason: "credential_invalid"
    },
    {
      name: "an active credential is expired",
      input: { credentialExpiresAt: "2026-07-12T23:59:59.000Z" },
      status: "needs_attention",
      reason: "credential_expired"
    },
    {
      name: "instagram_basic is missing",
      input: { scopes: ["instagram_content_publish"] },
      status: "needs_attention",
      reason: "missing_required_scopes"
    },
    {
      name: "instagram_content_publish is missing",
      input: { scopes: ["instagram_basic"] },
      status: "needs_attention",
      reason: "missing_required_scopes"
    },
    {
      name: "claimed scopes have not been provider verified",
      input: { capabilityMetadata: { storyPublishVerified: true, verifiedCredentialId: "credential-1" } },
      status: "needs_attention",
      reason: "scope_verification_required"
    },
    {
      name: "Story publishing has not been verified",
      input: { capabilityMetadata: { scopesVerified: true, verifiedCredentialId: "credential-1" } },
      status: "needs_attention",
      reason: "story_publish_verification_required"
    },
    {
      name: "Story verification is truthy but not true",
      input: {
        capabilityMetadata: {
          scopesVerified: true,
          storyPublishVerified: "true",
          verifiedCredentialId: "credential-1"
        }
      },
      status: "needs_attention",
      reason: "story_publish_verification_required"
    },
    {
      name: "verification belongs to another credential",
      input: {
        capabilityMetadata: {
          scopesVerified: true,
          storyPublishVerified: true,
          verifiedCredentialId: "credential-old"
        }
      },
      status: "needs_attention",
      reason: "verified_credential_mismatch"
    }
  ])("returns a safe reason when $name", ({ input, status, reason }) => {
    const result = evaluateInstagramStoryCapability({ ...baseInput, ...input });

    expect(result.status).toBe(status);
    expect(result.reason).toBe(reason);
  });

  it("reports the required, present, and missing scopes", () => {
    const result = evaluateInstagramStoryCapability({
      ...baseInput,
      scopes: ["instagram_basic", "pages_show_list"],
      capabilityMetadata: {
        scopesVerified: true,
        storyPublishVerified: false,
        verifiedCredentialId: "credential-1"
      }
    });

    expect(result.metadata).toEqual({
      apiVersion: "v20.0",
      requiredScopes: ["instagram_basic", "instagram_content_publish"],
      presentScopes: ["instagram_basic", "pages_show_list"],
      missingScopes: ["instagram_content_publish"],
      professionalAccountPresent: true,
      credentialStatus: "active",
      storyPublishVerified: false,
      scopesVerified: true,
      verifiedCredentialId: "credential-1"
    });
  });

  it("is available only when technical checks and Story verification pass", () => {
    expect(evaluateInstagramStoryCapability(baseInput)).toEqual({
      status: "available",
      reason: null,
      metadata: {
        apiVersion: "v20.0",
        requiredScopes: ["instagram_basic", "instagram_content_publish"],
        presentScopes: ["instagram_basic", "instagram_content_publish"],
        missingScopes: [],
        professionalAccountPresent: true,
        credentialStatus: "active",
        storyPublishVerified: true,
        scopesVerified: true,
        verifiedCredentialId: "credential-1"
      }
    });
  });

  it("does not promote claimed scopes into trusted verification", () => {
    const result = evaluateInstagramStoryCapability({
      ...baseInput,
      capabilityMetadata: {}
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      reason: "scope_verification_required",
      metadata: {
        presentScopes: ["instagram_basic", "instagram_content_publish"],
        scopesVerified: false,
        storyPublishVerified: false,
        verifiedCredentialId: null
      }
    });
  });

  it("clears trusted verification when the matching credential is expired", () => {
    const result = evaluateInstagramStoryCapability({
      ...baseInput,
      credentialExpiresAt: "2026-07-12T23:59:59.000Z"
    });

    expect(result).toMatchObject({
      status: "needs_attention",
      reason: "credential_expired",
      metadata: {
        credentialStatus: "expired",
        scopesVerified: false,
        storyPublishVerified: false,
        verifiedCredentialId: null
      }
    });
  });

  it("does not copy credential or token fields from persisted metadata", () => {
    const result = evaluateInstagramStoryCapability({
      ...baseInput,
      capabilityMetadata: {
        scopesVerified: true,
        storyPublishVerified: true,
        verifiedCredentialId: "credential-1",
        accessToken: "secret-token",
        encryptedPayload: "secret-ciphertext",
        token: "plain-secret",
        secret: "top-secret",
        credential: { token: "nested-secret" }
      }
    });

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.metadata).not.toHaveProperty("accessToken");
    expect(result.metadata).not.toHaveProperty("encryptedPayload");
    expect(result.metadata).not.toHaveProperty("token");
    expect(result.metadata).not.toHaveProperty("secret");
    expect(result.metadata).not.toHaveProperty("credential");
  });
});
