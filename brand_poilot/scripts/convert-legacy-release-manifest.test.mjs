import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { assembleReleaseManifest, parseReleaseManifest } from "./assemble-release-manifest.mjs";
import { convertLegacyReleaseManifest } from "./convert-legacy-release-manifest.mjs";

const LEGACY_SHA = "a".repeat(40);
const CANDIDATE_SHA = "b".repeat(40);
const digest = (name, character) => `ghcr.io/dkskrn2/${name}@sha256:${character.repeat(64)}`;

const legacyImages = {
  API_IMAGE: digest("brand-pilot-api", "1"),
  DM_WORKER_IMAGE: digest("brand-pilot-dm-worker", "2"),
  WIKI_WORKER_IMAGE: digest("brand-pilot-wiki-worker", "3"),
  CONTENT_PROPOSAL_WORKER_IMAGE: digest("brand-pilot-content-proposal-worker", "4"),
  BRAND_INTELLIGENCE_WORKER_IMAGE: digest("brand-pilot-brand-intelligence-worker", "5"),
  SUBJECT_ANALYSIS_WORKER_IMAGE: digest("brand-pilot-subject-analysis-worker", "6"),
  IMAGE_WORKER_IMAGE: digest("brand-pilot-image-worker", "7"),
  CARD_NEWS_WORKER_IMAGE: digest("brand-pilot-card-news-worker", "8"),
  BLOG_WORKER_IMAGE: digest("brand-pilot-blog-worker", "9"),
  MARKETING_WORKER_IMAGE: digest("brand-pilot-marketing-worker", "a"),
};

const staticValues = {
  CADDY_IMAGE: `docker.io/library/caddy@sha256:${"c".repeat(64)}`,
  CANARY_HOST: "canary-api.danbammsg.co.kr",
  PRIMARY_HOST: "api.danbammsg.co.kr",
  ACME_EMAIL: "ops@danbammsg.co.kr",
  API_ENV_FILE: "/opt/brand-pilot/shared/env/api.env",
};

function schema2Manifest() {
  const lines = ["RELEASE_SCHEMA=2", `RELEASE_SHA=${LEGACY_SHA}`];
  for (const [key, value] of Object.entries(legacyImages)) {
    const prefix = key.slice(0, -"_IMAGE".length);
    lines.push(`${key}=${value}`, `${prefix}_SOURCE_SHA=${LEGACY_SHA}`, `${prefix}_CHANGED=false`);
  }
  for (const [key, value] of Object.entries(staticValues)) lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

function schema1Manifest() {
  return `${[
    "RELEASE_SCHEMA=1",
    `RELEASE_SHA=${LEGACY_SHA}`,
    ...Object.entries(legacyImages).map(([key, value]) => `${key}=${value}`),
    ...Object.entries(staticValues).map(([key, value]) => `${key}=${value}`),
  ].join("\n")}\n`;
}

test("schema-2 conversion preserves unrelated values and emits a non-executable retirement record", () => {
  const converted = convertLegacyReleaseManifest(schema2Manifest());
  const baseline = parseReleaseManifest(converted.baselineManifest);

  assert.equal(baseline.RELEASE_SCHEMA, "3");
  assert.equal(Object.hasOwn(baseline, "RELEASE_SHA"), false);
  for (const prefix of ["API", "CONTENT_PROPOSAL_WORKER", "IMAGE_WORKER", "CARD_NEWS_WORKER", "BLOG_WORKER", "REEL_WORKER", "MARKETING_WORKER"]) {
    for (const suffix of ["IMAGE", "SOURCE_SHA", "CHANGED"]) {
      assert.equal(Object.hasOwn(baseline, `${prefix}_${suffix}`), false, `${prefix}_${suffix}`);
    }
  }
  for (const prefix of ["DM_WORKER", "WIKI_WORKER", "BRAND_INTELLIGENCE_WORKER", "SUBJECT_ANALYSIS_WORKER"]) {
    assert.equal(baseline[`${prefix}_IMAGE`], legacyImages[`${prefix}_IMAGE`]);
    assert.equal(baseline[`${prefix}_SOURCE_SHA`], LEGACY_SHA);
    assert.equal(baseline[`${prefix}_CHANGED`], "false");
  }
  assert.deepEqual(Object.fromEntries(Object.keys(staticValues).map((key) => [key, baseline[key]])), staticValues);

  assert.deepEqual(converted.retirementRecord, {
    contractVersion: "marketing-worker-retirement.v1",
    action: "stop_remove",
    service: "marketing-worker-1",
    restartAllowed: false,
    sourceReleaseSchema: "2",
    sourceReleaseSha: LEGACY_SHA,
    sourceManifestSha256: converted.retirementRecord.sourceManifestSha256,
    legacyImage: legacyImages.MARKETING_WORKER_IMAGE,
    legacySourceSha: LEGACY_SHA,
  });
  assert.match(converted.retirementRecord.sourceManifestSha256, /^[0-9a-f]{64}$/);
  assert.equal(Object.keys(converted.retirementRecord).some((key) => /^(?:command|start|recreate)$/i.test(key)), false);
});

test("schema-1 conversion derives only unrelated provenance from the sealed release SHA", () => {
  const baseline = parseReleaseManifest(convertLegacyReleaseManifest(schema1Manifest()).baselineManifest);
  assert.equal(baseline.DM_WORKER_IMAGE, legacyImages.DM_WORKER_IMAGE);
  assert.equal(baseline.DM_WORKER_SOURCE_SHA, LEGACY_SHA);
  assert.equal(baseline.DM_WORKER_CHANGED, "false");
});

test("converted baseline requires explicit fresh content images before final assembly", () => {
  const { baselineManifest, retirementRecord } = convertLegacyReleaseManifest(schema2Manifest());
  const changedImageKeys = [
    "API_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ];
  assert.throws(() => assembleReleaseManifest({
    releaseSha: CANDIDATE_SHA,
    currentManifest: baselineManifest,
    builtImages: {},
    changedImageKeys,
    staticValues,
    retirementRecord,
  }), /component_image_missing/);

  const builtImages = Object.fromEntries(changedImageKeys.map((key, index) => [key, {
    image: digest(key.toLowerCase().replaceAll("_", "-"), String((index + 1) % 10)),
    sourceSha: CANDIDATE_SHA,
  }]));
  const finalManifest = parseReleaseManifest(assembleReleaseManifest({
    releaseSha: CANDIDATE_SHA,
    currentManifest: baselineManifest,
    builtImages,
    changedImageKeys,
    staticValues,
    retirementRecord,
  }));
  assert.equal(finalManifest.RELEASE_SCHEMA, "3");
  assert.equal(finalManifest.REEL_WORKER_IMAGE, builtImages.REEL_WORKER_IMAGE.image);
  assert.equal(Object.hasOwn(finalManifest, "MARKETING_WORKER_IMAGE"), false);
  assert.equal(
    finalManifest.MARKETING_RETIREMENT_SHA256,
    createHash("sha256").update(`${JSON.stringify(retirementRecord)}\n`).digest("hex"),
  );
  assert.equal(retirementRecord.restartAllowed, false);

  assert.throws(() => assembleReleaseManifest({
    releaseSha: CANDIDATE_SHA,
    currentManifest: baselineManifest,
    builtImages,
    changedImageKeys,
    staticValues,
  }), /marketing_retirement_record_required/);

  assert.throws(() => assembleReleaseManifest({
    releaseSha: CANDIDATE_SHA,
    currentManifest: baselineManifest,
    builtImages,
    changedImageKeys,
    staticValues,
    retirementRecord: { ...retirementRecord, sourceReleaseSchema: "3" },
  }), /marketing_retirement_record_invalid/);
  assert.throws(() => assembleReleaseManifest({
    releaseSha: CANDIDATE_SHA,
    currentManifest: baselineManifest,
    builtImages,
    changedImageKeys,
    staticValues,
    retirementRecord: { ...retirementRecord, command: "docker start marketing-worker-1" },
  }), /marketing_retirement_record_invalid/);
});

test("converter rejects schema-3, duplicate, unknown, candidate reel, and mutable image inputs", () => {
  assert.throws(() => convertLegacyReleaseManifest(schema2Manifest().replace("RELEASE_SCHEMA=2", "RELEASE_SCHEMA=3")), /legacy_release_schema_required/);
  assert.throws(() => convertLegacyReleaseManifest(`${schema2Manifest()}RELEASE_SHA=${LEGACY_SHA}\n`), /legacy_manifest_key_duplicate/);
  assert.throws(() => convertLegacyReleaseManifest(`${schema2Manifest()}UNKNOWN_KEY=value\n`), /legacy_manifest_key_unknown/);
  assert.throws(() => convertLegacyReleaseManifest(`${schema2Manifest()}REEL_WORKER_IMAGE=${digest("reel", "f")}\n`), /legacy_manifest_candidate_field_forbidden/);
  assert.throws(() => convertLegacyReleaseManifest(schema2Manifest().replace(legacyImages.MARKETING_WORKER_IMAGE, "ghcr.io/example/marketing:latest")), /legacy_manifest_image_invalid/);
});

test("converter CLI writes exclusive deterministic baseline and retirement files", () => {
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-converter-"));
  const input = join(directory, "release.env");
  const baseline = join(directory, "baseline.env");
  const retirement = join(directory, "marketing-retirement.json");
  writeFileSync(input, schema2Manifest(), { mode: 0o600 });
  chmodSync(input, 0o600);
  const args = [
    "scripts/convert-legacy-release-manifest.mjs",
    "--input", input,
    "--baseline-output", baseline,
    "--retirement-output", retirement,
  ];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const expected = convertLegacyReleaseManifest(schema2Manifest());
  assert.equal(readFileSync(baseline, "utf8"), expected.baselineManifest);
  assert.equal(readFileSync(retirement, "utf8"), `${JSON.stringify(expected.retirementRecord)}\n`);
  assert.deepEqual(JSON.parse(result.stdout), {
    baselineSha256: createHash("sha256").update(expected.baselineManifest).digest("hex"),
    retirementSha256: createHash("sha256").update(`${JSON.stringify(expected.retirementRecord)}\n`).digest("hex"),
  });

  const duplicate = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /EEXIST/);
});

test("schema-2 fixture flows through both CLIs into one sealed schema-3 release", () => {
  const directory = mkdtempSync(join(tmpdir(), "brand-pilot-cutover-pipeline-"));
  const input = join(directory, "current-release.env");
  const baseline = join(directory, "schema3-baseline.env");
  const retirement = join(directory, "marketing-worker-retirement.json");
  const provenance = join(directory, "deployment-provenance.json");
  const uiEvidence = join(directory, "customer-ui-evidence.json");
  const output = join(directory, "release.env");
  writeFileSync(input, schema2Manifest(), { mode: 0o600 });
  const converted = spawnSync(process.execPath, [
    "scripts/convert-legacy-release-manifest.mjs",
    "--input", input,
    "--baseline-output", baseline,
    "--retirement-output", retirement,
  ], { encoding: "utf8" });
  assert.equal(converted.status, 0, converted.stderr);

  const evidence = `${JSON.stringify({
    contractVersion: "customer-ui-deployment-evidence.v1",
    sourceSha: CANDIDATE_SHA,
    deploymentId: "dpl_schema3_cutover",
    ready: true,
  })}\n`;
  writeFileSync(uiEvidence, evidence, { mode: 0o600 });
  const changedImageKeys = [
    "API_IMAGE",
    "CONTENT_PROPOSAL_WORKER_IMAGE",
    "IMAGE_WORKER_IMAGE",
    "CARD_NEWS_WORKER_IMAGE",
    "BLOG_WORKER_IMAGE",
    "REEL_WORKER_IMAGE",
  ];
  const builtImages = Object.fromEntries(changedImageKeys.map((key, index) => [key, {
    image: digest(key.toLowerCase().replaceAll("_", "-"), String(index + 1)),
    sourceSha: CANDIDATE_SHA,
  }]));
  writeFileSync(provenance, `${JSON.stringify({
    contractVersion: "brand-pilot-release-provenance.v1",
    releaseSha: CANDIDATE_SHA,
    builtImages,
    changedImageKeys,
    customerUiEvidenceSha256: createHash("sha256").update(evidence).digest("hex"),
  })}\n`, { mode: 0o600 });
  const assembled = spawnSync(process.execPath, [
    "scripts/assemble-release-manifest.mjs",
    "--schema3-baseline", baseline,
    "--candidate-provenance", provenance,
    "--customer-ui-evidence", uiEvidence,
    "--retirement-record", retirement,
    "--output", output,
  ], { encoding: "utf8" });
  assert.equal(assembled.status, 0, assembled.stderr);
  const manifest = parseReleaseManifest(readFileSync(output, "utf8"));
  assert.equal(manifest.RELEASE_SCHEMA, "3");
  assert.equal(manifest.RELEASE_SHA, CANDIDATE_SHA);
  assert.equal(manifest.REEL_WORKER_CHANGED, "true");
  assert.equal(manifest.DM_WORKER_IMAGE, legacyImages.DM_WORKER_IMAGE);
  assert.equal(Object.hasOwn(manifest, "MARKETING_WORKER_IMAGE"), false);
  assert.match(manifest.MARKETING_RETIREMENT_SHA256, /^[a-f0-9]{64}$/);
});
