import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SERVER_COMPONENTS = Object.freeze([
  "api",
  "dmWikiWorker",
  "contentProposalWorker",
  "brandIntelligenceWorker",
  "subjectAnalysisWorker",
  "imageWorker",
  "cardNewsWorker",
  "blogWorker",
  "reelWorker",
]);

const COMPONENTS = Object.freeze(["customerUi", ...SERVER_COMPONENTS]);

export const AI_CONTENT_THREE_FORMAT_CUTOVER_PROFILE = "ai-content-three-format-cutover";
export const STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE = "structured-social-render-semantics";
const AI_CONTENT_CUTOVER_SERVER_COMPONENTS = Object.freeze([
  "api",
  "contentProposalWorker",
  "imageWorker",
  "cardNewsWorker",
  "blogWorker",
  "reelWorker",
]);

const AI_CONTENT_ACCOUNT_POOL_RUNTIME_PATHS = new Set([
  "workers/brand-pilot-worker-runtime/src/codexAccountPool.test.ts",
  "workers/brand-pilot-worker-runtime/src/codexAccountPool.ts",
  "workers/brand-pilot-worker-runtime/src/index.test.ts",
  "workers/brand-pilot-worker-runtime/src/index.ts",
]);

const AI_CONTENT_CONTROLLED_SEARCH_RUNTIME_PATHS = new Set([
  "workers/brand-pilot-worker-runtime/src/controlledSearch.test.ts",
  "workers/brand-pilot-worker-runtime/src/controlledSearch.ts",
]);

const AI_CONTENT_PLANNER_DRAFT_CONTRACT_PATHS = new Set([
  "packages/brand-pilot-content-contracts/package.json",
  "packages/brand-pilot-content-contracts/src/generateArtifacts.ts",
  "packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts",
  "packages/brand-pilot-content-contracts/src/plannerDrafts.test.ts",
  "packages/brand-pilot-content-contracts/src/plannerDrafts.ts",
]);

const AI_CONTENT_SCOPED_TOOLING_PATHS = new Set([
  "scripts/check-local-env.mjs",
  "scripts/three-format-cutover-static-check.mjs",
]);

const STRUCTURED_SOCIAL_CONTRACT_PATHS = new Set([
  "packages/brand-pilot-content-contracts/package.json",
  "packages/brand-pilot-content-contracts/generated/content-catalog.json",
  "packages/brand-pilot-content-contracts/generated/structured-scene-copy-v1.schema.json",
  "packages/brand-pilot-content-contracts/src/catalog.test.ts",
  "packages/brand-pilot-content-contracts/src/catalog.ts",
  "packages/brand-pilot-content-contracts/src/generateArtifacts.ts",
  "packages/brand-pilot-content-contracts/src/generatedArtifacts.test.ts",
  "packages/brand-pilot-content-contracts/src/index.ts",
  "packages/brand-pilot-content-contracts/src/structuredSceneCopy.test.ts",
  "packages/brand-pilot-content-contracts/src/structuredSceneCopy.ts",
]);

const STRUCTURED_SOCIAL_API_PATHS = new Set([
  "apps/api/src/aiContentContracts.ts",
  "apps/api/src/aiContentRenderJobs.pglite.test.ts",
  "apps/api/src/aiContentRenderJobs.test.ts",
  "apps/api/src/aiContentRenderJobs.ts",
  "apps/api/src/aiContentRepository.ts",
  "apps/api/src/aiContentRepositoryV3.postgres.integration.test.ts",
  "apps/api/src/aiContentRepositoryV3Runtime.test.ts",
  "apps/api/src/httpServer.ts",
  "apps/api/src/server.aiContentWorker.test.ts",
]);

const STRUCTURED_SOCIAL_CARD_PATHS = new Set([
  "workers/brand-pilot-card-news-worker/.agents/skills/card-news-creator/SKILL.md",
  "workers/brand-pilot-card-news-worker/Dockerfile",
  "workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v1.schema.json",
  "workers/brand-pilot-card-news-worker/scripts/card-news-plan-draft-v2.schema.json",
  "workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs",
  "workers/brand-pilot-card-news-worker/src/editorialPlan.ts",
  "workers/brand-pilot-card-news-worker/src/productionRuntime.test.ts",
  "workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts",
  "workers/brand-pilot-card-news-worker/src/promptBuilder.ts",
  "workers/brand-pilot-card-news-worker/src/structuredSceneDraft.test.ts",
  "workers/brand-pilot-card-news-worker/src/structuredSceneDraft.ts",
  "workers/brand-pilot-card-news-worker/src/worker.test.ts",
  "workers/brand-pilot-card-news-worker/src/worker.ts",
]);

const STRUCTURED_SOCIAL_REEL_PATHS = new Set([
  "workers/brand-pilot-reel-worker/Dockerfile",
  "workers/brand-pilot-reel-worker/scripts/reel-plan-draft-v2.schema.json",
  "workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs",
  "workers/brand-pilot-reel-worker/src/contracts.test.ts",
  "workers/brand-pilot-reel-worker/src/contracts.ts",
  "workers/brand-pilot-reel-worker/src/productionRuntime.test.ts",
  "workers/brand-pilot-reel-worker/src/promptBuilder.test.ts",
  "workers/brand-pilot-reel-worker/src/promptBuilder.ts",
  "workers/brand-pilot-reel-worker/src/structuredSceneDraft.ts",
  "workers/brand-pilot-reel-worker/src/worker.test.ts",
  "workers/brand-pilot-reel-worker/src/worker.ts",
]);

const STRUCTURED_SOCIAL_IMAGE_PATHS = new Set([
  "workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md",
  "workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts",
  "workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts",
  "workers/brand-pilot-image-worker/src/aiContentCardNewsAssetPromptV2.ts",
  "workers/brand-pilot-image-worker/src/aiContentLockedSocialCopyPrompt.ts",
  "workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2.test.ts",
  "workers/brand-pilot-image-worker/src/aiContentManualAssetPromptV2Common.ts",
  "workers/brand-pilot-image-worker/src/aiContentManualRenderContract.test.ts",
  "workers/brand-pilot-image-worker/src/aiContentManualRenderContract.ts",
  "workers/brand-pilot-image-worker/src/aiContentReelAssetPromptV2.ts",
  "workers/brand-pilot-image-worker/src/aiContentRenderClient.test.ts",
  "workers/brand-pilot-image-worker/src/aiContentRenderClient.ts",
  "workers/brand-pilot-image-worker/src/productionRuntime.test.ts",
  "workers/brand-pilot-image-worker/src/skillContract.test.ts",
  "workers/brand-pilot-image-worker/test/fixtures/manualRender.ts",
]);

const STRUCTURED_SOCIAL_TOOLING_PATHS = new Set([
  ".github/workflows/publish-brand-pilot-server-images.yml",
  "scripts/incremental-cicd-contract.test.mjs",
  "scripts/release-impact.mjs",
  "scripts/release-impact.test.mjs",
]);

const STRUCTURED_SOCIAL_DOC_PATHS = new Set([
  "docs/superpowers/plans/2026-08-11-structured-social-scene-copy.md",
  "docs/superpowers/plans/2026-08-12-structured-scene-render-semantics.md",
  "docs/superpowers/specs/2026-08-11-structured-social-scene-copy-design.md",
]);

const WORKER_PATHS = Object.freeze([
  ["workers/brand-pilot-dm-worker/", "dmWikiWorker"],
  ["workers/brand-pilot-content-proposal-worker/", "contentProposalWorker"],
  ["workers/brand-pilot-brand-intelligence-worker/", "brandIntelligenceWorker"],
  ["workers/brand-pilot-subject-analysis-worker/", "subjectAnalysisWorker"],
  ["workers/brand-pilot-image-worker/", "imageWorker"],
  ["workers/brand-pilot-card-news-worker/", "cardNewsWorker"],
  ["workers/brand-pilot-blog-worker/", "blogWorker"],
  ["workers/brand-pilot-reel-worker/", "reelWorker"],
]);

const RELEASE_TOOLING_TEST_PATHS = new Set([
  "scripts/deployment-contract.test.mjs",
  "scripts/incremental-cicd-contract.test.mjs",
  "scripts/assemble-release-manifest.test.mjs",
  "scripts/release-impact.test.mjs",
]);

const normalizePath = (value) => {
  const path = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  return path.startsWith("brand_poilot/") ? path.slice("brand_poilot/".length) : path;
};

const enableAllServer = (components) => {
  for (const component of SERVER_COMPONENTS) components[component] = true;
};

const enableAiContentCutoverServer = (components) => {
  for (const component of AI_CONTENT_CUTOVER_SERVER_COMPONENTS) components[component] = true;
};

const CUTOVER_WORKER_PATHS = Object.freeze([
  ["workers/brand-pilot-content-proposal-worker/", "contentProposalWorker"],
  ["workers/brand-pilot-image-worker/", "imageWorker"],
  ["workers/brand-pilot-card-news-worker/", "cardNewsWorker"],
  ["workers/brand-pilot-blog-worker/", "blogWorker"],
  ["workers/brand-pilot-reel-worker/", "reelWorker"],
]);

const CUTOVER_API_SCRIPT_PATHS = Object.freeze([
  "scripts/ai-content-cutover-control.mjs",
  "scripts/ai-content-cutover-evidence.mjs",
  "scripts/ai-content-cutover-floor-probe.mjs",
  "scripts/ai-content-database-catalog.mjs",
  "scripts/ai-content-database-roles.mjs",
  "scripts/ai-content-provider-artifacts.mjs",
  "scripts/collect-ai-content-prepare-evidence.mjs",
  "scripts/migrate.mjs",
  "scripts/migrationRunner.mjs",
]);

const CUTOVER_PROPOSAL_SCRIPT_PATHS = Object.freeze([
  "scripts/ai-content-proposal-schema-preflight.mjs",
]);

const CUTOVER_TOOLING_PATHS = Object.freeze([
  "scripts/ai-content-smoke.mjs",
  "scripts/ai-content-subject-smoke.mjs",
  "scripts/assemble-release-manifest.mjs",
  "scripts/convert-legacy-release-manifest.mjs",
  "scripts/release-impact.mjs",
  "scripts/check-local-env.mjs",
  "scripts/three-format-cutover-static-check.mjs",
]);

function classifyAiContentCutoverPath(path, components) {
  if (path.startsWith("docs/") || path === "README.md" || path.endsWith(".md")) {
    return { known: true, documentation: true };
  }
  if (path.startsWith("apps/customer-ui/")) {
    components.customerUi = true;
    return { known: true };
  }
  if (path.startsWith("apps/api/")) {
    components.api = true;
    return { known: true };
  }
  if (path.startsWith("db/migrations/")) {
    components.api = true;
    return { known: true, migration: true };
  }
  if (path.startsWith("deploy/")) return { known: true, deployBundle: true };
  if (path.startsWith("../.github/workflows/") || path.startsWith(".github/workflows/")) {
    return { known: true, deployBundle: true };
  }
  if (path === "package.json" || path === "package-lock.json" || path === ".dockerignore") {
    enableAiContentCutoverServer(components);
    if (path !== ".dockerignore") components.customerUi = true;
    return { known: true };
  }
  if (path.startsWith("packages/brand-pilot-content-contracts/")) {
    enableAiContentCutoverServer(components);
    components.customerUi = true;
    return { known: true };
  }
  if (path.startsWith("workers/brand-pilot-worker-runtime/")) {
    for (const component of AI_CONTENT_CUTOVER_SERVER_COMPONENTS) {
      if (component !== "api") components[component] = true;
    }
    return { known: true };
  }
  const worker = CUTOVER_WORKER_PATHS.find(([prefix]) => path.startsWith(prefix));
  if (worker) {
    components[worker[1]] = true;
    return { known: true };
  }
  if (path.startsWith("workers/brand-pilot-marketing-worker/")) {
    components.reelWorker = true;
    return { known: true, deployBundle: true };
  }
  if (CUTOVER_API_SCRIPT_PATHS.some((value) => path === value || path === `${value.slice(0, -4)}.test.mjs`)) {
    components.api = true;
    return { known: true, migration: path === "scripts/migrate.mjs" || path === "scripts/migrationRunner.mjs" };
  }
  if (CUTOVER_PROPOSAL_SCRIPT_PATHS.some((value) => path === value || path === `${value.slice(0, -4)}.test.mjs`)) {
    components.contentProposalWorker = true;
    return { known: true };
  }
  if (CUTOVER_TOOLING_PATHS.includes(path)
    || path.endsWith(".test.mjs")
    || path.startsWith("scripts/customer-ui-")
    || path.startsWith("scripts/ai-content-07")) {
    return { known: true, deployBundle: !path.endsWith(".test.mjs") };
  }
  return { known: false };
}

function classifyStructuredSocialRenderPath(path, components) {
  if (STRUCTURED_SOCIAL_DOC_PATHS.has(path)) return { known: true, documentation: true };
  if (STRUCTURED_SOCIAL_CONTRACT_PATHS.has(path)) {
    for (const component of ["api", "cardNewsWorker", "imageWorker", "reelWorker"]) {
      components[component] = true;
    }
    return { known: true };
  }
  if (STRUCTURED_SOCIAL_API_PATHS.has(path)) {
    components.api = true;
    return { known: true };
  }
  if (STRUCTURED_SOCIAL_CARD_PATHS.has(path)) {
    components.cardNewsWorker = true;
    return { known: true };
  }
  if (STRUCTURED_SOCIAL_REEL_PATHS.has(path)) {
    components.reelWorker = true;
    return { known: true };
  }
  if (STRUCTURED_SOCIAL_IMAGE_PATHS.has(path)) {
    components.imageWorker = true;
    return { known: true };
  }
  if (STRUCTURED_SOCIAL_TOOLING_PATHS.has(path)) {
    return { known: true, deployBundle: path === "scripts/release-impact.mjs" };
  }
  return { known: false };
}

export function classifyChangedPaths(values, options = {}) {
  const profile = options.profile ?? "default";
  if (!["default", AI_CONTENT_THREE_FORMAT_CUTOVER_PROFILE, STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE].includes(profile)) {
    throw new Error("release_impact_profile_invalid");
  }
  const originalPaths = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (originalPaths.length === 0) throw new Error("changed_paths_required");

  const paths = [...new Set(originalPaths.map(normalizePath).filter(Boolean))];
  if (paths.length === 0) throw new Error("changed_paths_required");

  const components = Object.fromEntries(COMPONENTS.map((component) => [component, false]));
  const unknownPaths = [];
  let buildAllServer = false;
  let migrationChanged = false;
  let deployBundleChanged = false;
  let nonDocumentationChange = false;

  if (profile === AI_CONTENT_THREE_FORMAT_CUTOVER_PROFILE
    || profile === STRUCTURED_SOCIAL_RENDER_SEMANTICS_PROFILE) {
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const originalPath = originalPaths[index] ?? path;
      const result = profile === AI_CONTENT_THREE_FORMAT_CUTOVER_PROFILE
        ? classifyAiContentCutoverPath(path, components)
        : classifyStructuredSocialRenderPath(path, components);
      if (result.documentation) continue;
      nonDocumentationChange = true;
      if (result.migration) migrationChanged = true;
      if (result.deployBundle) deployBundleChanged = true;
      if (!result.known) unknownPaths.push(originalPath);
    }
    return {
      profile,
      paths,
      components,
      buildAllServer: false,
      migrationChanged,
      productionDeployAllowed: !migrationChanged && unknownPaths.length === 0,
      deployBundleChanged,
      docsOnly: !nonDocumentationChange,
      verifiedScope: unknownPaths.length === 0,
      unknownPaths,
    };
  }

  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const originalPath = originalPaths[index] ?? path;

    if (path.startsWith("docs/") || path === "README.md" || path.endsWith(".md")) continue;
    nonDocumentationChange = true;

    if (path.startsWith("apps/customer-ui/")) {
      components.customerUi = true;
      continue;
    }
    if (path.startsWith("apps/api/")) {
      components.api = true;
      continue;
    }
    if (path.startsWith("db/migrations/") || path === "scripts/migrate.mjs" || path === "scripts/migrationRunner.mjs") {
      migrationChanged = true;
      components.api = true;
      continue;
    }
    if (path.startsWith("deploy/")) {
      deployBundleChanged = true;
      continue;
    }
    if (AI_CONTENT_ACCOUNT_POOL_RUNTIME_PATHS.has(path)) {
      enableAiContentCutoverServer(components);
      continue;
    }
    if (AI_CONTENT_CONTROLLED_SEARCH_RUNTIME_PATHS.has(path)) {
      components.contentProposalWorker = true;
      components.blogWorker = true;
      continue;
    }
    if (AI_CONTENT_PLANNER_DRAFT_CONTRACT_PATHS.has(path)) {
      components.api = true;
      components.cardNewsWorker = true;
      components.blogWorker = true;
      components.reelWorker = true;
      continue;
    }
    if (AI_CONTENT_SCOPED_TOOLING_PATHS.has(path)) continue;
    if (path === "package.json" || path === "package-lock.json" || path === ".dockerignore" || path.startsWith("workers/brand-pilot-worker-runtime/")) {
      buildAllServer = true;
      enableAllServer(components);
      if (path === "package.json" || path === "package-lock.json") components.customerUi = true;
      continue;
    }

    const worker = WORKER_PATHS.find(([prefix]) => path.startsWith(prefix));
    if (worker) {
      components[worker[1]] = true;
      continue;
    }

    if (RELEASE_TOOLING_TEST_PATHS.has(path) || (path.startsWith("scripts/") && path.endsWith(".test.mjs"))) continue;
    if (path === "scripts/release-impact.mjs" || path === "scripts/assemble-release-manifest.mjs") {
      deployBundleChanged = true;
      continue;
    }
    if (path.startsWith("../.github/workflows/") || path.startsWith(".github/workflows/")) {
      deployBundleChanged = true;
      continue;
    }

    buildAllServer = true;
    enableAllServer(components);
    unknownPaths.push(originalPath);
  }

  return {
    profile,
    paths,
    components,
    buildAllServer,
    migrationChanged,
    productionDeployAllowed: !migrationChanged,
    deployBundleChanged,
    docsOnly: !nonDocumentationChange,
    verifiedScope: unknownPaths.length === 0,
    unknownPaths,
  };
}

function readGitPaths(base, head) {
  return execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${base}...${head}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).split(/\r?\n/).filter(Boolean);
}

function runCli(argv) {
  const baseIndex = argv.indexOf("--base");
  const headIndex = argv.indexOf("--head");
  const profileIndex = argv.indexOf("--profile");
  if (baseIndex < 0 || headIndex < 0 || !argv[baseIndex + 1] || !argv[headIndex + 1]) {
    throw new Error("usage_release_impact_base_head");
  }
  const profile = profileIndex < 0 ? "default" : argv[profileIndex + 1];
  if (!profile) throw new Error("release_impact_profile_invalid");
  process.stdout.write(`${JSON.stringify(classifyChangedPaths(
    readGitPaths(argv[baseIndex + 1], argv[headIndex + 1]),
    { profile },
  ))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "release_impact_failed");
    process.exitCode = 1;
  }
}
