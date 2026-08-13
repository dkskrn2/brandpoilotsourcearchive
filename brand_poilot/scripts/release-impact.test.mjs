import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CARD_DECK_EDITORIAL_PIPELINE_PROFILE,
  FAQ_UTTERANCE_MATCHING_PROFILE,
  SERVER_COMPONENTS,
  STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE,
  classifyChangedPaths,
} from "./release-impact.mjs";

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

test("does not rebuild the DM and Wiki image for a PGlite-only fixture change", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/workers/brand-pilot-dm-worker/src/faqSuggestionDb.test.ts",
  ]);
  assert.deepEqual(enabled(impact), []);
  assert.equal(impact.verifiedScope, true);
});

test("classifies reel worker changes without reviving the retired marketing worker component", () => {
  const impact = classifyChangedPaths(["brand_poilot/workers/brand-pilot-reel-worker/src/worker.ts"]);
  assert.deepEqual(enabled(impact), ["reelWorker"]);
  assert.equal(SERVER_COMPONENTS.includes("marketingWorker"), false);
});

test("widens shared runtime and dependency graph changes to every server image", () => {
  for (const path of [
    "brand_poilot/workers/brand-pilot-worker-runtime/src/jobLease.ts",
    "brand_poilot/package-lock.json",
    "brand_poilot/package.json",
  ]) {
    const impact = classifyChangedPaths([path]);
    assert.equal(impact.buildAllServer, true, path);
    assert.deepEqual(enabled(impact).filter((name) => name !== "customerUi"), [...SERVER_COMPONENTS].sort(), path);
  }
});

test("attributes an API workspace dependency lock update only to the API image", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/api/package.json",
    "brand_poilot/package-lock.json",
  ]);

  assert.deepEqual(enabled(impact), ["api"]);
  assert.equal(impact.buildAllServer, false);
  assert.deepEqual(impact.unknownPaths, []);
});

test("attributes API and UI workspace dependency lock updates without rebuilding workers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/api/package.json",
    "brand_poilot/apps/customer-ui/package.json",
    "brand_poilot/package-lock.json",
  ]);

  assert.deepEqual(enabled(impact), ["api", "customerUi"]);
  assert.equal(impact.buildAllServer, false);
  assert.deepEqual(impact.unknownPaths, []);
});

test("limits the Codex account pool runtime change to manual content generation", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/workers/brand-pilot-worker-runtime/src/codexAccountPool.test.ts",
    "brand_poilot/workers/brand-pilot-worker-runtime/src/codexAccountPool.ts",
    "brand_poilot/workers/brand-pilot-worker-runtime/src/index.test.ts",
    "brand_poilot/workers/brand-pilot-worker-runtime/src/index.ts",
    ".github/workflows/publish-brand-pilot-server-images.yml",
  ]);

  assert.deepEqual(enabled(impact), [
    "api", "blogWorker", "cardNewsWorker", "contentProposalWorker", "imageWorker", "reelWorker",
  ]);
  assert.equal(impact.components.dmWikiWorker, false);
  assert.equal(impact.components.brandIntelligenceWorker, false);
  assert.equal(impact.components.subjectAnalysisWorker, false);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.deployBundleChanged, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("limits controlled search and its static harness to the workers that execute it", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts",
    "brand_poilot/workers/brand-pilot-worker-runtime/src/controlledSearch.ts",
    "brand_poilot/scripts/check-local-env.mjs",
    "brand_poilot/scripts/three-format-cutover-static-check.mjs",
  ]);

  assert.deepEqual(enabled(impact), ["blogWorker", "contentProposalWorker"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.deployBundleChanged, false);
  assert.deepEqual(impact.unknownPaths, []);
});

test("limits private planner draft contracts to the manual V3 plan consumers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/packages/brand-pilot-content-contracts/package.json",
    "brand_poilot/packages/brand-pilot-content-contracts/src/generateArtifacts.ts",
    "brand_poilot/packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts",
    "brand_poilot/packages/brand-pilot-content-contracts/src/plannerDrafts.test.ts",
    "brand_poilot/packages/brand-pilot-content-contracts/src/plannerDrafts.ts",
  ]);

  assert.deepEqual(enabled(impact), ["api", "blogWorker", "cardNewsWorker", "reelWorker"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.deployBundleChanged, false);
  assert.deepEqual(impact.unknownPaths, []);
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

test("keeps script test fixtures out of runtime images", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/scripts/ai-content-074.postgres.integration.test.mjs",
    "brand_poilot/scripts/content-account-pool-deployment.test.mjs",
    "brand_poilot/scripts/migrations.integration.test.mjs",
  ]);
  assert.equal(impact.buildAllServer, false);
  assert.deepEqual(enabled(impact), []);
  assert.deepEqual(impact.unknownPaths, []);
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

test("three-format cutover maps every production cutover artifact without widening unrelated workers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/scripts/ai-content-cutover-evidence.mjs",
    "brand_poilot/scripts/ai-content-cutover-floor-probe.mjs",
    "brand_poilot/scripts/ai-content-database-catalog.mjs",
    "brand_poilot/scripts/ai-content-provider-artifacts.mjs",
    "brand_poilot/scripts/collect-ai-content-prepare-evidence.mjs",
    "brand_poilot/deploy/scripts/collect-ai-content-backend-evidence.sh",
    "brand_poilot/deploy/scripts/rollout-ai-content-cutover.sh",
    "brand_poilot/scripts/three-format-cutover-static-check.mjs",
  ], { profile: "ai-content-three-format-cutover" });

  assert.deepEqual(enabled(impact), ["api"]);
  assert.equal(impact.deployBundleChanged, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("structured social render profile selects only its four coordinated consumers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/packages/brand-pilot-content-contracts/src/structuredSceneCopy.ts",
    "brand_poilot/packages/brand-pilot-content-contracts/generated/structured-scene-copy-v1.schema.json",
    "brand_poilot/apps/api/src/aiContentRenderJobs.ts",
    "brand_poilot/workers/brand-pilot-card-news-worker/src/structuredSceneDraft.ts",
    "brand_poilot/workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md",
    "brand_poilot/workers/brand-pilot-card-news-worker/Dockerfile",
    "brand_poilot/workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v1.schema.json",
    "brand_poilot/workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs",
    "brand_poilot/workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts",
    "brand_poilot/workers/brand-pilot-reel-worker/src/structuredSceneDraft.ts",
    "brand_poilot/workers/brand-pilot-reel-worker/Dockerfile",
    "brand_poilot/workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs",
    "brand_poilot/workers/brand-pilot-reel-worker/src/productionRuntime.test.ts",
    "brand_poilot/workers/brand-pilot-image-worker/src/aiContentManualRenderContract.ts",
    "brand_poilot/docs/superpowers/plans/2026-08-11-structured-social-scene-copy.md",
    "brand_poilot/docs/superpowers/specs/2026-08-11-structured-social-scene-copy-design.md",
    "brand_poilot/scripts/release-impact.mjs",
    "brand_poilot/scripts/release-impact.test.mjs",
    ".github/workflows/publish-brand-pilot-server-images.yml",
    "brand_poilot/scripts/incremental-cicd-contract.test.mjs",
  ], { profile: STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE });

  assert.deepEqual(enabled(impact), ["api", "cardNewsWorker", "imageWorker", "reelWorker"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.migrationChanged, false);
  assert.equal(impact.productionDeployAllowed, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("structured social render profile rejects any extra path without widening deployment", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/api/src/aiContentRenderJobs.ts",
    "brand_poilot/workers/brand-pilot-blog-worker/src/worker.ts",
  ], { profile: STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE });

  assert.deepEqual(enabled(impact), ["api"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.productionDeployAllowed, false);
  assert.equal(impact.verifiedScope, false);
  assert.deepEqual(impact.unknownPaths, ["brand_poilot/workers/brand-pilot-blog-worker/src/worker.ts"]);
});

test("editorial pipeline selects exactly its five Card and Reel server consumers", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/packages/brand-pilot-content-contracts/src/cardDeckEditorialPlan.ts",
    "brand_poilot/apps/api/src/aiContentRenderJobs.ts",
    "brand_poilot/workers/brand-pilot-content-proposal-worker/src/contracts.ts",
    "brand_poilot/workers/brand-pilot-card-news-worker/src/deckPlan.ts",
    "brand_poilot/workers/brand-pilot-reel-worker/src/contracts.ts",
    "brand_poilot/workers/brand-pilot-image-worker/src/aiContentCardDeckPromptCompiler.ts",
    "brand_poilot/docs/superpowers/plans/2026-08-12-card-deck-editorial-pipeline.md",
  ], { profile: CARD_DECK_EDITORIAL_PIPELINE_PROFILE });

  assert.deepEqual(enabled(impact), ["api", "cardNewsWorker", "contentProposalWorker", "imageWorker", "reelWorker"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.migrationChanged, false);
  assert.equal(impact.productionDeployAllowed, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("editorial pipeline accepts the unified result UI without widening unrelated UI scope", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/api/src/aiContentPublish.ts",
    "brand_poilot/apps/customer-ui/src/pages/AiContentGenerationPage.tsx",
    "brand_poilot/apps/customer-ui/src/components/ai-content/AiContentPublishPanel.tsx",
    "brand_poilot/apps/customer-ui/src/styles/ai-content-flow.css",
    "brand_poilot/docs/superpowers/plans/2026-08-13-unified-results-and-reel-publishing.md",
    "brand_poilot/docs/superpowers/specs/2026-08-13-ai-content-reel-direct-publishing-design.md",
  ], { profile: CARD_DECK_EDITORIAL_PIPELINE_PROFILE });

  assert.deepEqual(enabled(impact), ["api", "customerUi"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.migrationChanged, false);
  assert.equal(impact.productionDeployAllowed, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);

  const unrelated = classifyChangedPaths([
    "brand_poilot/apps/customer-ui/src/App.tsx",
  ], { profile: CARD_DECK_EDITORIAL_PIPELINE_PROFILE });
  assert.equal(unrelated.productionDeployAllowed, false);
  assert.deepEqual(unrelated.unknownPaths, ["brand_poilot/apps/customer-ui/src/App.tsx"]);
});

test("editorial pipeline rejects unrelated UI, Blog, marketing, and migration paths", () => {
  for (const path of [
    "brand_poilot/apps/customer-ui/src/App.tsx",
    "brand_poilot/workers/brand-pilot-blog-worker/src/worker.ts",
    "brand_poilot/workers/brand-pilot-marketing-worker/src/worker.ts",
    "brand_poilot/db/migrations/077_unrelated.sql",
  ]) {
    const impact = classifyChangedPaths([
      "brand_poilot/apps/api/src/aiContentRenderJobs.ts",
      path,
    ], { profile: CARD_DECK_EDITORIAL_PIPELINE_PROFILE });
    assert.deepEqual(enabled(impact), ["api"], path);
    assert.equal(impact.buildAllServer, false, path);
    assert.equal(impact.productionDeployAllowed, false, path);
    assert.deepEqual(impact.unknownPaths, [path], path);
  }
});

test("editorial pipeline accepts its exact deployment tooling without widening runtime images", () => {
  const impact = classifyChangedPaths([
    ".github/workflows/publish-brand-pilot-server-images.yml",
    "brand_poilot/deploy/env/card-news-worker.env.example",
    "brand_poilot/scripts/canonical-format-schema-runtime.test.mjs",
    "brand_poilot/scripts/content-account-pool-deployment.test.mjs",
    "brand_poilot/scripts/incremental-cicd-contract.test.mjs",
    "brand_poilot/scripts/reel-worker-deployment-cutover.test.mjs",
    "brand_poilot/scripts/release-impact.mjs",
    "brand_poilot/scripts/release-impact.test.mjs",
    "brand_poilot/scripts/three-format-cutover-static-check.mjs",
    "brand_poilot/scripts/three-format-cutover-static-check.test.mjs",
  ], { profile: CARD_DECK_EDITORIAL_PIPELINE_PROFILE });

  assert.deepEqual(enabled(impact), []);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.productionDeployAllowed, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("FAQ utterance profile selects only API, customer UI, and the shared DM image", () => {
  const impact = classifyChangedPaths([
    "brand_poilot/apps/api/src/faqMatcher.ts",
    "brand_poilot/apps/customer-ui/src/components/brand-center/FaqUtteranceEditor.tsx",
    "brand_poilot/workers/brand-pilot-dm-worker/src/faqSuggestionWorker.ts",
    "brand_poilot/db/migrations/078_faq_utterance_matching.sql",
    "brand_poilot/deploy/scripts/rollout-workers.sh",
    "brand_poilot/scripts/faq-matcher-evaluation-runner.ts",
    "brand_poilot/scripts/migrationRunner.mjs",
    "brand_poilot/scripts/release-impact.mjs",
    "brand_poilot/scripts/release-impact.test.mjs",
    "brand_poilot/scripts/incremental-cicd-contract.test.mjs",
    ".github/workflows/publish-brand-pilot-server-images.yml",
    "brand_poilot/docs/operations/faq-utterance-matching-rollout.md",
  ], { profile: FAQ_UTTERANCE_MATCHING_PROFILE });

  assert.deepEqual(enabled(impact), ["api", "customerUi", "dmWikiWorker"]);
  assert.equal(impact.buildAllServer, false);
  assert.equal(impact.migrationChanged, true);
  assert.equal(impact.productionDeployAllowed, false);
  assert.equal(impact.deployBundleChanged, true);
  assert.equal(impact.verifiedScope, true);
  assert.deepEqual(impact.unknownPaths, []);
});

test("FAQ utterance profile rejects unrelated workers and migrations without widening", () => {
  for (const path of [
    "brand_poilot/workers/brand-pilot-blog-worker/src/worker.ts",
    "brand_poilot/db/migrations/079_unrelated.sql",
    "brand_poilot/scripts/unrelated-runtime.mjs",
  ]) {
    const impact = classifyChangedPaths([
      "brand_poilot/apps/api/src/faqMatcher.ts",
      path,
    ], { profile: FAQ_UTTERANCE_MATCHING_PROFILE });
    assert.deepEqual(enabled(impact), ["api"], path);
    assert.equal(impact.buildAllServer, false, path);
    assert.equal(impact.productionDeployAllowed, false, path);
    assert.equal(impact.verifiedScope, false, path);
    assert.deepEqual(impact.unknownPaths, [path], path);
  }
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
