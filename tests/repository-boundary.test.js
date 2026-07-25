const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const read = (path) => readFileSync(path, "utf8");

test("root tooling excludes the imported Brand Pilot repository", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"));
  const eslintConfig = read("eslint.config.mjs");
  const nextConfig = read("next.config.ts");
  const rootPackage = JSON.parse(read("package.json"));

  assert.ok(tsconfig.exclude.includes("brand_poilot"));
  assert.match(eslintConfig, /["']brand_poilot\/\*\*["']/);
  assert.match(nextConfig, /outputFileTracingExcludes/);
  assert.match(nextConfig, /["']\.\/brand_poilot\/\*\*\/\*["']/);
  assert.equal(Object.hasOwn(rootPackage, "workspaces"), false);
});
