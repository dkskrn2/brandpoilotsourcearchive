import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const deploymentRuntimeFiles = [
  "package.json",
  "package-lock.json",
  "deploy/compose.production.yml",
  "deploy/release.env.example",
  "deploy/scripts/lib.sh",
  "deploy/scripts/preflight.sh",
  "deploy/scripts/deploy.sh",
  "deploy/scripts/promote.sh",
  "deploy/scripts/backup-state.sh",
  "deploy/scripts/rollback.sh",
  "deploy/scripts/rollout-workers.sh",
  "scripts/assemble-release-manifest.mjs",
  "scripts/release-impact.mjs",
  "scripts/check-local-env.mjs",
  "scripts/ai-content-smoke.mjs",
];

test("manual generation deployment exposes reel worker and no legacy marketing worker runtime", () => {
  const sources = new Map(deploymentRuntimeFiles.map((path) => [path, read(path)]));

  assert.match(sources.get("package.json"), /"reel-worker:once":\s*"npm run run-once --workspace @brand-pilot\/reel-worker"/);
  assert.match(sources.get("package-lock.json"), /"node_modules\/@brand-pilot\/reel-worker"/);
  assert.doesNotMatch(sources.get("package-lock.json"), /brand-pilot-marketing-worker|@brand-pilot\/marketing-worker/);

  const compose = sources.get("deploy/compose.production.yml");
  assert.match(compose, /^  reel-worker-1:$/m);
  assert.match(compose, /REEL_WORKER_IMAGE/);
  assert.match(compose, /REEL_WORKER_1_ENV_FILE/);
  assert.match(compose, /REEL_WORKER_ID: reel-worker-1/);

  for (const [path, source] of sources) {
    if (path === "scripts/assemble-release-manifest.mjs") {
      assert.doesNotMatch(source, /MARKETING_WORKER_IMAGE|brand-pilot-marketing-worker|@brand-pilot\/marketing-worker/);
      continue;
    }
    if (path === "scripts/release-impact.mjs") {
      assert.match(source, /workers\/brand-pilot-marketing-worker\//, "retirement deletion must remain classifiable");
      assert.doesNotMatch(source, /MARKETING_WORKER_IMAGE|marketingWorker|@brand-pilot\/marketing-worker/);
      continue;
    }
    if ([
      "deploy/scripts/lib.sh",
      "deploy/scripts/deploy.sh",
      "deploy/scripts/promote.sh",
      "deploy/scripts/backup-state.sh",
      "deploy/scripts/rollback.sh",
      "deploy/scripts/rollout-workers.sh",
    ].includes(path)) {
      assert.doesNotMatch(
        source,
        /brand-pilot-marketing-worker|@brand-pilot\/marketing-worker|MARKETING_WORKER_ID|MARKETING_CODEX|marketingWorker/,
        `${path} retains the retired marketing worker runtime`,
      );
      continue;
    }
    assert.doesNotMatch(
      source,
      /brand-pilot-marketing-worker|@brand-pilot\/marketing-worker|marketing-worker(?:-1|:once)?|MARKETING_(?:WORKER|CODEX)|marketingWorker/,
      `${path} retains the retired marketing worker runtime`,
    );
  }

  for (const path of [
    "deploy/release.env.example",
    "deploy/scripts/lib.sh",
    "deploy/scripts/preflight.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/rollout-workers.sh",
    "scripts/assemble-release-manifest.mjs",
  ]) {
    assert.match(sources.get(path), /REEL_WORKER_IMAGE/, `${path} must carry the reel image`);
  }
  assert.match(sources.get("deploy/release.env.example"), /^RELEASE_SCHEMA=3$/m);
  assert.match(sources.get("deploy/scripts/lib.sh"), /RELEASE_SCHEMA[^\n]*\]\}" == "3"/);

  assert.equal(existsSync("deploy/env/reel-worker.env.example"), true);
  assert.equal(existsSync("workers/brand-pilot-reel-worker/.env.example"), true);
  assert.match(read("deploy/env/reel-worker.env.example"), /^REEL_CODEX_PLAN_COMMAND=/m);

  const dockerfile = read("workers/brand-pilot-reel-worker/Dockerfile");
  assert.match(dockerfile, /npm run build --workspace @brand-pilot\/worker-runtime[\s\\]*&& npm run build --workspace @brand-pilot\/reel-worker/);
  assert.match(dockerfile, /codex-resources\/bwrap \/usr\/local\/bin\/bwrap/);
  assert.match(dockerfile, /reel-storyboard-v2\.schema\.json/);
  assert.doesNotMatch(dockerfile, /generated\/reel-plan-v2\.schema\.json/);
  assert.match(dockerfile, /workers\/brand-pilot-reel-worker\/dist\/index\.js/);
});

test("general generation smoke is retired while scheduler, publishing, and subject ownership stay reachable", () => {
  const generalSmoke = read("scripts/ai-content-smoke.mjs");
  assert.match(generalSmoke, /ai_content_smoke_replaced_by_authenticated_browser_canary/);
  assert.match(generalSmoke, /--scheduler-contract/);
  assert.match(generalSmoke, /scheduled_crawl/);
  assert.match(generalSmoke, /--latest-completed/);
  assert.doesNotMatch(generalSmoke, /content-orchestration\.v1|ai-content\.v1|marketing-worker|marketing-worker:once/);
  assert.doesNotMatch(generalSmoke, /request\(`\/brands\/\$\{brandId\}\/ai-content\/generations`\s*,\s*\{[\s\S]{0,300}?method:\s*"POST"/);
  const generalResult = spawnSync(process.execPath, ["scripts/ai-content-smoke.mjs"], { encoding: "utf8" });
  assert.equal(generalResult.status, 2);
  assert.match(generalResult.stderr, /zero_writes/);

  const subjectSmoke = read("scripts/ai-content-subject-smoke.mjs");
  assert.match(subjectSmoke, /subject-analysis\.v2/);
  assert.match(subjectSmoke, /subject-analysis-worker:once/);
  assert.match(subjectSmoke, /generation\.draft\?\.origin[^\n]*proposal-v2/);
  assert.match(subjectSmoke, /generation-id/);
  assert.doesNotMatch(subjectSmoke, /content-orchestration\.v1|ai-content\.v1|marketing-worker|marketing-worker:once/);
  assert.doesNotMatch(subjectSmoke, /request\(`\/brands\/\$\{brandId\}\/ai-content\/generations`\s*,\s*\{[\s\S]{0,300}?method:\s*"POST"|\/generate/);
  const subjectResult = spawnSync(process.execPath, ["scripts/ai-content-subject-smoke.mjs"], { encoding: "utf8" });
  assert.equal(subjectResult.status, 2);
  assert.match(subjectResult.stderr, /zero_writes/);

  const envCheck = read("scripts/check-local-env.mjs");
  assert.match(envCheck, /"reel-worker"/);
  assert.match(envCheck, /brand-pilot-reel-worker/);
  assert.match(envCheck, /REEL_CODEX_PLAN_COMMAND/);
});

test("marketing remains a purpose branch inside every active format worker", () => {
  for (const path of [
    "workers/brand-pilot-card-news-worker/src/promptBuilder.ts",
    "workers/brand-pilot-blog-worker/src/promptBuilder.ts",
    "workers/brand-pilot-reel-worker/src/promptBuilder.ts",
  ]) {
    assert.match(read(path), /purpose\s*===\s*"marketing"/, `${path} lost the marketing purpose branch`);
  }
});

test("retired marketing worker has no tracked executable entrypoint", () => {
  for (const path of [
    "workers/brand-pilot-marketing-worker/package.json",
    "workers/brand-pilot-marketing-worker/Dockerfile",
    "workers/brand-pilot-marketing-worker/src/index.ts",
    "workers/brand-pilot-marketing-worker/src/worker.ts",
    "workers/brand-pilot-marketing-worker/src/client.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must be removed`);
  }
});

test("shared worker runtime no longer exports retired orchestration, revision, or attachment preflight helpers", () => {
  const runtime = read("workers/brand-pilot-worker-runtime/src/index.ts");
  assert.doesNotMatch(runtime, /buildAiContentRevisionInstruction|parseWorkerContentOrchestration|preflightAttachmentSnapshots|WorkerContentOrchestrationV1|AiContentRevisionV1/);
  for (const active of ["runControlledSearch", "startJobLeaseGuard", "terminateProcessTree", "runShellCommandWithTimeout", "isRetryableContentWorkerError"]) {
    assert.match(runtime, new RegExp(`\\b${active}\\b`));
  }
});

test("schema-3 cutover consumes the sealed retirement record and starts reel explicitly", () => {
  const lib = read("deploy/scripts/lib.sh");
  const deploy = read("deploy/scripts/deploy.sh");
  const rollout = read("deploy/scripts/rollout-workers.sh");

  assert.match(lib, /validate_marketing_retirement_record\(\)/);
  assert.match(lib, /validate_legacy_marketing_cutover_source\(\)/);
  assert.match(lib, /retire_legacy_marketing_worker\(\)/);
  assert.match(lib, /docker inspect[\s\S]*MARKETING_RETIREMENT_LEGACY_IMAGE/);
  assert.match(lib, /stop[\s\S]*marketing-worker-1[\s\S]*rm -f[\s\S]*marketing-worker-1/);
  assert.doesNotMatch(lib, /up[^\n]*marketing-worker-1|restart[^\n]*marketing-worker-1/);

  assert.match(deploy, /install -m 0400[\s\S]*marketing-worker-retirement\.json/);
  assert.match(deploy, /validate_legacy_marketing_cutover_source/);

  const retirementIndex = rollout.indexOf("retire_legacy_marketing_worker");
  const candidateUpIndex = rollout.indexOf('"${candidate_compose[@]}" up -d');
  assert.ok(retirementIndex >= 0 && candidateUpIndex > retirementIndex, "legacy retirement must precede candidate worker start");
  assert.match(rollout, /ROLLOUT_SERVICES\+=\("reel-worker-1"\)/);
  assert.match(rollout, /REEL_WORKER_CHANGED[\s\S]*true/);
  assert.match(rollout, /worker_rollout=ok[\s\S]*marketing_worker_retirement=ok/);
});

test("retirement executor verifies the legacy image then only stops and removes it", (t) => {
  const bash = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync)
    : ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  if (!bash) return t.skip("bash unavailable");
  const bashPath = (path) => {
    const normalized = resolve(path).replaceAll("\\", "/");
    return process.platform === "win32"
      ? normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
      : normalized;
  };
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-retirement-"));
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const log = join(directory, "docker.log");
  const state = join(directory, "removed");
  const record = join(directory, "marketing-worker-retirement.json");
  const invalidRecord = join(directory, "marketing-worker-retirement-invalid.json");
  const legacyImage = `ghcr.io/dkskrn2/brand-pilot-marketing-worker@sha256:${"a".repeat(64)}`;
  const retirement = {
    contractVersion: "marketing-worker-retirement.v1",
    action: "stop_remove",
    service: "marketing-worker-1",
    restartAllowed: false,
    sourceReleaseSchema: "2",
    sourceReleaseSha: "b".repeat(40),
    sourceManifestSha256: "c".repeat(64),
    baselineManifestSha256: "d".repeat(64),
    legacyImage,
    legacySourceSha: "b".repeat(40),
  };
  writeFileSync(record, `${JSON.stringify(retirement)}\n`, "utf8");
  writeFileSync(invalidRecord, `${JSON.stringify({ ...retirement, restartAllowed: true })}\n`, "utf8");
  const docker = join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [[ "$1" == "inspect" ]]; then printf '%s\\n' "$LEGACY_IMAGE"; exit 0; fi
if [[ "$*" == *" config --quiet" ]]; then exit 0; fi
if [[ "$*" == *" ps -a -q marketing-worker-1" ]]; then
  [[ -f "$DOCKER_STATE" ]] || printf '%s\\n' "aaaaaaaaaaaa"
  exit 0
fi
if [[ "$*" == *" rm -f marketing-worker-1" ]]; then : > "$DOCKER_STATE"; exit 0; fi
if [[ "$*" == *" stop --timeout 30 marketing-worker-1" ]]; then exit 0; fi
exit 91
`, "utf8");
  chmodSync(docker, 0o755);
  const runner = join(directory, "run.sh");
  writeFileSync(runner, `#!/usr/bin/env bash
set -Eeuo pipefail
source "${bashPath("deploy/scripts/lib.sh")}"
validate_marketing_retirement_record "$1"
validate_legacy_marketing_cutover_source() { :; }
retire_legacy_marketing_worker "${bashPath(directory)}"
`, "utf8");
  chmodSync(runner, 0o755);
  const executionEnv = {
    ...process.env,
    PATH: `${bashPath(bin)}:${process.env.PATH}`,
    DOCKER_LOG: bashPath(log),
    DOCKER_STATE: bashPath(state),
    LEGACY_IMAGE: legacyImage,
  };
  const result = spawnSync(bash, [bashPath(runner), bashPath(record)], {
    encoding: "utf8",
    env: executionEnv,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /marketing_worker_retirement=ok/);
  const calls = readFileSync(log, "utf8");
  assert.match(calls, /inspect[\s\S]*stop --timeout 30 marketing-worker-1[\s\S]*rm -f marketing-worker-1/);
  assert.doesNotMatch(calls, /\bup\b|\brestart\b/);
  const invalid = spawnSync(bash, [bashPath(runner), bashPath(invalidRecord)], {
    encoding: "utf8",
    env: executionEnv,
  });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /marketing_retirement_record_invalid/);
});

test("promotion, backup, and transition recovery bind schema-2 state while normal rollback rejects it", () => {
  const lib = read("deploy/scripts/lib.sh");
  assert.match(lib, /candidate\) role_image_keys=\("\$\{RELEASE_IMAGE_KEYS\[@\]\}"\)/);
  assert.match(lib, /legacy-current\) role_image_keys=\("\$\{LEGACY_RELEASE_IMAGE_KEYS\[@\]\}"\)/);
  assert.match(lib, /candidate_release_schema_required/);
  assert.match(lib, /legacy_release_schema_required/);
  assert.match(lib, /transition_retirement_source_sha[\s\S]*validate_legacy_marketing_cutover_source/);

  for (const path of ["deploy/scripts/promote.sh", "deploy/scripts/backup-state.sh"]) {
    const source = read(path);
    assert.match(source, /MARKETING_RETIREMENT_SHA256/);
    assert.match(source, /validate_legacy_marketing_cutover_source/);
    assert.match(source, /legacy_release_manifest_value[\s\S]*API_IMAGE/);
    assert.match(source, /validate_state_release_directory/);
  }
  assert.match(read("deploy/scripts/deploy.sh"), /validate_state_release_directory "\$ROOT" "\$CURRENT_SHA"/);
  const rollback = read("deploy/scripts/rollback.sh");
  assert.match(rollback, /validate_normal_rollback_target/);
  assert.doesNotMatch(rollback, /ROLLBACK_RETIREMENT_SOURCE_SHA|legacy-current/);
});
