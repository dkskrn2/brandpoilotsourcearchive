import assert from "node:assert/strict";
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
