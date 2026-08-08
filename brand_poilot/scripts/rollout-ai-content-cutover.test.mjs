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
import { join, resolve } from "node:path";
import test from "node:test";

const SCRIPT = "deploy/scripts/rollout-ai-content-cutover.sh";
const RELEASE_SHA = "a".repeat(40);
const PREVIOUS_SHA = "b".repeat(40);
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DIGEST = "c".repeat(64);
const PRE_SERVICES = [
  "content-proposal-worker-1",
  "image-worker-1",
  "card-news-worker-1",
  "blog-worker-1",
  "marketing-worker-1",
];
const POST_SERVICES = [
  "content-proposal-worker-1",
  "image-worker-1",
  "card-news-worker-1",
  "blog-worker-1",
  "reel-worker-1",
];

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

function statusJson(kind) {
  const common = {
    activeCutoverCount: 1,
    activeCutoverId: UUID,
    cleanupCredentialRevokedAt: null,
    cleanupRevocationEvidenceSha256: null,
    cutoverId: UUID,
    maintenanceCutoverId: UUID,
    maintenanceEnabled: true,
  };
  if (kind === "pre") return JSON.stringify({
    ...common, markerPresent: false, status: "maintenance_verified",
  });
  if (kind === "post") return JSON.stringify({
    ...common, markerPresent: true, status: "migration_body_complete",
  });
  return JSON.stringify({
    ...common, maintenanceCutoverId: null, maintenanceEnabled: false,
    markerPresent: false, status: "prepared",
  });
}

function createFixture(t) {
  const bash = findBash();
  if (!bash) return null;
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-content-runtime-cutover-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "host");
  const release = join(root, "releases", RELEASE_SHA);
  const previous = join(root, "releases", PREVIOUS_SHA);
  const scripts = join(release, "scripts");
  const bin = join(directory, "bin");
  const state = join(root, "state");
  const secrets = join(root, "shared", "secrets");
  for (const path of [scripts, join(previous, "scripts"), bin, state, secrets]) {
    mkdirSync(path, { recursive: true });
  }
  copyFileSync(SCRIPT, join(scripts, "rollout-ai-content-cutover.sh"));
  chmodSync(join(scripts, "rollout-ai-content-cutover.sh"), 0o755);
  for (const path of [release, previous]) {
    writeFileSync(join(path, "compose.production.yml"), "services: {}\n", "utf8");
    writeFileSync(join(path, "release.env"), "fixture=true\n", { mode: 0o600 });
  }
  writeFileSync(join(state, "current"), `${RELEASE_SHA}\n`, { mode: 0o600 });
  writeFileSync(join(state, "previous"), `${PREVIOUS_SHA}\n`, { mode: 0o600 });
  writeFileSync(join(state, "ai-content-cutover-id"), `${UUID}\n`, { mode: 0o600 });
  const operatorFile = join(secrets, "ai-content-operator-database-url");
  const applicationFile = join(secrets, "ai-content-application-database-url");
  writeFileSync(operatorFile, "postgresql://operator:test@db.invalid/postgres\n", { mode: 0o600 });
  writeFileSync(applicationFile, "postgresql://application:test@db.invalid/postgres\n", { mode: 0o600 });

  const candidateImages = Object.fromEntries([
    ["CONTENT_PROPOSAL_WORKER_IMAGE", "content-proposal"],
    ["IMAGE_WORKER_IMAGE", "image"],
    ["CARD_NEWS_WORKER_IMAGE", "card-news"],
    ["BLOG_WORKER_IMAGE", "blog"],
    ["REEL_WORKER_IMAGE", "reel"],
    ["API_IMAGE", "api"],
  ].map(([key, name]) => [key, `registry.invalid/${name}@sha256:${DIGEST}`]));
  const legacyImages = Object.fromEntries([
    ["CONTENT_PROPOSAL_WORKER_IMAGE", "legacy-content-proposal"],
    ["IMAGE_WORKER_IMAGE", "legacy-image"],
    ["CARD_NEWS_WORKER_IMAGE", "legacy-card-news"],
    ["BLOG_WORKER_IMAGE", "legacy-blog"],
    ["MARKETING_WORKER_IMAGE", "legacy-marketing"],
  ].map(([key, name]) => [key, `registry.invalid/${name}@sha256:${DIGEST}`]));
  const candidateAssignments = Object.entries(candidateImages)
    .map(([key, value]) => `RELEASE_MANIFEST[${key}]='${value}'`)
    .join("\n  ");
  const legacyCases = Object.entries(legacyImages)
    .map(([key, value]) => `${key}) printf '%s' '${value}' ;;`)
    .join("\n    ");
  writeFileSync(join(scripts, "lib.sh"), `#!/usr/bin/env bash
set -Eeuo pipefail
fail() { printf 'error=%s\\n' "$1" >&2; exit 1; }
status_ok() { printf '%s=ok\\n' "$1"; }
require_command() { :; }
require_release_sha() { [[ "$1" =~ ^[a-f0-9]{40}$ ]] || fail release_sha_invalid; }
require_file_mode_600() { [[ -f "$1" && ! -L "$1" ]] || fail required_file_missing; }
require_secure_state_file() { [[ -f "$1" && ! -L "$1" ]] || fail state_file_invalid; }
require_secure_state_directory() { [[ -d "$1" && ! -L "$1" ]] || fail state_directory_invalid; }
require_digest_image() { [[ "$1" == *@sha256:* ]] || fail image_must_be_digest_pinned; }
load_optional_state_sha() {
  local path="$1" output="$2" value
  [[ -f "$path" && ! -L "$path" ]] || return 1
  value="$(<"$path")"
  require_release_sha "$value"
  printf -v "$output" '%s' "$value"
}
load_required_state_sha() { load_optional_state_sha "$@" || fail state_file_missing; }
atomic_write() { printf '%s' "$2" > "$1"; chmod "${"$"}{3:-600}" "$1"; }
declare -gA RELEASE_MANIFEST=()
declare -g MARKETING_RETIREMENT_SOURCE_RELEASE_SHA='${PREVIOUS_SHA}'
validate_release_directory() {
  [[ "$1" == "$FIXTURE_ROOT/releases/${RELEASE_SHA}" ]] || fail release_directory_invalid
  RELEASE_MANIFEST=()
  RELEASE_MANIFEST[RELEASE_SCHEMA]=3
  RELEASE_MANIFEST[RELEASE_SHA]='${RELEASE_SHA}'
  RELEASE_MANIFEST[MARKETING_RETIREMENT_SHA256]='${DIGEST}'
  ${candidateAssignments}
  MARKETING_RETIREMENT_SOURCE_RELEASE_SHA='${PREVIOUS_SHA}'
}
require_worker_image_manifest() { :; }
release_image_source_revision() { printf '%s' '${RELEASE_SHA}'; }
verify_release_image_revision() {
  local actual
  actual="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1")"
  [[ "$actual" == "$2" ]] || fail release_image_revision_mismatch
}
validate_legacy_marketing_cutover_source() {
  [[ "$1" == "$FIXTURE_ROOT/releases/${PREVIOUS_SHA}" ]] || fail marketing_retirement_source_release_mismatch
}
legacy_release_manifest_value() {
  case "$2" in
    ${legacyCases}
    *) fail legacy_manifest_value_invalid ;;
  esac
}
`, "utf8");
  chmodSync(join(scripts, "lib.sh"), 0o755);

  const verifyLog = join(directory, "verify.log");
  writeFileSync(join(scripts, "verify-ai-content-cutover.sh"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$VERIFY_LOG"
case "$STATUS_KIND" in
  pre) printf '%s\\n' '${statusJson("pre")}' ;;
  post) printf '%s\\n' '${statusJson("post")}' ;;
  *) printf '%s\\n' '${statusJson("invalid")}' ;;
esac
`, "utf8");
  chmodSync(join(scripts, "verify-ai-content-cutover.sh"), 0o755);

  const dockerLog = join(directory, "docker.log");
  const dockerState = join(directory, "docker-state");
  mkdirSync(dockerState);
  const legacyId = Object.fromEntries(PRE_SERVICES.map((service, index) => [
    service, String(index + 1).repeat(12),
  ]));
  const candidateId = Object.fromEntries(POST_SERVICES.map((service, index) => [
    service, ["a", "b", "c", "d", "e"][index].repeat(12),
  ]));
  const legacyImageById = Object.fromEntries(PRE_SERVICES.map((service, index) => [
    legacyId[service], Object.values(legacyImages)[index],
  ]));
  const candidateImageById = Object.fromEntries(POST_SERVICES.map((service, index) => [
    candidateId[service], Object.values(candidateImages)[index],
  ]));
  const inspectCases = Object.entries({ ...legacyImageById, ...candidateImageById })
    .map(([id, image]) => `${id}) printf '%s\\n' '${image}' ;;`)
    .join("\n    ");
  const legacyIdCases = Object.entries(legacyId)
    .map(([service, id]) => `${service}) printf '%s\\n' '${id}' ;;`)
    .join("\n      ");
  const candidateIdCases = Object.entries(candidateId)
    .map(([service, id]) => `${service}) printf '%s\\n' '${id}' ;;`)
    .join("\n      ");
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [[ "$1 $2" == 'image inspect' ]]; then printf '%s\\n' '${RELEASE_SHA}'; exit 0; fi
if [[ "$1" == inspect ]]; then
  case "${"$"}{@: -1}" in
    ${inspectCases}
    *) exit 31 ;;
  esac
  exit 0
fi
if [[ "$1" == pull ]]; then exit 0; fi
if [[ "$1" == run ]]; then printf '%s\\n' "${"$"}{LEASE_COUNT:-0}"; exit 0; fi
if [[ "$1" != compose ]]; then exit 32; fi
args=" $* "
service="${"$"}{@: -1}"
legacy=false
[[ "$args" == *"/${PREVIOUS_SHA}/compose.production.yml"* ]] && legacy=true
if [[ "$args" == *" config --quiet "* ]]; then exit 0; fi
if [[ "$args" == *" ps -a -q "* ]]; then
  if [[ "$legacy" == true ]]; then
    if [[ "$service" == marketing-worker-1 && -f "$DOCKER_STATE/marketing-removed" ]]; then exit 0; fi
    case "$service" in
      ${legacyIdCases}
      *) exit 33 ;;
    esac
  fi
  exit 0
fi
if [[ "$args" == *" ps --status running -q "* ]]; then
  if [[ "$legacy" == true ]]; then
    [[ -f "$DOCKER_STATE/legacy-stopped" ]] && exit 0
    case "$service" in
      ${legacyIdCases}
      *) exit 34 ;;
    esac
  elif [[ -f "$DOCKER_STATE/candidate-started" ]]; then
    case "$service" in
      ${candidateIdCases}
      *) exit 35 ;;
    esac
  fi
  exit 0
fi
if [[ "$args" == *" stop --timeout "* ]]; then touch "$DOCKER_STATE/legacy-stopped"; exit 0; fi
if [[ "$args" == *" rm -f marketing-worker-1 "* ]]; then touch "$DOCKER_STATE/marketing-removed"; exit 0; fi
if [[ "$args" == *" up -d --no-deps --pull never --force-recreate "* ]]; then
  [[ "${"$"}{FAIL_UP:-false}" == true ]] && exit 55
  touch "$DOCKER_STATE/candidate-started"
  exit 0
fi
exit 36
`, "utf8");
  chmodSync(join(bin, "docker"), 0o755);
  writeFileSync(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  chmodSync(join(bin, "flock"), 0o755);

  const run = (mode, extraEnv = {}, extraArgs = []) => spawnSync(
    bash,
    [
      bashPath(join(scripts, "rollout-ai-content-cutover.sh")),
      mode,
      "--release", RELEASE_SHA,
      "--cutover-id", UUID,
      "--operator-url-file", bashPath(operatorFile),
      ...(mode === "--stop-legacy"
        ? ["--application-url-file", bashPath(applicationFile)]
        : []),
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bashPath(bin)}:/usr/bin:/bin`,
        BRAND_PILOT_ROOT: bashPath(root),
        FIXTURE_ROOT: bashPath(root),
        AI_CONTENT_CUTOVER_FILE_OWNER: "tester",
        STATUS_KIND: mode === "--stop-legacy" ? "pre" : "post",
        VERIFY_LOG: bashPath(verifyLog),
        DOCKER_LOG: bashPath(dockerLog),
        DOCKER_STATE: bashPath(dockerState),
        ...extraEnv,
      },
    },
  );
  return {
    applicationFile, bash, directory, dockerLog, dockerState, operatorFile,
    release, root, run, scripts, state, verifyLog,
  };
}

function logLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
}

test("cutover runtime script is content-only and exposes only the two one-way modes", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.match(source, /--stop-legacy/);
  assert.match(source, /--roll-forward/);
  assert.match(source, /state\/deploy\.lock/);
  assert.match(source, /maintenance_verified/);
  assert.match(source, /migration_body_complete/);
  assert.match(source, /verify-ai-content-cutover\.sh/);
  assert.match(source, /verify_release_image_revision/);
  assert.doesNotMatch(source, /rollback|recover_previous|rollout-workers\.sh/);
  for (const forbidden of [
    "dm-worker", "wiki-worker", "brand-intelligence-worker", "subject-analysis-worker",
  ]) assert.doesNotMatch(source, new RegExp(forbidden));
  for (const service of new Set([...PRE_SERVICES, ...POST_SERVICES])) {
    assert.match(source, new RegExp(service));
  }
});

test("pre-marker stop is exact, lease-fenced, immutable, and idempotent", (t) => {
  const fixture = createFixture(t);
  if (!fixture) return t.skip("bash unavailable");
  const first = fixture.run("--stop-legacy");
  assert.equal(first.status, 0, first.stderr);
  const second = fixture.run("--stop-legacy");
  assert.equal(second.status, 0, second.stderr);
  const lines = logLines(fixture.dockerLog);
  const stops = lines.filter((line) => line.includes(" stop --timeout "));
  assert.equal(stops.length, 2);
  for (const stop of stops) {
    assert.ok(PRE_SERVICES.every((service) => stop.includes(service)), stop);
    assert.equal(stop.includes("reel-worker-1"), false);
  }
  assert.equal(lines.some((line) => line.includes(" up ")), false);
  assert.equal(lines.some((line) => line.includes(" rm ")), false);
  assert.equal(lines.filter((line) => line.startsWith("run ")).length, 2,
    "every replay must recheck processing leases");
  assert.equal(logLines(fixture.verifyLog).length, 4,
    "every replay must verify maintenance before and after stopping");
  const evidence = join(fixture.state, "ai-content-cutovers", UUID, "runtime-rollout", "pre-marker-stop.json");
  assert.equal(existsSync(evidence), true);
  assert.match(readFileSync(evidence, "utf8"), /"status":"maintenance_verified"/);
});

test("pre-marker stop fails closed on status, release binding, and live leases", (t) => {
  const fixture = createFixture(t);
  if (!fixture) return t.skip("bash unavailable");

  const invalidStatus = fixture.run("--stop-legacy", { STATUS_KIND: "invalid" });
  assert.notEqual(invalidStatus.status, 0);
  assert.match(invalidStatus.stderr, /ai_content_runtime_cutover_status_invalid/);
  assert.equal(logLines(fixture.dockerLog).some((line) => line.includes(" stop ")), false);

  writeFileSync(join(fixture.state, "current"), `${PREVIOUS_SHA}\n`, { mode: 0o600 });
  const wrongCurrent = fixture.run("--stop-legacy");
  assert.notEqual(wrongCurrent.status, 0);
  assert.match(wrongCurrent.stderr, /ai_content_runtime_current_release_mismatch/);
  writeFileSync(join(fixture.state, "current"), `${RELEASE_SHA}\n`, { mode: 0o600 });

  const liveLease = fixture.run("--stop-legacy", { LEASE_COUNT: "1" });
  assert.notEqual(liveLease.status, 0);
  assert.match(liveLease.stderr, /ai_content_runtime_processing_lease_active/);
  const evidence = join(fixture.state, "ai-content-cutovers", UUID, "runtime-rollout", "pre-marker-stop.json");
  assert.equal(existsSync(evidence), false);
  const retry = fixture.run("--stop-legacy", { LEASE_COUNT: "0" });
  assert.equal(retry.status, 0, retry.stderr);
});

test("post-marker rollout retires marketing and starts only five pinned candidate services", (t) => {
  const fixture = createFixture(t);
  if (!fixture) return t.skip("bash unavailable");
  const first = fixture.run("--roll-forward");
  assert.equal(first.status, 0, first.stderr);
  const second = fixture.run("--roll-forward");
  assert.equal(second.status, 0, second.stderr);
  const lines = logLines(fixture.dockerLog);
  const up = lines.filter((line) => line.includes(" up -d --no-deps --pull never --force-recreate "));
  assert.equal(up.length, 1, "immutable successful evidence makes replay verification-only");
  assert.ok(POST_SERVICES.every((service) => up[0].includes(service)), up[0]);
  assert.equal(up[0].includes("marketing-worker-1"), false);
  assert.equal(lines.filter((line) => line.startsWith("pull --quiet ")).length, 5);
  assert.equal(lines.some((line) => line.includes(" rm -f marketing-worker-1")), true);
  assert.equal(lines.some((line) => line.includes(" up ") && line.includes("marketing-worker-1")), false);
  const evidence = join(fixture.state, "ai-content-cutovers", UUID, "runtime-rollout", "post-marker-roll-forward.json");
  assert.equal(existsSync(evidence), true);
  assert.match(readFileSync(evidence, "utf8"), /"status":"migration_body_complete"/);
  assert.equal(logLines(fixture.verifyLog).length, 4,
    "maintenance and marker state must remain exact across replay");
});

test("post-marker partial failure is replay-safe and never invokes a legacy rollback", (t) => {
  const fixture = createFixture(t);
  if (!fixture) return t.skip("bash unavailable");
  const failed = fixture.run("--roll-forward", { FAIL_UP: "true" });
  assert.notEqual(failed.status, 0);
  const evidence = join(fixture.state, "ai-content-cutovers", UUID, "runtime-rollout", "post-marker-roll-forward.json");
  assert.equal(existsSync(evidence), false);
  assert.equal(existsSync(join(fixture.dockerState, "marketing-removed")), true);
  const replay = fixture.run("--roll-forward");
  assert.equal(replay.status, 0, replay.stderr);
  const lines = logLines(fixture.dockerLog);
  assert.equal(lines.some((line) => line.includes(`/${PREVIOUS_SHA}/compose.production.yml`) && line.includes(" up ")), false);

  rmSync(evidence, { force: true });
  rmSync(join(fixture.dockerState, "candidate-started"), { force: true });
  const invalid = fixture.run("--roll-forward", { STATUS_KIND: "pre" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /ai_content_runtime_cutover_status_invalid/);
});
