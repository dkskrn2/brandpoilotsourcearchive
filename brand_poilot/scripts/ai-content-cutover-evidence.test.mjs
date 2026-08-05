import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  INCIDENT_EVIDENCE_SECTIONS,
  INCIDENT_QUERY_SECTIONS,
  REQUIRED_INCIDENT_GENERATION_IDS,
  buildIncidentEvidenceBundle,
  canonicalJson,
  collectIncidentEvidence,
  sha256CanonicalJson,
  writeChecksummedJson,
} from "./ai-content-cutover-evidence.mjs";

const [FIRST_ID, SECOND_ID] = REQUIRED_INCIDENT_GENERATION_IDS;

test("incident evidence hard-codes both required generation IDs and emits every absent section", () => {
  assert.deepEqual(REQUIRED_INCIDENT_GENERATION_IDS, [
    "26998aec-b8c4-4abb-a1d8-a7204c1b6226",
    "71565421-d205-4627-8ea5-84633ac879cb",
  ]);

  const bundle = buildIncidentEvidenceBundle({
    incidentRecords: {
      [FIRST_ID]: {
        generation: { id: FIRST_ID, status: "failed" },
        errors: [{ code: "invalid_json_schema" }],
      },
    },
  });

  assert.deepEqual(bundle.required_generation_ids, REQUIRED_INCIDENT_GENERATION_IDS);
  assert.equal(bundle.schema_version, "ai-content-cutover-evidence.v2");
  assert.equal(bundle.database_row_encoding, "postgres-jsonb-text.v1");
  assert.deepEqual(bundle.incidents.map((incident) => incident.generation_id), REQUIRED_INCIDENT_GENERATION_IDS);

  const first = bundle.incidents[0];
  assert.deepEqual(first.generation, {
    status: "found",
    data: { id: FIRST_ID, status: "failed" },
  });
  assert.deepEqual(first.errors, {
    status: "found",
    data: [{ code: "invalid_json_schema" }],
  });
  for (const section of INCIDENT_EVIDENCE_SECTIONS) {
    assert.ok(Object.hasOwn(first, section), `missing section ${section}`);
    if (section !== "generation" && section !== "errors") {
      assert.deepEqual(first[section], { status: "not_found" });
    }
  }

  const second = bundle.incidents[1];
  for (const section of INCIDENT_EVIDENCE_SECTIONS) {
    assert.deepEqual(second[section], { status: "not_found" });
  }
});

test("incident evidence accepts records in any order but returns deterministic bytes and SHA-256", () => {
  const recordA = {
    [SECOND_ID]: { jobs: [{ id: "b" }, { id: "a" }] },
    [FIRST_ID]: { request: { z: 1, a: 2 } },
  };
  const recordB = {
    [FIRST_ID]: { request: { a: 2, z: 1 } },
    [SECOND_ID]: { jobs: [{ id: "a" }, { id: "b" }] },
  };
  const firstBundle = buildIncidentEvidenceBundle({ incidentRecords: recordA });
  const secondBundle = buildIncidentEvidenceBundle({ incidentRecords: recordB });

  assert.equal(canonicalJson(firstBundle), canonicalJson(secondBundle));
  assert.equal(sha256CanonicalJson(firstBundle), sha256CanonicalJson(secondBundle));
  assert.match(sha256CanonicalJson(firstBundle), /^[0-9a-f]{64}$/);
});

test("record-set ordering uses locale-independent code-unit lexical order", () => {
  const bundle = buildIncidentEvidenceBundle({
    incidentRecords: {
      [FIRST_ID]: { jobs: [{ label: "ä" }, { label: "z" }] },
    },
  });
  assert.deepEqual(bundle.incidents[0].jobs.data, [{ label: "z" }, { label: "ä" }]);
});

test("collector executes fixed current-schema queries for both IDs and merges only closed external metadata", async () => {
  const calls = [];
  const queryable = {
    async query({ name, text, values }) {
      calls.push({ name, text, values });
      assert.match(text, /ai_content_|schema_migrations/);
      if (name === "ai-content-evidence-request") {
        assert.match(text, /from ai_content_generations/);
      }
      if (name === "ai-content-evidence-orchestration") {
        assert.match(text, /orchestration_snapshot/);
        assert.match(text, /ai_content_analyzed_subject_snapshots/);
        assert.match(text, /ai_content_subject_analyses/);
        assert.match(text, /ai_content_subject_images/);
        assert.match(text, /ai_content_generation_references/);
        assert.match(text, /ai_content_subject_appeal_regeneration_keys/);
        assert.match(text, /ai_content_generation_reference_migration_audits/);
        assert.match(text, /ai_content_wiki_version_snapshots/);
      }
      if (name === "ai-content-evidence-proposal-batch") {
        assert.match(text, /ai_content_proposal_research_snapshots/);
      }
      if (name === "ai-content-evidence-outputs") {
        assert.match(text, /ai_content_output_research_snapshots/);
      }
      if (name === "ai-content-evidence-jobs") {
        assert.match(text, /from jobs/);
        assert.match(text, /ai_content_generation_output_id/);
      }
      if (name === "ai-content-evidence-idempotency") {
        assert.match(text, /ai_content_subject_appeal_regeneration_keys/);
        assert.match(text, /subject_appeal_regeneration_key/);
      }
      if (name === "ai-content-evidence-errors") {
        assert.match(text, /ai_content_subject_analyses/);
        assert.match(text, /subject_analysis/);
      }
      if (name === "ai-content-evidence-attachment-paths") {
        assert.match(text, /ai_content_attachment_upload_sessions/);
        assert.match(text, /ai_content_attachment_deletion_jobs/);
        assert.match(text, /ai_content_attachment_storage_path_guards/);
        assert.match(text, /ai_content_one_time_avatar_receipts/);
        assert.match(text, /ai_content_one_time_avatar_revocations/);
      }
      if (name === "ai-content-evidence-generation" && values[0] === FIRST_ID) {
        return { rows: [{ row_json_text: `{"kind":"generation","record":{"id":"${FIRST_ID}","status":"failed","exact":9007199254740993}}` }] };
      }
      if (name === "ai-content-evidence-migration-version") {
        return { rows: [{ row_json_text: '{"kind":"schema_migration","record":{"id":"074_ai_content_maintenance_write_fence.sql"}}' }] };
      }
      return { rows: [] };
    },
  };

  const bundle = await collectIncidentEvidence(queryable, {
    metadata: {
      release_sha: "893242d9a10b2a0af6b238297c124dcb666caf49",
      release_images: [{ component: "api", digest: `sha256:${"a".repeat(64)}` }],
      incident_log_correlation: {
        [FIRST_ID]: [{ request_id: "request-1" }],
      },
    },
  });

  assert.deepEqual(
    calls.filter(({ name }) => name !== "ai-content-evidence-migration-version")
      .map(({ name, values }) => [name, values]),
    REQUIRED_INCIDENT_GENERATION_IDS.flatMap((generationId) =>
      INCIDENT_QUERY_SECTIONS.map((section) => [`ai-content-evidence-${section.replaceAll("_", "-")}`, [generationId]])),
  );
  assert.equal(calls.filter(({ name }) => name === "ai-content-evidence-migration-version").length, 1);
  assert.deepEqual(bundle.incidents[0].generation.data, {
    encoding: "postgres-jsonb-text.v1",
    json_text: `{"kind":"generation","record":{"id":"${FIRST_ID}","status":"failed","exact":9007199254740993}}`,
  });
  assert.deepEqual(bundle.incidents[0].log_correlation.data, [{ request_id: "request-1" }]);
  assert.equal(bundle.incidents[1].log_correlation.status, "not_found");
  assert.equal(bundle.incidents[1].release_sha.data, "893242d9a10b2a0af6b238297c124dcb666caf49");
  assert.match(bundle.incidents[0].migration_version.data.json_text, /074_ai_content_maintenance_write_fence/);
  assert.match(canonicalJson(bundle), /9007199254740993/);

  await assert.rejects(
    collectIncidentEvidence(queryable, { metadata: { database_url: "forbidden" } }),
    /incident_metadata_key_invalid:database_url/,
  );
  await assert.rejects(
    collectIncidentEvidence(queryable, { metadata: { release_sha: "short" } }),
    /incident_release_sha_invalid/,
  );
  await assert.rejects(
    collectIncidentEvidence(queryable, {
      metadata: { release_images: [{ component: "api", digest: "latest" }] },
    }),
    /incident_release_image_invalid/,
  );
  await assert.rejects(
    collectIncidentEvidence(queryable, {
      metadata: { incident_log_correlation: { [FIRST_ID]: [{ request_id: "r", secret: "x" }] } },
    }),
    /incident_log_correlation_key_invalid:secret/,
  );
});

test("collector snapshots closed metadata before the first await and rejects inherited metadata", async () => {
  let releaseFirstQuery;
  const firstQuery = new Promise((resolve) => { releaseFirstQuery = resolve; });
  let calls = 0;
  const queryable = { async query() {
    calls += 1;
    if (calls === 1) await firstQuery;
    return { rows: [] };
  } };
  const metadata = {
    release_sha: "893242d9a10b2a0af6b238297c124dcb666caf49",
    release_images: [{ component: "api", digest: `sha256:${"a".repeat(64)}` }],
    incident_log_correlation: { [FIRST_ID]: [{ request_id: "original" }] },
  };
  const pending = collectIncidentEvidence(queryable, { metadata });
  metadata.release_sha = "0".repeat(40);
  metadata.release_images[0].digest = `sha256:${"b".repeat(64)}`;
  metadata.incident_log_correlation[FIRST_ID][0].request_id = "mutated";
  releaseFirstQuery();
  const bundle = await pending;
  assert.equal(bundle.incidents[0].release_sha.data, "893242d9a10b2a0af6b238297c124dcb666caf49");
  assert.equal(bundle.incidents[0].release_images.data[0].digest, `sha256:${"a".repeat(64)}`);
  assert.equal(bundle.incidents[0].log_correlation.data[0].request_id, "original");
  await assert.rejects(
    collectIncidentEvidence({ query: async () => ({ rows: [] }) }, {
      metadata: Object.create({ release_sha: "893242d9a10b2a0af6b238297c124dcb666caf49" }),
    }), /incident_metadata_invalid/,
  );
  let getterInvoked = false;
  const accessorMetadata = {};
  Object.defineProperty(accessorMetadata, "release_sha", {
    enumerable: true,
    get() { getterInvoked = true; return "893242d9a10b2a0af6b238297c124dcb666caf49"; },
  });
  await assert.rejects(
    collectIncidentEvidence({ query: async () => ({ rows: [] }) }, { metadata: accessorMetadata }),
    /incident_metadata_invalid/,
  );
  assert.equal(getterInvoked, false);
  const invalidArrays = [];
  const sparse = new Array(1);
  invalidArrays.push(sparse);
  const extra = [{ component: "api", digest: `sha256:${"a".repeat(64)}` }];
  extra.extra = true;
  invalidArrays.push(extra);
  const symbol = [{ component: "api", digest: `sha256:${"a".repeat(64)}` }];
  symbol[Symbol("hidden")] = true;
  invalidArrays.push(symbol);
  const hidden = [{ component: "api", digest: `sha256:${"a".repeat(64)}` }];
  Object.defineProperty(hidden, "hidden", { value: true });
  invalidArrays.push(hidden);
  for (const release_images of invalidArrays) {
    await assert.rejects(
      collectIncidentEvidence({ query: async () => ({ rows: [] }) }, { metadata: { release_images } }),
      /incident_release_image_invalid/,
    );
  }
  let elementGetterReads = 0;
  const imageWithGetter = { digest: `sha256:${"a".repeat(64)}` };
  Object.defineProperty(imageWithGetter, "component", {
    enumerable: true,
    get() { elementGetterReads += 1; return elementGetterReads === 1 ? "api" : "mutated"; },
  });
  await assert.rejects(
    collectIncidentEvidence({ query: async () => ({ rows: [] }) }, {
      metadata: { release_images: [imageWithGetter] },
    }), /incident_release_image_invalid/,
  );
  assert.equal(elementGetterReads, 0);
  const correlationItems = [{ request_id: "r" }];
  correlationItems.extra = "forbidden";
  await assert.rejects(
    collectIncidentEvidence({ query: async () => ({ rows: [] }) }, {
      metadata: { incident_log_correlation: { [FIRST_ID]: correlationItems } },
    }), /incident_log_correlation_invalid/,
  );
});

test("checksummed writer requires an existing restricted directory outside every execution root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ai-content-evidence-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executionRoot = join(root, "execution");
  const outputDirectory = join(root, "operator-evidence");
  await mkdir(executionRoot);
  await mkdir(outputDirectory);
  await chmod(outputDirectory, 0o700);

  const verifyModeRestricted = async ({ directory }) => directory === resolve(outputDirectory);
  const result = await writeChecksummedJson({
    outputDirectory,
    fileName: "incident.json",
    value: { z: 1, a: 2 },
    executionGraphRoots: [executionRoot],
    verifyModeRestricted,
  });
  assert.equal(await readFile(result.jsonPath, "utf8"), '{"a":2,"z":1}\n');
  assert.equal(result.sha256, sha256CanonicalJson({ z: 1, a: 2 }));
  assert.equal(
    await readFile(result.checksumPath, "utf8"),
    `${result.sha256}  incident.json\n`,
  );

  await assert.rejects(
    writeChecksummedJson({
      outputDirectory: join(root, "missing"),
      fileName: "missing.json",
      value: {},
      executionGraphRoots: [executionRoot],
      verifyModeRestricted: async () => true,
    }),
    /output_directory_not_found/,
  );
  if (process.platform === "win32") {
    await assert.rejects(writeChecksummedJson({
      outputDirectory,
      fileName: "windows-acl.json",
      value: {},
      executionGraphRoots: [executionRoot],
    }), /output_directory_acl_verifier_required/);
  }
  await assert.rejects(
    writeChecksummedJson({
      outputDirectory: join(executionRoot, "nested"),
      fileName: "inside.json",
      value: {},
      executionGraphRoots: [executionRoot],
      verifyModeRestricted: async () => true,
    }),
    /output_directory_not_found|output_directory_inside_execution_graph/,
  );
  await assert.rejects(
    writeChecksummedJson({
      outputDirectory,
      fileName: "unrestricted.json",
      value: {},
      executionGraphRoots: [executionRoot],
      verifyModeRestricted: async () => false,
    }),
    /output_directory_not_mode_restricted/,
  );
  await assert.rejects(
    writeChecksummedJson({
      outputDirectory,
      fileName: "..\\escape.json",
      value: {},
      executionGraphRoots: [executionRoot],
      verifyModeRestricted,
    }),
    /output_file_name_invalid/,
  );

  await assert.rejects(
    writeChecksummedJson({
      outputDirectory,
      fileName: "roots-required.json",
      value: {},
      executionGraphRoots: [],
      verifyModeRestricted,
    }),
    /execution_graph_roots_required/,
  );

  assert.equal(dirname(result.jsonPath), resolve(outputDirectory));
  await assert.rejects(
    writeChecksummedJson({
      outputDirectory,
      fileName: "incident.json",
      value: { changed: true },
      executionGraphRoots: [executionRoot],
      verifyModeRestricted,
    }),
    /output_file_exists/,
  );
});

test("checksummed writer cleans its own partial bundle when sidecar reservation fails", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ai-content-evidence-bundle-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executionRoot = join(root, "execution");
  const outputDirectory = join(root, "operator-evidence");
  await mkdir(executionRoot);
  await mkdir(outputDirectory);
  await chmod(outputDirectory, 0o700);
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(join(outputDirectory, "incident.json.sha256"), "operator-owned\n"));

  await assert.rejects(writeChecksummedJson({
    outputDirectory,
    fileName: "incident.json",
    value: { a: 1 },
    executionGraphRoots: [executionRoot],
    verifyModeRestricted: async () => true,
  }), /output_file_exists/);
  await assert.rejects(readFile(join(outputDirectory, "incident.json")), /ENOENT/);
  assert.equal(await readFile(join(outputDirectory, "incident.json.sha256"), "utf8"), "operator-owned\n");
});
