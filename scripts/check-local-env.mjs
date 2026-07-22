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

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
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
const processName = args.get("process") ?? "all";
const supportedProcesses = new Set(["all", "api", "ui", "image-worker", "dm-worker", "card-news-worker", "blog-worker", "marketing-worker", "subject-analysis-worker", "brand-intelligence-worker"]);
if (!supportedProcesses.has(processName)) {
  console.error(`Unknown process: ${processName}`);
  process.exit(1);
}

const files = {
  api: path.join(envRoot, "apps", "api", ".env"),
  ui: path.join(envRoot, "apps", "customer-ui", ".env.local"),
  imageWorker: path.join(envRoot, "workers", "brand-pilot-image-worker", ".env"),
  dmWorker: path.join(envRoot, "workers", "brand-pilot-dm-worker", ".env"),
  cardNewsWorker: path.join(envRoot, "workers", "brand-pilot-card-news-worker", ".env"),
  blogWorker: path.join(envRoot, "workers", "brand-pilot-blog-worker", ".env"),
  marketingWorker: path.join(envRoot, "workers", "brand-pilot-marketing-worker", ".env"),
  subjectAnalysisWorker: path.join(envRoot, "workers", "brand-pilot-subject-analysis-worker", ".env"),
  brandIntelligenceWorker: path.join(envRoot, "workers", "brand-pilot-brand-intelligence-worker", ".env")
};

const envs = Object.fromEntries(
  Object.entries(files).map(([name, filePath]) => [name, { filePath, ...parseEnvFile(filePath) }])
);

const results = [];

const processEnvNames = {
  api: ["api"],
  ui: ["ui"],
  "image-worker": ["imageWorker"],
  "dm-worker": ["dmWorker"],
  "card-news-worker": ["cardNewsWorker"],
  "blog-worker": ["blogWorker"],
  "marketing-worker": ["marketingWorker"],
  "subject-analysis-worker": ["subjectAnalysisWorker"],
  "brand-intelligence-worker": ["brandIntelligenceWorker"],
  all: Object.keys(envs)
};
const checkedEnvNames = new Set(processEnvNames[processName]);

for (const [name, env] of Object.entries(envs)) {
  if (!checkedEnvNames.has(name)) continue;
  addResult(results, env.exists, `${name} env file`, env.exists ? path.relative(envRoot, env.filePath) : `missing: ${env.filePath}`);
}

function requireKeys(envName, keys) {
  for (const key of keys) {
    const value = get(envs[envName], key);
    addResult(results, isSet(value), `${envName} ${key}`, isSet(value) ? "set" : `missing: ${envName} ${key}`);
  }
}

function requireUrl(envName, key) {
  const value = get(envs[envName], key);
  const valid = Boolean(safeUrlOrigin(value));
  addResult(results, valid, `${envName} ${key}`, valid ? "valid URL" : `missing or invalid: ${envName} ${key}`);
}

if (processName === "ui") {
  requireUrl("ui", "VITE_API_BASE_URL");
}

if (processName === "image-worker") {
  requireUrl("imageWorker", "BRAND_PILOT_API_URL");
  requireKeys("imageWorker", ["WORKER_API_TOKEN", "BLOB_READ_WRITE_TOKEN", "IMAGE_RENDER_COMMAND"]);
}

if (processName === "dm-worker") {
  requireUrl("dmWorker", "BRAND_PILOT_API_URL");
  requireKeys("dmWorker", ["WORKER_API_TOKEN", "DM_WORKER_DATABASE_URL"]);
}

const dedicatedWorkers = {
  "card-news-worker": ["cardNewsWorker", "CARD_NEWS_CODEX_COMMAND"],
  "blog-worker": ["blogWorker", "BLOG_CODEX_COMMAND"],
  "marketing-worker": ["marketingWorker", "MARKETING_CODEX_COMMAND"],
  "subject-analysis-worker": ["subjectAnalysisWorker", "SUBJECT_ANALYSIS_CODEX_COMMAND", ["WORKER_API_TOKEN", "SUBJECT_ANALYSIS_CODEX_COMMAND"]],
  "brand-intelligence-worker": ["brandIntelligenceWorker", "BRAND_INTELLIGENCE_CODEX_COMMAND", ["WORKER_API_TOKEN", "BRAND_INTELLIGENCE_CODEX_COMMAND"]]
};
if (dedicatedWorkers[processName]) {
  const [envName, commandKey, requiredKeys = ["WORKER_API_TOKEN", "BLOB_READ_WRITE_TOKEN", commandKey]] = dedicatedWorkers[processName];
  requireUrl(envName, "BRAND_PILOT_API_URL");
  requireKeys(envName, [...new Set(requiredKeys)]);
}

if (processName !== "all") {
  if (processName === "api") {
    const databaseUrl = get(envs.api, "SUPABASE_DATABASE_URL") || get(envs.api, "DATABASE_URL");
    addResult(results, isSet(databaseUrl), "api database URL", isSet(databaseUrl) ? "set" : "missing: SUPABASE_DATABASE_URL or DATABASE_URL");
    requireKeys("api", ["WORKER_API_TOKEN", "BLOB_READ_WRITE_TOKEN", "KAKAO_REST_API_KEY", "META_APP_ID", "META_APP_SECRET"]);
  }
  console.log(`Local env root: ${envRoot}`);
  console.log(`Process: ${processName}`);
  for (const result of results) console.log(`${result.ok ? "OK " : "ERR"} ${result.label} - ${result.detail}`);
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`\nLocal env check failed: ${failed.length} issue(s). Values are intentionally hidden.`);
    process.exit(1);
  }
  console.log("\nLocal env check passed. Values are intentionally hidden.");
  process.exit(0);
}

const apiBaseCandidates = [
  get(envs.ui, "VITE_API_BASE_URL"),
  get(envs.imageWorker, "BRAND_PILOT_API_URL"),
  get(envs.dmWorker, "BRAND_PILOT_API_URL"),
  get(envs.cardNewsWorker, "BRAND_PILOT_API_URL"),
  get(envs.blogWorker, "BRAND_PILOT_API_URL"),
  get(envs.marketingWorker, "BRAND_PILOT_API_URL"),
  get(envs.subjectAnalysisWorker, "BRAND_PILOT_API_URL"),
  get(envs.brandIntelligenceWorker, "BRAND_PILOT_API_URL")
].filter(Boolean);
const expectedApiBase = apiBaseCandidates[0] ?? "http://localhost:4000";

compareExact(results, "local API base URL", [
  { name: "customer-ui VITE_API_BASE_URL", value: get(envs.ui, "VITE_API_BASE_URL") },
  { name: "image-worker BRAND_PILOT_API_URL", value: get(envs.imageWorker, "BRAND_PILOT_API_URL") },
  { name: "dm-worker BRAND_PILOT_API_URL", value: get(envs.dmWorker, "BRAND_PILOT_API_URL") },
  { name: "card-news-worker BRAND_PILOT_API_URL", value: get(envs.cardNewsWorker, "BRAND_PILOT_API_URL") },
  { name: "blog-worker BRAND_PILOT_API_URL", value: get(envs.blogWorker, "BRAND_PILOT_API_URL") },
  { name: "marketing-worker BRAND_PILOT_API_URL", value: get(envs.marketingWorker, "BRAND_PILOT_API_URL") },
  { name: "subject-analysis-worker BRAND_PILOT_API_URL", value: get(envs.subjectAnalysisWorker, "BRAND_PILOT_API_URL") },
  { name: "brand-intelligence-worker BRAND_PILOT_API_URL", value: get(envs.brandIntelligenceWorker, "BRAND_PILOT_API_URL") }
]);

compareExact(results, "WORKER_API_TOKEN", [
  { name: "api WORKER_API_TOKEN", value: get(envs.api, "WORKER_API_TOKEN") },
  { name: "image-worker WORKER_API_TOKEN", value: get(envs.imageWorker, "WORKER_API_TOKEN") },
  { name: "dm-worker WORKER_API_TOKEN", value: get(envs.dmWorker, "WORKER_API_TOKEN") },
  { name: "card-news-worker WORKER_API_TOKEN", value: get(envs.cardNewsWorker, "WORKER_API_TOKEN") },
  { name: "blog-worker WORKER_API_TOKEN", value: get(envs.blogWorker, "WORKER_API_TOKEN") },
  { name: "marketing-worker WORKER_API_TOKEN", value: get(envs.marketingWorker, "WORKER_API_TOKEN") },
  { name: "subject-analysis-worker WORKER_API_TOKEN", value: get(envs.subjectAnalysisWorker, "WORKER_API_TOKEN") },
  { name: "brand-intelligence-worker WORKER_API_TOKEN", value: get(envs.brandIntelligenceWorker, "WORKER_API_TOKEN") }
]);

const apiDatabaseUrl = get(envs.api, "SUPABASE_DATABASE_URL") || get(envs.api, "DATABASE_URL");
compareExact(results, "DM worker database URL", [
  { name: "api SUPABASE_DATABASE_URL/DATABASE_URL", value: apiDatabaseUrl },
  { name: "dm-worker DM_WORKER_DATABASE_URL", value: get(envs.dmWorker, "DM_WORKER_DATABASE_URL") }
]);

for (const key of ["META_APP_ID", "META_APP_SECRET"]) {
  addResult(
    results,
    isSet(get(envs.api, key)),
    `api ${key}`,
    isSet(get(envs.api, key)) ? "set" : `missing: api ${key}`
  );
}

for (const [key, label] of [
  ["KAKAO_REDIRECT_URI", "Kakao redirect URI"],
  ["META_OAUTH_REDIRECT_URI", "Meta redirect URI"],
  ["META_TRENDS_OAUTH_REDIRECT_URI", "Meta trends redirect URI"]
]) {
  const redirectUri = get(envs.api, key);
  const redirectOrigin = safeUrlOrigin(redirectUri);
  const allowsPublicCallback = key === "META_TRENDS_OAUTH_REDIRECT_URI" && isHttpsUrl(redirectUri);
  const validOrigin = redirectOrigin === expectedApiBase || allowsPublicCallback;
  addResult(
    results,
    isSet(redirectUri) && validOrigin,
    label,
    isSet(redirectUri)
      ? validOrigin
        ? allowsPublicCallback
          ? `public HTTPS callback configured: ${key}`
          : `origin matches ${key}`
        : `origin mismatch: ${key} must use the same API base as the frontend/workers or an allowed public HTTPS callback`
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
