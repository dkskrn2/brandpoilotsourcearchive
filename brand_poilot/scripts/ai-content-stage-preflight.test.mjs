import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const RELEASE_SHA = "1".repeat(40);

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

function functionBody(source, name, nextName) {
  const start = source.indexOf(`${name}() {`);
  const nextMarker = nextName.startsWith("for ") ? nextName : `${nextName}() {`;
  const end = source.indexOf(nextMarker, start + 1);
  assert.notEqual(start, -1, `${name} missing`);
  assert.notEqual(end, -1, `${nextName} missing after ${name}`);
  return source.slice(start, end);
}

test("AI-content staging and preflight are isolated from generic deployment and unrelated workers", () => {
  const stage = readFileSync("deploy/scripts/stage-ai-content-release.sh", "utf8");
  const preflight = readFileSync("deploy/scripts/preflight-ai-content.sh", "utf8");
  const genericPreflight = readFileSync("deploy/scripts/preflight.sh", "utf8");
  const lib = readFileSync("deploy/scripts/lib.sh", "utf8");

  assert.match(stage, /state\/ai-content-staged-release/);
  assert.match(stage, /PREFLIGHT_SCRIPT/);
  assert.match(stage, /validate_release_manifest/);
  assert.match(stage, /generate_release_integrity/);
  assert.match(stage, /enforce_ai_content_staging_floor\(\)[\s\S]*enforce_ai_content_roll_forward_floor "\$1"[\s\S]*ai_content_cutover_marker_present "\$1"/);
  assert.ok(
    stage.indexOf('enforce_ai_content_staging_floor "$ROOT"') < stage.indexOf('mkdir -p -- "$ROOT/releases" "$ROOT/state"'),
    "the marker/active-cutover floor must run before staging mutates the host",
  );
  assert.doesNotMatch(stage, /state\/candidate/);
  assert.doesNotMatch(stage, /docker\s+compose[\s\S]{0,200}\s+up\b|\bcompose\b[^\n]*\bup\b/);
  assert.match(lib, /755 scripts\/stage-ai-content-release\.sh/);
  assert.match(lib, /755 scripts\/preflight-ai-content\.sh/);

  const expectedImages = [
    "API_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ];
  for (const image of expectedImages) assert.match(preflight, new RegExp(`\\b${image}\\b`));
  for (const forbidden of [
    "DM_WORKER_IMAGE",
    "WIKI_WORKER_IMAGE",
    "BRAND_INTELLIGENCE_WORKER_IMAGE",
    "SUBJECT_ANALYSIS_WORKER_IMAGE",
    "dm-worker",
    "wiki-worker",
    "brand-intelligence-worker",
    "subject-analysis-worker",
  ]) assert.doesNotMatch(preflight, new RegExp(forbidden));
  assert.match(preflight, /AI_CONTENT_PREFLIGHT_MODE/);
  assert.match(preflight, /pre-bootstrap/);
  assert.match(preflight, /post-bootstrap/);
  assert.match(preflight, /ai-content-application-database-url/);
  assert.match(preflight, /require_exact_boolean\s+"LOCAL_SCHEDULER_ENABLED"\s+"false"/);
  assert.match(preflight, /require_exact_boolean\s+"CONTENT_PROPOSALS_ENABLED"\s+"true"/);
  assert.match(genericPreflight, /require_exact_boolean\s+"CONTENT_PROPOSALS_ENABLED"\s+"true"/);
  assert.match(preflight, /docker pull/);
  assert.match(preflight, /verify_release_image_revision/);
  assert.match(preflight, /docker compose/);
  assert.doesNotMatch(preflight, /docker\s+compose[\s\S]{0,200}\s+up\b|\bwatch\b|codex\s+exec/);
});

test("cutover uses staged, candidate, and promoted release pointers only in their valid phases", () => {
  const source = readFileSync("deploy/scripts/ai-content-cutover.sh", "utf8");
  for (const [name, next] of [
    ["run_role_plan", "run_role_bootstrap"],
    ["run_role_bootstrap", "run_073a"],
    ["run_073a", "load_bootstrap_inputs"],
    ["run_proposal_preflight", "require_active_cutover"],
  ]) {
    assert.match(functionBody(source, name, next), /load_staged_release/,
      `${name} must accept the immutable staged release before a generic candidate exists`);
  }
  for (const [name, next] of [
    ["run_074", "run_075"],
    ["run_075", "run_proposal_preflight"],
    ["run_restore_shared_owners", "run_verify_backend"],
    ["run_verify_backend", "run_complete_cutover"],
    ["run_complete_cutover", "for command_name"],
  ]) assert.match(functionBody(source, name, next), /load_runtime_release/,
    `${name} must require the exact candidate or promoted current release`);

  const control = functionBody(source, "run_control", "copy_durable_evidence");
  assert.match(control, /load_runtime_release/);
  assert.doesNotMatch(control, /load_staged_release/);
  assert.doesNotMatch(source, /load_candidate_release/);
  const runtimeLoader = functionBody(source, "load_runtime_release", "docker_runtime_prefix");
  assert.match(runtimeLoader, /state\/candidate/);
  assert.match(runtimeLoader, /state\/current/);
  assert.doesNotMatch(runtimeLoader, /load_staged_release/);
  assert.match(runtimeLoader, /require_staged_release_pointer_consistency/);

  assert.ok(
    control.indexOf("remove_staged_release_pointer") < control.indexOf('remove_state_file "$ROOT/state/ai-content-cutover-id"'),
    "safe pre-marker abort must clean staged state before clearing replay identity",
  );
  const complete = functionBody(source, "run_complete_cutover", "for command_name");
  assert.ok(
    complete.indexOf("remove_staged_release_pointer") < complete.indexOf('remove_state_file "$ROOT/state/ai-content-cutover-id"'),
    "completion must clean staged state before clearing replay identity",
  );
});

test("release binding rejects staged-only post-runtime use and every stale pointer", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const source = readFileSync("deploy/scripts/ai-content-cutover.sh", "utf8");
  const start = source.indexOf("load_release_directory() {");
  const end = source.indexOf("docker_runtime_prefix() {", start);
  assert.ok(start >= 0 && end > start);
  const bindingFunctions = source.slice(start, end);

  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-ai-binding-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const state = join(directory, "state");
  mkdirSync(join(directory, "releases", RELEASE_SHA), { recursive: true });
  mkdirSync(state);
  const runner = join(directory, "binding.sh");
  writeFileSync(runner, `#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$ROOT_PATH"
RELEASE_SHA=""
RELEASE_DIR=""
API_IMAGE=""
API_SOURCE_SHA=""
declare -gA RELEASE_MANIFEST=()
option() { printf '%s' "$EXPECTED_RELEASE"; }
fail() { printf 'error=%s\\n' "$1" >&2; exit 1; }
require_release_sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]] || fail release_sha_invalid; }
load_optional_state_sha() {
  local path="$1" output="$2" value
  [[ -f "$path" && ! -L "$path" ]] || return 1
  value="$(<"$path")"
  require_release_sha "$value"
  printf -v "$output" '%s' "$value"
}
load_required_state_sha() { load_optional_state_sha "$@" || fail state_file_missing; }
remove_state_file() { rm -f -- "$1"; }
validate_release_directory() {
  [[ -d "$1" && ! -L "$1" ]] || fail release_directory_invalid
  RELEASE_MANIFEST=()
  RELEASE_MANIFEST[RELEASE_SCHEMA]=3
  RELEASE_MANIFEST[API_IMAGE]='example.invalid/api@sha256:${"a".repeat(64)}'
  RELEASE_MANIFEST[API_SOURCE_SHA]="$EXPECTED_RELEASE"
}
release_image_source_revision() { printf '%s' "$EXPECTED_RELEASE"; }
require_digest_image() { :; }
verify_release_image_revision() { :; }
docker() { [[ "$1 $2" == 'image inspect' ]] && printf 'node\\n'; }
${bindingFunctions}
case "$BINDING_MODE" in
  staged) load_staged_release ;;
  runtime) load_runtime_release ;;
  *) exit 98 ;;
esac
`, "utf8");
  chmodSync(runner, 0o755);

  const writePointer = (name, value) => {
    const path = join(state, name);
    rmSync(path, { force: true });
    if (value) writeFileSync(path, `${value}\n`, { mode: 0o600 });
  };
  const run = (mode, { staged, candidate, current }) => {
    writePointer("ai-content-staged-release", staged);
    writePointer("candidate", candidate);
    writePointer("current", current);
    return spawnSync(bash, [bashPath(runner)], {
      encoding: "utf8",
      env: {
        ...process.env,
        ROOT_PATH: bashPath(directory),
        EXPECTED_RELEASE: RELEASE_SHA,
        BINDING_MODE: mode,
      },
    });
  };
  const old = "2".repeat(40);
  const stale = "3".repeat(40);
  assert.equal(run("staged", { staged: RELEASE_SHA, current: old }).status, 0);
  assert.equal(run("runtime", { staged: RELEASE_SHA, candidate: RELEASE_SHA, current: old }).status, 0);
  assert.equal(run("runtime", { staged: RELEASE_SHA, current: RELEASE_SHA }).status, 0);
  assert.equal(run("runtime", { current: RELEASE_SHA }).status, 0,
    "completion replay may occur after the staged pointer is safely removed");
  assert.match(run("runtime", { staged: stale, current: RELEASE_SHA }).stderr,
    /ai_content_cutover_staged_release_mismatch/);
  assert.match(run("runtime", { staged: RELEASE_SHA }).stderr,
    /ai_content_cutover_runtime_release_missing/);
  assert.match(run("runtime", { staged: RELEASE_SHA, candidate: stale, current: RELEASE_SHA }).stderr,
    /ai_content_cutover_candidate_mismatch/);
});

test("content preflight executes only the six content images and gates the app DB secret by phase", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-content-preflight-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = join(directory, "release");
  const scripts = join(release, "scripts");
  const root = join(directory, "host");
  const envDirectory = join(root, "shared", "env");
  const codexHome = join(root, "shared", "codex");
  const secretDirectory = join(root, "shared", "secrets");
  const bin = join(directory, "bin");
  for (const path of [scripts, envDirectory, codexHome, secretDirectory, bin]) {
    mkdirSync(path, { recursive: true });
  }
  copyFileSync("deploy/scripts/preflight-ai-content.sh", join(scripts, "preflight-ai-content.sh"));
  chmodSync(join(scripts, "preflight-ai-content.sh"), 0o755);
  writeFileSync(join(release, "compose.production.yml"), "services: {}\n", "utf8");
  const manifest = join(release, "release.env");
  writeFileSync(manifest, "RELEASE_SCHEMA=3\n", { mode: 0o600 });
  const digest = "a".repeat(64);
  const imageNames = {
    API_IMAGE: "api",
    CONTENT_PROPOSAL_WORKER_IMAGE: "content-proposal",
    IMAGE_WORKER_IMAGE: "image",
    CARD_NEWS_WORKER_IMAGE: "card-news",
    BLOG_WORKER_IMAGE: "blog",
    REEL_WORKER_IMAGE: "reel",
  };
  const manifestAssignments = Object.entries(imageNames)
    .map(([key, name]) => `RELEASE_MANIFEST[${key}]='example.invalid/${name}@sha256:${digest}'`)
    .join("\n");
  writeFileSync(join(scripts, "lib.sh"), `#!/usr/bin/env bash
fail() { printf 'error=%s\\n' "$1" >&2; exit 1; }
status_ok() { :; }
require_command() { :; }
require_file_mode_600() { [[ -f "$1" && ! -L "$1" ]] || fail required_file_missing; }
require_exact_boolean() { :; }
require_matching_env_secret() { :; }
require_distinct_env_secrets() { :; }
require_digest_image() { :; }
verify_release_image_revision() { :; }
release_image_source_revision() { printf '%s' '${RELEASE_SHA}'; }
declare -gA RELEASE_MANIFEST=()
validate_release_manifest() {
  RELEASE_MANIFEST=()
  RELEASE_MANIFEST[RELEASE_SCHEMA]=3
  RELEASE_MANIFEST[RELEASE_SHA]='${RELEASE_SHA}'
  RELEASE_MANIFEST[API_ENV_FILE]="$FIXTURE_ROOT/shared/env/api.env"
  ${manifestAssignments}
}
`, "utf8");
  chmodSync(join(scripts, "lib.sh"), 0o755);

  const apiEnv = [
    "AI_CONTENT_ATTACHMENT_UPLOAD_SESSIONS_ENABLED=true",
    "AUTOMATED_CONTENT_ENABLED=false",
    "CONTENT_PROPOSALS_ENABLED=true",
    "WORKER_API_TOKEN=worker-token",
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=proposal-token",
    "",
  ].join("\n");
  writeFileSync(join(envDirectory, "api.env"), apiEnv, { mode: 0o600 });
  for (const name of ["content-proposal", "image", "card-news", "blog", "reel"]) {
    writeFileSync(join(envDirectory, `${name}-worker-1.env`), "WORKER_API_TOKEN=worker-token\n", { mode: 0o600 });
  }
  writeFileSync(join(codexHome, "auth.json"), "{}\n", { mode: 0o600 });

  const dockerLog = join(directory, "docker.log");
  const statLog = join(directory, "stat.log");
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [[ "$1 $2" == 'image inspect' ]]; then printf 'node\\n'; fi
exit 0
`, "utf8");
  writeFileSync(join(bin, "timeout"), `#!/usr/bin/env bash
shift 3
exec "$@"
`, "utf8");
  writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  writeFileSync(join(bin, "id"), `#!/usr/bin/env bash
case "$1" in -u|-g) printf '1000\\n' ;; *) exit 1 ;; esac
`, "utf8");
  writeFileSync(join(bin, "realpath"), `#!/usr/bin/env bash
printf '%s\\n' "\${@: -1}"
`, "utf8");
  writeFileSync(join(bin, "stat"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STAT_LOG"
format=''
for argument in "$@"; do
  case "$argument" in %a|%U|%U:%G|%G|%u:%g) format="$argument" ;; esac
done
case "$format" in
  %a) printf '700\\n' ;;
  %U) printf 'tester\\n' ;;
  %U:%G) printf 'tester:tester\\n' ;;
  %G) printf 'tester\\n' ;;
  %u:%g) printf '1000:1000\\n' ;;
  *) exit 1 ;;
esac
`, "utf8");
  for (const command of ["docker", "timeout", "flock", "id", "realpath", "stat"]) {
    chmodSync(join(bin, command), 0o755);
  }

  const run = (mode) => spawnSync(bash, [
    "-c",
    'export PATH="$FAKE_BIN:/usr/bin:/bin"; exec "$1" "$2"',
    "content-preflight-fixture",
    bashPath(join(scripts, "preflight-ai-content.sh")),
    bashPath(manifest),
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_BIN: bashPath(bin),
      BRAND_PILOT_ROOT: bashPath(root),
      FIXTURE_ROOT: bashPath(root),
      AI_CONTENT_PREFLIGHT_FILE_OWNER: "tester",
      AI_CONTENT_PREFLIGHT_MODE: mode,
      DOCKER_LOG: bashPath(dockerLog),
      STAT_LOG: bashPath(statLog),
    },
  });

  const preBootstrap = run("pre-bootstrap");
  assert.equal(preBootstrap.status, 0, `${preBootstrap.stderr}\nstat=${existsSync(statLog) ? readFileSync(statLog, "utf8") : "missing"}`);
  const invocations = readFileSync(dockerLog, "utf8").trim().split("\n");
  const pulls = invocations.filter((line) => line.startsWith("pull --quiet "));
  assert.equal(pulls.length, 6);
  for (const name of Object.values(imageNames)) {
    assert.ok(pulls.some((line) => line.includes(`example.invalid/${name}@`)), `missing ${name} pull`);
  }
  for (const forbidden of ["dm-worker", "wiki-worker", "brand-intelligence", "subject-analysis"]) {
    assert.equal(invocations.some((line) => line.includes(forbidden)), false);
  }
  assert.equal(invocations.some((line) => /^compose .*\bup\b/u.test(line)), false);
  assert.equal(existsSync(join(secretDirectory, "ai-content-application-database-url")), false);

  rmSync(dockerLog, { force: true });
  const postWithoutSecret = run("post-bootstrap");
  assert.notEqual(postWithoutSecret.status, 0);
  assert.match(postWithoutSecret.stderr, /required_file_missing/);
  writeFileSync(
    join(secretDirectory, "ai-content-application-database-url"),
    "postgresql://content_application:secret@db.example.invalid/postgres\n",
    { mode: 0o600 },
  );
  rmSync(dockerLog, { force: true });
  const postBootstrap = run("post-bootstrap");
  assert.equal(postBootstrap.status, 0, postBootstrap.stderr);
  const postBootstrapLog = readFileSync(dockerLog, "utf8");
  assert.match(postBootstrapLog, /example\.invalid\/api@[^\n]*ai_content_application_database_url/);
  const databaseSecretValidation = postBootstrapLog.split("\n")
    .find((line) => line.includes("ai_content_application_database_url"));
  assert.match(databaseSecretValidation, /--user 1000:1000/);
});

test("active or marker-present cutover state blocks staging before any host mutation", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-stage-floor-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const scripts = join(source, "scripts");
  mkdirSync(scripts, { recursive: true });
  copyFileSync("deploy/scripts/stage-ai-content-release.sh", join(scripts, "stage-ai-content-release.sh"));
  chmodSync(join(scripts, "stage-ai-content-release.sh"), 0o755);
  writeFileSync(join(scripts, "lib.sh"), `#!/usr/bin/env bash
fail() { printf 'error=%s\\n' "$1" >&2; exit 1; }
require_command() { :; }
enforce_ai_content_roll_forward_floor() {
  case "$FLOOR_STATE" in
    active) fail ai_content_cutover_abort_pre_marker_required ;;
    marker) fail ai_content_cutover_roll_forward_only ;;
    completed-marker) return 0 ;;
    *) exit 97 ;;
  esac
}
ai_content_cutover_marker_present() {
  [[ "$FLOOR_STATE" == completed-marker ]] && return 0
  return 1
}
`, "utf8");
  chmodSync(join(scripts, "lib.sh"), 0o755);
  const root = join(directory, "must-not-exist");
  const run = (floorState) => spawnSync(
    bash,
    [bashPath(join(scripts, "stage-ai-content-release.sh")), bashPath(join(directory, "unused.env"))],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        BRAND_PILOT_ROOT: bashPath(root),
        FLOOR_STATE: floorState,
      },
    },
  );
  for (const [state, error] of [
    ["active", /ai_content_cutover_abort_pre_marker_required/],
    ["marker", /ai_content_cutover_roll_forward_only/],
    ["completed-marker", /ai_content_staging_post_marker_forbidden/],
  ]) {
    const result = run(state);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.equal(existsSync(root), false, `${state} state mutated the deployment root`);
  }
});

test("staging is immutable and writes only the dedicated pointer without starting Docker", (t) => {
  const bash = findBash();
  if (!bash) return t.skip("bash unavailable");

  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-ai-stage-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const scripts = join(source, "scripts");
  const root = join(directory, "host");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin, { recursive: true });

  copyFileSync("deploy/scripts/stage-ai-content-release.sh", join(scripts, "stage-ai-content-release.sh"));
  chmodSync(join(scripts, "stage-ai-content-release.sh"), 0o755);
  for (const name of ["compose.production.yml", "Caddyfile", "Caddyfile.canary"]) {
    writeFileSync(join(source, name), `${name}\n`, "utf8");
  }
  writeFileSync(join(scripts, "lib.sh"), `#!/usr/bin/env bash
fail() { printf 'error=%s\\n' "$1" >&2; exit 1; }
status_ok() { printf '%s=ok\\n' "$1"; }
require_command() { :; }
enforce_ai_content_roll_forward_floor() { :; }
ai_content_cutover_marker_present() { return 1; }
require_release_sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]] || fail release_sha_invalid; }
declare -gA RELEASE_MANIFEST=()
load_manifest() { RELEASE_MANIFEST=(); RELEASE_MANIFEST[RELEASE_SCHEMA]=3; RELEASE_MANIFEST[RELEASE_SHA]="${RELEASE_SHA}"; }
validate_release_manifest() { load_manifest; }
require_worker_image_manifest() { :; }
generate_release_integrity() { printf 'fixture-integrity\\n' > "$1/release-integrity.sha256"; chmod 600 "$1/release-integrity.sha256"; }
validate_release_directory() { [[ -d "$1" && ! -L "$1" ]] || fail release_directory_invalid; load_manifest; }
load_optional_state_sha() { local file="$1" output="$2"; [[ -f "$file" && ! -L "$file" ]] || return 1; printf -v "$output" '%s' "$(<"$file")"; }
load_required_state_sha() { load_optional_state_sha "$@" || fail state_file_missing; }
atomic_write_state() { local target="$1" value="$2"; printf '%s' "$value" > "$target"; chmod 600 "$target"; }
`, "utf8");
  chmodSync(join(scripts, "lib.sh"), 0o755);
  writeFileSync(join(scripts, "preflight-ai-content.sh"), "#!/usr/bin/env bash\nexit 99\n", "utf8");
  chmodSync(join(scripts, "preflight-ai-content.sh"), 0o755);

  const manifest = join(directory, "release.env");
  writeFileSync(manifest, `RELEASE_SCHEMA=3\nRELEASE_SHA=${RELEASE_SHA}\n`, { mode: 0o600 });
  writeFileSync(`${manifest}.sha256`, `${"a".repeat(64)}  release.env\n`, { mode: 0o600 });
  const preflightLog = join(directory, "preflight.log");
  const preflight = join(directory, "preflight.sh");
  writeFileSync(preflight, `#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$AI_CONTENT_PREFLIGHT_MODE" == pre-bootstrap ]]
[[ "$#" -eq 1 ]]
printf '%s\\n' "$1" >> "$PREFLIGHT_LOG"
`, "utf8");
  chmodSync(preflight, 0o755);
  const dockerLog = join(directory, "docker.log");
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
exit 97
`, "utf8");
  chmodSync(join(bin, "docker"), 0o755);
  for (const command of ["flock", "sync"]) {
    writeFileSync(join(bin, command), "#!/usr/bin/env bash\nexit 0\n", "utf8");
    chmodSync(join(bin, command), 0o755);
  }

  const run = () => spawnSync(bash, [bashPath(join(scripts, "stage-ai-content-release.sh")), bashPath(manifest)], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bashPath(bin)}:/usr/bin:/bin`,
      BRAND_PILOT_ROOT: bashPath(root),
      PREFLIGHT_SCRIPT: bashPath(preflight),
      PREFLIGHT_LOG: bashPath(preflightLog),
      DOCKER_LOG: bashPath(dockerLog),
    },
  });

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(join(root, "state", "ai-content-staged-release"), "utf8"), `${RELEASE_SHA}\n`);
  assert.equal(existsSync(join(root, "state", "candidate")), false);
  assert.equal(existsSync(dockerLog), false, "staging itself must not invoke Docker");
  assert.equal(readFileSync(preflightLog, "utf8").trim().split("\n").length, 1,
    "a staged-pointer replay must not rerun even the model-incapable image preflight");
  assert.equal(existsSync(join(root, "releases", RELEASE_SHA, "release.env")), true);
});
