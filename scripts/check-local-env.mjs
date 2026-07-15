import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function readArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    args.set(key, rest.join("=") || "true");
  }
  return args;
}

function parseEnvFile(filePath) {
  const values = new Map();
  if (!existsSync(filePath)) return { exists: false, values };

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return { exists: true, values };
}

function get(env, key) {
  return env.values.get(key)?.trim() ?? "";
}

function isSet(value) {
  return value.length > 0;
}

function safeUrlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function addResult(results, ok, label, detail) {
  results.push({ ok, label, detail });
}

function compareExact(results, label, entries) {
  const present = entries.filter((entry) => isSet(entry.value));
  if (present.length < entries.length) {
    addResult(
      results,
      false,
      label,
      `missing: ${entries.filter((entry) => !isSet(entry.value)).map((entry) => entry.name).join(", ")}`
    );
    return;
  }

  const first = present[0].value;
  const mismatched = present.filter((entry) => entry.value !== first);
  addResult(
    results,
    mismatched.length === 0,
    label,
    mismatched.length === 0
      ? `matched: ${entries.map((entry) => entry.name).join(", ")}`
      : `mismatch: ${entries.map((entry) => entry.name).join(", ")}`
  );
}

const args = readArgs(process.argv.slice(2));
const envRoot = path.resolve(args.get("env-root") ?? process.cwd());

const files = {
  api: path.join(envRoot, "apps", "api", ".env"),
  ui: path.join(envRoot, "apps", "customer-ui", ".env.local"),
  imageWorker: path.join(envRoot, "workers", "brand-pilot-image-worker", ".env"),
  dmWorker: path.join(envRoot, "workers", "brand-pilot-dm-worker", ".env")
};

const envs = Object.fromEntries(
  Object.entries(files).map(([name, filePath]) => [name, { filePath, ...parseEnvFile(filePath) }])
);

const results = [];

for (const [name, env] of Object.entries(envs)) {
  addResult(results, env.exists, `${name} env file`, env.exists ? path.relative(envRoot, env.filePath) : `missing: ${env.filePath}`);
}

const apiBaseCandidates = [
  get(envs.ui, "VITE_API_BASE_URL"),
  get(envs.imageWorker, "BRAND_PILOT_API_URL"),
  get(envs.dmWorker, "BRAND_PILOT_API_URL")
].filter(Boolean);
const expectedApiBase = apiBaseCandidates[0] ?? "http://localhost:4000";

compareExact(results, "local API base URL", [
  { name: "customer-ui VITE_API_BASE_URL", value: get(envs.ui, "VITE_API_BASE_URL") },
  { name: "image-worker BRAND_PILOT_API_URL", value: get(envs.imageWorker, "BRAND_PILOT_API_URL") },
  { name: "dm-worker BRAND_PILOT_API_URL", value: get(envs.dmWorker, "BRAND_PILOT_API_URL") }
]);

compareExact(results, "WORKER_API_TOKEN", [
  { name: "api WORKER_API_TOKEN", value: get(envs.api, "WORKER_API_TOKEN") },
  { name: "image-worker WORKER_API_TOKEN", value: get(envs.imageWorker, "WORKER_API_TOKEN") },
  { name: "dm-worker WORKER_API_TOKEN", value: get(envs.dmWorker, "WORKER_API_TOKEN") }
]);

const apiDatabaseUrl = get(envs.api, "SUPABASE_DATABASE_URL") || get(envs.api, "DATABASE_URL");
compareExact(results, "DM worker database URL", [
  { name: "api SUPABASE_DATABASE_URL/DATABASE_URL", value: apiDatabaseUrl },
  { name: "dm-worker DM_WORKER_DATABASE_URL", value: get(envs.dmWorker, "DM_WORKER_DATABASE_URL") }
]);

for (const [key, label] of [
  ["KAKAO_REDIRECT_URI", "Kakao redirect URI"],
  ["META_OAUTH_REDIRECT_URI", "Meta redirect URI"]
]) {
  const redirectUri = get(envs.api, key);
  const redirectOrigin = safeUrlOrigin(redirectUri);
  addResult(
    results,
    isSet(redirectUri) && redirectOrigin === expectedApiBase,
    label,
    isSet(redirectUri)
      ? redirectOrigin === expectedApiBase
        ? `origin matches ${key}`
        : `origin mismatch: ${key} must use the same API base as the frontend/workers`
      : `missing: api ${key}`
  );
}

const frontendUrl = get(envs.api, "AUTH_FRONTEND_URL");
addResult(
  results,
  isSet(frontendUrl),
  "auth frontend URL",
  isSet(frontendUrl) ? "set: api AUTH_FRONTEND_URL" : "missing: api AUTH_FRONTEND_URL"
);

console.log(`Local env root: ${envRoot}`);
for (const result of results) {
  console.log(`${result.ok ? "OK " : "ERR"} ${result.label} - ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\nLocal env check failed: ${failed.length} issue(s). Values are intentionally hidden.`);
  process.exit(1);
}

console.log("\nLocal env check passed. Values are intentionally hidden.");
