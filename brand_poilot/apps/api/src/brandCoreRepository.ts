import type { Pool, PoolClient } from "pg";
import {
  BRAND_CORE_FIELD_PATHS,
  parseBrandCoreDraft,
  parseBrandCoreForApproval,
  parseBrandEvidence,
  parseBrandReviewState,
  parseBrandRules,
  type BrandCoreV1,
  type BrandCoreFieldPath,
  type BrandEvidenceItem,
  type BrandFieldReview,
  type BrandReviewState,
  type BrandRulesV2,
} from "./brandCoreContracts.js";
import {
  ensureActiveApprovedBrandRules,
} from "./brandRulesReadiness.js";
import { parseCompatibleBrandRulesContentV2 } from "@brand-pilot/content-contracts";

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
  rules: BrandRulesV2;
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

export interface ApproveBrandCoreDraft {
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
    input: ApproveBrandCoreDraft,
  ): Promise<BrandCoreVersion>;
  getActiveRules(scope: BrandScope): Promise<BrandRuleSet | null>;
  listRuleSets(scope: BrandScope): Promise<BrandRuleSet[]>;
  saveRuleDraft(
    scope: BrandScope & { actorUserId: string },
    input: BrandRulesV2,
  ): Promise<BrandRuleSet>;
  approveRules(
    scope: BrandScope & { actorUserId: string; ruleSetId: string },
  ): Promise<BrandRuleSet>;
}

const coreColumns = `id, workspace_id, brand_id, source_analysis_id, version, status,
  core_json, evidence_json, review_state_json, created_by, created_by_user_id,
  approved_by_user_id, approved_at, created_at,
  to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at`;
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

function concurrencyToken(value: unknown): string {
  if (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)
  ) return value;
  return iso(value)!;
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
    updatedAt: concurrencyToken(row.updated_at),
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

function mapHistoricalRule(row: Record<string, unknown>): BrandRuleSet {
  try {
    return mapRule(row);
  } catch {
    return mapRule({
      ...row,
      rules_json: parseCompatibleBrandRulesContentV2(json(row.rules_json, {})),
    });
  }
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

function coreField(core: BrandCoreV1, path: BrandCoreFieldPath): unknown {
  switch (path) {
    case "summary.oneLine": return core.summary.oneLine;
    case "summary.description": return core.summary.description;
    case "audiences": return core.audiences;
    case "valueProposition.primary": return core.valueProposition.primary;
    case "valueProposition.differentiators": return core.valueProposition.differentiators;
    case "valueProposition.proofPoints": return core.valueProposition.proofPoints;
    case "messaging.appeals": return core.messaging.appeals;
    case "messaging.tone": return core.messaging.tone;
    case "messaging.preferredPhrases": return core.messaging.preferredPhrases;
    case "messaging.brandDirection": return core.messaging.brandDirection;
    case "messaging.priorityMessages": return core.messaging.priorityMessages;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedCoreFields(previous: BrandCoreV1, next: BrandCoreV1): Set<BrandCoreFieldPath> {
  return new Set(BRAND_CORE_FIELD_PATHS.filter(
    (path) => !sameValue(coreField(previous, path), coreField(next, path)),
  ));
}

function reviewStateForEdit(
  previous: BrandCoreV1,
  next: BrandCoreV1,
  previousReviewState: BrandReviewState,
  actorUserId: string,
  reviewedAt: string,
): BrandReviewState {
  const changed = changedCoreFields(previous, next);
  return Object.fromEntries(BRAND_CORE_FIELD_PATHS.map((path) => {
    const review: BrandFieldReview = changed.has(path)
      ? { decision: "user_edited", reviewerUserId: actorUserId, reviewedAt }
      : previousReviewState[path]
        ?? { decision: "ai_suggested", reviewerUserId: null, reviewedAt: null };
    return [path, review];
  })) as BrandReviewState;
}

function evidenceForEdit(
  previous: BrandCoreV1,
  next: BrandCoreV1,
  previousEvidence: BrandEvidenceItem[],
  nextEvidence: BrandEvidenceItem[],
): BrandEvidenceItem[] {
  const changed = changedCoreFields(previous, next);
  return [
    ...previousEvidence.filter((item) => !changed.has(item.fieldPath)),
    ...nextEvidence.filter((item) => changed.has(item.fieldPath)),
  ];
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
      const requestedReviewState = input.reviewState
        ? parseBrandReviewState(input.reviewState)
        : initialReviewState();
      return transaction(pool, async (client) => {
        await requireMember(client, scope);
        const profile = await client.query(
          `select id, active_brand_core_id from brand_profiles
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
        const existingDraft = await client.query(
          `select ${coreColumns}
             from brand_core_versions
            where workspace_id = $1 and brand_id = $2 and status = 'draft'
            order by version desc
            limit 1
            for update`,
          [scope.workspaceId, scope.brandId],
        );
        if (existingDraft.rowCount) {
          return mapCore(existingDraft.rows[0] as Record<string, unknown>);
        }
        let reviewState = requestedReviewState;
        let storedEvidence = evidence;
        if (profile.rows[0]?.active_brand_core_id) {
          const activeResult = await client.query(
            `select ${coreColumns}
               from brand_core_versions
              where id = $1 and workspace_id = $2 and brand_id = $3`,
            [
              profile.rows[0].active_brand_core_id,
              scope.workspaceId,
              scope.brandId,
            ],
          );
          if (activeResult.rowCount) {
            const active = mapCore(activeResult.rows[0] as Record<string, unknown>);
            reviewState = reviewStateForEdit(
              active.core,
              core,
              active.reviewState,
              scope.actorUserId,
              new Date().toISOString(),
            );
            storedEvidence = evidenceForEdit(active.core, core, active.evidence, evidence);
          }
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
           on conflict (workspace_id, brand_id) where status = 'draft' do nothing
           returning ${coreColumns}`,
          [
            scope.workspaceId,
            scope.brandId,
            input.sourceAnalysisId,
            JSON.stringify(core),
            JSON.stringify(storedEvidence),
            JSON.stringify(reviewState),
            scope.actorUserId,
          ],
        );
        if (inserted.rowCount) {
          return mapCore(inserted.rows[0] as Record<string, unknown>);
        }
        const concurrentDraft = await client.query(
          `select ${coreColumns}
             from brand_core_versions
            where workspace_id = $1 and brand_id = $2 and status = 'draft'
            order by version desc
            limit 1`,
          [scope.workspaceId, scope.brandId],
        );
        if (!concurrentDraft.rowCount) throw new Error("brand_core_version_conflict");
        return mapCore(concurrentDraft.rows[0] as Record<string, unknown>);
      });
    },

    async updateDraft(scope, input) {
      const core = parseBrandCoreDraft(input.core);
      const evidence = parseBrandEvidence(input.evidence);
      parseBrandReviewState(input.reviewState);
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
        const reviewState = reviewStateForEdit(
          existing.core,
          core,
          existing.reviewState,
          scope.actorUserId,
          new Date().toISOString(),
        );
        const storedEvidence = evidenceForEdit(existing.core, core, existing.evidence, evidence);
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
            JSON.stringify(storedEvidence),
            JSON.stringify(reviewState),
            input.expectedUpdatedAt,
          ],
        );
        if (!updated.rowCount) throw new Error("brand_core_version_conflict");
        return mapCore(updated.rows[0] as Record<string, unknown>);
      });
    },

    async approve(scope, input) {
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
        if (
          new Date(target.updatedAt).getTime()
          !== new Date(input.expectedUpdatedAt).getTime()
        ) {
          throw new Error("brand_core_version_conflict");
        }
        if (target.status === "approved") {
          await ensureActiveApprovedBrandRules(client, {
            workspaceId: scope.workspaceId,
            brandId: scope.brandId,
            createdBy: "user",
            actorUserId: scope.actorUserId,
          });
          return target;
        }
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
              and updated_at = $7::timestamptz
            returning ${coreColumns}`,
          [
            scope.versionId,
            scope.workspaceId,
            scope.brandId,
            JSON.stringify(approvedReview),
            scope.actorUserId,
            approvedAt,
            input.expectedUpdatedAt,
          ],
        );
        if (!approved.rowCount) throw new Error("brand_core_version_conflict");
        await client.query(
          `update brand_profiles
              set active_brand_core_id = $3
            where workspace_id = $1 and brand_id = $2`,
          [scope.workspaceId, scope.brandId, scope.versionId],
        );
        await ensureActiveApprovedBrandRules(client, {
          workspaceId: scope.workspaceId,
          brandId: scope.brandId,
          createdBy: "user",
          actorUserId: scope.actorUserId,
        });
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
      return result.rowCount ? mapHistoricalRule(result.rows[0] as Record<string, unknown>) : null;
    },

    async listRuleSets(scope) {
      const result = await pool.query(
        `select ${ruleColumns}
           from brand_rule_sets
          where workspace_id = $1 and brand_id = $2
          order by version desc`,
        [scope.workspaceId, scope.brandId],
      );
      return result.rows.map((row) => mapHistoricalRule(row as Record<string, unknown>));
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
        const targetRules = parseBrandRules(target.rules);
        if (target.status === "approved") return target;
        if (target.status !== "draft") throw new Error("brand_rules_not_draft");
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
