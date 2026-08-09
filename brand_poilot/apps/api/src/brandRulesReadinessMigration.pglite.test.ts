import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBrandRulesContentV1 } from "@brand-pilot/content-contracts";

const workspaceId = "10000000-0000-4000-8000-000000000090";
const missingBrandId = "20000000-0000-4000-8000-000000000090";
const invalidBrandId = "20000000-0000-4000-8000-000000000091";
const validBrandId = "20000000-0000-4000-8000-000000000092";
const unavailableStyleBrandId = "20000000-0000-4000-8000-000000000093";

let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  await database.exec(`
    create table brand_profiles (
      workspace_id uuid not null,
      brand_id uuid not null,
      active_brand_core_id uuid,
      active_brand_rule_set_id uuid,
      forbidden_terms jsonb not null default '[]'::jsonb,
      default_cta text,
      auto_approval_enabled boolean not null default false,
      primary key (workspace_id, brand_id)
    );
    create table brand_rule_sets (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null,
      brand_id uuid not null,
      version integer not null,
      status text not null,
      rules_json jsonb not null,
      created_by text not null,
      created_by_user_id uuid,
      approved_by_user_id uuid,
      approved_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, brand_id, version)
    );
    create unique index brand_rule_sets_one_approved
      on brand_rule_sets(workspace_id, brand_id) where status = 'approved';
    create table storage_artifacts (
      id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
      public_url text, path text, mime_type text not null, checksum text not null,
      deleted_at timestamptz
    );
    create table reference_items (
      id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
      kind text not null, archived_at timestamptz, storage_artifact_id uuid
    );

    insert into brand_profiles (
      workspace_id, brand_id, active_brand_core_id, forbidden_terms, default_cta, auto_approval_enabled
    ) values
      ('${workspaceId}', '${missingBrandId}', gen_random_uuid(), '["금지"]', null, true),
      ('${workspaceId}', '${invalidBrandId}', gen_random_uuid(), '[]', '문의하기', false),
      ('${workspaceId}', '${validBrandId}', gen_random_uuid(), '[]', '기본 CTA', false),
      ('${workspaceId}', '${unavailableStyleBrandId}', gen_random_uuid(), '[]', '', false);

    insert into brand_rule_sets (
      id, workspace_id, brand_id, version, status, rules_json, created_by, approved_at
    ) values
      (
        '30000000-0000-4000-8000-000000000091', '${workspaceId}', '${invalidBrandId}', 3,
        'approved',
        '{
          "contractVersion":"brand-rules.v1",
          "requiredPhrases":["기존 문구"],
          "forbiddenPhrases":[],
          "exaggerationRules":[],
          "ctaRules":{"defaultCta":null,"allowed":[]},
          "channelRules":{},
          "designRules":{"colors":[],"fonts":[],"notes":[]},
          "autoApprovalRules":{"enabled":false,"conditions":[]}
        }',
        'migration', now()
      ),
      (
        '30000000-0000-4000-8000-000000000092', '${workspaceId}', '${validBrandId}', 7,
        'approved',
        '{
          "contractVersion":"brand-rules.v1",
          "requiredPhrases":["사용자 문구"],
          "forbiddenPhrases":[],
          "exaggerationRules":[],
          "ctaRules":{"defaultCta":"사용자 CTA","allowed":[]},
          "channelRules":{},
          "designRules":{"colors":[],"fonts":[],"notes":[],"referenceImages":[]},
          "autoApprovalRules":{"enabled":false,"conditions":[]}
        }',
        'user', now()
      ),
      (
        '30000000-0000-4000-8000-000000000093', '${workspaceId}', '${unavailableStyleBrandId}', 1,
        'approved',
        '{
          "contractVersion":"brand-rules.v1",
          "requiredPhrases":[],"forbiddenPhrases":[],"exaggerationRules":[],
          "ctaRules":{"defaultCta":"","allowed":[]},"channelRules":{},
          "designRules":{"colors":[],"fonts":[],"notes":[],"referenceImages":[{
            "referenceItemId":"71000000-0000-4000-8000-000000000093",
            "description":"","tags":[]
          }]},
          "autoApprovalRules":{"enabled":false,"conditions":[]}
        }',
        'user', now()
      );
    update brand_profiles set active_brand_rule_set_id =
      case brand_id
        when '${invalidBrandId}' then '30000000-0000-4000-8000-000000000091'::uuid
        when '${validBrandId}' then '30000000-0000-4000-8000-000000000092'::uuid
        when '${unavailableStyleBrandId}' then '30000000-0000-4000-8000-000000000093'::uuid
      end
    where brand_id in ('${invalidBrandId}', '${validBrandId}', '${unavailableStyleBrandId}');
  `);
}, 30_000);

afterAll(async () => {
  await database.close();
});

describe("076 manual content generation brand-rule repair", () => {
  it("creates missing rules, versions invalid rules, and preserves valid user rules", async () => {
    const migrationPath = resolve(
      process.cwd(),
      "../../db/migrations/076_manual_content_generation_brand_rules.sql",
    );
    let migrationSql: string | null = null;
    try {
      migrationSql = await readFile(migrationPath, "utf8");
    } catch {
      // The assertion below is the RED state before migration 076 exists.
    }
    expect(migrationSql).not.toBeNull();
    await database.exec(migrationSql!);

    const rows = await database.query<{
      brand_id: string;
      id: string;
      version: number;
      status: string;
      created_by: string;
      rules_json: unknown;
    }>(`
      select profile.brand_id, rules.id, rules.version, rules.status, rules.created_by, rules.rules_json
        from brand_profiles profile
        join brand_rule_sets rules on rules.id = profile.active_brand_rule_set_id
       order by profile.brand_id
    `);
    expect(rows.rows).toHaveLength(4);
    for (const row of rows.rows) expect(() => parseBrandRulesContentV1(row.rules_json)).not.toThrow();

    expect(rows.rows.find((row) => row.brand_id === missingBrandId)).toMatchObject({
      version: 1,
      status: "approved",
      created_by: "migration",
      rules_json: {
        forbiddenPhrases: ["금지"],
        ctaRules: { defaultCta: "", allowed: [] },
        designRules: { referenceImages: [] },
      },
    });
    expect(rows.rows.find((row) => row.brand_id === invalidBrandId)).toMatchObject({
      version: 4,
      status: "approved",
      rules_json: {
        requiredPhrases: ["기존 문구"],
        ctaRules: { defaultCta: "문의하기", allowed: [] },
        designRules: { referenceImages: [] },
      },
    });
    expect(rows.rows.find((row) => row.brand_id === validBrandId)).toMatchObject({
      id: "30000000-0000-4000-8000-000000000092",
      version: 7,
      status: "approved",
      created_by: "user",
    });
    expect(rows.rows.find((row) => row.brand_id === unavailableStyleBrandId)).toMatchObject({
      version: 2,
      status: "approved",
      created_by: "migration",
      rules_json: { designRules: { referenceImages: [] } },
    });

    const invalidHistory = await database.query<{ version: number; status: string }>(
      `select version, status from brand_rule_sets
        where workspace_id = $1 and brand_id = $2 order by version`,
      [workspaceId, invalidBrandId],
    );
    expect(invalidHistory.rows).toEqual([
      { version: 3, status: "superseded" },
      { version: 4, status: "approved" },
    ]);
  }, 30_000);
});
