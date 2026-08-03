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
  "marketingWorker",
]);

const COMPONENTS = Object.freeze(["customerUi", ...SERVER_COMPONENTS]);

const WORKER_PATHS = Object.freeze([
  ["workers/brand-pilot-dm-worker/", "dmWikiWorker"],
  ["workers/brand-pilot-content-proposal-worker/", "contentProposalWorker"],
  ["workers/brand-pilot-brand-intelligence-worker/", "brandIntelligenceWorker"],
  ["workers/brand-pilot-subject-analysis-worker/", "subjectAnalysisWorker"],
  ["workers/brand-pilot-image-worker/", "imageWorker"],
  ["workers/brand-pilot-card-news-worker/", "cardNewsWorker"],
  ["workers/brand-pilot-blog-worker/", "blogWorker"],
  ["workers/brand-pilot-marketing-worker/", "marketingWorker"],
]);

const normalizePath = (value) => {
  const path = String(value ?? "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  return path.startsWith("brand_poilot/") ? path.slice("brand_poilot/".length) : path;
};

const enableAllServer = (components) => {
  for (const component of SERVER_COMPONENTS) components[component] = true;
};

export function classifyChangedPaths(values) {
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

    if (path === "scripts/deployment-contract.test.mjs" || path.endsWith("release-impact.test.mjs")) continue;
    if (path === "scripts/release-impact.mjs" || path === "scripts/assemble-release-manifest.mjs" || path.startsWith("../.github/workflows/") || path.startsWith(".github/workflows/")) {
      buildAllServer = true;
      enableAllServer(components);
      continue;
    }

    buildAllServer = true;
    enableAllServer(components);
    unknownPaths.push(originalPath);
  }

  return {
    paths,
    components,
    buildAllServer,
    migrationChanged,
    productionDeployAllowed: !migrationChanged,
    deployBundleChanged,
    docsOnly: !nonDocumentationChange,
    unknownPaths,
  };
}

function readGitPaths(base, head) {
  return execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}...${head}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).split(/\r?\n/).filter(Boolean);
}

function runCli(argv) {
  const baseIndex = argv.indexOf("--base");
  const headIndex = argv.indexOf("--head");
  if (baseIndex < 0 || headIndex < 0 || !argv[baseIndex + 1] || !argv[headIndex + 1]) {
    throw new Error("usage_release_impact_base_head");
  }
  process.stdout.write(`${JSON.stringify(classifyChangedPaths(readGitPaths(argv[baseIndex + 1], argv[headIndex + 1])))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "release_impact_failed");
    process.exitCode = 1;
  }
}
