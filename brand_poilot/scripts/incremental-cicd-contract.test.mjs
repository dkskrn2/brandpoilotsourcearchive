import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { IMAGE_KEYS, assembleReleaseManifest } from "./assemble-release-manifest.mjs";

const workflow = readFileSync("../.github/workflows/publish-brand-pilot-server-images.yml", "utf8");
const lib = readFileSync("deploy/scripts/lib.sh", "utf8");
const preflight = readFileSync("deploy/scripts/preflight.sh", "utf8");
const example = readFileSync("deploy/release.env.example", "utf8");

test("publishing is main-only and stale releases are serialized and rejected", () => {
  assert.doesNotMatch(workflow, /instagram-production-base-hotfix/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: brand-pilot-production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /origin\/main/);
  assert.match(workflow, /stale_main_release/);
});

test("workflow detects production impact and builds an affected image matrix", () => {
  assert.match(workflow, /scripts\/release-impact\.mjs/);
  assert.match(workflow, /PRODUCTION_RELEASE_SHA/);
  const prImpactBranch = workflow.match(/if \[\[ "\$GITHUB_EVENT_NAME" == "pull_request" \]\]; then([\s\S]*?)elif/)?.[1] ?? "";
  assert.match(prImpactBranch, /base_sha="\$\(git merge-base "origin\/\$GITHUB_BASE_REF" "\$GITHUB_SHA"\)"/);
  assert.doesNotMatch(prImpactBranch, /base_sha="\$PRODUCTION_RELEASE_SHA"/);
  assert.match(prImpactBranch, /--profile structured-social-render-semantics/);
  assert.match(prImpactBranch, /impact\.verifiedScope && impact\.productionDeployAllowed/);
  assert.match(prImpactBranch, /else[\s\S]*release-impact\.mjs --base "\$base_sha" --head "\$GITHUB_SHA"/);
  const productionImpactBranch = workflow.match(/else\n([\s\S]*?)bootstrap=false\n\s*fi/)?.[1] ?? "";
  assert.match(productionImpactBranch, /release-impact\.mjs --base "\$PRODUCTION_RELEASE_SHA" --head "\$GITHUB_SHA" --profile structured-social-render-semantics/);
  assert.match(productionImpactBranch, /impact\.verifiedScope && impact\.productionDeployAllowed/);
  assert.match(productionImpactBranch, /else[\s\S]*release-impact\.mjs --base "\$PRODUCTION_RELEASE_SHA" --head "\$GITHUB_SHA"/);
  assert.match(workflow, /strategy:[\s\S]*matrix:[\s\S]*fromJSON/);
  assert.match(workflow, /docker\/build-push-action/);
  assert.match(workflow, /cache-from: type=gha/);
  assert.match(workflow, /cache-to: type=gha,mode=max/);
  assert.match(workflow, /DM_WORKER_IMAGE[\s\S]*WIKI_WORKER_IMAGE/);
  assert.match(workflow, /dmWikiWorker/);
  assert.match(workflow, /deploy_bundle_changed: \$\{\{ steps\.impact\.outputs\.deploy_bundle_changed \}\}/);
  assert.match(workflow, /needs\.impact\.outputs\.deploy_bundle_changed == 'true'/);
  assert.match(workflow, /mkdir -p built-images/);
  assert.match(workflow, /name: Verify customer UI[\s\S]*TZ: Asia\/Seoul[\s\S]*npm run test --workspace @brand-pilot\/customer-ui/);
});

test.skip("DEFERRED: automatic three-format cutover waits for manual production and browser evidence", () => {
  assert.match(workflow, /release-impact\.mjs[^\n]*--profile ai-content-three-format-cutover/);
  assert.match(workflow, /assemble-release-manifest\.mjs[^\n]*--mode initial-cutover/);
  assert.match(workflow, /RELEASE_SCHEMA=3/);
  assert.doesNotMatch(workflow, /RELEASE_SCHEMA=2/);
});

test("deployment scripts inspect legacy cutover sources but normal rollback targets schema 3 only", () => {
  assert.match(lib, /RELEASE_MANIFEST\[RELEASE_SCHEMA\][^\n]*== "1"/);
  assert.match(lib, /RELEASE_MANIFEST\[RELEASE_SCHEMA\][^\n]*== "2"/);
  assert.match(lib, /validate_normal_rollback_target/);
  assert.match(lib, /legacy_release_rollback_forbidden/);
  assert.match(lib, /_SOURCE_SHA/);
  assert.match(lib, /_CHANGED/);
  assert.match(preflight, /component_source_revision/);
  assert.match(example, /^RELEASE_SCHEMA=3$/m);
  assert.match(example, /^API_SOURCE_SHA=/m);
  assert.match(example, /^API_CHANGED=/m);
  assert.match(example, /^CARD_NEWS_WORKER_SOURCE_SHA=/m);
  assert.match(example, /^CARD_NEWS_WORKER_CHANGED=/m);
});

test("workflow does not apply database migrations automatically", () => {
  assert.doesNotMatch(workflow, /npm run db:migrate|node scripts\/migrate\.mjs|\bpsql\b/);
});

test("bash parser accepts schema 3 and returns each component source revision", (t) => {
  const bash = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync)
    : ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  if (!bash) return t.skip("bash unavailable");

  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-schema2-"));
  const manifestPath = join(directory, "release.env");
  const sha = "a".repeat(40);
  const digest = "d".repeat(64);
  const builtImages = Object.fromEntries(IMAGE_KEYS.map((key) => [key, {
    image: `ghcr.io/example/${key.toLowerCase()}@sha256:${digest}`,
    sourceSha: sha,
  }]));
  writeFileSync(manifestPath, assembleReleaseManifest({
    releaseSha: sha,
    currentManifest: null,
    builtImages,
    changedImageKeys: IMAGE_KEYS,
    staticValues: {
      CADDY_IMAGE: `docker.io/library/caddy@sha256:${digest}`,
      CANARY_HOST: "canary.example.com",
      PRIMARY_HOST: "api.example.com",
      ACME_EMAIL: "ops@example.com",
      API_ENV_FILE: "/opt/example/api.env",
    },
  }), { mode: 0o600 });
  chmodSync(manifestPath, 0o600);

  const toBashPath = (path) => process.platform === "win32"
    ? path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
  const result = spawnSync(bash, ["-lc", `source deploy/scripts/lib.sh; parse_release_manifest \"$1\"; [[ \"$(release_image_source_revision API_IMAGE)\" == \"${sha}\" ]]; release_image_changed API_IMAGE`, "schema2-test", toBashPath(manifestPath)], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  rmSync(directory, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("legacy-current validation accepts any immutable pre-rollout release", (t) => {
  const bash = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync)
    : ["/usr/bin/bash", "/bin/bash"].find(existsSync);
  if (!bash) return t.skip("bash unavailable");

  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-legacy-current-"));
  const releaseSha = "a".repeat(40);
  const releaseDirectory = join(directory, "releases", releaseSha);
  mkdirSync(releaseDirectory, { recursive: true });
  writeFileSync(join(releaseDirectory, "release.env"), "RELEASE_SCHEMA=1\n", { mode: 0o600 });
  writeFileSync(join(releaseDirectory, "release-integrity.sha256"), [
    `${"b".repeat(64)}  755  scripts/backup-state.sh`,
    `${"c".repeat(64)}  755  scripts/restore-state.sh`,
    "",
  ].join("\n"), { mode: 0o600 });
  const toBashPath = (path) => process.platform === "win32"
    ? path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
    : path;
  const bashReleaseDirectory = toBashPath(releaseDirectory);
  const bashRoot = toBashPath(directory);
  const result = spawnSync(bash, ["-lc", [
    "source deploy/scripts/lib.sh",
    `specs=\"$(release_file_specs '${bashReleaseDirectory}' legacy-current)\"`,
    "[[ \"$specs\" != *rollout-workers.sh* ]]",
    "[[ \"$specs\" == *backup-state.sh* ]]",
    "[[ \"$specs\" == *restore-state.sh* ]]",
    "validate_release_directory(){ [[ \"$2\" == legacy-current ]]; }",
    `validate_state_release_directory '${bashRoot}' '${releaseSha}'`,
  ].join("; ")], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  rmSync(directory, { recursive: true, force: true });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("worker rollout is locked, digest-pinned, selective, and fails closed before heartbeat evidence", () => {
  const rolloutPath = "deploy/scripts/rollout-workers.sh";
  assert.equal(existsSync(rolloutPath), true, "selective rollout script must exist");
  const rollout = readFileSync(rolloutPath, "utf8");

  assert.match(rollout, /deploy\.lock/);
  assert.match(rollout, /flock -n 9/);
  assert.match(rollout, /reconcile_transition_or_fail/);
  assert.match(rollout, /validate_release_directory/);
  assert.match(rollout, /release_image_changed/);
  assert.match(rollout, /verify_release_image_revision/);
  assert.match(rollout, /--no-deps --pull never --force-recreate/);
  assert.match(rollout, /worker_heartbeat_evidence_required/);
  assert.match(rollout, /ps --status running --services/);
  assert.match(rollout, /worker_rollout=skipped_inactive/);
  assert.match(rollout, /worker_previous_runtime_mismatch/);
  assert.match(rollout, /docker inspect --format '\{\{\.Config\.Image\}\}'/);
  assert.match(rollout, /previous/);

  for (const service of [
    "dm-worker-1",
    "dm-worker-2",
    "wiki-worker-1",
    "content-proposal-worker-1",
    "brand-intelligence-worker-1",
    "subject-analysis-worker-1",
    "image-worker-1",
    "card-news-worker-1",
    "blog-worker-1",
    "reel-worker-1",
  ]) {
    assert.match(rollout, new RegExp(service));
  }
  assert.doesNotMatch(rollout, /docker compose down/);
});
