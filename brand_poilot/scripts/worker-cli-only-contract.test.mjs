import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { test } from "node:test";

const workerRoot = "workers";
const productionExtensions = new Set([".js", ".mjs", ".ts"]);

async function productionWorkerFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "node_modules", "coverage"].includes(entry.name)) return [];
      return productionWorkerFiles(path);
    }
    if (
      entry.name === "Dockerfile"
      || entry.name === ".env.example"
      || (
        productionExtensions.has(extname(entry.name))
        && !/\.(?:test|spec)\.[cm]?[jt]s$/i.test(entry.name)
      )
    ) {
      return [path];
    }
    return [];
  }));
  return nested.flat();
}

test("production workers never call OpenAI HTTP APIs or inherit API-key/proxy routing", async () => {
  const files = await productionWorkerFiles(workerRoot);
  const violations = [];
  for (const path of files) {
    const source = await readFile(path, "utf8");
    if (
      /api\.openai\.com|OPENAI_API_KEY|OPENAI_BASE_URL/i.test(source)
      || /\b(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\b/i.test(source)
    ) {
      violations.push(path);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `CLI-only worker boundary violated:\n${violations.map((path) => `- ${path}`).join("\n")}`,
  );
});

test("runtime consumers build the emitted package before developer entrypoints", async () => {
  const runtimeBuild = "npm run build --workspace @brand-pilot/worker-runtime";
  const entries = await readdir(workerRoot, { withFileTypes: true });
  const violations = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packagePath = join(workerRoot, entry.name, "package.json");
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!packageJson.dependencies?.["@brand-pilot/worker-runtime"]) continue;

    for (const [script, lifecycle] of [
      ["dev", "predev"],
      ["run-once", "prerun-once"],
    ]) {
      const lifecycleCommands = packageJson.scripts?.[lifecycle]?.split("&&").map((value) => value.trim()) ?? [];
      if (packageJson.scripts?.[script] && !lifecycleCommands.includes(runtimeBuild)) {
        violations.push(`${packageJson.name}:${lifecycle}`);
      }
    }
  }

  const apiPackage = JSON.parse(await readFile("apps/api/package.json", "utf8"));
  const apiPretestCommands = apiPackage.scripts?.pretest?.split("&&").map((value) => value.trim()) ?? [];
  if (!apiPretestCommands.includes(runtimeBuild)) {
    violations.push(`${apiPackage.name}:pretest`);
  }

  assert.deepEqual(
    violations,
    [],
    `clean-checkout runtime build hooks missing:\n${violations.map((value) => `- ${value}`).join("\n")}`,
  );
});

test("published server images invoke valid clean-checkout build targets in dependency order", async () => {
  const runtimeBuild = "npm run build --workspace @brand-pilot/worker-runtime";
  const publishedImages = [
    {
      name: "api",
      dockerfile: "apps/api/Dockerfile",
      packagePath: "apps/api/package.json",
      compile: "npm run build --workspace @brand-pilot/api",
      requiresRuntime: true,
    },
    {
      name: "dm",
      dockerfile: "workers/brand-pilot-dm-worker/Dockerfile",
      packagePath: "workers/brand-pilot-dm-worker/package.json",
      compile: "./node_modules/.bin/tsc -p workers/brand-pilot-dm-worker/tsconfig.json --noEmit false",
      requiresRuntime: true,
    },
    {
      name: "wiki",
      dockerfile: "workers/brand-pilot-dm-worker/Dockerfile",
      packagePath: "workers/brand-pilot-dm-worker/package.json",
      compile: "./node_modules/.bin/tsc -p workers/brand-pilot-dm-worker/tsconfig.json --noEmit false",
      requiresRuntime: true,
    },
    {
      name: "content-proposal",
      dockerfile: "workers/brand-pilot-content-proposal-worker/Dockerfile",
      packagePath: "workers/brand-pilot-content-proposal-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/content-proposal-worker",
      requiresRuntime: true,
    },
    {
      name: "brand-intelligence",
      dockerfile: "workers/brand-pilot-brand-intelligence-worker/Dockerfile",
      packagePath: "workers/brand-pilot-brand-intelligence-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/brand-intelligence-worker",
      requiresRuntime: true,
    },
    {
      name: "subject-analysis",
      dockerfile: "workers/brand-pilot-subject-analysis-worker/Dockerfile",
      packagePath: "workers/brand-pilot-subject-analysis-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/subject-analysis-worker",
      requiresRuntime: true,
    },
    {
      name: "image",
      dockerfile: "workers/brand-pilot-image-worker/Dockerfile",
      packagePath: "workers/brand-pilot-image-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/image-worker",
      requiresRuntime: false,
    },
    {
      name: "card-news",
      dockerfile: "workers/brand-pilot-card-news-worker/Dockerfile",
      packagePath: "workers/brand-pilot-card-news-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/card-news-worker",
      requiresRuntime: true,
    },
    {
      name: "blog",
      dockerfile: "workers/brand-pilot-blog-worker/Dockerfile",
      packagePath: "workers/brand-pilot-blog-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/blog-worker",
      requiresRuntime: true,
    },
    {
      name: "reel",
      dockerfile: "workers/brand-pilot-reel-worker/Dockerfile",
      packagePath: "workers/brand-pilot-reel-worker/package.json",
      compile: "npm run build --workspace @brand-pilot/reel-worker",
      requiresRuntime: true,
    },
  ];
  const violations = [];

  for (const image of publishedImages) {
    const [dockerfile, packageJson] = await Promise.all([
      readFile(image.dockerfile, "utf8"),
      readFile(image.packagePath, "utf8").then(JSON.parse),
    ]);
    const compileIndex = dockerfile.indexOf(image.compile);
    if (compileIndex < 0) {
      violations.push(`${image.name}:missing ${image.compile}`);
      continue;
    }
    if (!image.requiresRuntime) continue;

    const directRuntimeIndex = dockerfile.indexOf(runtimeBuild);
    const buildsRuntimeDirectly = directRuntimeIndex >= 0 && directRuntimeIndex < compileIndex;
    const packageBuildCommands = packageJson.scripts?.build?.split("&&").map((value) => value.trim()) ?? [];
    const runtimeBuildIndex = packageBuildCommands.indexOf(runtimeBuild);
    const compileStepIndex = packageBuildCommands.findIndex((command) => /^(?:tsc|\.\/node_modules\/\.bin\/tsc)\b/.test(command));
    const delegatesToOrderedPackageBuild = image.compile.includes(packageJson.name)
      && runtimeBuildIndex >= 0
      && compileStepIndex > runtimeBuildIndex;
    if (!buildsRuntimeDirectly && !delegatesToOrderedPackageBuild) {
      violations.push(`${image.name}:worker-runtime must build before ${image.compile}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `published image clean-build order is invalid:\n${violations.map((value) => `- ${value}`).join("\n")}`,
  );
});

test("Codex worker images install bubblewrap for the pinned Linux sandbox", async () => {
  const dockerfiles = [
    "brand-pilot-brand-intelligence-worker",
    "brand-pilot-subject-analysis-worker",
    "brand-pilot-content-proposal-worker",
    "brand-pilot-dm-worker",
    "brand-pilot-image-worker",
    "brand-pilot-card-news-worker",
    "brand-pilot-blog-worker",
    "brand-pilot-reel-worker",
  ].map((directory) => join(workerRoot, directory, "Dockerfile"));
  const violations = [];

  for (const path of dockerfiles) {
    const source = await readFile(path, "utf8");
    if (!/\bapt-get install\b[^\n]*\bbubblewrap\b/.test(source)) {
      violations.push(`${path}: system bubblewrap package missing`);
    }
    if (!/codex-resources\/bwrap \/usr\/local\/bin\/bwrap/.test(source)) {
      violations.push(`${path}: pinned Codex bubblewrap override missing`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Codex worker image is missing bubblewrap:\n${violations.map((path) => `- ${path}`).join("\n")}`,
  );
});
