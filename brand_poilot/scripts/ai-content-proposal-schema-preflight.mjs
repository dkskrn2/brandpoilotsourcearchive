import { spawn as spawnChild } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseContentProposalSetV2 } from "@brand-pilot/content-contracts";

const MODEL_ID = "gpt-5.6-terra";
const JOURNAL_VERSION = "proposal-schema-preflight-journal.v1";
const identityKeys = Object.freeze([
  "preflightCandidateSha", "contentProposalWorkerImageDigest", "proposalWorkerSourceSha",
  "proposalWorkerTreeSha", "proposalContractSourceSha256", "proposalSchemaSha256",
  "proposalCatalogSha256", "proposalModelId", "proposalCommandDescriptorSha256", "migrationSha256",
]);
const journalFiles = Object.freeze([
  "claim.json", "started.json", "completed.json", "evidence.json", "phase5-transfer.json",
]);

function plainRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (plainRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function proposalPreflightCommandDescriptor(proposalSchemaSha256) {
  return Object.freeze({
    runner: "codex-exec",
    modelId: MODEL_ID,
    promptVersion: "proposal.writer.v2",
    outputSchemaSha256: proposalSchemaSha256,
    proposalContractVersion: "content-proposal.v2",
    baseInputContractVersion: "proposal-base-input.v2",
  });
}

function validateIdentity(value) {
  if (!plainRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...identityKeys].sort())
    || !/^[0-9a-f]{40}$/.test(value.preflightCandidateSha)
    || !/^sha256:[0-9a-f]{64}$/.test(value.contentProposalWorkerImageDigest)
    || !/^[0-9a-f]{40}$/.test(value.proposalWorkerSourceSha)
    || !/^[0-9a-f]{40}$/.test(value.proposalWorkerTreeSha)
    || !identityKeys.filter((key) => key.endsWith("Sha256")).every((key) => /^[0-9a-f]{64}$/.test(value[key]))
    || value.proposalModelId !== MODEL_ID
    || value.proposalCommandDescriptorSha256 !== sha256Canonical(
      proposalPreflightCommandDescriptor(value.proposalSchemaSha256),
    )) {
    throw new Error("proposal_preflight_identity_invalid");
  }
  return Object.freeze(structuredClone(value));
}

export function assertProposalSchemaIdentity(identity, schemaText) {
  const validIdentity = validateIdentity(identity);
  if (typeof schemaText !== "string"
    || createHash("sha256").update(schemaText).digest("hex") !== validIdentity.proposalSchemaSha256) {
    throw new Error("proposal_preflight_schema_identity_mismatch");
  }
  return validIdentity;
}

async function assertPrivateDirectory(directory) {
  const resolved = await realpath(directory);
  const metadata = await stat(resolved);
  if (!metadata.isDirectory() || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)) {
    throw new Error("proposal_preflight_state_directory_insecure");
  }
  return resolved;
}

async function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const handle = await open(directory, fsConstants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusiveJson(directory, fileName, value) {
  const handle = await open(path.join(directory, fileName), "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await fsyncDirectory(directory);
  return sha256Canonical(value);
}

async function writeExclusiveText(directory, fileName, value) {
  const handle = await open(path.join(directory, fileName), "wx", 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await fsyncDirectory(directory);
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(directory, fileName) {
  try { return JSON.parse(await readFile(path.join(directory, fileName), "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error(`proposal_preflight_journal_invalid:${fileName}`);
  }
}

function journalRecord({ event, sequence, previousSha256, identitySha256, cutoverId, createdAt, ...rest }) {
  return Object.freeze({
    contractVersion: JOURNAL_VERSION, event, sequence, previousSha256,
    identitySha256, cutoverId, createdAt, ...rest,
  });
}

function assertJournal(record, expected, identitySha256, cutoverId) {
  if (!plainRecord(record) || record.contractVersion !== JOURNAL_VERSION
    || record.event !== expected.event || record.sequence !== expected.sequence
    || record.previousSha256 !== expected.previousSha256
    || record.identitySha256 !== identitySha256 || record.cutoverId !== cutoverId) {
    throw new Error("proposal_preflight_journal_corrupt");
  }
}

function finalAgentMessage(stdout) {
  let finalMessage;
  for (const line of String(stdout).split(/\r?\n/).filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    if (item?.type === "item.completed" && item?.item?.type === "agent_message"
      && typeof item.item.text === "string") finalMessage = item.item.text;
  }
  if (!finalMessage) throw new Error("proposal_preflight_output_missing");
  return finalMessage;
}

function codexArguments(schemaPath) {
  return [
    "exec", "--ignore-user-config", "--strict-config", "-m", MODEL_ID,
    "--output-schema", schemaPath,
    "-c", "default_permissions=\"worker\"",
    "-c", "permissions.worker.filesystem={\":minimal\"=\"deny\",\"/codex\"=\"deny\",\":workspace_roots\"={\".\"=\"deny\"}}",
    "-c", "permissions.worker.network.enabled=false",
    "--disable", "shell_tool", "--disable", "shell_snapshot", "--disable", "image_generation",
    "--skip-git-repo-check", "--ephemeral", "--json", "-C", process.cwd(), "-",
  ];
}

async function defaultSpawn({ command, args, prompt }) {
  return await new Promise((resolve, reject) => {
    const child = spawnChild(command, args, {
      cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: Object.fromEntries(["PATH", "CODEX_HOME"].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; if (stdout.length > 4_000_000) child.kill(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (stderr.length > 200_000) child.kill(); });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(prompt);
  });
}

export async function inspectPreflightState({ stateDirectory, identity, cutoverId }) {
  const directory = await assertPrivateDirectory(stateDirectory);
  const validIdentity = validateIdentity(identity);
  const identitySha256 = sha256Canonical(validIdentity);
  const [claim, started, completed, evidence, transfer] = await Promise.all(
    journalFiles.map((fileName) => readJson(directory, fileName)),
  );
  if (!claim) {
    if ([started, completed, evidence, transfer].some(Boolean)) return { status: "corrupt" };
    return { status: "unclaimed" };
  }
  const exactCutoverId = cutoverId ?? claim.cutoverId;
  try {
    assertJournal(claim, { event: "claimed", sequence: 1, previousSha256: null }, identitySha256, exactCutoverId);
    const claimSha256 = sha256Canonical(claim);
    if (!started) return { status: "claimed_incomplete", identitySha256, cutoverId: exactCutoverId };
    assertJournal(started, { event: "invocation_started", sequence: 2, previousSha256: claimSha256 }, identitySha256, exactCutoverId);
    const startedSha256 = sha256Canonical(started);
    if (!completed) return { status: "invocation_indeterminate", identitySha256, cutoverId: exactCutoverId };
    assertJournal(completed, { event: "invocation_completed", sequence: 3, previousSha256: startedSha256 }, identitySha256, exactCutoverId);
    const completedSha256 = sha256Canonical(completed);
    if (!evidence) return { status: "completed_unsealed", identitySha256, cutoverId: exactCutoverId };
    assertJournal(evidence, { event: "passed", sequence: 4, previousSha256: completedSha256 }, identitySha256, exactCutoverId);
    if (!transfer || transfer.contractVersion !== "ai-content-075-proposal-preflight-evidence.v1"
      || transfer.cutoverId !== exactCutoverId
      || canonicalJson(transfer.proposalPreflightIdentity) !== canonicalJson(validIdentity)
      || transfer.proposalPreflightIdentitySha256 !== identitySha256
      || !/^[0-9a-f]{64}$/.test(transfer.proposalPreflightTransferSha256)) return { status: "corrupt" };
    return { status: "passed", identitySha256, cutoverId: exactCutoverId, transfer };
  } catch {
    return { status: "corrupt" };
  }
}

export async function runProposalSchemaPreflight({
  stateDirectory, cutoverId, identity, schema, schemaPath,
  command = "codex", spawn = defaultSpawn, now = () => new Date(),
}) {
  const directory = await assertPrivateDirectory(stateDirectory);
  const validIdentity = validateIdentity(identity);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cutoverId)
    || !plainRecord(schema) || typeof schemaPath !== "string" || !schemaPath) {
    throw new Error("proposal_preflight_input_invalid");
  }
  const identitySha256 = sha256Canonical(validIdentity);
  const createdAt = now().toISOString();
  const claim = journalRecord({ event: "claimed", sequence: 1, previousSha256: null, identitySha256, cutoverId, createdAt });
  let claimSha256;
  try { claimSha256 = await writeExclusiveJson(directory, "claim.json", claim); }
  catch (error) {
    if (error?.code === "EEXIST") throw new Error("proposal_preflight_already_claimed");
    throw error;
  }
  const args = codexArguments(schemaPath);
  const started = journalRecord({
    event: "invocation_started", sequence: 2, previousSha256: claimSha256,
    identitySha256, cutoverId, createdAt: now().toISOString(), command: "codex", callOrdinal: 1,
  });
  const startedSha256 = await writeExclusiveJson(directory, "started.json", started);
  const prompt = [
    "This is a schema-only provider preflight. Return one synthetic content-proposal.v2 JSON object",
    "with exactly three structurally distinct informational reel proposals. Use no tools, network, or real customer data.",
    "Return JSON only and conform exactly to the provided output schema.",
  ].join(" ");
  const result = await spawn({ command, args, prompt });
  if (!plainRecord(result) || result.exitCode !== 0 || typeof result.stdout !== "string" || typeof result.stderr !== "string") {
    throw new Error("proposal_preflight_invocation_failed");
  }
  const stdoutSha256 = await writeExclusiveText(directory, "stdout.jsonl", result.stdout);
  const stderrSha256 = await writeExclusiveText(directory, "stderr.log", result.stderr);
  const rawOutput = finalAgentMessage(result.stdout);
  let output;
  try { output = JSON.parse(rawOutput); } catch { throw new Error("proposal_preflight_output_invalid"); }
  try { output = parseContentProposalSetV2(output); }
  catch { throw new Error("proposal_preflight_output_invalid"); }
  if (output.contractVersion !== "content-proposal.v2" || output.proposals.length !== 3) {
    throw new Error("proposal_preflight_output_invalid");
  }
  const outputSha256 = createHash("sha256").update(rawOutput).digest("hex");
  const completed = journalRecord({
    event: "invocation_completed", sequence: 3, previousSha256: startedSha256,
    identitySha256, cutoverId, createdAt: now().toISOString(), callCount: 1,
    stdoutSha256, stderrSha256, outputSha256,
    projection: { contractVersion: "content-proposal.v2", proposalCount: 3, parser: "passed" },
  });
  const completedSha256 = await writeExclusiveJson(directory, "completed.json", completed);
  const evidence = journalRecord({
    event: "passed", sequence: 4, previousSha256: completedSha256,
    identitySha256, cutoverId, createdAt: now().toISOString(), callCount: 1,
    completedSha256, outputSha256,
  });
  const evidenceSha256 = await writeExclusiveJson(directory, "evidence.json", evidence);
  const transferPayload = { identitySha256, completedSha256, evidenceSha256, callCount: 1 };
  const transfer = {
    contractVersion: "ai-content-075-proposal-preflight-evidence.v1",
    cutoverId,
    proposalPreflightIdentity: validIdentity,
    proposalPreflightIdentitySha256: identitySha256,
    proposalPreflightTransferSha256: sha256Canonical(transferPayload),
  };
  await writeExclusiveJson(directory, "phase5-transfer.json", transfer);
  return transfer;
}

export async function verifyProposalSchemaPreflight({ stateDirectory, cutoverId, identity }) {
  const state = await inspectPreflightState({ stateDirectory, cutoverId, identity });
  if (state.status !== "passed") {
    if (state.status === "corrupt") throw new Error("proposal_preflight_identity_mismatch");
    throw new Error(`proposal_preflight_not_passed:${state.status}`);
  }
  return state.transfer;
}

function parseCli(argv) {
  const mode = argv[2];
  const values = {};
  for (let index = 3; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("proposal_preflight_cli_invalid");
    values[argv[index].slice(2)] = argv[index + 1];
  }
  if (!["--execute-once", "--verify-evidence"].includes(mode)) throw new Error("proposal_preflight_cli_invalid");
  return { mode, values };
}

async function main(argv = process.argv) {
  const { mode, values } = parseCli(argv);
  const identity = JSON.parse(await readFile(values["identity-file"], "utf8"));
  if (mode === "--verify-evidence") {
    process.stdout.write(`${canonicalJson(await verifyProposalSchemaPreflight({
      stateDirectory: values["state-dir"], cutoverId: values["cutover-id"], identity,
    }))}\n`);
    return;
  }
  const schemaText = await readFile(values["schema-file"], "utf8");
  assertProposalSchemaIdentity(identity, schemaText);
  const schema = JSON.parse(schemaText);
  process.stdout.write(`${canonicalJson(await runProposalSchemaPreflight({
    stateDirectory: values["state-dir"], cutoverId: values["cutover-id"], identity,
    schema, schemaPath: values["schema-file"], command: values.command ?? "codex",
  }))}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "proposal_preflight_failed"}\n`);
    process.exitCode = 1;
  });
}
