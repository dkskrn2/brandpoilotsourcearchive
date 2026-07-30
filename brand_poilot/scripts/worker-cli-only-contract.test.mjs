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
      if (packageJson.scripts?.[script] && packageJson.scripts?.[lifecycle] !== runtimeBuild) {
        violations.push(`${packageJson.name}:${lifecycle}`);
      }
    }
  }

  const apiPackage = JSON.parse(await readFile("apps/api/package.json", "utf8"));
  if (apiPackage.scripts?.pretest !== runtimeBuild) {
    violations.push(`${apiPackage.name}:pretest`);
  }

  assert.deepEqual(
    violations,
    [],
    `clean-checkout runtime build hooks missing:\n${violations.map((value) => `- ${value}`).join("\n")}`,
  );
});

test("Codex worker images install bubblewrap for the pinned Linux sandbox", async () => {
  const dockerfiles = [
    "brand-pilot-brand-intelligence-worker",
    "brand-pilot-subject-analysis-worker",
    "brand-pilot-content-proposal-worker",
    "brand-pilot-dm-worker",
  ].map((directory) => join(workerRoot, directory, "Dockerfile"));
  const violations = [];

  for (const path of dockerfiles) {
    const source = await readFile(path, "utf8");
    if (!/\bapt-get install\b[^\n]*\bbubblewrap\b/.test(source)) {
      violations.push(path);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Codex worker image is missing bubblewrap:\n${violations.map((path) => `- ${path}`).join("\n")}`,
  );
});
