import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_PATTERN = /^[a-zA-Z0-9._-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._-]+)+@sha256:[0-9a-f]{64}$/;

const LEGACY_IMAGE_KEYS = Object.freeze([
  "API_IMAGE",
  "DM_WORKER_IMAGE",
  "WIKI_WORKER_IMAGE",
  "CONTENT_PROPOSAL_WORKER_IMAGE",
  "BRAND_INTELLIGENCE_WORKER_IMAGE",
  "SUBJECT_ANALYSIS_WORKER_IMAGE",
  "IMAGE_WORKER_IMAGE",
  "CARD_NEWS_WORKER_IMAGE",
  "BLOG_WORKER_IMAGE",
  "MARKETING_WORKER_IMAGE",
]);

const PRESERVED_IMAGE_KEYS = Object.freeze([
  "DM_WORKER_IMAGE",
  "WIKI_WORKER_IMAGE",
  "BRAND_INTELLIGENCE_WORKER_IMAGE",
  "SUBJECT_ANALYSIS_WORKER_IMAGE",
]);

const STATIC_KEYS = Object.freeze([
  "CADDY_IMAGE",
  "CANARY_HOST",
  "PRIMARY_HOST",
  "ACME_EMAIL",
  "API_ENV_FILE",
]);

const allowedKeys = new Set([
  "RELEASE_SCHEMA",
  "RELEASE_SHA",
  ...LEGACY_IMAGE_KEYS,
  ...LEGACY_IMAGE_KEYS.flatMap((key) => {
    const prefix = key.slice(0, -"_IMAGE".length);
    return [`${prefix}_SOURCE_SHA`, `${prefix}_CHANGED`];
  }),
  ...STATIC_KEYS,
]);

const candidateField = /^(?:REEL_WORKER_|CUSTOMER_UI_|CONTENT_CATALOG_|CONTENT_PROPOSAL_MODEL_|PREFLIGHT_|PROPOSAL_V2_|REQUIRED_MIGRATION_|MIGRATION_|CANDIDATE_)/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseLegacyManifest(text) {
  const source = String(text ?? "");
  const manifest = {};
  for (const line of source.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !match[2]) throw new Error("legacy_manifest_line_invalid");
    const [, key, value] = match;
    if (candidateField.test(key)) throw new Error("legacy_manifest_candidate_field_forbidden");
    if (!allowedKeys.has(key)) throw new Error("legacy_manifest_key_unknown");
    if (Object.hasOwn(manifest, key)) throw new Error("legacy_manifest_key_duplicate");
    manifest[key] = value;
  }

  if (!new Set(["1", "2"]).has(manifest.RELEASE_SCHEMA)) throw new Error("legacy_release_schema_required");
  if (!SHA_PATTERN.test(manifest.RELEASE_SHA ?? "")) throw new Error("legacy_release_sha_invalid");
  for (const key of [...STATIC_KEYS, "MARKETING_WORKER_IMAGE"]) {
    if (!manifest[key]) throw new Error(`legacy_manifest_required_key_missing:${key}`);
  }
  for (const key of [...LEGACY_IMAGE_KEYS.filter((key) => manifest[key]), "CADDY_IMAGE"]) {
    if (!IMAGE_PATTERN.test(manifest[key])) throw new Error("legacy_manifest_image_invalid");
  }

  for (const key of LEGACY_IMAGE_KEYS) {
    const prefix = key.slice(0, -"_IMAGE".length);
    const sourceKey = `${prefix}_SOURCE_SHA`;
    const changedKey = `${prefix}_CHANGED`;
    if (manifest.RELEASE_SCHEMA === "1") {
      if (manifest[sourceKey] || manifest[changedKey]) throw new Error("legacy_schema1_provenance_forbidden");
      continue;
    }
    if (manifest[key]) {
      if (!SHA_PATTERN.test(manifest[sourceKey] ?? "")) throw new Error("legacy_component_source_sha_invalid");
      if (!new Set(["true", "false"]).has(manifest[changedKey])) throw new Error("legacy_component_changed_invalid");
      if (manifest[changedKey] === "true" && manifest[sourceKey] !== manifest.RELEASE_SHA) {
        throw new Error("legacy_component_source_sha_mismatch");
      }
    } else if (manifest[sourceKey] || manifest[changedKey]) {
      throw new Error("legacy_component_provenance_orphaned");
    }
  }
  return manifest;
}

export function convertLegacyReleaseManifest(text) {
  const source = String(text ?? "");
  const manifest = parseLegacyManifest(source);
  const baseline = { RELEASE_SCHEMA: "3" };
  for (const key of PRESERVED_IMAGE_KEYS) {
    if (!manifest[key]) continue;
    const prefix = key.slice(0, -"_IMAGE".length);
    baseline[key] = manifest[key];
    baseline[`${prefix}_SOURCE_SHA`] = manifest.RELEASE_SCHEMA === "2"
      ? manifest[`${prefix}_SOURCE_SHA`]
      : manifest.RELEASE_SHA;
    baseline[`${prefix}_CHANGED`] = "false";
  }
  for (const key of STATIC_KEYS) baseline[key] = manifest[key];

  const baselineManifest = `${Object.entries(baseline).map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
  const marketingPrefix = "MARKETING_WORKER";
  const retirementRecord = {
    contractVersion: "marketing-worker-retirement.v1",
    action: "stop_remove",
    service: "marketing-worker-1",
    restartAllowed: false,
    sourceReleaseSchema: manifest.RELEASE_SCHEMA,
    sourceReleaseSha: manifest.RELEASE_SHA,
    sourceManifestSha256: sha256(source),
    legacyImage: manifest.MARKETING_WORKER_IMAGE,
    legacySourceSha: manifest.RELEASE_SCHEMA === "2"
      ? manifest[`${marketingPrefix}_SOURCE_SHA`]
      : manifest.RELEASE_SHA,
  };
  return { baselineManifest, retirementRecord };
}

function parseArguments(argv) {
  const allowed = new Set(["--input", "--baseline-output", "--retirement-output"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || values.has(key)) throw new Error("legacy_converter_usage_invalid");
    values.set(key, resolve(value));
  }
  if (argv.length !== 6 || values.size !== 3) throw new Error("legacy_converter_usage_invalid");
  const paths = [...values.values()];
  if (new Set(paths).size !== paths.length) throw new Error("legacy_converter_path_collision");
  return values;
}

async function writeExclusive(path, contents, mode) {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main(argv) {
  const args = parseArguments(argv);
  const input = await open(args.get("--input"), "r");
  let source;
  try {
    source = await input.readFile("utf8");
  } finally {
    await input.close();
  }
  const converted = convertLegacyReleaseManifest(source);
  const baselinePath = args.get("--baseline-output");
  const retirementPath = args.get("--retirement-output");
  let baselineCreated = false;
  try {
    await writeExclusive(baselinePath, converted.baselineManifest, 0o600);
    baselineCreated = true;
    await writeExclusive(retirementPath, `${JSON.stringify(converted.retirementRecord)}\n`, 0o400);
  } catch (error) {
    if (baselineCreated) await unlink(baselinePath).catch(() => {});
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    baselineSha256: sha256(converted.baselineManifest),
    retirementSha256: sha256(`${JSON.stringify(converted.retirementRecord)}\n`),
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "legacy_converter_failed"}\n`);
    process.exitCode = 1;
  });
}
