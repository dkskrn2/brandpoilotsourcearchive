import type { ChannelStatus, InstagramCapabilityStatus } from "./types.js";

export const requiredInstagramStoryScopes = [
  "instagram_basic",
  "instagram_content_publish"
] as const;

export interface InstagramStoryCapabilityInput {
  channelStatus: string | null;
  externalAccountId: string | null;
  credentialId: string | null;
  credentialStatus: string | null;
  credentialExpiresAt: Date | string | null;
  scopes: readonly string[];
  apiVersion: string;
  capabilityMetadata: Record<string, unknown>;
  now?: Date;
}

export interface InstagramStoryCapabilityResult {
  status: InstagramCapabilityStatus;
  reason: string | null;
  metadata: {
    apiVersion: string;
    requiredScopes: string[];
    presentScopes: string[];
    missingScopes: string[];
    professionalAccountPresent: boolean;
    credentialStatus: string | null;
    storyPublishVerified: boolean;
    scopesVerified: boolean;
    verifiedCredentialId: string | null;
  };
}

export type InstagramChannelReadiness =
  | { connectionStatus: "connected"; readiness: "ready"; reasonCode: null }
  | {
    connectionStatus: "not_connected";
    readiness: "needs_connection";
    reasonCode: "channel_not_connected";
  }
  | {
    connectionStatus: Exclude<ChannelStatus, "connected" | "not_connected">;
    readiness: "needs_permission";
    reasonCode:
      | "credential_expired"
      | "credential_invalid"
      | "missing_required_scopes"
      | "professional_account_required"
      | "provider_not_supported";
  };

export interface AuthoritativeInstagramChannelInput {
  externalAccountId: string | null;
  credentialId: string | null;
  credentialProvider: string | null;
  credentialStatus: string | null;
  credentialExpiresAt: Date | string | null;
  scopes: readonly string[];
  now?: Date;
}

const instagramBasicScopeAlternatives = [
  "instagram_business_basic",
  "instagram_basic",
] as const;
const instagramPublishScopeAlternatives = [
  "instagram_business_content_publish",
  "instagram_content_publish",
] as const;

export function evaluateInstagramChannelReadiness(
  input: AuthoritativeInstagramChannelInput,
): InstagramChannelReadiness {
  if (!input.credentialId || !input.credentialStatus) {
    return {
      connectionStatus: "not_connected",
      readiness: "needs_connection",
      reasonCode: "channel_not_connected",
    };
  }
  if (!input.externalAccountId?.trim()) {
    return {
      connectionStatus: "mapping_required",
      readiness: "needs_permission",
      reasonCode: "professional_account_required",
    };
  }
  if (input.credentialProvider !== "meta") {
    return {
      connectionStatus: "needs_attention",
      readiness: "needs_permission",
      reasonCode: "provider_not_supported",
    };
  }

  const now = input.now ?? new Date();
  const expiresAt = input.credentialExpiresAt === null
    ? null
    : new Date(input.credentialExpiresAt);
  const expired = input.credentialStatus === "expired"
    || (expiresAt !== null
      && Number.isFinite(expiresAt.getTime())
      && expiresAt.getTime() <= now.getTime());
  if (expired) {
    return {
      connectionStatus: "expired",
      readiness: "needs_permission",
      reasonCode: "credential_expired",
    };
  }
  if (input.credentialStatus !== "active"
    || (expiresAt !== null && !Number.isFinite(expiresAt.getTime()))) {
    return {
      connectionStatus: "needs_attention",
      readiness: "needs_permission",
      reasonCode: "credential_invalid",
    };
  }

  const scopes = new Set(input.scopes);
  const hasBasic = instagramBasicScopeAlternatives.some((scope) => scopes.has(scope));
  const hasPublish = instagramPublishScopeAlternatives.some((scope) => scopes.has(scope));
  if (!hasBasic || !hasPublish) {
    return {
      connectionStatus: "insufficient_permissions",
      readiness: "needs_permission",
      reasonCode: "missing_required_scopes",
    };
  }
  return { connectionStatus: "connected", readiness: "ready", reasonCode: null };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function sanitizeInstagramCapabilityMetadata(value: unknown): Record<string, unknown> {
  const source = metadataRecord(value);
  const safe: Record<string, unknown> = {};
  if (typeof source.apiVersion === "string") safe.apiVersion = source.apiVersion;
  for (const key of ["requiredScopes", "presentScopes", "missingScopes"] as const) {
    if (Array.isArray(source[key])) {
      safe[key] = source[key].filter((item): item is string => typeof item === "string");
    }
  }
  if (typeof source.professionalAccountPresent === "boolean") {
    safe.professionalAccountPresent = source.professionalAccountPresent;
  }
  if (typeof source.credentialStatus === "string" || source.credentialStatus === null) {
    safe.credentialStatus = source.credentialStatus;
  }
  if (typeof source.storyPublishVerified === "boolean") {
    safe.storyPublishVerified = source.storyPublishVerified;
  }
  if (typeof source.scopesVerified === "boolean") safe.scopesVerified = source.scopesVerified;
  if (typeof source.verifiedCredentialId === "string" || source.verifiedCredentialId === null) {
    safe.verifiedCredentialId = source.verifiedCredentialId;
  }
  return safe;
}

export function evaluateInstagramStoryCapability(
  input: InstagramStoryCapabilityInput
): InstagramStoryCapabilityResult {
  const presentScopes = [...new Set(input.scopes.filter((scope) => scope.trim().length > 0))];
  const missingScopes = requiredInstagramStoryScopes.filter((scope) => !presentScopes.includes(scope));
  const professionalAccountPresent = Boolean(input.externalAccountId?.trim());
  const now = input.now ?? new Date();
  const expiresAt = input.credentialExpiresAt === null ? null : new Date(input.credentialExpiresAt);
  const credentialExpired = input.credentialStatus === "expired" || (
    input.credentialStatus === "active" &&
    expiresAt !== null &&
    Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() <= now.getTime()
  );
  const credentialStatus = credentialExpired ? "expired" : input.credentialStatus;
  const sourceVerifiedCredentialId = typeof input.capabilityMetadata.verifiedCredentialId === "string"
    ? input.capabilityMetadata.verifiedCredentialId
    : null;
  const credentialMatches = input.credentialId !== null &&
    input.credentialStatus === "active" &&
    !credentialExpired &&
    sourceVerifiedCredentialId === input.credentialId;
  const verificationClaimsPresent = input.capabilityMetadata.scopesVerified === true ||
    input.capabilityMetadata.storyPublishVerified === true ||
    sourceVerifiedCredentialId !== null;
  const verifiedCredentialMismatch = verificationClaimsPresent && !credentialMatches;
  const scopesVerified = credentialMatches && input.capabilityMetadata.scopesVerified === true;
  const storyPublishVerified = credentialMatches && input.capabilityMetadata.storyPublishVerified === true;
  const metadata = {
    apiVersion: input.apiVersion,
    requiredScopes: [...requiredInstagramStoryScopes],
    presentScopes,
    missingScopes,
    professionalAccountPresent,
    credentialStatus,
    storyPublishVerified,
    scopesVerified,
    verifiedCredentialId: credentialMatches ? input.credentialId : null
  };

  if (input.channelStatus !== "connected") {
    return { status: "unavailable", reason: "channel_not_connected", metadata };
  }
  if (!professionalAccountPresent) {
    return { status: "needs_attention", reason: "professional_account_required", metadata };
  }
  if (input.credentialStatus === null) {
    return { status: "needs_attention", reason: "credential_missing", metadata };
  }
  if (credentialExpired) {
    return { status: "needs_attention", reason: "credential_expired", metadata };
  }
  if (input.credentialStatus !== "active") {
    return { status: "needs_attention", reason: "credential_invalid", metadata };
  }
  if (missingScopes.length > 0) {
    return { status: "needs_attention", reason: "missing_required_scopes", metadata };
  }
  if (verifiedCredentialMismatch) {
    return { status: "needs_attention", reason: "verified_credential_mismatch", metadata };
  }
  if (!scopesVerified) {
    return { status: "needs_attention", reason: "scope_verification_required", metadata };
  }
  if (!storyPublishVerified) {
    return { status: "needs_attention", reason: "story_publish_verification_required", metadata };
  }
  return { status: "available", reason: null, metadata };
}
