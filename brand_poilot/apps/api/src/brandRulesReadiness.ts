import type { PoolClient } from "pg";
import { parseBrandRulesContentV2 } from "@brand-pilot/content-contracts";
import type { BrandRulesV2 } from "./brandCoreContracts.js";

export interface EnsureActiveApprovedBrandRulesInput {
  workspaceId: string;
  brandId: string;
  createdBy: "analysis_confirm" | "user" | "migration";
  actorUserId?: string | null;
}

interface StoredRuleRow {
  id: unknown;
  rules_json: unknown;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function databaseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function normalizedText(value: unknown, maxLength: number, fallback = ""): string {
  if (typeof value !== "string") return fallback.trim().slice(0, maxLength);
  return value.trim().slice(0, maxLength);
}

function normalizedStringList(
  value: unknown,
  options: { maxItems?: number; maxLength?: number } = {},
): string[] {
  if (!Array.isArray(value)) return [];
  const maxItems = options.maxItems ?? 20;
  const maxLength = options.maxLength ?? 500;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizedText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizedChannelRules(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [rawChannel, rawRules] of Object.entries(record(value))) {
    const channel = normalizedText(rawChannel, 50);
    if (!channel || Object.keys(result).length >= 20 || !Array.isArray(rawRules)) continue;
    result[channel] = normalizedStringList(rawRules);
  }
  return result;
}

export function normalizeBrandRulesV2(
  value: unknown,
  legacyProfile: {
    forbiddenTerms: unknown;
    defaultCta: unknown;
    autoApprovalEnabled: unknown;
  },
): BrandRulesV2 {
  const source = record(databaseJson(value));
  const ctaRules = record(source.ctaRules);
  const autoApprovalRules = record(source.autoApprovalRules);
  const forbiddenPhrases = Array.isArray(source.forbiddenPhrases)
    ? normalizedStringList(source.forbiddenPhrases)
    : normalizedStringList(databaseJson(legacyProfile.forbiddenTerms));
  const defaultCta = typeof ctaRules.defaultCta === "string"
    ? normalizedText(ctaRules.defaultCta, 500)
    : normalizedText(legacyProfile.defaultCta, 500);

  return parseBrandRulesContentV2({
    contractVersion: "brand-rules.v2",
    requiredPhrases: normalizedStringList(source.requiredPhrases),
    forbiddenPhrases,
    exaggerationRules: normalizedStringList(source.exaggerationRules),
    ctaRules: {
      defaultCta,
      allowed: normalizedStringList(ctaRules.allowed),
    },
    channelRules: normalizedChannelRules(source.channelRules),
    autoApprovalRules: {
      enabled: typeof autoApprovalRules.enabled === "boolean"
        ? autoApprovalRules.enabled
        : legacyProfile.autoApprovalEnabled === true,
      conditions: normalizedStringList(autoApprovalRules.conditions),
    },
  });
}

export async function ensureActiveApprovedBrandRules(
  client: Pick<PoolClient, "query">,
  input: EnsureActiveApprovedBrandRulesInput,
): Promise<{ id: string; rules: BrandRulesV2; created: boolean }> {
  const profile = await client.query(
    `select active_brand_rule_set_id, forbidden_terms, default_cta, auto_approval_enabled
       from brand_profiles
      where workspace_id = $1 and brand_id = $2
      for update`,
    [input.workspaceId, input.brandId],
  );
  if (!profile.rowCount) throw new Error("brand_not_found");
  const profileRow = profile.rows[0] as Record<string, unknown>;
  const approved = await client.query(
    `select id, rules_json
       from brand_rule_sets
      where workspace_id = $1 and brand_id = $2 and status = 'approved'
      order by version desc
      limit 1
      for update`,
    [input.workspaceId, input.brandId],
  );

  let invalidApproved: StoredRuleRow | null = null;
  if (approved.rowCount) {
    const row = approved.rows[0] as StoredRuleRow;
    try {
      const rules = parseBrandRulesContentV2(databaseJson(row.rules_json));
      const id = String(row.id);
      if (String(profileRow.active_brand_rule_set_id ?? "") !== id) {
        await client.query(
          `update brand_profiles set active_brand_rule_set_id = $3
            where workspace_id = $1 and brand_id = $2`,
          [input.workspaceId, input.brandId, id],
        );
      }
      return { id, rules, created: false };
    } catch {
      invalidApproved = row;
    }
  }

  const rules = normalizeBrandRulesV2(invalidApproved?.rules_json ?? {}, {
    forbiddenTerms: profileRow.forbidden_terms,
    defaultCta: profileRow.default_cta,
    autoApprovalEnabled: profileRow.auto_approval_enabled,
  });
  if (invalidApproved) {
    await client.query(
      `update brand_rule_sets
          set status = 'superseded', updated_at = now()
        where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'approved'`,
      [invalidApproved.id, input.workspaceId, input.brandId],
    );
  }
  const inserted = await client.query(
    `insert into brand_rule_sets (
       workspace_id, brand_id, version, status, rules_json, created_by,
       created_by_user_id, approved_by_user_id, approved_at
     )
     select $1, $2, coalesce(max(version), 0) + 1, 'approved', $3::jsonb, $4, $5, $5, now()
       from brand_rule_sets
      where workspace_id = $1 and brand_id = $2
     returning id`,
    [
      input.workspaceId,
      input.brandId,
      JSON.stringify(rules),
      input.createdBy,
      input.actorUserId ?? null,
    ],
  );
  const id = String(inserted.rows[0]!.id);
  await client.query(
    `update brand_profiles set active_brand_rule_set_id = $3
      where workspace_id = $1 and brand_id = $2`,
    [input.workspaceId, input.brandId, id],
  );
  return { id, rules, created: true };
}
