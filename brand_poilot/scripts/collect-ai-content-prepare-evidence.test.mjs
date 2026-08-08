import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  INCIDENT_OUTPUT_FILE,
  PRESERVED_OUTPUT_FILE,
  collectPrepareEvidenceSnapshot,
  main,
  parseCollectorArguments,
  validateSecureOwnedFileMetadata,
  writePrepareEvidenceArtifacts,
} from "./collect-ai-content-prepare-evidence.mjs";

test("collector argument contract requires file-only admin credentials and fixed output names", () => {
  assert.deepEqual(parseCollectorArguments([
    "node",
    "collector.mjs",
    "--admin-url-file",
    "/run/secrets/admin-database-url",
    "--output-directory",
    "/run/output",
    "--execution-graph-root",
    "/app",
  ]), {
    adminUrlFile: "/run/secrets/admin-database-url",
    outputDirectory: "/run/output",
    executionGraphRoots: ["/app"],
    pageSize: 1000,
  });
  assert.equal(INCIDENT_OUTPUT_FILE, "incident-evidence.json");
  assert.equal(PRESERVED_OUTPUT_FILE, "preserved-data-catalog.json");

  assert.throws(() => parseCollectorArguments([
    "node", "collector.mjs", "--output-directory", "/run/output",
  ]), /collector_required_option_missing:--admin-url-file/);
  assert.throws(() => parseCollectorArguments([
    "node", "collector.mjs",
    "--admin-url-file", "/run/secrets/a",
    "--admin-url-file", "/run/secrets/b",
    "--output-directory", "/run/output",
  ]), /collector_option_duplicate:--admin-url-file/);
  assert.throws(() => parseCollectorArguments([
    "node", "collector.mjs",
    "--admin-url-file", "/run/secrets/a",
    "--output-directory", "/run/output",
    "--page-size", "0",
  ]), /collector_page_size_invalid/);
  assert.throws(() => parseCollectorArguments([
    "node", "collector.mjs",
    "--admin-url-file", "/run/secrets/a",
    "--output-directory", "/run/output",
    "--unknown", "value",
  ]), /collector_option_unknown:--unknown/);
});

test("secure admin credential metadata is owner-only, regular, bounded, and Linux-only", () => {
  const valid = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 1000,
    mode: 0o100600,
    size: 128,
  };
  assert.doesNotThrow(() => validateSecureOwnedFileMetadata(valid, {
    platform: "linux", uid: 1000, maxBytes: 32 * 1024,
  }));
  for (const metadata of [
    { ...valid, uid: 1001 },
    { ...valid, mode: 0o100640 },
    { ...valid, size: 0 },
    { ...valid, size: 32 * 1024 + 1 },
    { ...valid, isFile: () => false },
    { ...valid, isSymbolicLink: () => true },
  ]) {
    assert.throws(() => validateSecureOwnedFileMetadata(metadata, {
      platform: "linux", uid: 1000, maxBytes: 32 * 1024,
    }), /collector_secure_file_invalid/);
  }
  assert.throws(() => validateSecureOwnedFileMetadata(valid, {
    platform: "win32", uid: undefined, maxBytes: 32 * 1024,
  }), /collector_secure_file_platform_unsupported/);
});

test("incident and preserved collectors share one verified repeatable-read read-only transaction", async () => {
  const commands = [];
  const session = { async query(command) {
    commands.push(command);
    if (command.name === "ai-content-prepare-transaction-characteristics") {
      return { rows: [{ read_only: "on", isolation: "repeatable read" }] };
    }
    return { rows: [{ marker: "same-session" }] };
  } };
  const incidentBundle = { schema_version: "incident" };
  const preservedCatalog = { schema_version: "catalog" };

  const result = await collectPrepareEvidenceSnapshot(session, {
    collectIncidentEvidenceImpl: async (queryable, options) => {
      assert.equal(queryable, session);
      assert.deepEqual(options, { metadata: {} });
      const forwarded = await queryable.query({ name: "incident-select", text: "select 1", values: [] });
      assert.equal(forwarded.rows[0].marker, "same-session");
      return incidentBundle;
    },
    collectPreservedDataCatalogImpl: async (queryable, options) => {
      assert.notEqual(queryable, session);
      assert.deepEqual(options, { failOnMissingRelations: true, pageSize: 1000 });
      await queryable.query({
        name: "ai-content-preserved-begin",
        text: "begin transaction isolation level repeatable read read only",
        values: [],
      });
      const forwarded = await queryable.query({ name: "catalog-select", text: "select 2", values: [] });
      assert.equal(forwarded.rows[0].marker, "same-session");
      await queryable.query({ name: "ai-content-preserved-commit", text: "commit", values: [] });
      return preservedCatalog;
    },
  });

  assert.deepEqual(result, { incidentBundle, preservedCatalog });
  assert.deepEqual(commands.map(({ name }) => name), [
    "ai-content-prepare-begin",
    "ai-content-prepare-transaction-characteristics",
    "incident-select",
    "catalog-select",
    "ai-content-prepare-commit",
  ]);
  assert.equal(commands[0].text, "begin transaction isolation level repeatable read read only");
  assert.equal(commands.at(-1).text, "commit");
});

test("collector fails closed and rolls back the outer snapshot when a relation is missing", async () => {
  const commands = [];
  const session = { async query(command) {
    commands.push(command);
    if (command.name === "ai-content-prepare-transaction-characteristics") {
      return { rows: [{ read_only: "on", isolation: "repeatable read" }] };
    }
    return { rows: [] };
  } };
  const missing = new Error("preserved_relation_not_found:brands");
  await assert.rejects(collectPrepareEvidenceSnapshot(session, {
    collectIncidentEvidenceImpl: async () => ({ schema_version: "incident" }),
    collectPreservedDataCatalogImpl: async (queryable, options) => {
      assert.equal(options.failOnMissingRelations, true);
      await queryable.query({
        name: "ai-content-preserved-begin",
        text: "begin transaction isolation level repeatable read read only",
        values: [],
      });
      await queryable.query({ name: "ai-content-preserved-rollback", text: "rollback", values: [] });
      throw missing;
    },
  }), (error) => error === missing);
  assert.deepEqual(commands.map(({ name }) => name), [
    "ai-content-prepare-begin",
    "ai-content-prepare-transaction-characteristics",
    "ai-content-prepare-rollback",
  ]);
});

test("transaction characteristics must be verified before any evidence query", async () => {
  let collectorCalled = false;
  const session = { async query(command) {
    if (command.name === "ai-content-prepare-transaction-characteristics") {
      return { rows: [{ read_only: "off", isolation: "read committed" }] };
    }
    return { rows: [] };
  } };
  await assert.rejects(collectPrepareEvidenceSnapshot(session, {
    collectIncidentEvidenceImpl: async () => { collectorCalled = true; },
  }), /collector_transaction_characteristics_invalid/);
  assert.equal(collectorCalled, false);
});

test("artifact set is canonical, exclusive, mode-600, and removes its first pair when the second conflicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ai-content-prepare-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executionRoot = join(root, "execution");
  const outputDirectory = join(root, "output");
  await mkdir(executionRoot);
  await mkdir(outputDirectory);
  await chmod(outputDirectory, 0o700);
  const verifyModeRestricted = async ({ directory }) => directory.startsWith(resolve(outputDirectory));
  const verifyArtifactFile = async () => true;

  const first = await writePrepareEvidenceArtifacts({
    outputDirectory,
    executionGraphRoots: [executionRoot],
    incidentBundle: { z: 1, a: 2 },
    preservedCatalog: { z: 3, a: 4 },
    verifyModeRestricted,
    verifyArtifactFile,
  });
  assert.equal(await readFile(first.incident.jsonPath, "utf8"), '{"a":2,"z":1}\n');
  assert.equal(await readFile(first.preserved.jsonPath, "utf8"), '{"a":4,"z":3}\n');
  assert.equal((await readdir(outputDirectory)).some((name) => name.startsWith(".prepare-evidence-")), false);
  if (process.platform !== "win32") {
    for (const path of [
      first.incident.jsonPath,
      first.incident.checksumPath,
      first.preserved.jsonPath,
      first.preserved.checksumPath,
    ]) assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }

  const secondOutput = join(root, "second-output");
  await mkdir(secondOutput);
  await chmod(secondOutput, 0o700);
  await writeFile(join(secondOutput, `${PRESERVED_OUTPUT_FILE}.sha256`), "operator-owned\n", { mode: 0o600 });
  await assert.rejects(writePrepareEvidenceArtifacts({
    outputDirectory: secondOutput,
    executionGraphRoots: [executionRoot],
    incidentBundle: { incident: true },
    preservedCatalog: { preserved: true },
    verifyModeRestricted: async ({ directory }) => directory.startsWith(resolve(secondOutput)),
    verifyArtifactFile,
  }), /output_file_exists/);
  await assert.rejects(readFile(join(secondOutput, INCIDENT_OUTPUT_FILE)), /ENOENT/);
  await assert.rejects(readFile(join(secondOutput, `${INCIDENT_OUTPUT_FILE}.sha256`)), /ENOENT/);
  assert.equal(
    await readFile(join(secondOutput, `${PRESERVED_OUTPUT_FILE}.sha256`), "utf8"),
    "operator-owned\n",
  );
});

test("main never accepts inline database URLs and never logs the credential", async () => {
  const secret = "postgresql://admin:super-secret@db.example.test/postgres";
  const logs = [];
  const writes = [];
  const client = { connect: async () => undefined, end: async () => undefined };
  const argv = [
    "node", "collector.mjs",
    "--admin-url-file", "/run/secrets/admin-url",
    "--output-directory", "/run/output",
    "--execution-graph-root", "/app",
  ];
  const result = await main({
    argv,
    env: {},
    readSecureFileImpl: async () => `${secret}\n`,
    createClientImpl: (config) => {
      assert.equal(config.connectionString, secret);
      return client;
    },
    collectPrepareEvidenceSnapshotImpl: async (received) => {
      assert.equal(received, client);
      return {
        incidentBundle: { schema_version: "incident" },
        preservedCatalog: { schema_version: "catalog" },
      };
    },
    writePrepareEvidenceArtifactsImpl: async (input) => {
      writes.push(input);
      return {
        incident: { sha256: "a".repeat(64), bytes: 10 },
        preserved: { sha256: "b".repeat(64), bytes: 20 },
      };
    },
    logger: { log(value) { logs.push(value); } },
  });
  assert.equal(writes.length, 1);
  assert.deepEqual(result, {
    contractVersion: "ai-content-prepare-evidence-collection.v1",
    incidentFile: INCIDENT_OUTPUT_FILE,
    incidentSha256: "a".repeat(64),
    preservedFile: PRESERVED_OUTPUT_FILE,
    preservedSha256: "b".repeat(64),
  });
  assert.equal(JSON.stringify({ logs, result }).includes("super-secret"), false);

  await assert.rejects(main({
    argv,
    env: { DATABASE_URL: secret },
    readSecureFileImpl: async () => { throw new Error("must_not_read"); },
  }), /collector_inline_database_url_forbidden/);
});
