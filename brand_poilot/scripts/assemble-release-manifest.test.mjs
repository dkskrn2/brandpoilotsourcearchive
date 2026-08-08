import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  IMAGE_KEYS,
  assembleReleaseManifest,
  parseReleaseManifest,
} from "./assemble-release-manifest.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const digest = (character) => `sha256:${character.repeat(64)}`;
const image = (key, character) => `ghcr.io/dkskrn2/${key.toLowerCase()}@${digest(character)}`;

const staticValues = {
  CADDY_IMAGE: `docker.io/library/caddy@${digest("c")}`,
  CANARY_HOST: "canary-api.danbammsg.co.kr",
  PRIMARY_HOST: "api.danbammsg.co.kr",
  ACME_EMAIL: "ops@danbammsg.co.kr",
  API_ENV_FILE: "/opt/brand-pilot/shared/env/api.env",
};

const allBuilt = Object.fromEntries(IMAGE_KEYS.map((key, index) => [
  key,
  { image: image(key, String((index % 9) + 1)), sourceSha: SHA_A },
]));

test("assembles a complete schema-3 bootstrap manifest", () => {
  const text = assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  });
  const manifest = parseReleaseManifest(text);

  assert.equal(manifest.RELEASE_SCHEMA, "3");
  assert.equal(manifest.RELEASE_SHA, SHA_A);
  assert.equal(IMAGE_KEYS.includes("REEL_WORKER_IMAGE"), true);
  assert.equal(IMAGE_KEYS.includes("MARKETING_WORKER_IMAGE"), false);
  for (const key of IMAGE_KEYS) {
    const prefix = key.slice(0, -"_IMAGE".length);
    assert.equal(manifest[key], allBuilt[key].image);
    assert.equal(manifest[`${prefix}_SOURCE_SHA`], SHA_A);
    assert.equal(manifest[`${prefix}_CHANGED`], "true");
  }
});

test("reuses unchanged digest and component source revision", () => {
  const currentText = assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  });
  const nextApi = { image: image("API_IMAGE", "d"), sourceSha: SHA_B };
  const nextText = assembleReleaseManifest({
    releaseSha: SHA_B,
    currentManifest: currentText,
    builtImages: { API_IMAGE: nextApi },
    changedImageKeys: ["API_IMAGE"],
    staticValues,
  });
  const next = parseReleaseManifest(nextText);

  assert.equal(next.API_IMAGE, nextApi.image);
  assert.equal(next.API_SOURCE_SHA, SHA_B);
  assert.equal(next.API_CHANGED, "true");
  assert.equal(next.CARD_NEWS_WORKER_IMAGE, parseReleaseManifest(currentText).CARD_NEWS_WORKER_IMAGE);
  assert.equal(next.CARD_NEWS_WORKER_SOURCE_SHA, SHA_A);
  assert.equal(next.CARD_NEWS_WORKER_CHANGED, "false");
});

test("fails closed when a changed or reusable component is missing", () => {
  assert.throws(() => assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: { API_IMAGE: allBuilt.API_IMAGE },
    changedImageKeys: ["API_IMAGE"],
    staticValues,
  }), /component_image_missing/);

  assert.throws(() => assembleReleaseManifest({
    releaseSha: SHA_B,
    currentManifest: null,
    builtImages: {},
    changedImageKeys: ["API_IMAGE"],
    staticValues,
  }), /component_image_missing/);
});

test("rejects malformed digests, revisions, and unknown image keys", () => {
  assert.throws(() => assembleReleaseManifest({
    releaseSha: "not-a-sha",
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  }), /release_sha_invalid/);

  assert.throws(() => assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: { ...allBuilt, API_IMAGE: { image: "ghcr.io/example/api:latest", sourceSha: SHA_A } },
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  }), /component_image_invalid/);

  assert.throws(() => assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: [...IMAGE_KEYS, "UNKNOWN_IMAGE"],
    staticValues,
  }), /component_key_unknown/);
});

test("emits deterministic key order and a final newline", () => {
  const first = assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: [...IMAGE_KEYS].reverse(),
    staticValues,
  });
  const second = assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: Object.fromEntries(Object.entries(allBuilt).reverse()),
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  });
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
});

test("CLI assembles the one-time schema-3 cutover from checksum-bound files", () => {
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-assembler-"));
  const baselinePath = join(directory, "baseline.env");
  const provenancePath = join(directory, "deployment-provenance.json");
  const uiEvidencePath = join(directory, "customer-ui-evidence.json");
  const retirementPath = join(directory, "marketing-retirement.json");
  const outputPath = join(directory, "release.env");
  const cutoverKeys = [
    "API_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ];
  const preservedKeys = [
    "DM_WORKER_IMAGE",
    "WIKI_WORKER_IMAGE",
    "BRAND_INTELLIGENCE_WORKER_IMAGE",
    "SUBJECT_ANALYSIS_WORKER_IMAGE",
  ];
  const baselineLines = ["RELEASE_SCHEMA=3"];
  for (const key of preservedKeys) {
    const prefix = key.slice(0, -"_IMAGE".length);
    baselineLines.push(`${key}=${allBuilt[key].image}`, `${prefix}_SOURCE_SHA=${SHA_A}`, `${prefix}_CHANGED=false`);
  }
  for (const [key, value] of Object.entries(staticValues)) baselineLines.push(`${key}=${value}`);
  writeFileSync(baselinePath, `${baselineLines.join("\n")}\n`, { mode: 0o600 });

  const uiEvidence = `${JSON.stringify({
    contractVersion: "customer-ui-deployment-evidence.v1",
    sourceSha: SHA_B,
    deploymentId: "dpl_cutover_123",
    ready: true,
  })}\n`;
  writeFileSync(uiEvidencePath, uiEvidence, { mode: 0o600 });
  const builtImages = Object.fromEntries(cutoverKeys.map((key, index) => [key, {
    image: image(key, String((index % 9) + 1)),
    sourceSha: SHA_B,
  }]));
  writeFileSync(provenancePath, `${JSON.stringify({
    contractVersion: "brand-pilot-release-provenance.v1",
    releaseSha: SHA_B,
    builtImages,
    changedImageKeys: cutoverKeys,
    customerUiEvidenceSha256: createHash("sha256").update(uiEvidence).digest("hex"),
  })}\n`, { mode: 0o600 });
  const retirementRecord = {
    contractVersion: "marketing-worker-retirement.v1",
    action: "stop_remove",
    service: "marketing-worker-1",
    restartAllowed: false,
    sourceReleaseSchema: "2",
    sourceReleaseSha: SHA_A,
    sourceManifestSha256: "1".repeat(64),
    baselineManifestSha256: createHash("sha256").update(readFileSync(baselinePath)).digest("hex"),
    legacyImage: image("marketing-worker", "a"),
    legacySourceSha: SHA_A,
  };
  writeFileSync(retirementPath, `${JSON.stringify(retirementRecord)}\n`, { mode: 0o400 });
  chmodSync(retirementPath, 0o400);

  const result = spawnSync(process.execPath, [
    "scripts/assemble-release-manifest.mjs",
    "--mode", "initial-cutover",
    "--schema3-baseline", baselinePath,
    "--candidate-provenance", provenancePath,
    "--customer-ui-evidence", uiEvidencePath,
    "--retirement-record", retirementPath,
    "--output", outputPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const manifest = parseReleaseManifest(readFileSync(outputPath, "utf8"));
  assert.equal(manifest.RELEASE_SCHEMA, "3");
  assert.equal(manifest.RELEASE_SHA, SHA_B);
  assert.equal(manifest.REEL_WORKER_CHANGED, "true");
  assert.equal(manifest.DM_WORKER_CHANGED, "false");
  assert.equal(Object.hasOwn(manifest, "MARKETING_WORKER_IMAGE"), false);
  assert.equal(result.stdout, `${JSON.stringify({
    releaseSha: SHA_B,
    manifestSha256: createHash("sha256").update(readFileSync(outputPath)).digest("hex"),
  })}\n`);

  const duplicate = spawnSync(process.execPath, [
    "scripts/assemble-release-manifest.mjs",
    "--mode", "initial-cutover",
    "--schema3-baseline", baselinePath,
    "--candidate-provenance", provenancePath,
    "--customer-ui-evidence", uiEvidencePath,
    "--retirement-record", retirementPath,
    "--output", outputPath,
  ], { encoding: "utf8" });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /assembler_output_exists/);
});
