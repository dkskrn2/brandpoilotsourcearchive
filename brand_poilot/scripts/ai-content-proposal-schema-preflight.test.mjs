import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCutover075PreflightEvidence } from "./migrate.mjs";
import {
  assertProposalSchemaIdentity,
  inspectPreflightState,
  proposalPreflightCommandDescriptor,
  runProposalSchemaPreflight,
  sha256Canonical,
  verifyProposalSchemaPreflight,
} from "./ai-content-proposal-schema-preflight.mjs";

const migrationSha256 = "9".repeat(64);
const cutoverId = "11111111-1111-4111-8111-111111111111";
const proposalSchemaSha256 = "6".repeat(64);
const identity = Object.freeze({
  preflightCandidateSha: "1".repeat(40),
  contentProposalWorkerImageDigest: `sha256:${"2".repeat(64)}`,
  proposalWorkerSourceSha: "3".repeat(40),
  proposalWorkerTreeSha: "4".repeat(40),
  proposalContractSourceSha256: "5".repeat(64),
  proposalSchemaSha256,
  proposalCatalogSha256: "7".repeat(64),
  proposalModelId: "gpt-5.6-terra",
  proposalCommandDescriptorSha256: sha256Canonical(proposalPreflightCommandDescriptor(proposalSchemaSha256)),
  migrationSha256,
});

function proposal(index) {
  return {
    conceptKey: `concept-${index}`, title: `Title ${index}`, informationalType: "how_to",
    oneLineIntent: `Intent ${index}`, differentiator: `Difference ${index}`,
    differentiationAxes: ["narrative"], target: "Reader", customerContext: "Question",
    keyMessage: `Answer ${index}`, hook: `Hook ${index}`, selectionReason: "Useful",
    evidenceIds: [], referenceIds: [], outputFormat: "reel", channelTargets: ["instagram"],
    assetCount: 1, outline: [{ index: 1, role: "scene", headline: "Open", purpose: "Explain" }],
    purposeDetails: { kind: "informational", question: "What?", value: "Answer", whyNow: "Now", learningPoints: ["Point"] },
  };
}

const validOutput = { contractVersion: "content-proposal.v2", proposals: [proposal(1), proposal(2), proposal(3)] };
const schema = JSON.parse(await readFile(new URL(
  "../packages/brand-pilot-content-contracts/generated/content-proposal-v2.schema.json",
  import.meta.url,
), "utf8"));

test("schema preflight binds the exact output-schema bytes before model invocation", () => {
  const schemaText = JSON.stringify(schema);
  const exactSchemaSha256 = createHash("sha256").update(schemaText).digest("hex");
  const exactIdentity = {
    ...identity,
    proposalSchemaSha256: exactSchemaSha256,
    proposalCommandDescriptorSha256: sha256Canonical(proposalPreflightCommandDescriptor(exactSchemaSha256)),
  };
  assert.deepEqual(assertProposalSchemaIdentity(exactIdentity, schemaText), exactIdentity);
  assert.throws(
    () => assertProposalSchemaIdentity(exactIdentity, `${schemaText}\n`),
    /proposal_preflight_schema_identity_mismatch/,
  );
});

async function withState(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "proposal-preflight-"));
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("schema preflight claims before spawn and permits at most one model attempt", async () => {
  await withState(async (stateDirectory) => {
    let calls = 0;
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const spawnEntered = new Promise((resolve) => { entered = resolve; });
    const spawn = async ({ args }) => {
      calls += 1;
      entered();
      assert.deepEqual(args.slice(0, 7), [
        "exec", "--ignore-user-config", "--strict-config", "-m", "gpt-5.6-terra", "--output-schema", "/app/schema.json",
      ]);
      await gate;
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(validOutput) } })}\n`,
        stderr: "",
      };
    };
    const first = runProposalSchemaPreflight({
      stateDirectory, cutoverId, identity, schema, schemaPath: "/app/schema.json", spawn,
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });
    await spawnEntered;
    await assert.rejects(
      runProposalSchemaPreflight({ stateDirectory, cutoverId, identity, schema, schemaPath: "/app/schema.json", spawn }),
      /proposal_preflight_already_claimed/,
    );
    release();
    const transfer = await first;
    assert.equal(calls, 1);
    assert.equal((await inspectPreflightState({ stateDirectory, identity })).status, "passed");
    assert.deepEqual(
      parseCutover075PreflightEvidence(transfer, { cutoverId, migrationSha256 }).proposalPreflightIdentity,
      identity,
    );
    assert.deepEqual(await verifyProposalSchemaPreflight({ stateDirectory, cutoverId, identity }), transfer);
  });
});

test("a failure after invocation start is indeterminate and can never spend a second call", async () => {
  await withState(async (stateDirectory) => {
    let calls = 0;
    const spawn = async () => { calls += 1; throw new Error("child_lost"); };
    await assert.rejects(
      runProposalSchemaPreflight({ stateDirectory, cutoverId, identity, schema, schemaPath: "/schema.json", spawn }),
      /child_lost/,
    );
    assert.equal((await inspectPreflightState({ stateDirectory, identity })).status, "invocation_indeterminate");
    await assert.rejects(
      runProposalSchemaPreflight({ stateDirectory, cutoverId, identity, schema, schemaPath: "/schema.json", spawn }),
      /proposal_preflight_already_claimed/,
    );
    assert.equal(calls, 1);
  });
});

test("a completed non-zero Codex process preserves diagnostics before failing closed", async () => {
  await withState(async (stateDirectory) => {
    await assert.rejects(
      runProposalSchemaPreflight({
        stateDirectory, cutoverId, identity, schema, schemaPath: "/schema.json",
        spawn: async () => ({ exitCode: 17, stdout: "partial-jsonl\n", stderr: "token unavailable\n" }),
      }),
      /proposal_preflight_invocation_failed/,
    );
    assert.equal(await readFile(path.join(stateDirectory, "stdout.jsonl"), "utf8"), "partial-jsonl\n");
    assert.equal(await readFile(path.join(stateDirectory, "stderr.log"), "utf8"), "token unavailable\n");
    const failure = JSON.parse(await readFile(path.join(stateDirectory, "failed.json"), "utf8"));
    assert.equal(failure.event, "invocation_failed");
    assert.equal(failure.exitCode, 17);
    assert.equal(failure.sequence, 3);
    assert.equal((await inspectPreflightState({ stateDirectory, identity })).status, "invocation_indeterminate");
  });
});

test("verification fails closed on identity drift or journal tampering", async () => {
  await withState(async (stateDirectory) => {
    await runProposalSchemaPreflight({
      stateDirectory, cutoverId, identity, schema, schemaPath: "/schema.json",
      spawn: async () => ({ exitCode: 0, stdout: JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(validOutput) } }), stderr: "" }),
    });
    await assert.rejects(
      verifyProposalSchemaPreflight({ stateDirectory, cutoverId, identity: { ...identity, proposalWorkerTreeSha: "a".repeat(40) } }),
      /proposal_preflight_identity_mismatch/,
    );
  });
});
