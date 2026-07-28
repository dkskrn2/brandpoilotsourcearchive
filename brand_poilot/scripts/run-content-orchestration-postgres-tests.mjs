import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const apiDirectory = fileURLToPath(new URL("../apps/api/", import.meta.url));
const vitestEntry = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const result = spawnSync(
  process.execPath,
  [
    vitestEntry,
    "run",
    "--maxWorkers=1",
    "src/contentOrchestrationRepository.postgres.integration.test.ts",
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
process.exitCode = result.status ?? 1;
