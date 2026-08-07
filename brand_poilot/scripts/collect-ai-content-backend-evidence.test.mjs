import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { parseBackendVerificationEvidence } from "./ai-content-cutover-control.mjs";

const RELEASE_SHA = "1".repeat(40);
const IMAGE_DIGEST = `sha256:${"a".repeat(64)}`;
const CONFIG_DIGEST = `sha256:${"b".repeat(64)}`;
const CUTOVER_ID = "11111111-1111-4111-8111-111111111111";
const SCRIPT = resolve("deploy/scripts/collect-ai-content-backend-evidence.sh");

const services = [
  ["api-canary", "api"],
  ["api-primary", "api"],
  ["content-proposal-worker-1", "content-proposal"],
  ["image-worker-1", "image"],
  ["card-news-worker-1", "card-news"],
  ["blog-worker-1", "blog"],
  ["reel-worker-1", "reel"],
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

function bashPath(value) {
  const absolute = resolve(value).replaceAll("\\", "/");
  if (process.platform !== "win32") return absolute;
  return absolute.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function secureDirectory(path) {
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o700);
}

function secureFile(path, value) {
  secureDirectory(dirname(path));
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function fakeDockerSource() {
  const imageCases = services
    .filter(([, component], index, all) => all.findIndex(([, item]) => item === component) === index)
    .map(([, component]) => `    ${component}) printf '%s\\n' 'registry.example/${component}@${IMAGE_DIGEST}' ;;`)
    .join("\n");
  const idCases = services
    .map(([service], index) => `    ${service}) printf '%s\\n' '${(index + 10).toString(16).repeat(12).slice(0, 12)}' ;;`)
    .join("\n");
  const serviceCases = services
    .map(([service], index) => `    ${(index + 10).toString(16).repeat(12).slice(0, 12)}) printf '%s' '${service}' ;;`)
    .join("\n");
  return `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
format_arg() {
  local previous="" value=""
  for value in "$@"; do
    if [[ "$previous" == "--format" ]]; then printf '%s' "$value"; return 0; fi
    previous="$value"
  done
  return 1
}
env_arg() {
  local wanted="$1" previous="" value=""
  shift
  for value in "$@"; do
    if [[ "$previous" == "--env" && "$value" == "$wanted="* ]]; then
      printf '%s' "\${value#*=}"
      return 0
    fi
    previous="$value"
  done
  return 1
}
component_image() {
  case "$1" in
${imageCases}
    *) exit 91 ;;
  esac
}
service_id() {
  case "$1" in
${idCases}
    *) exit 92 ;;
  esac
}
id_service() {
  case "$1" in
${serviceCases}
    *) exit 93 ;;
  esac
}
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  format="$(format_arg "$@")"
  image="\${!#}"
  case "$format" in
    '{{.Id}}') printf '%s\\n' '${CONFIG_DIGEST}' ;;
    '{{.Config.User}}') printf '%s\\n' 'node' ;;
    *org.opencontainers.image.revision*) printf '%s\\n' '${RELEASE_SHA}' ;;
    *) exit 94 ;;
  esac
  exit 0
fi
if [[ "\${1:-}" == "compose" ]]; then
  service="\${!#}"
  service_id "$service"
  exit 0
fi
if [[ "\${1:-}" == "inspect" ]]; then
  format="$(format_arg "$@")"
  id="\${!#}"
  service="$(id_service "$id")"
  case "$format" in
    '{{.Config.Image}}')
      case "$service" in
        api-*) component_image api ;;
        content-proposal-worker-1) component_image content-proposal ;;
        image-worker-1) component_image image ;;
        card-news-worker-1) component_image card-news ;;
        blog-worker-1) component_image blog ;;
        reel-worker-1) component_image reel ;;
      esac ;;
    '{{.Image}}') printf '%s\\n' '${CONFIG_DIGEST}' ;;
    '{{.State.Status}}') printf '%s\\n' 'running' ;;
    '{{if .State.Health}}{{.State.Health.Status}}{{end}}')
      [[ "$service" == api-* ]] && printf '%s\\n' 'healthy' ;;
    *org.opencontainers.image.revision*) printf '%s\\n' '${RELEASE_SHA}' ;;
    *com.docker.compose.service*) printf '%s\\n' "$service" ;;
    *com.docker.compose.project*) printf '%s\\n' 'brand-pilot' ;;
    *'.Config.Env'*) printf '%s\\n' 'AI_CONTENT_DATABASE_URL_FILE=/run/secrets/ai_content_application_database_url' ;;
    *'.Mounts'*) printf '%s|%s|%s|%s\\n' "$FAKE_ROOT/shared/secrets/ai-content-application-database-url" '/run/secrets/ai_content_application_database_url' "\${FAKE_MOUNT_RW:-false}" 'bind' ;;
    *) exit 95 ;;
  esac
  exit 0
fi
if [[ "\${1:-}" == "run" ]]; then
  joined="$*"
  if [[ "$joined" == *'/app/scripts/ai-content-cutover-control.mjs --status'* ]]; then
    if [[ "\${FAKE_STATUS_MODE:-safe}" == "safe" ]]; then
      printf '%s\\n' '{"activeCutoverCount":1,"activeCutoverId":"${CUTOVER_ID}","cleanupCredentialRevokedAt":null,"cleanupRevocationEvidenceSha256":null,"cutoverId":"${CUTOVER_ID}","maintenanceCutoverId":"${CUTOVER_ID}","maintenanceEnabled":true,"markerPresent":true,"status":"migration_body_complete"}'
    else
      printf '%s\\n' '{"activeCutoverCount":1,"activeCutoverId":"${CUTOVER_ID}","cleanupCredentialRevokedAt":null,"cleanupRevocationEvidenceSha256":null,"cutoverId":"${CUTOVER_ID}","maintenanceCutoverId":null,"maintenanceEnabled":false,"markerPresent":false,"status":"prepared"}'
    fi
    exit 0
  fi
  if [[ "$joined" == *'/run/input/db-identity.mjs'* ]]; then
    printf '%s\\n' '{"databaseCurrentUser":"content_application","databaseSessionUser":"content_application"}'
    exit 0
  fi
  if [[ "$joined" == *'/run/input/http-probe.mjs'* ]]; then
    api_service="$(env_arg PROBE_API_SERVICE "$@")"
    probe_kind="$(env_arg PROBE_KIND "$@")"
    service_name="$(env_arg PROBE_SERVICE_NAME "$@")"
    if [[ "$probe_kind" == "ready" ]]; then
      printf '{"observedAt":"2026-08-07T01:02:03.000Z","readiness":"ready","serviceName":"%s"}\\n' "$api_service"
    elif [[ "$probe_kind" == "heartbeat" ]]; then
      printf '{"apiService":"%s","observedAt":"2026-08-07T01:02:04.000Z","observedStatus":"heartbeat_verified","serviceName":"%s"}\\n' "$api_service" "$service_name"
    else
      printf '{"apiService":"%s","observedAt":"2026-08-07T01:02:05.000Z","observedStatus":"ai_content_maintenance_503","serviceName":"%s"}\\n' "$api_service" "$service_name"
    fi
    exit 0
  fi
  if [[ "$joined" == *'/app/scripts/ai-content-cutover-control.mjs --create-backend-evidence'* ]]; then
    body="" expected=""
    for value in "$@"; do
      case "$value" in
        type=bind,src=*,dst=/run/input/backend-body.json,readonly)
          body="\${value#*src=}"; body="\${body%%,dst=*}" ;;
        type=bind,src=*,dst=/run/input/backend-expected.json,readonly)
          expected="\${value#*src=}"; expected="\${expected%%,dst=*}" ;;
      esac
    done
    [[ -n "$body" && -n "$expected" ]]
    [[ "$(stat -c '%a' -- "$body")" == 600 && "$(stat -c '%a' -- "$expected")" == 600 ]]
    node "$CONTROL_PATH" --create-backend-evidence --body-file "$body" --expected-file "$expected"
    exit 0
  fi
fi
exit 96
`;
}

function fixture(t, { statusMode = "safe", mountRw = "false" } = {}) {
  const bash = findBash();
  if (!bash) return null;
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-backend-evidence-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "root");
  const release = join(root, "releases", RELEASE_SHA);
  const releases = join(root, "releases");
  const state = join(root, "state");
  const shared = join(root, "shared");
  const envDirectory = join(root, "shared", "env");
  const secretDirectory = join(root, "shared", "secrets");
  const restoreDirectory = join(
    state,
    "ai-content-cutovers",
    CUTOVER_ID,
    "finalize-post-075",
    "shared-owner-restore",
  );
  const outputDirectory = join(state, "evidence-output");
  const bin = join(directory, "bin");
  for (const path of [root, releases, release, state, shared, envDirectory, secretDirectory, restoreDirectory, outputDirectory, bin]) {
    secureDirectory(path);
  }
  for (const path of [root, releases]) chmodSync(path, 0o750);
  secureFile(join(state, "current"), `${RELEASE_SHA}\n`);
  secureFile(join(state, "ai-content-cutover-id"), `${CUTOVER_ID}\n`);
  secureFile(join(secretDirectory, "operator-database-url"), "postgresql://operator:secret@db.example.test/postgres\n");
  secureFile(join(secretDirectory, "ai-content-application-database-url"), "postgresql://content_application:secret@db.example.test/postgres\n");
  secureFile(join(restoreDirectory, "evidence.json"), '{"contractVersion":"ai-content-shared-owner-restore-evidence.v1"}\n');
  secureFile(join(envDirectory, "api.env"), [
    "WORKER_API_TOKEN=WORKER_SUPER_SECRET",
    "CONTENT_PROPOSAL_WORKER_API_TOKEN=PROPOSAL_SUPER_SECRET",
    "DB_SSL_CA_BASE64=",
  ].join("\n") + "\n");
  secureFile(join(release, "compose.production.yml"), "services: {}\n");
  const manifest = [
    "RELEASE_SCHEMA=3",
    `RELEASE_SHA=${RELEASE_SHA}`,
    `API_ENV_FILE=${bashPath(join(envDirectory, "api.env"))}`,
    ...services
      .filter(([, component], index, all) => all.findIndex(([, item]) => item === component) === index)
      .flatMap(([, component]) => {
        const prefix = component.replaceAll("-", "_").toUpperCase();
        const key = component === "api" ? "API" : `${prefix}_WORKER`;
        return [
          `${key}_IMAGE=registry.example/${component}@${IMAGE_DIGEST}`,
          `${key}_SOURCE_SHA=${RELEASE_SHA}`,
          `${key}_CHANGED=true`,
        ];
      }),
  ].join("\n") + "\n";
  secureFile(join(release, "release.env"), manifest);
  secureFile(join(release, "release.env.sha256"), `${sha256(manifest)}  release.env\n`);

  const dockerLog = join(directory, "docker.log");
  secureFile(dockerLog, "");
  secureFile(join(bin, "docker"), fakeDockerSource());
  chmodSync(join(bin, "docker"), 0o755);
  secureFile(join(bin, "flock"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "flock"), 0o755);
  const owner = spawnSync(bash, ["-lc", "id -un"], { encoding: "utf8" }).stdout.trim();
  const output = join(outputDirectory, "backend-evidence.json");
  const result = spawnSync(bash, [bashPath(SCRIPT),
    "--release", RELEASE_SHA,
    "--operator-url-file", bashPath(join(secretDirectory, "operator-database-url")),
    "--cutover-id", CUTOVER_ID,
    "--output", bashPath(output),
  ], {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      BRAND_PILOT_ROOT: bashPath(root),
      AI_CONTENT_BACKEND_EVIDENCE_FILE_OWNER: owner,
      FAKE_DOCKER_LOG: bashPath(dockerLog),
      FAKE_ROOT: bashPath(root),
      FAKE_STATUS_MODE: statusMode,
      FAKE_MOUNT_RW: mountRw,
      CONTROL_PATH: bashPath(resolve("scripts/ai-content-cutover-control.mjs")),
    },
  });
  return { result, output, dockerLog, root, restoreDirectory, bash };
}

test("collector is strict, secret-safe, and names only the manual AI-content backend", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.match(source, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail\numask 077/m);
  assert.doesNotMatch(source, /^[ \t]*(?:source|\.)[ \t]+/m);
  assert.doesNotMatch(source, /\beval[ \t]+/);
  for (const [service] of services) assert.match(source, new RegExp(`\\b${service}\\b`));
  for (const forbidden of [
    "dm-worker",
    "wiki-worker",
    "subject-analysis",
    "brand-intelligence",
    "automated-card",
    "marketing-worker",
  ]) assert.doesNotMatch(source, new RegExp(forbidden));
  assert.match(source, /\/worker\/content-proposal-jobs\/heartbeat/);
  assert.match(source, /\/worker\/ai-content-render-jobs\/claim/);
  assert.match(source, /\/worker\/ai-content-jobs\/card_news\/claim/);
  assert.match(source, /\/worker\/ai-content-jobs\/blog\/claim/);
  assert.match(source, /\/worker\/ai-content-jobs\/reel\/claim/);
  assert.match(source, /--env-file\s+"\$API_ENV_FILE"/);
  assert.doesNotMatch(source, /(?:WORKER_API_TOKEN|CONTENT_PROPOSAL_WORKER_API_TOKEN)="?\$\(/);
  assert.match(source, /require_owned_directory\(\)[\s\S]*700[\s\S]*750/);
  assert.doesNotMatch(source, /require_owned_directory\(\)[\s\S]*\|\| "\$mode" == "755"/);
  for (const directory of ["ROOT", "STATE_DIR", "ROOT/releases", "ROOT/shared"]) {
    assert.match(source, new RegExp(`require_owned_directory \"\\$${directory.replace("/", "\\/")}`));
  }
  assert.match(source, /for command_name in[^\n]*awk[^\n]*basename[^\n]*cat[^\n]*dirname/);
  assert.match(source, /CODEX_RUNTIME_UID="\$\(id -u "\$FILE_OWNER"\)"[\s\S]*CODEX_RUNTIME_GID="\$\(id -g "\$FILE_OWNER"\)"[\s\S]*export CODEX_RUNTIME_UID CODEX_RUNTIME_GID/);
  assert.doesNotMatch(source, /printf "%s\|%s\|%t\|%s\\n" \.Source \.Destination \.RW \.Type/);
  assert.match(source, /const init = kind === "ready" \? \{\s*signal: AbortSignal\.timeout\(10_000\)/);
  assert.match(source, /verify_container\(\) \{[\s\S]*docker image inspect --format '\{\{ index \.Config\.Labels "org\.opencontainers\.image\.revision" \}\}'/);
  assert.ok(
    source.indexOf("trap cleanup_backend_temp EXIT") < source.indexOf('require_secure_directory "$TEMP_DIR"'),
    "the cleanup trap must be armed immediately after the temporary directory is named",
  );
  assert.match(source, /cleanup_backend_temp\(\)[\s\S]*OUTPUT_TEMP/);
  assert.match(source, /readonly -a SECURE_DOCKER_RUN=\(\s*timeout --signal=TERM --kill-after=5s 45s\s*docker run/);
});

test("collector seals exact evidence after checking status, identities, readiness, and both API fences", (t) => {
  const setup = fixture(t);
  if (!setup) return t.skip("bash unavailable");
  assert.equal(setup.result.status, 0, setup.result.stderr);
  assert.equal(setup.result.stdout, "ai_content_backend_evidence=ok\n");
  assert.equal(
    spawnSync(setup.bash, ["-c", "umask 077; stat -c '%a' -- \"$1\"", "mode-check", bashPath(setup.output)], {
      encoding: "utf8",
    }).stdout.trim(),
    "600",
  );
  const restoreHash = sha256(readFileSync(join(setup.restoreDirectory, "evidence.json")));
  const evidence = JSON.parse(readFileSync(setup.output, "utf8"));
  assert.deepEqual(parseBackendVerificationEvidence(evidence, {
    cutoverId: CUTOVER_ID,
    candidateReleaseSha: RELEASE_SHA,
    sharedOwnerRestoreEvidenceSha256: restoreHash,
    imageDigests: Object.fromEntries(services.map(([service]) => [service, IMAGE_DIGEST])),
  }), evidence);

  const log = readFileSync(setup.dockerLog, "utf8");
  assert.equal(log.includes("WORKER_SUPER_SECRET"), false);
  assert.equal(log.includes("PROPOSAL_SUPER_SECRET"), false);
  const statusIndex = log.indexOf("--status");
  const firstClaimIndex = log.indexOf("PROBE_KIND=claim");
  assert.ok(statusIndex >= 0 && firstClaimIndex > statusIndex, "control status must precede every claim");
  assert.equal((log.match(/PROBE_KIND=heartbeat/g) ?? []).length, 2);
  assert.equal((log.match(/PROBE_KIND=claim/g) ?? []).length, 8);
  assert.equal(log.split("\n").filter((line) => line.endsWith(" /run/input/db-identity.mjs")).length, 2);
  for (const [service] of services) assert.match(log, new RegExp(`ps -a -q ${service}`));
  for (const forbidden of ["dm-worker", "wiki-worker", "subject-analysis", "brand-intelligence", "automated-card"]) {
    assert.equal(log.includes(forbidden), false);
  }
  assert.equal(
    readdirSync(join(setup.root, "state")).some((name) => name.startsWith(".ai-content-backend-evidence.")),
    false,
    "secure temporary state must be removed",
  );
});

test("collector fails before probes when the database is not in the exact maintenance state", (t) => {
  const setup = fixture(t, { statusMode: "unsafe" });
  if (!setup) return t.skip("bash unavailable");
  assert.notEqual(setup.result.status, 0);
  assert.match(setup.result.stderr, /ai_content_backend_control_state_invalid/);
  const log = readFileSync(setup.dockerLog, "utf8");
  assert.doesNotMatch(log, /PROBE_KIND=(?:heartbeat|claim)|db-identity\.mjs|compose .* ps -a -q/);
  assert.equal(existsSync(setup.output), false);
});

test("collector rejects a writable application-secret mount before authentication probes", (t) => {
  const setup = fixture(t, { mountRw: "true" });
  if (!setup) return t.skip("bash unavailable");
  assert.notEqual(setup.result.status, 0);
  assert.match(setup.result.stderr, /ai_content_backend_application_secret_mount_invalid/);
  const log = readFileSync(setup.dockerLog, "utf8");
  assert.doesNotMatch(log, /PROBE_KIND=(?:heartbeat|claim)|db-identity\.mjs/);
  assert.equal(existsSync(setup.output), false);
});
