import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const LIB = "deploy/scripts/lib.sh";
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function findBash() {
  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\bin\\bash.exe",
        "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      ]
    : ["/usr/bin/bash", "/bin/bash"];
  return candidates.find(existsSync);
}

function bashPath(path) {
  const absolute = resolve(path).replaceAll("\\", "/");
  if (process.platform !== "win32") return absolute;
  return absolute.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function writeRunner(directory, body) {
  const runner = join(directory, "run.sh");
  writeFileSync(runner, `#!/usr/bin/env bash\nset -Eeuo pipefail\n${body}\n`, "utf8");
  chmodSync(runner, 0o755);
  return runner;
}

function runRunner(bash, runner, env = {}) {
  return spawnSync(bash, [bashPath(runner)], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("all generic mutation entry points guard before mutation and reconciliation guards again under lock", () => {
  const entryPoints = new Map([
    ["deploy/scripts/deploy.sh", "mkdir -p --"],
    ["deploy/scripts/promote.sh", 'exec 9>"$ROOT/state/deploy.lock"'],
    ["deploy/scripts/rollout-workers.sh", "mkdir -p --"],
    ["deploy/scripts/preflight.sh", "mkdir -p --"],
    ["deploy/scripts/backup-state.sh", "mkdir -p --"],
  ]);

  for (const [path, firstMutation] of entryPoints) {
    const source = readFileSync(path, "utf8");
    const guards = [...source.matchAll(/enforce_ai_content_roll_forward_floor "\$ROOT"/g)]
      .map((match) => match.index);
    const mutationIndex = source.indexOf(firstMutation);
    const lockIndex = source.indexOf("flock -n 9");
    const reconcileIndex = source.indexOf("reconcile_transition_or_fail");
    assert.ok(guards.length >= 1, `${path} must guard before mutation`);
    assert.ok(guards[0] < mutationIndex, `${path} mutates before its first floor guard`);
    assert.ok(guards[0] < reconcileIndex, `${path} reconciles before its entry-point floor guard`);
    assert.ok(lockIndex < reconcileIndex, `${path} must hold the deploy lock before guarded reconciliation`);
  }

  const lib = readFileSync(LIB, "utf8");
  assert.match(
    lib,
    /reconcile_transition_or_fail\(\) \{[\s\S]*?enforce_ai_content_roll_forward_floor "\$1"[\s\S]*?reconcile_transition "\$@"/,
  );
  assert.match(lib, /\/app\/scripts\/ai-content-cutover-floor-probe\.mjs/);
  const probe = readFileSync("scripts/ai-content-cutover-floor-probe.mjs", "utf8");
  assert.match(probe, /select exists[\s\S]*075_ai_content_three_format_cutover\.sql/);
  assert.match(lib, /docker run --rm --pull never --read-only/);
  const statusQuery = lib.slice(
    lib.indexOf("query_ai_content_cutover_status()"),
    lib.indexOf("validate_ai_content_completed_floor()"),
  );
  assert.match(statusQuery, /load_required_state_sha "\$root\/state\/current" current_sha/);
  assert.match(statusQuery, /\$root\/releases\/\$current_sha\/scripts\/verify-ai-content-cutover\.sh/);
  assert.doesNotMatch(statusQuery, /dirname -- "\$\{BASH_SOURCE\[0\]\}"/);
});

test("the marker probe uses the operator security-definer snapshot without requiring table ACLs", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-marker-probe-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const capturedArguments = join(directory, "docker-arguments.txt");
  const runner = writeRunner(directory, `
source "${bashPath(LIB)}"
require_command() { :; }
resolve_ai_content_floor_database_input() {
  printf -v "$2" '%s' "/unused/operator-url"
  printf -v "$3" '%s' "operator"
}
resolve_ai_content_floor_probe_image() { printf '%s\\n' 'example.invalid/api@sha256:${"a".repeat(64)}'; }
resolve_ai_content_floor_tls_environment() { printf '%s\\0' --env DB_SSL_CA_BASE64=YWJj; }
docker() {
  printf '%s\\n' "$@" > "$CAPTURED_ARGUMENTS"
  printf 'true\\n'
}
probe_ai_content_075_marker "/unused/root"
`);
  const result = runRunner(bash, runner, { CAPTURED_ARGUMENTS: bashPath(capturedArguments) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "true\n");
  const argumentsText = readFileSync(capturedArguments, "utf8");
  assert.match(argumentsText, /\/app\/scripts\/ai-content-cutover-floor-probe\.mjs/);
  assert.match(argumentsText, /--input-kind\r?\noperator/);
  assert.match(argumentsText, /--env\r?\nDB_SSL_CA_BASE64=YWJj/);
  assert.doesNotMatch(argumentsText, /--eval/);
  const probe = readFileSync("scripts/ai-content-cutover-floor-probe.mjs", "utf8");
  assert.match(probe, /read_ai_content_cutover_control_state\('00000000-0000-0000-0000-000000000000'::uuid\)/);
  assert.match(probe, /marker_present/);
  const syntax = spawnSync(process.execPath, ["--check", "scripts/ai-content-cutover-floor-probe.mjs"], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("five unsafe floor states reach neither transition reconciliation nor state mutation", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-roll-forward-floor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  mkdirSync(state);
  const mutationLog = join(directory, "mutation.log");
  const runner = writeRunner(directory, `
source "${bashPath(LIB)}"
require_secure_state_file() {
  [[ -f "$1" && ! -L "$1" ]] || fail "state_file_invalid"
}
probe_ai_content_075_marker() {
  case "$MARKER_STATE" in
    true|false) printf '%s\\n' "$MARKER_STATE" ;;
    error) return 1 ;;
    *) return 2 ;;
  esac
}
validate_ai_content_completed_floor() {
  [[ "\${COMPLETED_STATE:-missing}" == valid ]]
}
reconcile_transition() {
  printf 'reconcile-called\\n' >> "$MUTATION_LOG"
}
reconcile_transition_or_fail "$ROOT" 5
`);

  const activeFile = join(state, "ai-content-cutover-id");
  const run = ({ active, marker }) => {
    rmSync(activeFile, { force: true });
    rmSync(mutationLog, { force: true });
    if (active !== undefined) writeFileSync(activeFile, `${active}\n`, { mode: 0o600 });
    const result = runRunner(bash, runner, {
      ROOT: bashPath(directory),
      MUTATION_LOG: bashPath(mutationLog),
      MARKER_STATE: marker,
      COMPLETED_STATE: "missing",
    });
    assert.equal(
      existsSync(mutationLog) ? readFileSync(mutationLog, "utf8") : "",
      "",
      `unsafe state invoked reconciliation: ${result.stderr}`,
    );
    return result;
  };

  assert.match(run({ active: UUID, marker: "false" }).stderr,
    /ai_content_cutover_abort_pre_marker_required/);
  assert.match(run({ active: UUID, marker: "true" }).stderr,
    /ai_content_cutover_roll_forward_only/);
  assert.match(run({ active: undefined, marker: "true" }).stderr,
    /ai_content_cutover_completed_evidence_required/);
  assert.match(run({ active: "corrupt", marker: "true" }).stderr,
    /ai_content_cutover_active_id_invalid/);
  assert.match(run({ active: undefined, marker: "error" }).stderr,
    /ai_content_cutover_floor_query_failed/);
});

test("marker-absent legacy state and fully completed schema-3 state are the only allowed paths", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-roll-forward-allow-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "state"));
  const mutationLog = join(directory, "mutation.log");
  const runner = writeRunner(directory, `
source "${bashPath(LIB)}"
probe_ai_content_075_marker() { printf '%s\\n' "$MARKER_STATE"; }
validate_ai_content_completed_floor() { [[ "$COMPLETED_STATE" == valid ]]; }
reconcile_transition() { printf 'reconcile-called\\n' >> "$MUTATION_LOG"; }
reconcile_transition_or_fail "$ROOT" 5
`);
  const run = (marker, completed) => {
    rmSync(mutationLog, { force: true });
    const result = runRunner(bash, runner, {
      ROOT: bashPath(directory),
      MUTATION_LOG: bashPath(mutationLog),
      MARKER_STATE: marker,
      COMPLETED_STATE: completed,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(mutationLog, "utf8"), "reconcile-called\n");
  };
  run("false", "missing");
  run("true", "valid");
});

test("completed evidence is canonical, bound to schema 3 current state, and reverified as completed in DB", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-completed-floor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sha = "1".repeat(40);
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);
  const hashC = "c".repeat(64);
  const timestamp = "2026-08-07T00:00:00.000Z";
  const completedDirectory = join(
    directory,
    "state",
    "ai-content-cutovers",
    UUID,
    "finalize-post-075",
    "completed",
  );
  mkdirSync(completedDirectory, { recursive: true });
  writeFileSync(join(directory, "state", "current"), `${sha}\n`, { mode: 0o600 });
  writeFileSync(
    join(completedDirectory, "evidence.json"),
    `{"cleanupCredentialRevokedAt":"${timestamp}","cleanupRevocationEvidenceSha256":"${hashA}","cutoverId":"${UUID}","eventSha256":"${hashB}","evidenceSha256":"${hashC}","maintenanceEnabled":false,"markerPresent":true,"status":"completed"}\n`,
    { mode: 0o600 },
  );
  const validStatus = `{"activeCutoverCount":0,"activeCutoverId":null,"cleanupCredentialRevokedAt":"${timestamp}","cleanupRevocationEvidenceSha256":"${hashA}","cutoverId":"${UUID}","maintenanceCutoverId":null,"maintenanceEnabled":false,"markerPresent":true,"status":"completed"}`;
  const runner = writeRunner(directory, `
source "${bashPath(LIB)}"
require_secure_state_file() { [[ -f "$1" && ! -L "$1" ]] || fail "state_file_invalid"; }
require_secure_state_directory() { [[ -d "$1" && ! -L "$1" ]] || fail "state_directory_invalid"; }
validate_state_release_directory() {
  RELEASE_MANIFEST=()
  RELEASE_MANIFEST[RELEASE_SCHEMA]="$CURRENT_SCHEMA"
}
query_ai_content_cutover_status() { printf '%s\\n' "$DB_STATUS"; }
validate_ai_content_completed_floor "$ROOT"
`);
  const run = (currentSchema, status = validStatus) => runRunner(bash, runner, {
    ROOT: bashPath(directory),
    CURRENT_SCHEMA: currentSchema,
    DB_STATUS: status,
  });

  assert.equal(run("3").status, 0);
  assert.match(run("2").stderr, /ai_content_cutover_completed_current_schema_invalid/);
  assert.match(
    run("3", validStatus.replace('"status":"completed"', '"status":"backend_verified"')).stderr,
    /ai_content_cutover_completed_database_status_invalid/,
  );
});
