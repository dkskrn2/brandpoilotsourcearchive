export const IMAGE_KEYS = Object.freeze([
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

const STATIC_KEYS = Object.freeze([
  "CADDY_IMAGE",
  "CANARY_HOST",
  "PRIMARY_HOST",
  "ACME_EMAIL",
  "API_ENV_FILE",
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

export function assembleReleaseManifest({
  releaseSha,
  currentManifest,
  builtImages,
  changedImageKeys,
  staticValues,
}) {
  requireSha(releaseSha, "release_sha_invalid");
  const current = normalizeCurrent(currentManifest);
  const built = builtImages ?? {};
  const changed = new Set(changedImageKeys ?? []);

  for (const key of changed) {
    if (!IMAGE_KEYS.includes(key)) throw new Error("component_key_unknown");
  }

  const values = {
    RELEASE_SCHEMA: "2",
    RELEASE_SHA: releaseSha,
  };

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
    ...IMAGE_KEYS.flatMap((key) => {
      const prefix = prefixFor(key);
      return [key, `${prefix}_SOURCE_SHA`, `${prefix}_CHANGED`];
    }),
    ...STATIC_KEYS,
  ];
  return `${orderedKeys.map((key) => `${key}=${values[key]}`).join("\n")}\n`;
}
