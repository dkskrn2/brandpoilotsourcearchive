import os from "node:os";
import path from "node:path";

const CHILD_ENVIRONMENT_KEYS = [
  "APPDATA",
  "CODEX_COMMAND",
  "CODEX_GENERATED_IMAGES_DIR",
  "CODEX_HOME",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "WINDIR",
  "XDG_CONFIG_HOME"
];

/**
 * Keep service credentials out of Codex and renderer descendants. The parent
 * worker remains the only process that can call Brand Pilot or upload assets.
 *
 * @param {NodeJS.ProcessEnv} source
 * @returns {NodeJS.ProcessEnv}
 */
export function buildImageWorkerChildEnvironment(source) {
  const childEnvironment = {};
  for (const key of CHILD_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) childEnvironment[key] = source[key];
  }
  return childEnvironment;
}

/**
 * Codex image_generation writes to CODEX_HOME/generated_images. Production
 * mounts that exact subtree as tmpfs so authentication can remain persistent.
 *
 * @param {NodeJS.ProcessEnv} source
 * @param {string} [homeDirectory]
 */
export function resolveGeneratedImagesDirectory(source, homeDirectory = os.homedir()) {
  const codexHome = source.CODEX_HOME?.trim() || path.join(homeDirectory, ".codex");
  const expectedDirectory = path.resolve(codexHome, "generated_images");
  const configuredDirectory = source.CODEX_GENERATED_IMAGES_DIR?.trim();
  if (configuredDirectory && path.resolve(configuredDirectory) !== expectedDirectory) {
    throw new Error("codex_generated_images_directory_invalid");
  }
  return expectedDirectory;
}
