import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const IMAGE_KEYS = Object.freeze([
  "API_IMAGE",
  "PUBLISH_SCHEDULER_IMAGE",
  "DM_WORKER_IMAGE",
  "WIKI_WORKER_IMAGE",
  "CONTENT_PROPOSAL_WORKER_IMAGE",
  "BRAND_INTELLIGENCE_WORKER_IMAGE",
  "SUBJECT_ANALYSIS_WORKER_IMAGE",
  "IMAGE_WORKER_IMAGE",
  "CARD_NEWS_WORKER_IMAGE",
  "BLOG_WORKER_IMAGE",
  "REEL_WORKER_IMAGE",
]);

const STATIC_KEYS = Object.freeze([
  "CADDY_IMAGE",
  "CANARY_HOST",
  "PRIMARY_HOST",
  "ACME_EMAIL",
  "API_ENV_FILE",
]);

const CUTOVER_IMAGE_KEYS = Object.freeze([
  "API_IMAGE",
  "PUBLISH_SCHEDULER_IMAGE",
  "CONTENT_PROPOSAL_WORKER_IMAGE",
  "IMAGE_WORKER_IMAGE",
  "CARD_NEWS_WORKER_IMAGE",
  "BLOG_WORKER_IMAGE",
  "REEL_WORKER_IMAGE",
]);

const PRESERVED_IMAGE_KEYS = Object.freeze([
  "DM_WORKER_IMAGE",
  "WIKI_WORKER_IMAGE",
  "BRAND_INTELLIGENCE_WORKER_IMAGE",
  "SUBJECT_ANALYSIS_WORKER_IMAGE",
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const IMAGE_PATTERN = /^[a-zA-Z0-9._-]+(?::[0-9]+)?(?:\/[a-zA-Z0-9._-]+)+@sha256:[0-9a-f]{64}$/;

const prefixFor = (imageKey) => imageKey.slice(0, -"_IMAGE".length);

const requireSha = (value, code) => {
  if (!SHA_PATTERN.test(String(value ?? ""))) throw new Error(code);
  return value;
};

const requireImage = (value, code) => {
  if (!IMAGE_PATTERN.test(String(value ?? ""))) throw new Error(code);
  return value;
};

export function parseReleaseManifest(text) {
  const manifest = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || !match[2]) throw new Error("manifest_line_invalid");
    if (Object.hasOwn(manifest, match[1])) throw new Error("manifest_key_duplicate");
    manifest[match[1]] = match[2];
  }
  return manifest;
}

const normalizeCurrent = (currentManifest) => {
  if (currentManifest == null) return null;
  return typeof currentManifest === "string" ? parseReleaseManifest(currentManifest) : { ...currentManifest };
};

const validateRetirementRecord = (record) => {
  const expectedKeys = [
    "contractVersion",
    "action",
    "service",
    "restartAllowed",
    "sourceReleaseSchema",
    "sourceReleaseSha",
    "sourceManifestSha256",
    "baselineManifestSha256",
    "legacyImage",
    "legacySourceSha",
  ].sort();
  const actualKeys = record && typeof record === "object" && !Array.isArray(record)
    ? Object.keys(record).sort()
    : [];
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || record?.contractVersion !== "marketing-worker-retirement.v1"
    || record?.action !== "stop_remove"
    || record?.service !== "marketing-worker-1"
    || record?.restartAllowed !== false
    || !new Set(["1", "2"]).has(record?.sourceReleaseSchema)
    || !SHA_PATTERN.test(String(record?.sourceReleaseSha ?? ""))
    || !IMAGE_PATTERN.test(String(record?.legacyImage ?? ""))
    || !SHA_PATTERN.test(String(record?.legacySourceSha ?? ""))
    || !/^[0-9a-f]{64}$/.test(String(record?.sourceManifestSha256 ?? ""))
    || !/^[0-9a-f]{64}$/.test(String(record?.baselineManifestSha256 ?? ""))) {
    throw new Error("marketing_retirement_record_invalid");
  }
};

export function assembleReleaseManifest({
  releaseSha,
  currentManifest,
  builtImages,
  changedImageKeys,
  staticValues,
  retirementRecord,
}) {
  requireSha(releaseSha, "release_sha_invalid");
  const current = normalizeCurrent(currentManifest);
  const isStrippedCutoverBaseline = current?.RELEASE_SCHEMA === "3" && !current.RELEASE_SHA;
  if (isStrippedCutoverBaseline) {
    if (!retirementRecord) throw new Error("marketing_retirement_record_required");
    validateRetirementRecord(retirementRecord);
    if (typeof currentManifest !== "string"
      || createHash("sha256").update(currentManifest).digest("hex") !== retirementRecord.baselineManifestSha256) {
      throw new Error("marketing_retirement_baseline_mismatch");
    }
  } else if (retirementRecord) {
    throw new Error("marketing_retirement_normal_mode_forbidden");
  }
  const built = builtImages ?? {};
  const changed = new Set(changedImageKeys ?? []);

  for (const key of changed) {
    if (!IMAGE_KEYS.includes(key)) throw new Error("component_key_unknown");
  }

  const values = {
    RELEASE_SCHEMA: "3",
    RELEASE_SHA: releaseSha,
  };
  if (retirementRecord) {
    values.MARKETING_RETIREMENT_SHA256 = createHash("sha256")
      .update(`${JSON.stringify(retirementRecord)}\n`)
      .digest("hex");
  }

  for (const key of IMAGE_KEYS) {
    const prefix = prefixFor(key);
    let image;
    let sourceSha;
    if (changed.has(key)) {
      const entry = built[key];
      if (!entry) throw new Error("component_image_missing");
      image = requireImage(entry.image, "component_image_invalid");
      sourceSha = requireSha(entry.sourceSha, "component_source_sha_invalid");
      if (sourceSha !== releaseSha) throw new Error("component_source_sha_mismatch");
    } else {
      if (!current?.[key]) throw new Error("component_image_missing");
      image = requireImage(current[key], "component_image_invalid");
      sourceSha = requireSha(
        current[`${prefix}_SOURCE_SHA`] ?? current.RELEASE_SHA,
        "component_source_sha_invalid",
      );
    }
    values[key] = image;
    values[`${prefix}_SOURCE_SHA`] = sourceSha;
    values[`${prefix}_CHANGED`] = changed.has(key) ? "true" : "false";
  }

  for (const key of STATIC_KEYS) {
    const value = String(staticValues?.[key] ?? current?.[key] ?? "");
    if (!value || /[\r\n]/.test(value)) throw new Error("static_value_invalid");
    values[key] = value;
  }
  requireImage(values.CADDY_IMAGE, "caddy_image_invalid");

  const orderedKeys = [
    "RELEASE_SCHEMA",
    "RELEASE_SHA",
    ...(values.MARKETING_RETIREMENT_SHA256 ? ["MARKETING_RETIREMENT_SHA256"] : []),
    ...IMAGE_KEYS.flatMap((key) => {
      const prefix = prefixFor(key);
      return [key, `${prefix}_SOURCE_SHA`, `${prefix}_CHANGED`];
    }),
    ...STATIC_KEYS,
  ];
  return `${orderedKeys.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}

const requireExactKeys = (value, expected, code) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
};

const parseCanonicalJson = (source, code) => {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(code);
  }
  if (source !== `${JSON.stringify(value)}\n`) throw new Error(code);
  return value;
};

const validateSchema3Baseline = (source) => {
  const baseline = parseReleaseManifest(source);
  const allowed = new Set(["RELEASE_SCHEMA", ...STATIC_KEYS]);
  for (const key of PRESERVED_IMAGE_KEYS) {
    const prefix = prefixFor(key);
    allowed.add(key);
    allowed.add(`${prefix}_SOURCE_SHA`);
    allowed.add(`${prefix}_CHANGED`);
  }
  if (baseline.RELEASE_SCHEMA !== "3" || Object.hasOwn(baseline, "RELEASE_SHA")) {
    throw new Error("assembler_schema3_baseline_invalid");
  }
  for (const key of Object.keys(baseline)) {
    if (!allowed.has(key)) throw new Error("assembler_schema3_baseline_invalid");
  }
  for (const key of PRESERVED_IMAGE_KEYS) {
    const prefix = prefixFor(key);
    requireImage(baseline[key], "assembler_schema3_baseline_invalid");
    requireSha(baseline[`${prefix}_SOURCE_SHA`], "assembler_schema3_baseline_invalid");
    if (baseline[`${prefix}_CHANGED`] !== "false") throw new Error("assembler_schema3_baseline_invalid");
  }
  for (const key of STATIC_KEYS) {
    if (!baseline[key] || /[\r\n]/.test(baseline[key])) throw new Error("assembler_schema3_baseline_invalid");
  }
  requireImage(baseline.CADDY_IMAGE, "assembler_schema3_baseline_invalid");
  return source;
};

const validateFullSchema3Current = (source) => {
  const current = parseReleaseManifest(source);
  const allowed = new Set(["RELEASE_SCHEMA", "RELEASE_SHA", "MARKETING_RETIREMENT_SHA256", ...STATIC_KEYS]);
  for (const key of IMAGE_KEYS) {
    const prefix = prefixFor(key);
    allowed.add(key);
    allowed.add(`${prefix}_SOURCE_SHA`);
    allowed.add(`${prefix}_CHANGED`);
  }
  if (current.RELEASE_SCHEMA !== "3") throw new Error("assembler_schema3_current_invalid");
  requireSha(current.RELEASE_SHA, "assembler_schema3_current_invalid");
  for (const key of Object.keys(current)) {
    if (!allowed.has(key)) throw new Error("assembler_schema3_current_invalid");
  }
  if (Object.hasOwn(current, "MARKETING_RETIREMENT_SHA256")
    && !/^[0-9a-f]{64}$/.test(current.MARKETING_RETIREMENT_SHA256)) {
    throw new Error("assembler_schema3_current_invalid");
  }
  for (const key of IMAGE_KEYS) {
    const prefix = prefixFor(key);
    requireImage(current[key], "assembler_schema3_current_invalid");
    requireSha(current[`${prefix}_SOURCE_SHA`], "assembler_schema3_current_invalid");
    if (!new Set(["true", "false"]).has(current[`${prefix}_CHANGED`])) {
      throw new Error("assembler_schema3_current_invalid");
    }
    if (current[`${prefix}_CHANGED`] === "true" && current[`${prefix}_SOURCE_SHA`] !== current.RELEASE_SHA) {
      throw new Error("assembler_schema3_current_invalid");
    }
  }
  for (const key of STATIC_KEYS) {
    if (!current[key] || /[\r\n]/.test(current[key])) throw new Error("assembler_schema3_current_invalid");
  }
  requireImage(current.CADDY_IMAGE, "assembler_schema3_current_invalid");
  return source;
};

const validateCandidateProvenance = (source, mode) => {
  const provenance = parseCanonicalJson(source, "assembler_candidate_provenance_invalid");
  const expectedKeys = mode === "initial-cutover"
    ? ["contractVersion", "releaseSha", "builtImages", "changedImageKeys", "customerUiEvidenceSha256"]
    : ["contractVersion", "releaseSha", "builtImages", "changedImageKeys"];
  requireExactKeys(provenance, expectedKeys, "assembler_candidate_provenance_invalid");
  if (provenance.contractVersion !== "brand-pilot-release-provenance.v1") {
    throw new Error("assembler_candidate_provenance_invalid");
  }
  requireSha(provenance.releaseSha, "assembler_candidate_provenance_invalid");
  if (!Array.isArray(provenance.changedImageKeys)) throw new Error("assembler_candidate_provenance_invalid");
  const expectedChanged = mode === "initial-cutover"
    ? [...CUTOVER_IMAGE_KEYS]
    : IMAGE_KEYS.filter((key) => provenance.changedImageKeys.includes(key));
  if (provenance.changedImageKeys.length !== expectedChanged.length
    || provenance.changedImageKeys.some((key, index) => key !== expectedChanged[index])) {
    throw new Error(mode === "initial-cutover"
      ? "assembler_cutover_component_set_invalid"
      : "assembler_normal_component_set_invalid");
  }
  requireExactKeys(provenance.builtImages, expectedChanged, mode === "initial-cutover"
    ? "assembler_cutover_component_set_invalid"
    : "assembler_normal_component_set_invalid");
  for (const key of expectedChanged) {
    requireExactKeys(provenance.builtImages[key], ["image", "sourceSha"], "assembler_candidate_provenance_invalid");
    requireImage(provenance.builtImages[key].image, "assembler_candidate_provenance_invalid");
    if (provenance.builtImages[key].sourceSha !== provenance.releaseSha) {
      throw new Error("assembler_candidate_provenance_invalid");
    }
  }
  return provenance;
};

const validateCustomerUiEvidence = (source, provenance) => {
  const uiEvidenceHash = createHash("sha256").update(source).digest("hex");
  if (provenance.customerUiEvidenceSha256 !== uiEvidenceHash) throw new Error("assembler_customer_ui_evidence_mismatch");
  const uiEvidence = parseCanonicalJson(source, "assembler_customer_ui_evidence_invalid");
  requireExactKeys(uiEvidence, ["contractVersion", "sourceSha", "deploymentId", "ready"], "assembler_customer_ui_evidence_invalid");
  if (uiEvidence.contractVersion !== "customer-ui-deployment-evidence.v1"
    || uiEvidence.sourceSha !== provenance.releaseSha
    || uiEvidence.ready !== true
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(String(uiEvidence.deploymentId ?? ""))) {
    throw new Error("assembler_customer_ui_evidence_invalid");
  }
};

const parseArguments = (argv) => {
  const allowed = new Set([
    "--mode",
    "--schema3-baseline",
    "--schema3-current",
    "--candidate-provenance",
    "--customer-ui-evidence",
    "--retirement-record",
    "--output",
  ]);
  const raw = new Map();
  if (argv.length % 2 !== 0) throw new Error("assembler_usage_invalid");
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || !value || raw.has(key)) throw new Error("assembler_usage_invalid");
    raw.set(key, value);
  }
  const mode = raw.get("--mode");
  const required = mode === "initial-cutover"
    ? ["--mode", "--schema3-baseline", "--candidate-provenance", "--customer-ui-evidence", "--retirement-record", "--output"]
    : mode === "normal"
      ? ["--mode", "--schema3-current", "--candidate-provenance", "--output"]
      : [];
  if (required.length === 0
    || raw.size !== required.length
    || required.some((key) => !raw.has(key))) {
    throw new Error("assembler_usage_invalid");
  }
  const values = new Map([["--mode", mode]]);
  for (const key of required.filter((key) => key !== "--mode")) values.set(key, resolve(raw.get(key)));
  const paths = [...values.entries()].filter(([key]) => key !== "--mode").map(([, value]) => value);
  if (new Set(paths).size !== paths.length) throw new Error("assembler_path_collision");
  return values;
};

async function writeExclusive(path, contents) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") throw new Error("assembler_output_exists");
    throw error;
  }
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function main(argv) {
  const args = parseArguments(argv);
  const mode = args.get("--mode");
  let currentManifest;
  let provenance;
  let retirementRecord;
  if (mode === "initial-cutover") {
    const [baselineSource, provenanceSource, uiEvidenceSource, retirementSource] = await Promise.all([
      readFile(args.get("--schema3-baseline"), "utf8"),
      readFile(args.get("--candidate-provenance"), "utf8"),
      readFile(args.get("--customer-ui-evidence"), "utf8"),
      readFile(args.get("--retirement-record"), "utf8"),
    ]);
    currentManifest = validateSchema3Baseline(baselineSource);
    provenance = validateCandidateProvenance(provenanceSource, mode);
    validateCustomerUiEvidence(uiEvidenceSource, provenance);
    retirementRecord = parseCanonicalJson(retirementSource, "marketing_retirement_record_invalid");
    validateRetirementRecord(retirementRecord);
    if (retirementRecord.baselineManifestSha256 !== createHash("sha256").update(baselineSource).digest("hex")) {
      throw new Error("marketing_retirement_baseline_mismatch");
    }
  } else {
    const [currentSource, provenanceSource] = await Promise.all([
      readFile(args.get("--schema3-current"), "utf8"),
      readFile(args.get("--candidate-provenance"), "utf8"),
    ]);
    currentManifest = validateFullSchema3Current(currentSource);
    provenance = validateCandidateProvenance(provenanceSource, mode);
    retirementRecord = undefined;
  }
  const release = assembleReleaseManifest({
    releaseSha: provenance.releaseSha,
    currentManifest,
    builtImages: provenance.builtImages,
    changedImageKeys: provenance.changedImageKeys,
    staticValues: null,
    retirementRecord,
  });
  await writeExclusive(args.get("--output"), release);
  process.stdout.write(`${JSON.stringify({
    releaseSha: provenance.releaseSha,
    manifestSha256: createHash("sha256").update(release).digest("hex"),
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "assembler_failed"}\n`);
    process.exitCode = 1;
  });
}
