import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexAccountPool, type CodexAccountPool } from "@brand-pilot/worker-runtime";
import {
  buildContentProposalCodexChildEnv,
  createCodexContentProposalModel,
} from "./codexModel.js";

type TestChild = EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function child(): TestChild {
  const value = new EventEmitter() as TestChild;
  value.pid = 1234;
  value.stdin = new PassThrough();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.kill = vi.fn();
  return value;
}

function completed(text: string): string {
  return `${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } })}\n`;
}

function runtime() {
  return {
    createRuntimeDirectory: vi.fn(async () => "C:\\temp\\proposal"),
    removeRuntimeDirectory: vi.fn(async () => undefined),
  };
}

const accountRoots: string[] = [];
let testPrimaryHome = "";
let testSecondaryHome = "";

async function testAccountPool(): Promise<CodexAccountPool> {
  const root = await mkdtemp(path.join(tmpdir(), "proposal-accounts-"));
  accountRoots.push(root);
  testPrimaryHome = path.join(root, "primary");
  testSecondaryHome = path.join(root, "secondary");
  for (const home of [testPrimaryHome, testSecondaryHome]) {
    await mkdir(home);
    await writeFile(path.join(home, "auth.json"), "{}", { mode: 0o600 });
  }
  return createCodexAccountPool({ root, aliases: ["primary", "secondary"] });
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(accountRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Proposal V2 Codex model", () => {
  it("always invokes Terra with the canonical output schema and exposes hashes, not raw transcript", async () => {
    const process = child();
    const spawnProcess = vi.fn(() => process);
    const temp = runtime();
    let stdin = "";
    process.stdin.on("data", (chunk) => { stdin += String(chunk); });
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex", timeoutMs: 10_000,
      outputSchemaPath: "C:\\contracts\\content-proposal-v2.schema.json",
      spawnProcess,
      ...temp,
      env: { PATH: "/usr/bin", OPENAI_API_KEY: "secret", DATABASE_URL: "secret" },
    });
    const rawOutput = JSON.stringify({ contractVersion: "content-proposal.v2", proposals: [] });
    const promise = model.generate("frozen prompt");
    await Promise.resolve();
    process.stdout.write(completed(rawOutput));
    process.emit("close", 0, null);
    await expect(promise).resolves.toEqual({
      output: JSON.parse(rawOutput), rawOutput, syntaxValid: true,
      transcriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(stdin).toBe("frozen prompt");
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      "-m", "gpt-5.6-terra", "--output-schema", "C:\\contracts\\content-proposal-v2.schema.json",
    ]));
    expect(spawnProcess.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      env: { PATH: "/usr/bin", CODEX_HOME: testPrimaryHome }, shell: false, windowsHide: true,
    }));
    expect(await promise).not.toHaveProperty("transcript");
  });

  it("adds Codex Fast only for an explicitly fast manual composition", async () => {
    const process = child();
    const spawnProcess = vi.fn(() => process);
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(), command: "codex", timeoutMs: 10_000,
      spawnProcess, ...runtime(),
    });
    const promise = model.generate("prompt", undefined, "fast");
    await Promise.resolve();
    process.stdout.write(completed("{}"));
    process.emit("close", 0, null);
    await promise;
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      "--enable", "fast_mode", "-c", 'service_tier="fast"',
    ]));
  });

  it("returns invalid JSON as a completed parser-invalid output with stable hashes", async () => {
    const process = child();
    const temp = runtime();
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex", timeoutMs: 10_000, spawnProcess: vi.fn(() => process), ...temp,
    });
    const promise = model.generate("prompt");
    await Promise.resolve();
    process.stdout.write(completed("not-json"));
    process.emit("close", 0, null);
    await expect(promise).resolves.toEqual({
      output: null, rawOutput: "not-json", syntaxValid: false,
      transcriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      outputSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("does not rewrite a completed invocation when temporary-directory cleanup fails", async () => {
    const process = child();
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess: vi.fn(() => process),
      createRuntimeDirectory: vi.fn(async () => "C:\\temp\\proposal"),
      removeRuntimeDirectory: vi.fn(async () => { throw new Error("cleanup_failed"); }),
    });
    const promise = model.generate("prompt");
    await Promise.resolve();
    process.stdout.write(completed("{}"));
    process.emit("close", 0, null);
    await expect(promise).resolves.toMatchObject({ output: {}, syntaxValid: true });
  });

  it("classifies a nonzero exit as definite failure and timeout/abort as indeterminate", async () => {
    const failed = child();
    const firstRuntime = runtime();
    const failedPromise = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex", timeoutMs: 10_000, spawnProcess: vi.fn(() => failed), ...firstRuntime,
    }).generate("prompt");
    await Promise.resolve();
    failed.stderr.write("ACCOUNT_SECRET");
    failed.emit("close", 7, null);
    const failedError = await failedPromise.catch((caught: unknown) => caught) as Error;
    expect(failedError).toMatchObject({
      message: "content_proposal_model_process_failed:7",
      outcome: "definite_failure",
    });
    expect(JSON.stringify(failedError)).not.toContain("ACCOUNT_SECRET");
    expect(Object.keys(failedError)).not.toContain("diagnostic");

    vi.useFakeTimers();
    const timedOut = child();
    const terminate = vi.fn(async () => undefined);
    const secondRuntime = runtime();
    const timeoutPromise = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex", timeoutMs: 50, spawnProcess: vi.fn(() => timedOut),
      terminateProcessTree: terminate, ...secondRuntime,
    }).generate("prompt");
    const timeoutAssertion = expect(timeoutPromise).rejects.toMatchObject({ outcome: "indeterminate" });
    await vi.advanceTimersByTimeAsync(50);
    await timeoutAssertion;
    expect(terminate).toHaveBeenCalledWith(timedOut);
  });

  it("hashes the complete received stdout chunk that crosses the byte limit", async () => {
    const process = child();
    const terminate = vi.fn(async () => undefined);
    const temp = runtime();
    const promise = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex", timeoutMs: 10_000, spawnProcess: vi.fn(() => process),
      terminateProcessTree: terminate, ...temp,
    }).generate("prompt");
    const assertion = expect(promise).rejects.toMatchObject({
      outcome: "indeterminate",
      transcriptSha256: createHash("sha256").update(Buffer.alloc(1024 * 1024 + 1, 97)).digest("hex"),
    });
    await Promise.resolve();
    process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 97));
    await assertion;
  });

  it("excludes credentials and proxy secrets from the child environment", () => {
    expect(buildContentProposalCodexChildEnv({
      PATH: "/bin", CODEX_HOME: "/codex", OPENAI_API_KEY: "secret",
      HTTP_PROXY: "proxy", HTTPS_PROXY: "proxy", DATABASE_URL: "secret",
    })).toEqual({ PATH: "/bin", CODEX_HOME: "/codex" });
  });

  it("replays the identical prompt under secondary after primary usage exhaustion", async () => {
    const primary = child();
    const secondary = child();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(secondary);
    let primaryStdin = "";
    let secondaryStdin = "";
    primary.stdin.on("data", (chunk) => { primaryStdin += String(chunk); });
    secondary.stdin.on("data", (chunk) => { secondaryStdin += String(chunk); });
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess,
      ...runtime(),
    });
    const rawOutput = JSON.stringify({ contractVersion: "content-proposal.v2", proposals: [] });

    const promise = model.generate("frozen prompt");
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    primary.stderr.write("You've hit your usage limit");
    primary.emit("close", 1, null);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    secondary.stdout.write(completed(rawOutput));
    secondary.emit("close", 0, null);

    await expect(promise).resolves.toMatchObject({ output: JSON.parse(rawOutput), syntaxValid: true });
    expect(primaryStdin).toBe("frozen prompt");
    expect(secondaryStdin).toBe("frozen prompt");
    expect(spawnProcess.mock.calls.map((call) => call[2]?.env?.CODEX_HOME))
      .toEqual([testPrimaryHome, testSecondaryHome]);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(spawnProcess.mock.calls[1]?.[1]);
  });

  it("does not replay a nonzero child that emitted a final agent message", async () => {
    const process = child();
    const spawnProcess = vi.fn(() => process);
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess,
      ...runtime(),
    });

    const promise = model.generate("prompt");
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    process.stdout.write(completed("{}"));
    process.stderr.write("You've hit your usage limit");
    process.emit("close", 1, null);

    await expect(promise).rejects.toMatchObject({ outcome: "definite_failure" });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("maps two exhausted profiles to codex_accounts_exhausted", async () => {
    const primary = child();
    const secondary = child();
    const spawnProcess = vi.fn()
      .mockReturnValueOnce(primary)
      .mockReturnValueOnce(secondary);
    const model = createCodexContentProposalModel({
      accountPool: await testAccountPool(),
      command: "codex",
      timeoutMs: 10_000,
      spawnProcess,
      ...runtime(),
    });

    const promise = model.generate("prompt");
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1));
    primary.stderr.write("usage limit");
    primary.emit("close", 1, null);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    secondary.stderr.write("usage limit");
    secondary.emit("close", 1, null);

    await expect(promise).rejects.toMatchObject({
      message: "codex_accounts_exhausted",
      outcome: "definite_failure",
    });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });
});
