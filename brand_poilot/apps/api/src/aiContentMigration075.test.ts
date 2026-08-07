import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../../../db/migrations/075_ai_content_three_format_cutover.sql", import.meta.url));
const maintenanceMigrationPath = fileURLToPath(new URL(
  "../../../db/migrations/074_ai_content_maintenance_write_fence.sql",
  import.meta.url,
));

describe("075 content-generation cutover invariants", () => {
  it("keeps proposal selection invoker-bound and privileged mutations application-gated", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const invokerSignature = "create or replace function public.select_ai_content_proposal(";
    const invokerStart = sql.indexOf(invokerSignature);
    const invokerEnd = sql.indexOf("\n$$;", invokerStart);
    expect(invokerStart).toBeGreaterThanOrEqual(0);
    expect(invokerEnd).toBeGreaterThan(invokerStart);
    const invokerDefinition = sql.slice(invokerStart, invokerEnd);
    expect(invokerDefinition).toMatch(/language\s+plpgsql\s+security\s+invoker/i);
    expect(invokerDefinition).not.toMatch(/security\s+definer/i);
    expect(invokerDefinition).toMatch(/set\s+search_path=pg_catalog,public,pg_temp/i);

    for (const signature of [
      "create function transition_ai_content_generation_operation(",
      "create function create_ai_content_generation_prompt_binding(",
    ]) {
      const start = sql.indexOf(signature);
      const end = sql.indexOf("\n$$;", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const definition = sql.slice(start, end);
      expect(definition).toMatch(/language\s+plpgsql\s+security\s+definer/i);
      expect(definition).toMatch(/session_user<>bootstrap\.application_role_name::text/i);
      expect(definition).toMatch(/set\s+search_path=pg_catalog,public,pg_temp/i);
    }
  });

  it("allows failed retries but enforces one successful lineage per job and batch", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toMatch(
      /create unique index ai_content_proposal_attempt_events_one_success_per_job\s+on ai_content_proposal_attempt_events\(job_id\)\s+where event_type='attempt_succeeded'/i,
    );
    expect(sql).toMatch(
      /create unique index ai_content_proposal_jobs_one_completed_per_batch\s+on ai_content_proposal_jobs\(batch_id\)\s+where status='completed'/i,
    );
    expect(sql.indexOf("delete from ai_content_proposal_jobs;")).toBeLessThan(
      sql.indexOf("create unique index ai_content_proposal_jobs_one_completed_per_batch"),
    );
  });

  it("revokes PUBLIC execution from generation SECURITY DEFINER trigger functions", async () => {
    const [sql, maintenanceSql] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(maintenanceMigrationPath, "utf8"),
    ]);
    expect(sql).toMatch(/final_catalog_sha256:=register_ai_content_075_fence_relations\(\)/i);
    const registrationStart = maintenanceSql.indexOf(
      "create function register_ai_content_075_fence_relations() returns text",
    );
    const registrationEnd = maintenanceSql.indexOf("\n$$;", registrationStart);
    const registration = maintenanceSql.slice(registrationStart, registrationEnd);
    for (const identity of [
      "public.enforce_ai_content_generation_operation_identity()",
      "public.enforce_ai_content_prompt_binding_source()",
    ]) {
      expect(registration).toContain(`'${identity}'`);
    }
    expect(registration).toMatch(
      /apply_ai_content_075_acl_command\(\s*'REVOKE','function:'\|\|missing_relations,'PUBLIC','ALL'\)/i,
    );
  });
});
