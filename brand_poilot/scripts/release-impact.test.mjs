import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { SERVER_COMPONENTS, classifyChangedPaths } from "./release-impact.mjs";

const enabled = (impact) => Object.entries(impact.components)
  .filter(([, value]) => value)
  .map(([key]) => key)
  .sort();

test("classifies UI, API, and one worker without widening unrelated components", () => {
  assert.deepEqual(enabled(classifyChangedPaths(["brand_poilot/apps/customer-ui/src/App.tsx"])), ["customerUi"]);
  assert.deepEqual(enabled(classifyChangedPaths(["brand_poilot/apps/api/src/index.ts"])), ["api"]);
  assert.deepEqual(
    enabled(classifyChangedPaths(["brand_poilot/workers/brand-pilot-card-news-worker/src/worker.ts"])),
    ["cardNewsWorker"],
  );
});

test("builds the shared DM and Wiki image once for DM worker changes", () => {
  const impact = classifyChangedPaths(["brand_poilot/workers/brand-pilot-dm-worker/src/worker.ts"]);
  assert.deepEqual(enabled(impact), ["dmWikiWorker"]);
});

test("classifies reel worker changes without reviving the retired marketing worker component", () => {
  const impact = classifyChangedPaths(["brand_poilot/workers/brand-pilot-reel-worker/src/worker.ts"]);
  assert.deepEqual(enabled(impact), ["reelWorker"]);
  assert.equal(SERVER_COMPONENTS.includes("marketingWorker"), false);
});

test("widens shared runtime and dependency graph changes to every server image", () => {
  for (const path of [
    "brand_poilot/workers/brand-pilot-worker-runtime/src/index.ts",
    "brand_poilot/package-lock.json",
    "brand_poilot/package.json",
  ]) {
    const impact = classifyChangedPaths([path]);
    assert.equal(impact.buildAllServer, true, path);
    assert.deepEqual(enabled(impact).filter((name) => name !== "customerUi"), [...SERVER_COMPONENTS].sort(), path);
  }
});

test("marks migration changes and never treats them as an automatic deploy", () => {
  const impact = classifyChangedPaths(["brand_poilot/db/migrations/074_example.sql"]);
  assert.equal(impact.migrationChanged, true);
  assert.equal(impact.productionDeployAllowed, false);
  assert.equal(impact.components.api, true);
});

test("keeps deploy-only and docs-only changes out of application images", () => {
  const deploy = classifyChangedPaths(["brand_poilot/deploy/scripts/deploy.sh"]);
  assert.equal(deploy.deployBundleChanged, true);
  assert.deepEqual(enabled(deploy), []);

  const docs = classifyChangedPaths(["brand_poilot/docs/operations/UBUNTU_DEPLOYMENT.md"]);
  assert.equal(docs.docsOnly, true);
  assert.deepEqual(enabled(docs), []);
});

test("keeps release tooling contract tests out of runtime images", () => {
  for (const path of [
    "brand_poilot/scripts/deployment-contract.test.mjs",
    "brand_poilot/scripts/incremental-cicd-contract.test.mjs",
    "brand_poilot/scripts/assemble-release-manifest.test.mjs",
    "brand_poilot/scripts/release-impact.test.mjs",
  ]) {
    const impact = classifyChangedPaths([path]);
    assert.equal(impact.buildAllServer, false, path);
    assert.deepEqual(enabled(impact), [], path);
    assert.deepEqual(impact.unknownPaths, [], path);
  }
});

test("updates the release bundle without rebuilding images for CI-only release tools", () => {
  for (const path of [
    "brand_poilot/scripts/release-impact.mjs",
    "brand_poilot/scripts/assemble-release-manifest.mjs",
  ]) {
    const impact = classifyChangedPaths([path]);
    assert.equal(impact.deployBundleChanged, true, path);
    assert.equal(impact.buildAllServer, false, path);
    assert.deepEqual(enabled(impact), [], path);
  }
});

test("fails closed to all server images for an unknown runtime-capable path", () => {
  const impact = classifyChangedPaths(["brand_poilot/runtime/new-entrypoint.sh"]);
  assert.equal(impact.buildAllServer, true);
  assert.deepEqual(impact.unknownPaths, ["brand_poilot/runtime/new-entrypoint.sh"]);
  assert.deepEqual(enabled(impact), [...SERVER_COMPONENTS].sort());
});

test("normalizes paths, removes duplicates, and rejects empty input", () => {
  const impact = classifyChangedPaths([
    "apps/api/src/index.ts",
    "brand_poilot/apps/api/src/index.ts",
    "brand_poilot/apps/api/src/index.ts",
  ]);
  assert.deepEqual(enabled(impact), ["api"]);
  assert.throws(() => classifyChangedPaths([]), /changed_paths_required/);
  assert.throws(() => classifyChangedPaths(["  "]), /changed_paths_required/);
});

test("three-format cutover profile never widens into unrelated workers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts",
    "brand_poilot/apps/api/src/httpServer.ts",
    "brand_poilot/db/migrations/075_ai_content_three_format_cutover.sql",
    "brand_poilot/package.json",
    "brand_poilot/package-lock.json",
    "brand_poilot/workers/brand-pilot-worker-runtime/src/index.ts",
    "brand_poilot/workers/brand-pilot-content-proposal-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-image-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-card-news-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-blog-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-reel-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-marketing-worker/src/worker.ts",
    "brand_poilot/deploy/scripts/rollout-workers.sh",
    "brand_poilot/scripts/convert-legacy-release-manifest.mjs",
  ], { profile: "ai-content-three-format-cutover" });

  assert.deepEqual(enabled(impact), [
    "api", "blogWorker", "cardNewsWorker", "contentProposalWorker",
    "customerUi", "imageWorker", "reelWorker",
  ]);
  assert.equal(impact.components.dmWikiWorker, false);
  assert.equal(impact.components.brandIntelligenceWorker, false);
  assert.equal(impact.components.subjectAnalysisWorker, false);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.deployBundleChanged, true);
  assert.equal(impact.verifiedScope, true);
  assert.equal(impact.productionDeployAllowed, false, "the cutover migration remains manual");
  assert.deepEqual(impact.unknownPaths, []);
});

test("three-format cutover profile fails closed without selecting unrelated images", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/workers/brand-pilot-dm-worker/src/worker.ts",
  ], { profile: "ai-content-three-format-cutover" });
  assert.deepEqual(enabled(impact), []);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.verifiedScope, false);
  assert.equal(impact.productionDeployAllowed, false);
  assert.deepEqual(impact.unknownPaths, ["brand_poilot/workers/brand-pilot-dm-worker/src/worker.ts"]);
});

test("CLI includes deleted marketing paths and maps retirement only to reel and deploy", () => {
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-impact-deletion-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    execFileSync("git", ["config", "user.email", "impact@example.test"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Impact Fixture"], { cwd: directory });
    const workerDirectory = join(directory, "brand_poilot", "workers", "brand-pilot-marketing-worker", "src");
    mkdirSync(workerDirectory, { recursive: true });
    writeFileSync(join(workerDirectory, "worker.ts"), "export {};\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: directory });
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    rmSync(join(workerDirectory, "worker.ts"));
    execFileSync("git", ["add", "-A"], { cwd: directory });
    execFileSync("git", ["commit", "--quiet", "-m", "retire"], { cwd: directory });
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();

    const output = execFileSync(process.execPath, [
      resolve("scripts/release-impact.mjs"), "--base", base, "--head", head,
      "--profile", "ai-content-three-format-cutover",
    ], { cwd: directory, encoding: "utf8" });
    const impact = JSON.parse(output);
    assert.deepEqual(enabled(impact), ["reelWorker"]);
    assert.equal(impact.deployBundleChanged, true);
    assert.equal(impact.verifiedScope, true);
    assert.deepEqual(impact.paths, ["workers/brand-pilot-marketing-worker/src/worker.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
