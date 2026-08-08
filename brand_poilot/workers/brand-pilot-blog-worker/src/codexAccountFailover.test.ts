import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexAccountPool } from "@brand-pilot/worker-runtime";
import { createCommandRunner } from "./worker.js";

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "blog-account-failover-"));
  roots.push(root);
  const accounts = path.join(root, "accounts");
  await mkdir(accounts);
  for (const alias of ["primary", "secondary"]) {
    const home = path.join(accounts, alias);
    await mkdir(home);
    await writeFile(path.join(home, "auth.json"), "{}");
  }
  const attempts = path.join(root, "attempts.jsonl");
  const script = path.join(root, "runner.mjs");
  await writeFile(script, [
    'import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";',
    'import path from "node:path";',
    'const value = (name) => process.argv[process.argv.indexOf(name) + 1];',
    'const job = JSON.parse(await readFile(value("--job"), "utf8"));',
    `await appendFile(${JSON.stringify(attempts)}, JSON.stringify({ home: process.env.CODEX_HOME, prompt: job.prompt }) + "\\n");`,
    'if (!process.env.CODEX_HOME?.endsWith("secondary")) { console.error("You have hit your usage limit"); process.exit(1); }',
    'const output = value("--output");',
    'await mkdir(output, { recursive: true });',
    'await writeFile(path.join(output, "blog-plan.json"), JSON.stringify({ ok: true }));',
  ].join("\n"));
  const skillFile = path.join(root, "SKILL.md");
  await writeFile(skillFile, "test skill");
  return {
    root,
    attempts,
    skillFile,
    pool: await createCodexAccountPool({ root: accounts, aliases: ["primary", "secondary"] }),
    command: `"${process.execPath}" "${script}" --job "{{jobFile}}" --output "{{outputDir}}"`,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("blog Codex account failover", () => {
  it("replays the frozen prompt under secondary after primary usage exhaustion", async () => {
    const test = await fixture();
    const runner = createCommandRunner(test.command, 10_000, {
      accountPool: test.pool,
      generatedImagesDirectory: path.join(test.root, "generated"),
      skillFile: test.skillFile,
    });

    const result = await runner.run({} as never, "frozen blog prompt");
    const attempts = (await readFile(test.attempts, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

    expect(attempts).toEqual([
      { home: test.pool.profiles[0]?.home, prompt: "frozen blog prompt" },
      { home: test.pool.profiles[1]?.home, prompt: "frozen blog prompt" },
    ]);
    expect(result.outputDir).toContain("output-secondary");
    await result.cleanup();
  });
});
