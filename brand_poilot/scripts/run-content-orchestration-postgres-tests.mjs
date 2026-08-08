import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const apiDirectory = fileURLToPath(new URL("../apps/api/", import.meta.url));
const vitestEntry = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

export const contentOrchestrationPostgresTestFiles = Object.freeze([
  "src/contentOrchestrationRepository.postgres.integration.test.ts",
  "src/aiContentProposalV2Repository.postgres.integration.test.ts",
]);

export function runContentOrchestrationPostgresTests({
  spawn = spawnSync,
  nodeExecutable = process.execPath,
} = {}) {
  const result = spawn(
    nodeExecutable,
    [
      vitestEntry,
      "run",
      "--maxWorkers=1",
      ...contentOrchestrationPostgresTestFiles,
    ],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        RUN_POSTGRES_INTEGRATION: "true",
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runContentOrchestrationPostgresTests();
}
