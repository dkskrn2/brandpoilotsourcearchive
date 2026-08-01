import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function runProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("Codex runner semantic retries", () => {
  it("retries registry validation failures before recording stage success", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brand-pilot-runner-retry-"));
    temporaryDirectories.push(root);
    const appData = path.join(root, "appdata");
    const runtimeDirectory = path.join(root, "runtime");
    const fakeCodex = path.join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(fakeCodex, `
const fs = require("node:fs");
process.stdin.resume();
process.stdin.on("end", () => {
  const outputIndex = process.argv.indexOf("--output-last-message");
  fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify({
    stageVersion: "owned-facts.v1",
    output: [{
      id: "fact-1",
      claim: "PRIVATE_CUSTOMER_FACT",
      sourceId: "invented-source",
      segmentId: "segment-1",
      sourceUrl: null,
      quotes: ["PRIVATE_CUSTOMER_FACT"],
      category: "business",
      support: "supported"
    }]
  }));
});
`, "utf8");

    const jobFile = path.join(root, "job.json");
    const outputFile = path.join(root, "output.json");
    const progressFile = path.join(root, "progress.jsonl");
    const errorFile = path.join(root, "terminal-error.json");
    await writeFile(jobFile, JSON.stringify({
      analysisId: "analysis-1",
      brandId: "brand-1",
      companyName: null,
      batches: [{
        batchIndex: 0,
        segments: [{
          id: "segment-1",
          sourceId: "owned-1",
          sourceUrl: null,
          text: "registered text",
        }],
      }],
      sourceRegistry: [{ sourceId: "owned-1", sourceUrl: null }],
    }), "utf8");

    const runner = fileURLToPath(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url));
    const result = await runProcess(process.execPath, [
      runner,
      `--job-file=${jobFile}`,
      `--output-file=${outputFile}`,
      `--runtime-dir=${runtimeDirectory}`,
      `--progress-file=${progressFile}`,
      `--error-file=${errorFile}`,
    ], {
      ...process.env,
      APPDATA: appData,
      BRAND_INTELLIGENCE_CODEX_COMMAND: "codex",
      BRAND_INTELLIGENCE_CODEX_FAST_MODE: "false",
      CODEX_HOME: path.join(root, "codex-home"),
    });

    const progressText = await readFile(progressFile, "utf8");
    const progress = progressText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const terminalError = JSON.parse(await readFile(errorFile, "utf8"));

    expect(result.code).not.toBe(0);
    expect(progress.map(({ status }) => status)).toEqual([
      "running", "failed", "running", "failed", "running", "failed",
    ]);
    expect(progress.filter(({ status }) => status === "failed"))
      .toHaveLength(3);
    expect(progress.filter(({ status }) => status === "failed")
      .every(({ errorCode }) => errorCode === "owned_fact_source_registry_mismatch"))
      .toBe(true);
    expect(terminalError).toEqual({
      kind: "contract",
      errorCode: "owned_fact_source_registry_mismatch",
    });
    expect(progressText).not.toContain("PRIVATE_CUSTOMER_FACT");
    expect(result.stdout).not.toContain("PRIVATE_CUSTOMER_FACT");
    expect(result.stderr).not.toContain("PRIVATE_CUSTOMER_FACT");
  }, 30_000);

  it("preserves malformed JSON as a terminal contract failure after bounded retries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brand-pilot-runner-json-retry-"));
    temporaryDirectories.push(root);
    const appData = path.join(root, "appdata");
    const runtimeDirectory = path.join(root, "runtime");
    const fakeCodex = path.join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(fakeCodex, `
const fs = require("node:fs");
process.stdin.resume();
process.stdin.on("end", () => {
  const outputIndex = process.argv.indexOf("--output-last-message");
  fs.writeFileSync(process.argv[outputIndex + 1], "not JSON PRIVATE_CUSTOMER_FACT");
});
`, "utf8");

    const jobFile = path.join(root, "job.json");
    const outputFile = path.join(root, "output.json");
    const progressFile = path.join(root, "progress.jsonl");
    const errorFile = path.join(root, "terminal-error.json");
    await writeFile(jobFile, JSON.stringify({
      analysisId: "analysis-1",
      brandId: "brand-1",
      companyName: null,
      batches: [{ batchIndex: 0, segments: [] }],
      sourceRegistry: [],
    }), "utf8");

    const runner = fileURLToPath(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url));
    const result = await runProcess(process.execPath, [
      runner,
      `--job-file=${jobFile}`,
      `--output-file=${outputFile}`,
      `--runtime-dir=${runtimeDirectory}`,
      `--progress-file=${progressFile}`,
      `--error-file=${errorFile}`,
    ], {
      ...process.env,
      APPDATA: appData,
      BRAND_INTELLIGENCE_CODEX_COMMAND: "codex",
      BRAND_INTELLIGENCE_CODEX_FAST_MODE: "false",
      CODEX_HOME: path.join(root, "codex-home"),
    });

    const progressText = await readFile(progressFile, "utf8");
    const progress = progressText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const terminalError = JSON.parse(await readFile(errorFile, "utf8"));

    expect(result.code).not.toBe(0);
    expect(progress.filter(({ status }) => status === "failed")).toHaveLength(3);
    expect(progress.filter(({ status }) => status === "failed")
      .every(({ errorCode }) => errorCode === "brand_intelligence_codex_json_invalid"))
      .toBe(true);
    expect(terminalError).toEqual({
      kind: "contract",
      errorCode: "brand_intelligence_codex_json_invalid",
    });
    expect(progressText).not.toContain("PRIVATE_CUSTOMER_FACT");
    expect(result.stdout).not.toContain("PRIVATE_CUSTOMER_FACT");
    expect(result.stderr).not.toContain("PRIVATE_CUSTOMER_FACT");
  }, 30_000);

  it("clears a swallowed optional-stage error before a later operational failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brand-pilot-runner-stale-error-"));
    temporaryDirectories.push(root);
    const appData = path.join(root, "appdata");
    const runtimeDirectory = path.join(root, "runtime");
    const fakeCodex = path.join(
      appData,
      "npm",
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    await mkdir(path.dirname(fakeCodex), { recursive: true });
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(fakeCodex, `
const fs = require("node:fs");
let prompt = "";
process.stdin.on("data", (chunk) => { prompt += String(chunk); });
process.stdin.on("end", () => {
  const outputIndex = process.argv.indexOf("--output-last-message");
  const outputFile = process.argv[outputIndex + 1];
  if (prompt.includes("공개 웹검색")) {
    fs.writeFileSync(outputFile, "not JSON");
    return;
  }
  if (prompt.includes("감사하라")) {
    process.exitCode = 1;
    return;
  }
  if (prompt.includes("대표 상품")) {
    fs.writeFileSync(outputFile, JSON.stringify({
      companyNameSuggestion: null,
      offerings: [],
      faqSuggestions: []
    }));
    return;
  }
  if (prompt.includes("브랜드 코어")) {
    fs.writeFileSync(outputFile, "{}");
    return;
  }
  fs.writeFileSync(outputFile, JSON.stringify({
    stageVersion: "owned-facts.v1",
    output: []
  }));
});
`, "utf8");

    const jobFile = path.join(root, "job.json");
    const outputFile = path.join(root, "output.json");
    const progressFile = path.join(root, "progress.jsonl");
    const errorFile = path.join(root, "terminal-error.json");
    await writeFile(jobFile, JSON.stringify({
      analysisId: "analysis-1",
      brandId: "brand-1",
      companyName: null,
      batches: [{ batchIndex: 0, segments: [] }],
      sourceRegistry: [],
    }), "utf8");

    const runner = fileURLToPath(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url));
    const result = await runProcess(process.execPath, [
      runner,
      `--job-file=${jobFile}`,
      `--output-file=${outputFile}`,
      `--runtime-dir=${runtimeDirectory}`,
      `--progress-file=${progressFile}`,
      `--error-file=${errorFile}`,
    ], {
      ...process.env,
      APPDATA: appData,
      BRAND_INTELLIGENCE_CODEX_COMMAND: "codex",
      BRAND_INTELLIGENCE_CODEX_FAST_MODE: "false",
      CODEX_HOME: path.join(root, "codex-home"),
    });

    const progressText = await readFile(progressFile, "utf8");
    const progress = progressText.trim().split(/\r?\n/).map((line) => JSON.parse(line));

    expect(result.code).not.toBe(0);
    expect(progress.at(-1)).toMatchObject({
      stage: "final_audit",
      status: "failed",
      errorCode: "brand_intelligence_codex_failed",
    });
    expect((await readFile(errorFile, "utf8")).trim()).toBe("");
  }, 30_000);
});
