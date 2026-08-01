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

  it("drops quote-mismatched facts without spending a retry or registering their IDs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "brand-pilot-runner-quote-filter-"));
    temporaryDirectories.push(root);
    const appData = path.join(root, "appdata");
    const runtimeDirectory = path.join(root, "runtime");
    const callsFile = path.join(root, "calls.txt");
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
    await writeFile(fakeCodex, [
      'const fs = require("node:fs");',
      "const callsFile = " + JSON.stringify(callsFile) + ";",
      'let prompt = "";',
      'process.stdin.on("data", (chunk) => { prompt += String(chunk); });',
      'process.stdin.on("end", () => {',
      '  const outputIndex = process.argv.indexOf("--output-last-message");',
      '  const outputFile = process.argv[outputIndex + 1];',
      '  const write = (value) => fs.writeFileSync(outputFile, JSON.stringify(value));',
      '  fs.appendFileSync(callsFile, "call\\n");',
      '  if (prompt.includes("오직 제공된 텍스트")) {',
      '    const output = prompt.includes("segment-1") ? [{',
      '      id: "fact-mismatch",',
      '      claim: "PRIVATE_DROPPED_FACT",',
      '      sourceId: "owned-1",',
      '      segmentId: "segment-1",',
      '      sourceUrl: null,',
      '      quotes: ["PRIVATE_INVENTED_QUOTE"],',
      '      category: "business",',
      '      support: "supported"',
      '    }] : [];',
      '    write({ stageVersion: "owned-facts.v1", output });',
      '    return;',
      '  }',
      '  if (prompt.includes("대표 상품")) {',
      '    write({ companyNameSuggestion: null, offerings: [], faqSuggestions: [] });',
      '    return;',
      '  }',
      '  if (prompt.includes("브랜드 코어")) {',
      '    write({ oneLineDefinition: "PRIVATE_UNGROUNDED_CORE" });',
      '    return;',
      '  }',
      '  if (prompt.includes("공개 웹검색")) {',
      '    write({ competitors: [], marketContext: [], evidence: [] });',
      '    return;',
      '  }',
      '  if (prompt.includes("감사하라")) {',
      '    const payload = JSON.parse(prompt.trim().split(/\\r?\\n/).at(-1));',
      '    write({',
      '      ...payload.candidate,',
      '      oneLineDefinition: "PRIVATE_FINAL_CORE",',
      '      companyOverview: "PRIVATE_FINAL_CORE",',
      '      businessDescription: "PRIVATE_FINAL_CORE",',
      '      primaryCategory: { code: null, name: "PRIVATE_FINAL_CORE" },',
      '      subcategories: [{ code: null, name: "PRIVATE_FINAL_CORE" }],',
      '      primaryTarget: "PRIVATE_FINAL_CORE",',
      '      secondaryTargets: ["PRIVATE_FINAL_CORE"],',
      '      customerNeeds: ["PRIVATE_FINAL_CORE"],',
      '      valueProposition: "PRIVATE_FINAL_CORE",',
      '      differentiators: ["PRIVATE_FINAL_CORE"],',
      '      coreAppeal: "PRIVATE_FINAL_CORE",',
      '      supportingAppeals: ["PRIVATE_FINAL_CORE"],',
      '      keywords: ["PRIVATE_FINAL_CORE"],',
      '      observedTone: { summary: "PRIVATE_FINAL_CORE", sourceFactIds: [] }',
      '    });',
      '    return;',
      '  }',
      '  process.exitCode = 2;',
      '});',
    ].join("\n"), "utf8");

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
      sourceRegistry: [{ sourceId: "owned-1", sourceUrl: null, sourceKind: "upload" }],
    }), "utf8");

    const runner = fileURLToPath(new URL("../scripts/run-codex-brand-intelligence.mjs", import.meta.url));
    const result = await runProcess(process.execPath, [
      runner,
      "--job-file=" + jobFile,
      "--output-file=" + outputFile,
      "--runtime-dir=" + runtimeDirectory,
      "--progress-file=" + progressFile,
      "--error-file=" + errorFile,
    ], {
      ...process.env,
      APPDATA: appData,
      BRAND_INTELLIGENCE_CODEX_COMMAND: "codex",
      BRAND_INTELLIGENCE_CODEX_FAST_MODE: "false",
      CODEX_HOME: path.join(root, "codex-home"),
    });

    const calls = (await readFile(callsFile, "utf8")).trim().split(/\r?\n/);
    const progressText = await readFile(progressFile, "utf8");
    const progress = progressText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    const output = JSON.parse(await readFile(outputFile, "utf8"));

    expect(result.code).toBe(0);
    expect(calls).toHaveLength(8);
    expect(progress.filter(({ status }) => status === "failed")).toEqual([]);
    expect(progress.filter(({ status }) => status === "succeeded")).toHaveLength(8);
    expect(output.registry.ownedFactIds).toEqual([]);
    expect(output.result.evidence).toEqual([]);
    expect(output.result.sourceGaps).toEqual([
      "직접 인용과 일치하지 않은 자사 사실 1건을 제외함",
      "검증 가능한 자사 사실을 확인하지 못함",
    ]);
    expect(output.result).toMatchObject({
      oneLineDefinition: null,
      companyOverview: null,
      businessDescription: null,
      primaryCategory: null,
      subcategories: [],
      primaryTarget: null,
      secondaryTargets: [],
      customerNeeds: [],
      valueProposition: null,
      differentiators: [],
      coreAppeal: null,
      supportingAppeals: [],
      keywords: [],
      observedTone: null,
    });
    expect(JSON.stringify(output)).not.toContain("fact-mismatch");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_DROPPED_FACT");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_INVENTED_QUOTE");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_UNGROUNDED_CORE");
    expect(JSON.stringify(output)).not.toContain("PRIVATE_FINAL_CORE");
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
