import assert from "node:assert/strict";
import test from "node:test";
import {
  contentOrchestrationPostgresTestFiles,
  runContentOrchestrationPostgresTests,
} from "./run-content-orchestration-postgres-tests.mjs";

test("the content-only PostgreSQL runner owns an explicit Proposal V2 registry", () => {
  assert.deepEqual(contentOrchestrationPostgresTestFiles, [
    "src/contentOrchestrationRepository.postgres.integration.test.ts",
    "src/aiContentProposalV2Repository.postgres.integration.test.ts",
  ]);
  assert.equal(Object.isFrozen(contentOrchestrationPostgresTestFiles), true);
});

test("the runner passes only registered content tests to single-worker Vitest", () => {
  let invocation;
  const status = runContentOrchestrationPostgresTests({
    nodeExecutable: "node-under-test",
    spawn(executable, args, options) {
      invocation = { executable, args, options };
      return { status: 0, error: undefined };
    },
  });

  assert.equal(status, 0);
  assert.equal(invocation.executable, "node-under-test");
  assert.deepEqual(invocation.args.slice(1), [
    "run",
    "--maxWorkers=1",
    ...contentOrchestrationPostgresTestFiles,
  ]);
  assert.match(invocation.args[0], /vitest[\\/]vitest\.mjs$/);
  assert.match(invocation.options.cwd, /apps[\\/]api[\\/]?$/);
  assert.equal(invocation.options.env.RUN_POSTGRES_INTEGRATION, "true");
  assert.equal(invocation.options.stdio, "inherit");
});

test("the runner propagates spawn failures and nonzero status", () => {
  assert.throws(
    () => runContentOrchestrationPostgresTests({
      spawn: () => ({ status: null, error: new Error("spawn failed") }),
    }),
    /spawn failed/,
  );
  assert.equal(runContentOrchestrationPostgresTests({
    spawn: () => ({ status: 7, error: undefined }),
  }), 7);
});
