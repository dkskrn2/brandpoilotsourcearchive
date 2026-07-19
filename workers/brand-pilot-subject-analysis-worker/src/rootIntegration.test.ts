import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("subject analysis root integration", () => {
  it("keeps root scripts and local env checks wired", async () => {
    const rootPackage = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(rootPackage.scripts["predev:subject-analysis-worker"]).toContain("--process=subject-analysis-worker");
    expect(rootPackage.scripts["dev:subject-analysis-worker"]).toContain("@brand-pilot/subject-analysis-worker");
    expect(rootPackage.scripts["subject-analysis-worker:once"]).toContain("@brand-pilot/subject-analysis-worker");
    const envCheck = await readFile(path.join(repositoryRoot, "scripts", "check-local-env.mjs"), "utf8");
    expect(envCheck).toContain('"subject-analysis-worker"');
    expect(envCheck).toContain('"SUBJECT_ANALYSIS_CODEX_COMMAND"');
    expect(envCheck).toContain('"WORKER_API_TOKEN"');
  });
});
