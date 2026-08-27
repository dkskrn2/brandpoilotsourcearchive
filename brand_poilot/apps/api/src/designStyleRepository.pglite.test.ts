import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDesignStyleRepository } from "./designStyleRepository.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001", brand: "20000000-0000-4000-8000-000000000002",
  user: "30000000-0000-4000-8000-000000000003", reference: "40000000-0000-4000-8000-000000000004",
  artifact: "50000000-0000-4000-8000-000000000005",
};
function pool(database: PGlite): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
  };
  return { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
}
const analysis = {
  contractVersion: "design-style-analysis.v1" as const,
  layout: { composition: ["중앙 정렬"], hierarchy: [], spacing: [], alignment: [], recurringModules: [] },
  typography: { families: [], weightHierarchy: [], scale: [], placement: [] },
  color: { palette: ["보라색 강조"], contrast: [], background: [], accentUsage: [] },
  graphics: { media: [], shapes: [], icons: [], texture: [] },
  visualCues: { comparison: [], humor: [], practicality: [], empathy: [] },
  promptGuidance: { use: ["큰 제목"], avoid: [] },
};

describe("design style repository", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    await database.exec(`
      create table workspace_members(workspace_id uuid,user_id uuid,role text,status text);
      create table brands(id uuid,workspace_id uuid,deleted_at timestamptz);
      create table storage_artifacts(id uuid,workspace_id uuid,brand_id uuid,public_url text,path text,mime_type text,byte_size bigint,checksum text,deleted_at timestamptz);
      create table reference_items(id uuid,workspace_id uuid,brand_id uuid,storage_artifact_id uuid,archived_at timestamptz);
      create table brand_design_styles(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,name text,revision int default 1,analysis_status text default 'queued',analysis_contract_version text,analysis_json jsonb,analysis_sha256 text,analysis_error_code text,created_by_user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      create table brand_design_style_references(id uuid default gen_random_uuid(),workspace_id uuid,brand_id uuid,design_style_id uuid,reference_item_id uuid,position int);
      create table brand_design_style_analysis_jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,design_style_id uuid,style_revision int,status text default 'queued',attempt_count int default 0,max_attempts int default 3,available_at timestamptz default now(),leased_by text,lease_token uuid,lease_expires_at timestamptz,error_code text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table brand_avatars(id uuid,workspace_id uuid,brand_id uuid,revision int,name text,description text,status text);
      create table brand_avatar_images(id uuid,workspace_id uuid,brand_id uuid,avatar_id uuid,position int,is_representative bool,storage_url text,storage_path text,mime_type text,checksum text);
      create table brand_style_presets(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,name text,design_style_id uuid,avatar_id uuid,revision int default 1,is_default bool default false,status text default 'active',created_by_user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      insert into workspace_members values('${ids.workspace}','${ids.user}','owner','active');
      insert into brands values('${ids.brand}','${ids.workspace}',null);
      insert into storage_artifacts values('${ids.artifact}','${ids.workspace}','${ids.brand}','https://blob.example/style.png','style.png','image/png',4,'${"a".repeat(64)}',null);
      insert into reference_items values('${ids.reference}','${ids.workspace}','${ids.brand}','${ids.artifact}',null);
    `);
  }, 30_000);
  afterAll(async () => database.close());

  it("allows an analyzing preset but gates default until the exact style revision is ready", async () => {
    const repository = createDesignStyleRepository(pool(database));
    const scope = { workspaceId: ids.workspace, brandId: ids.brand, actorUserId: ids.user };
    const style = await repository.createDesignStyle(scope, {
      contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: [ids.reference],
    });
    const preset = await repository.createVisualPreset(scope, {
      contractVersion: "visual-preset-input.v1", name: "비교형", designStyleId: style.id, avatarId: null, isDefault: false,
    });
    expect(preset.usability).toEqual({ usable: false, reason: "style_analyzing" });
    await expect(repository.setDefaultVisualPreset({ ...scope, presetId: preset.id })).rejects.toThrow("visual_preset_not_usable");

    const job = await repository.claimDesignStyleAnalysis("worker-1", 60);
    expect(job?.images).toHaveLength(1);
    await expect(repository.completeDesignStyleAnalysis({
      jobId: job!.jobId, workerId: "worker-1", leaseToken: job!.leaseToken,
      designStyleId: style.id, styleRevision: style.revision, analysis, analysisSha256: "b".repeat(64),
    })).rejects.toThrow("design_style_analysis_hash_mismatch");
    expect(await repository.completeDesignStyleAnalysis({
      jobId: job!.jobId, workerId: "worker-1", leaseToken: job!.leaseToken,
      designStyleId: style.id, styleRevision: style.revision, analysis,
      analysisSha256: createHash("sha256").update(JSON.stringify(analysis)).digest("hex"),
    })).toBe(true);
    await expect(repository.completeDesignStyleAnalysis({
      jobId: job!.jobId, workerId: "worker-1", leaseToken: job!.leaseToken,
      designStyleId: style.id, styleRevision: style.revision, analysis,
      analysisSha256: createHash("sha256").update(JSON.stringify(analysis)).digest("hex"),
    })).resolves.toBe(false);
    const defaultPreset = await repository.setDefaultVisualPreset({ ...scope, presetId: preset.id });
    expect(defaultPreset).toMatchObject({
      isDefault: true, usability: { usable: true, reason: null },
    });
    await database.query("update workspace_members set role='member' where workspace_id=$1 and user_id=$2", [ids.workspace, ids.user]);
    await expect(repository.updateVisualPreset({
      ...scope, presetId: preset.id, expectedRevision: defaultPreset.revision,
    }, {
      contractVersion: "visual-preset-input.v1", name: "비교형", designStyleId: style.id,
      avatarId: null, isDefault: false,
    })).rejects.toThrow("design_style_admin_required");
  }, 30_000);
});
