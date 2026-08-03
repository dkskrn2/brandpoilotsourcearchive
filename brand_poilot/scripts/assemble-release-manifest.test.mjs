import assert from "node:assert/strict";
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

test("assembles a complete schema-2 bootstrap manifest", () => {
  const text = assembleReleaseManifest({
    releaseSha: SHA_A,
    currentManifest: null,
    builtImages: allBuilt,
    changedImageKeys: IMAGE_KEYS,
    staticValues,
  });
  const manifest = parseReleaseManifest(text);

  assert.equal(manifest.RELEASE_SCHEMA, "2");
  assert.equal(manifest.RELEASE_SHA, SHA_A);
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
