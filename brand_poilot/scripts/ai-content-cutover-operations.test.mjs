import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

test("cutover dispatcher uses only pinned images and the staged 073a/074/075 runner", async () => {
  const source = await read("deploy/scripts/ai-content-cutover.sh");
  for (const mode of [
    "--plan-role-bootstrap", "--apply-role-bootstrap", "--run-proposal-preflight", "--apply-073a", "--apply-074-stage",
    "--consume-074-attestation", "--abort-pre-marker", "--execute-075",
    "--restore-shared-owners", "--verify-backend", "--complete",
  ]) assert.match(source, new RegExp(mode.replaceAll("-", "\\-")));
  assert.match(source, /RELEASE_MANIFEST\[API_IMAGE\]/);
  assert.match(source, /verify_release_image_revision/);
  assert.match(source, /scripts\/migrate\.mjs/);
  assert.match(source, /scripts\/ai-content-database-roles\.mjs[\s\S]*--apply/);
  assert.match(source, /shared\/secrets\/ai-content-application-database-url/);
  assert.match(source, /ai_content_role_bootstrap_state_incomplete/);
  assert.match(source, /cmp -s "\$source" "\$target"/);
  assert.match(source, /--bootstrap-074-prerequisite/);
  assert.match(source, /SUPABASE_DATABASE_URL_FILE/);
  assert.match(source, /AI_CONTENT_075_PREFLIGHT_EVIDENCE_FILE/);
  assert.match(source, /'"status":"abandoned_pre_marker"'/);
  assert.match(source, /remove_state_file "\$ROOT\/state\/ai-content-cutover-id"/);
  assert.doesNotMatch(source, /npm\s+run\s+db:migrate|AI_CONTENT_075_BYPASS_TOKEN=/);
});

test("073a is a provider prerequisite before role bootstrap and does not depend on cutover roles", async () => {
  const source = await read("deploy/scripts/ai-content-cutover.sh");
  const run073a = source.slice(source.indexOf("run_073a()"), source.indexOf("load_bootstrap_inputs()"));
  assert.match(run073a, /option admin-url-file/);
  assert.match(run073a, /SUPABASE_DATABASE_URL_FILE=\/run\/secrets\/admin-database-url/);
  assert.match(run073a, /AI_CONTENT_074_PREREQUISITE_PROVIDER_ROLE=postgres/);
  assert.doesNotMatch(run073a, /load_role_environment|ROLE_ENV|migration-url-file/);

  const dispatch = source.slice(source.lastIndexOf('case "$MODE"'));
  assert.ok(
    dispatch.indexOf("--apply-073a)") < dispatch.indexOf("--plan-role-bootstrap)"),
    "provider 073a must be presented before role plan/apply in the cutover dispatcher",
  );
});

test("cutover database containers receive only the production database CA projection", async () => {
  const source = await read("deploy/scripts/ai-content-cutover.sh");
  const runtime = source.slice(
    source.indexOf("database_tls_environment()"),
    source.indexOf("role_environment()"),
  );
  assert.match(runtime, /shared\/env\/api\.env/);
  assert.match(runtime, /DB_SSL_CA_BASE64/);
  assert.match(runtime, /--env/);
  assert.doesNotMatch(runtime, /--env-file/);
  assert.doesNotMatch(runtime, /SUPABASE_DATABASE_URL|WORKER_API_TOKEN|SESSION_SECRET/);
  assert.ok(runtime.indexOf("database_tls_environment") < runtime.indexOf("docker_runtime_prefix"));
});

test("post-075 lifecycle keeps maintenance across restore and rollout verification, then completes", async () => {
  const source = await read("deploy/scripts/ai-content-cutover.sh");
  const restore = source.slice(source.indexOf("run_restore_shared_owners()"), source.indexOf("run_verify_backend()"));
  const backend = source.slice(source.indexOf("run_verify_backend()"), source.indexOf("run_complete_cutover()"));
  const complete = source.slice(source.indexOf("run_complete_cutover()"), source.indexOf("for command_name"));

  assert.match(restore, /ai-content-database-roles\.mjs --restore-shared-owners/);
  assert.match(restore, /ai-content-shared-owner-restore-evidence\.v1/);
  assert.match(restore, /ai_content_shared_owner_restore_state_incomplete/);
  assert.doesNotMatch(restore, /--verify-backend|--retire-cleanup-role|--complete|remove_state_file/);

  assert.match(backend, /option backend-evidence-file/);
  assert.match(backend, /ai-content-cutover-control\.mjs --verify-backend/);
  for (const service of [
    "content-proposal-worker", "image-worker",
    "card-news-worker", "blog-worker", "reel-worker",
  ]) assert.match(backend, new RegExp(service));
  assert.doesNotMatch(backend, /subject-analysis-worker|brand-intelligence-worker|dm-worker|wiki-worker/);
  assert.match(backend, /shared-owner-restore-evidence-sha256/);
  assert.doesNotMatch(backend, /--retire-cleanup-role|--complete|remove_state_file/);

  assert.match(complete, /ai-content-database-roles\.mjs --retire-cleanup-role/);
  assert.match(complete, /ai_content_cleanup_role_retirement_state_incomplete/);
  assert.match(complete, /ai-content-cutover-control\.mjs --complete/);
  assert.match(complete, /'"status":"completed"'/);
  assert.match(complete, /'"maintenanceEnabled":false'/);
  assert.ok(complete.indexOf("--retire-cleanup-role") < complete.indexOf("--complete"));
  assert.ok(complete.indexOf("--complete") < complete.indexOf('remove_state_file "$ROOT/state/ai-content-cutover-id"'));
});

test("only API services receive the restricted AI-content database secret", async () => {
  const compose = await read("deploy/compose.production.yml");
  const mounts = compose.match(/ai_content_application_database_url/g) ?? [];
  assert.equal(mounts.length, 4, "primary and canary each declare one env path and one mount target");
  const serviceBlock = (name) => {
    const start = compose.indexOf(`  ${name}:`);
    assert.notEqual(start, -1, `${name} service is missing`);
    const next = compose.slice(start + 3).search(/\r?\n  [a-z0-9-]+:/);
    return next === -1 ? compose.slice(start) : compose.slice(start, start + 3 + next);
  };
  const runtimeUser = 'user: "${CODEX_RUNTIME_UID:?CODEX_RUNTIME_UID is required}:${CODEX_RUNTIME_GID:?CODEX_RUNTIME_GID is required}"';
  for (const service of ["api-primary", "api-canary"]) {
    assert.match(
      serviceBlock(service),
      new RegExp(`^ {4}${runtimeUser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
      `${service} must run as the owner of its mode-600 database secret`,
    );
  }
  const workerSection = compose.slice(compose.indexOf("content-proposal-worker-1:"));
  assert.doesNotMatch(workerSection, /AI_CONTENT_DATABASE_URL_FILE|ai_content_application_database_url/);
});

test("marker verifier and generic rollback fail closed through the exact operator function", async () => {
  const [verify, rollback, lib, control, migration] = await Promise.all([
    read("deploy/scripts/verify-ai-content-cutover.sh"),
    read("deploy/scripts/rollback.sh"),
    read("deploy/scripts/lib.sh"),
    read("scripts/ai-content-cutover-control.mjs"),
    read("db/migrations/074_ai_content_maintenance_write_fence.sql"),
  ]);
  assert.match(verify, /--assert-rollback-allowed/);
  assert.match(verify, /ai-content-cutover-control\.mjs/);
  assert.match(verify, /--env-file "\$\{RELEASE_MANIFEST\[API_ENV_FILE\]\}"/);
  assert.match(rollback, /enforce_ai_content_roll_forward_floor/);
  assert.ok(rollback.indexOf("enforce_ai_content_roll_forward_floor") < rollback.indexOf('"${compose[@]}" up'));
  assert.match(rollback, /validate_normal_rollback_target/);
  assert.doesNotMatch(rollback, /validate_release_directory[^\n]*legacy-current/);
  assert.match(lib, /ai_content_cutover_abort_pre_marker_required/);
  assert.match(lib, /legacy_release_rollback_forbidden/);
  assert.match(control, /read_ai_content_cutover_control_state/);
  assert.match(migration, /create function read_ai_content_cutover_control_state\(p_cutover_id uuid\)/i);
  assert.match(migration, /p_preflight_identity_sha256 text/);
  assert.doesNotMatch(migration, /digest\(p_preflight_identity_json::text/);
});

test("normal rollback distinguishes no cutover, pre-marker abort, marker floor, and verifier failure", (t) => {
  const bash = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync)
    : ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  if (!bash) return t.skip("bash unavailable");
  const toBash = (path) => {
    const normalized = resolve(path).replaceAll("\\", "/");
    return process.platform === "win32"
      ? normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
      : normalized;
  };
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-cutover-floor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  mkdirSync(state);
  const runner = join(directory, "run.sh");
  writeFileSync(runner, `#!/usr/bin/env bash
set -Eeuo pipefail
source "${toBash("deploy/scripts/lib.sh")}"
require_secure_state_file() { [[ -f "$1" && ! -L "$1" ]]; }
ai_content_cutover_marker_present() {
  [[ "\${MARKER_STATUS:-none}" == none ]] && return 1
  return "\$MARKER_STATUS"
}
enforce_ai_content_roll_forward_floor "${toBash(directory)}"
`, "utf8");
  chmodSync(runner, 0o755);

  const run = (status, active) => {
    const activeFile = join(state, "ai-content-cutover-id");
    if (active) writeFileSync(activeFile, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\n", "utf8");
    else if (existsSync(activeFile)) rmSync(activeFile);
    return spawnSync(bash, [toBash(runner)], {
      encoding: "utf8", env: { ...process.env, MARKER_STATUS: status },
    });
  };
  assert.equal(run("none", false).status, 0);
  assert.match(run("1", true).stderr, /ai_content_cutover_abort_pre_marker_required/);
  assert.match(run("0", true).stderr, /ai_content_cutover_roll_forward_only/);
  assert.match(run("2", true).stderr, /ai_content_cutover_floor_query_failed/);

  const legacySha = "b".repeat(40);
  const legacyDirectory = join(directory, "releases", legacySha);
  mkdirSync(legacyDirectory, { recursive: true });
  writeFileSync(join(legacyDirectory, "release.env"), "RELEASE_SCHEMA=2\n", "utf8");
  const legacy = spawnSync(bash, ["-lc", [
    `source '${toBash("deploy/scripts/lib.sh")}'`,
    `validate_normal_rollback_target '${toBash(directory)}' '${legacySha}'`,
  ].join("; ")], { encoding: "utf8" });
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /legacy_release_rollback_forbidden/);
});

test("cutover tools are integrity-bound and present in the two owning images", async () => {
  const [lib, apiDockerfile, proposalDockerfile] = await Promise.all([
    read("deploy/scripts/lib.sh"), read("apps/api/Dockerfile"),
    read("workers/brand-pilot-content-proposal-worker/Dockerfile"),
  ]);
  assert.match(lib, /755 scripts\/ai-content-cutover\.sh/);
  assert.match(lib, /755 scripts\/verify-ai-content-cutover\.sh/);
  assert.match(apiDockerfile, /ai-content-cutover-control\.mjs/);
  assert.match(apiDockerfile, /ai-content-cutover-floor-probe\.mjs/);
  assert.match(apiDockerfile, /ai-content-database-roles\.mjs/);
  assert.match(proposalDockerfile, /ai-content-proposal-schema-preflight\.mjs/);
});

test("proposal preflight uses the host owner identity without requiring image UID equality", async () => {
  const source = await read("deploy/scripts/ai-content-cutover.sh");
  const preflight = source.slice(
    source.indexOf("run_proposal_preflight()"),
    source.indexOf("require_active_cutover()"),
  );
  assert.match(preflight, /runtime_uid="\$\(id -u\)"/);
  assert.match(preflight, /runtime_gid="\$\(id -g\)"/);
  assert.match(preflight, /--user "\$runtime_uid:\$runtime_gid"/);
  assert.doesNotMatch(preflight, /\$image_uid" == "\$\(id -u\)"/);
});
