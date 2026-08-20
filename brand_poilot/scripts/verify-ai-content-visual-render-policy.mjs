import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AI_CONTENT_VISUAL_RENDER_POLICY_SHA256,
  AI_CONTENT_VISUAL_RENDER_POLICY_VERSION,
} from "../workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs";

const manifestPath = "workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.releases.json";
const versionPattern = /^visual-render-policy\.d2pp\.v[1-9][0-9]*$/;
const shaPattern = /^[a-f0-9]{64}$/;

function exactEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("visual_render_policy_release_entry_invalid");
  if (Object.keys(value).sort().join(",") !== "sha256,version") throw new Error("visual_render_policy_release_entry_invalid");
  if (!versionPattern.test(value.version) || !shaPattern.test(value.sha256)) throw new Error("visual_render_policy_release_entry_invalid");
  return { version: value.version, sha256: value.sha256 };
}

function exactEntries(value) {
  if (!Array.isArray(value) || value.length < 1) throw new Error("visual_render_policy_release_manifest_invalid");
  const entries = value.map(exactEntry);
  if (new Set(entries.map((entry) => entry.version)).size !== entries.length) throw new Error("visual_render_policy_release_version_duplicate");
  if (new Set(entries.map((entry) => entry.sha256)).size !== entries.length) throw new Error("visual_render_policy_release_hash_duplicate");
  return entries;
}

export function validateVisualRenderPolicyRelease({
  previousEntries = [], currentEntries, currentPolicyVersion, currentPolicySha256,
}) {
  const previous = previousEntries.length === 0 ? [] : exactEntries(previousEntries);
  const current = exactEntries(currentEntries);
  if (current.length < previous.length) throw new Error("visual_render_policy_release_history_mutated");
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(current[index]) !== JSON.stringify(previous[index])) {
      throw new Error("visual_render_policy_release_history_mutated");
    }
  }
  const active = current.at(-1);
  if (active?.version !== currentPolicyVersion || active.sha256 !== currentPolicySha256) {
    throw new Error("visual_render_policy_current_hash_unregistered");
  }
}

function parseManifest(text) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("visual_render_policy_release_manifest_invalid");
  if (Object.keys(value).sort().join(",") !== "contractVersion,entries") throw new Error("visual_render_policy_release_manifest_invalid");
  if (value.contractVersion !== "visual-render-policy-releases.v1") throw new Error("visual_render_policy_release_manifest_invalid");
  return exactEntries(value.entries);
}

function baseEntries(baseSha) {
  if (!baseSha) return [];
  const object = `${baseSha}:brand_poilot/${manifestPath}`;
  try {
    execFileSync("git", ["cat-file", "-e", object], { stdio: "ignore" });
  } catch {
    return [];
  }
  return parseManifest(execFileSync("git", ["show", object], { encoding: "utf8" }));
}

export function verifyVisualRenderPolicyRelease(baseSha = null) {
  const currentEntries = parseManifest(readFileSync(manifestPath, "utf8"));
  validateVisualRenderPolicyRelease({
    previousEntries: baseEntries(baseSha),
    currentEntries,
    currentPolicyVersion: AI_CONTENT_VISUAL_RENDER_POLICY_VERSION,
    currentPolicySha256: AI_CONTENT_VISUAL_RENDER_POLICY_SHA256,
  });
}

const invokedPath = process.argv[1] ? fileURLToPath(new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`)) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const baseIndex = process.argv.indexOf("--base");
  const baseSha = baseIndex >= 0 ? process.argv[baseIndex + 1] : null;
  if (baseIndex >= 0 && !/^[a-f0-9]{40}$/.test(baseSha ?? "")) throw new Error("visual_render_policy_base_sha_invalid");
  verifyVisualRenderPolicyRelease(baseSha);
  console.log(`visual_render_policy_release_ok:${AI_CONTENT_VISUAL_RENDER_POLICY_VERSION}:${AI_CONTENT_VISUAL_RENDER_POLICY_SHA256}`);
}
