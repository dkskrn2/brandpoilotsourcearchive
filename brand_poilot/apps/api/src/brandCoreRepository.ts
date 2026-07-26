import type { Pool, PoolClient } from "pg";
import {
  BRAND_CORE_FIELD_PATHS,
  parseBrandCoreDraft,
  parseBrandCoreForApproval,
  parseBrandEvidence,
  parseBrandReviewState,
  parseBrandRules,
  transitionBrandReviewState,
  type BrandCoreV1,
  type BrandEvidenceItem,
  type BrandReviewState,
  type BrandRulesV1,
} from "./brandCoreContracts.js";

export interface BrandScope {
  workspaceId: string;
  brandId: string;
}

export interface BrandCoreVersion extends BrandScope {
  id: string;
  sourceAnalysisId: string | null;
  version: number;
  status: "draft" | "approved" | "superseded";
  core: BrandCoreV1;
  evidence: BrandEvidenceItem[];
  reviewState: BrandReviewState;
  createdBy: "analysis_confirm" | "user" | "migration";
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrandRuleSet extends BrandScope {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  rules: BrandRulesV1;
  createdBy: "analysis_confirm" | "user" | "migration";
  createdByUserId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBrandCoreDraft {
  core: BrandCoreV1;
  evidence: BrandEvidenceItem[];
  sourceAnalysisId: string | null;
  reviewState?: BrandReviewState;
}

export interface UpdateBrandCoreDraft {
  core: BrandCoreV1;
  evidence: BrandEvidenceItem[];
  reviewState: BrandReviewState;
  expectedUpdatedAt: string;
}

export interface BrandCoreRepository {
  getActive(scope: BrandScope): Promise<BrandCoreVersion | null>;
  listVersions(scope: BrandScope): Promise<BrandCoreVersion[]>;
  createDraft(
    scope: BrandScope & { actorUserId: string },
    input: CreateBrandCoreDraft,
  ): Promise<BrandCoreVersion>;
  updateDraft(
    scope: BrandScope & { actorUserId: string; versionId: string },
    input: UpdateBrandCoreDraft,
  ): Promise<BrandCoreVersion>;
  approve(
    scope: BrandScope & { actorUserId: string; versionId: string },
  ): Promise<BrandCoreVersion>;
  getActiveRules(scope: BrandScope): Promise<BrandRuleSet | null>;
  listRuleSets(scope: BrandScope): Promise<BrandRuleSet[]>;
  saveRuleDraft(
    scope: BrandScope & { actorUserId: string },
    input: BrandRulesV1,
  ): Promise<BrandRuleSet>;
  approveRules(
    scope: BrandScope & { actorUserId: string; ruleSetId: string },
  ): Promise<BrandRuleSet>;
}

const coreColumns = `id, workspace_id, brand_id, source_analysis_id, version, status,
  core_json, evidence_json, review_state_json, created_by, created_by_user_id,
  approved_by_user_id, approved_at, created_at, updated_at`;
const ruleColumns = `id, workspace_id, brand_id, version, status, rules_json, created_by,
  created_by_user_id, approved_by_user_id, approved_at, created_at, updated_at`;

function json<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapCore(row: Record<string, unknown>): BrandCoreVersion {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    sourceAnalysisId: row.source_analysis_id ? String(row.source_analysis_id) : null,
    version: Number(row.version),
    status: row.status as BrandCoreVersion["status"],
    core: parseBrandCoreDraft(json(row.core_json, {})),
    evidence: parseBrandEvidence(json(row.evidence_json, [])),
    reviewState: parseBrandReviewState(json(row.review_state_json, {})),
    createdBy: row.created_by as BrandCoreVersion["createdBy"],
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
    approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function mapRule(row: Record<string, unknown>): BrandRuleSet {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    version: Number(row.version),
    status: row.status as BrandRuleSet["status"],
    rules: parseBrandRules(json(row.rules_json, {})),
    createdBy: row.created_by as BrandRuleSet["createdBy"],
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    approvedByUserId: row.approved_by_user_id ? String(row.approved_by_user_id) : null,
    approvedAt: iso(row.approved_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function requireMember(
  client: Pick<PoolClient, "query">,
  input: BrandScope & { actorUserId: string },
  approval = false,
): Promise<void> {
  const member = await client.query(
    `select member.role
       from workspace_members member
       join brands brand
         on brand.workspace_id = member.workspace_id
        and brand.id = $2
      where member.workspace_id = $1
        and member.user_id = $3
        and member.status = 'active'`,
    [input.workspaceId, input.brandId, input.actorUserId],
  );
  if (!member.rowCount) throw new Error("brand_core_access_forbidden");
  if (approval && !["owner", "admin"].includes(String(member.rows[0]?.role))) {
    throw new Error("brand_core_approval_forbidden");
  }
}

function initialReviewState(): BrandReviewState {
  return Object.fromEntries(BRAND_CORE_FIELD_PATHS.map((path) => [
    path,
    { decision: "ai_suggested", reviewerUserId: null, reviewedAt: null },
  ])) as BrandReviewState;
}

export function createBrandCoreRepository(pool: Pool): BrandCoreRepository {
  return {
    async getActive(scope) {
      const result = await pool.query(
        `select core.*
           from brand_profiles profile
           join brand_core_versions core
             on core.id = profile.active_brand_core_id
            and core.workspace_id = profile.workspace_id
            and core.brand_id = profile.brand_id
          where profile.workspace_id = $1
            and profile.brand_id = $2
            and core.status = 'approved'`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rowCount ? mapCore(result.rows[0] as Record<string, unknown>) : null;
    },

    async listVersions(scope) {
      const result = await pool.query(
        `select ${coreColumns}
           from brand_core_versions
          where workspace_id = $1 and brand_id = $2
          order by version desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => mapCore(row as Record<string, unknown>));
    },

    async createDraft(scope, input) {
      const core = parseBrandCoreDraft(input.core);
      const evidence = parseBrandEvidence(input.evidence);
      const reviewState = input.reviewState
        ? parseBrandReviewState(input.reviewState)
        : initialReviewState();
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const profile = await client.query(
          `select id from brand_profiles
            where workspace_id = $1 and brand_id = $2
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (!profile.rowCount) throw new Error("brand_not_found");
        if (input.sourceAnalysisId) {
          const analysis = await client.query(
            `select id from brand_analysis_runs
              where id = $1 and workspace_id = $2 and brand_id = $3`,
            [input.sourceAnalysisId, scope.workspaceId, scope.brandId],
          );
          if (!analysis.rowCount) throw new Error("brand_analysis_not_found");
        }
        const inserted = await client.query(
          `insert into brand_core_versions (
             workspace_id, brand_id, source_analysis_id, version, status, core_json,
             evidence_json, review_state_json, created_by, created_by_user_id
           )
           select $1, $2, $3, coalesce(max(version), 0) + 1, 'draft',
                  $4::jsonb, $5::jsonb, $6::jsonb, 'user', $7
             from brand_core_versions
            where workspace_id = $1 and brand_id = $2
           returning ${coreColumns}`,
          [
            scope.workspaceId,
            scope.brandId,
            input.sourceAnalysisId,
            JSON.stringify(core),
            JSON.stringify(evidence),
            JSON.stringify(reviewState),
            scope.actorUserId,
          ],
        );
        return mapCore(inserted.rows[0] as Record<string, unknown>);
      });
    },

    async updateDraft(scope, input) {
      const core = parseBrandCoreDraft(input.core);
      const evidence = parseBrandEvidence(input.evidence);
      const reviewState = parseBrandReviewState(input.reviewState);
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const current = await client.query(
          `select ${coreColumns}
             from brand_core_versions
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [scope.versionId, scope.workspaceId, scope.brandId],
        );
        if (!current.rowCount) throw new Error("brand_core_not_found");
        const existing = mapCore(current.rows[0] as Record<string, unknown>);
        if (existing.status !== "draft") throw new Error("brand_core_not_draft");
        for (const [path, next] of Object.entries(reviewState)) {
          const previous = existing.reviewState[path as keyof BrandReviewState];
          if (previous && next) transitionBrandReviewState(previous, next);
        }
        const updated = await client.query(
          `update brand_core_versions
              set core_json = $4::jsonb,
                  evidence_json = $5::jsonb,
                  review_state_json = $6::jsonb,
                  updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3
              and updated_at = $7::timestamptz
            returning ${coreColumns}`,
          [
            scope.versionId,
            scope.workspaceId,
            scope.brandId,
            JSON.stringify(core),
            JSON.stringify(evidence),
            JSON.stringify(reviewState),
            input.expectedUpdatedAt,
          ],
        );
        if (!updated.rowCount) throw new Error("brand_core_version_conflict");
        return mapCore(updated.rows[0] as Record<string, unknown>);
      });
    },

    async approve(scope) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope, true);
        const profile = await client.query(
          `select id from brand_profiles
            where workspace_id = $1 and brand_id = $2
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (!profile.rowCount) throw new Error("brand_not_found");
        const current = await client.query(
          `select ${coreColumns}
             from brand_core_versions
            where id = $1 and workspace_id = $2 and brand_id = $3
            for update`,
          [scope.versionId, scope.workspaceId, scope.brandId],
        );
        if (!current.rowCount) throw new Error("brand_core_not_found");
        const target = mapCore(current.rows[0] as Record<string, unknown>);
        if (target.status === "approved") return target;
        if (target.status !== "draft") throw new Error("brand_core_not_draft");
        parseBrandCoreForApproval(target.core);
        parseBrandEvidence(target.evidence);
        parseBrandReviewState(target.reviewState);
        const approvedAt = new Date().toISOString();
        const approvedReview = Object.fromEntries(BRAND_CORE_FIELD_PATHS.map((path) => [
          path,
          { decision: "approved", reviewerUserId: scope.actorUserId, reviewedAt: approvedAt },
        ]));
        await client.query(
          `update brand_core_versions
              set status = 'superseded', updated_at = now()
            where workspace_id = $1 and brand_id = $2 and status = 'approved' and id <> $3`,
          [scope.workspaceId, scope.brandId, scope.versionId],
        );
        const approved = await client.query(
          `update brand_core_versions
              set status = 'approved',
                  review_state_json = $4::jsonb,
                  approved_by_user_id = $5,
                  approved_at = $6::timestamptz,
                  updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'draft'
            returning ${coreColumns}`,
          [
            scope.versionId,
            scope.workspaceId,
            scope.brandId,
            JSON.stringify(approvedReview),
            scope.actorUserId,
            approvedAt,
          ],
        );
        if (!approved.rowCount) throw new Error("brand_core_version_conflict");
        await client.query(
          `update brand_profiles
              set active_brand_core_id = $3
            where workspace_id = $1 and brand_id = $2`,
          [scope.workspaceId, scope.brandId, scope.versionId],
        );
        return mapCore(approved.rows[0] as Record<string, unknown>);
      });
    },

    async getActiveRules(scope) {
      const result = await pool.query(
        `select rules.*
           from brand_profiles profile
           join brand_rule_sets rules
             on rules.id = profile.active_brand_rule_set_id
            and rules.workspace_id = profile.workspace_id
            and rules.brand_id = profile.brand_id
          where profile.workspace_id = $1 and profile.brand_id = $2
            and rules.status = 'approved'`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rowCount ? mapRule(result.rows[0] as Record<string, unknown>) : null;
    },

    async listRuleSets(scope) {
      const result = await pool.query(
        `select ${ruleColumns}
           from brand_rule_sets
          where workspace_id = $1 and brand_id = $2
          order by version desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => mapRule(row as Record<string, unknown>));
    },

    async saveRuleDraft(scope, input) {
      const rules = parseBrandRules(input);
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const profile = await client.query(
          `select id from brand_profiles
            where workspace_id = $1 and brand_id = $2
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (!profile.rowCount) throw new Error("brand_not_found");
        const inserted = await client.query(
          `insert into brand_rule_sets (
             workspace_id, brand_id, version, status, rules_json, created_by, created_by_user_id
           )
           select $1, $2, coalesce(max(version), 0) + 1, 'draft', $3::jsonb, 'user', $4
             from brand_rule_sets where workspace_id = $1 and brand_id = $2
           returning ${ruleColumns}`,
          [scope.workspaceId, scope.brandId, JSON.stringify(rules), scope.actorUserId],
        );
        return mapRule(inserted.rows[0] as Record<string, unknown>);
      });
    },

    async approveRules(scope) {
      return transaction(pool, async (client) => {
        await requireMember(client, scope, true);
        const profile = await client.query(
          `select id from brand_profiles
            where workspace_id = $1 and brand_id = $2
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (!profile.rowCount) throw new Error("brand_not_found");
        const current = await client.query(
          `select ${ruleColumns} from brand_rule_sets
            where id = $1 and workspace_id = $2 and brand_id = $3 for update`,
          [scope.ruleSetId, scope.workspaceId, scope.brandId],
        );
        if (!current.rowCount) throw new Error("brand_rules_not_found");
        const target = mapRule(current.rows[0] as Record<string, unknown>);
        if (target.status === "approved") return target;
        if (target.status !== "draft") throw new Error("brand_rules_not_draft");
        parseBrandRules(target.rules);
        await client.query(
          `update brand_rule_sets set status = 'superseded', updated_at = now()
            where workspace_id = $1 and brand_id = $2 and status = 'approved' and id <> $3`,
          [scope.workspaceId, scope.brandId, scope.ruleSetId],
        );
        const approved = await client.query(
          `update brand_rule_sets
              set status = 'approved', approved_by_user_id = $4,
                  approved_at = now(), updated_at = now()
            where id = $1 and workspace_id = $2 and brand_id = $3 and status = 'draft'
            returning ${ruleColumns}`,
          [scope.ruleSetId, scope.workspaceId, scope.brandId, scope.actorUserId],
        );
        if (!approved.rowCount) throw new Error("brand_rules_version_conflict");
        await client.query(
          `update brand_profiles set active_brand_rule_set_id = $3
            where workspace_id = $1 and brand_id = $2`,
          [scope.workspaceId, scope.brandId, scope.ruleSetId],
        );
        return mapRule(approved.rows[0] as Record<string, unknown>);
      });
    },
  };
}
