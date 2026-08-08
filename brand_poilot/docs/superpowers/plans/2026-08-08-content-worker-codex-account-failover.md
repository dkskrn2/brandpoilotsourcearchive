# Content Worker Codex Account Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically move one safe manual-content Codex invocation from the exhausted `primary` profile to the authenticated `secondary` profile without duplicating an application job or affecting unrelated workers.

**Architecture:** A persistent account-pool object in each of the five content worker processes validates two isolated Codex homes, remembers per-profile cooldowns, and wraps the existing Codex child boundary. Callers report bounded diagnostics and whether a final output was accepted; the pool retries only a proven usage-exhaustion failure with no accepted output. Production Compose mounts the account parent into the five approved services while legacy/unrelated Codex paths continue to use the primary profile.

**Tech Stack:** Node.js 22, TypeScript, ESM, Vitest, Docker Compose, Bash deployment preflight, Codex CLI 0.145.0.

---

## File map

- Create `workers/brand-pilot-worker-runtime/src/codexAccountPool.ts`: profile validation, cooldowns, usage-exhaustion classification, and generic failover orchestration.
- Create `workers/brand-pilot-worker-runtime/src/codexAccountPool.test.ts`: deterministic account-pool unit tests.
- Modify `workers/brand-pilot-worker-runtime/src/index.ts`: export the account-pool API and allow the existing bounded command runner to capture a diagnostic when explicitly requested.
- Modify `workers/brand-pilot-worker-runtime/src/index.test.ts`: protect existing command-runner behavior and its opt-in diagnostic capture.
- Modify `workers/brand-pilot-content-proposal-worker/src/main.ts`, `codexModel.ts`, and `codexModel.test.ts`: share one pool for the persistent proposal worker and fail over inside a single invocation ordinal.
- Modify the card-news, blog, and reel `src/index.ts`, `src/worker.ts`, and plan scripts: share one persistent pool, select the child Codex home, and clear only attempt-local output before a safe replay.
- Modify `workers/brand-pilot-blog-worker/src/research.ts` and `research.test.ts`: route the blog research-assessment Codex call through the same pool.
- Modify `workers/brand-pilot-image-worker/src/index.ts`, `aiContentAssetRenderer.ts`, and `aiContentAssetRenderer.test.ts`: fail over only the V3 manual-content asset child; leave legacy image/text jobs on primary.
- Modify the five worker Dockerfiles and their Codex permission arguments: use `/codex-accounts/primary` as the legacy default and deny the entire `/codex-accounts` tree to model tools.
- Modify `deploy/compose.production.yml`, `deploy/scripts/preflight.sh`, `deploy/scripts/preflight-ai-content.sh`, `deploy/env/*.env.example`, deployment contract tests, and `docs/operations/UBUNTU_DEPLOYMENT.md`: provision and validate both profiles without exposing credentials.
- Do not modify existing dirty customer UI E2E files, blog/marketing schema files, or marketing-worker tests.

### Task 1: Build the shared account-pool state machine

**Files:**
- Create: `workers/brand-pilot-worker-runtime/src/codexAccountPool.test.ts`
- Create: `workers/brand-pilot-worker-runtime/src/codexAccountPool.ts`
- Modify: `workers/brand-pilot-worker-runtime/src/index.ts`

- [ ] **Step 1: Write the failing profile and classifier tests**

Create tests using real temporary directories and regular `auth.json` files. The public API is fixed as:

```ts
const pool = await createCodexAccountPool({
  root,
  aliases: ["primary", "secondary"],
  now: () => clock,
});

const result = await pool.run(async (profile) =>
  profile.alias === "primary"
    ? failure(new Error("exit 1"), "You've hit your usage limit. Try again after 2026-08-10T14:20:00Z", false)
    : success("secondary-result"),
);

expect(result).toEqual({
  profile: { alias: "secondary", home: path.join(root, "secondary") },
  value: "secondary-result",
});
```

Use this concrete fixture and assertions:

```ts
const roots: string[] = [];
async function accountRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-account-pool-"));
  roots.push(root);
  for (const alias of ["primary", "secondary"]) {
    await mkdir(path.join(root, alias));
    await writeFile(path.join(root, alias, "auth.json"), "{}", { mode: 0o600 });
  }
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, { recursive: true, force: true }))));

it("selects primary first", async () => {
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"] });
  const attempted: string[] = [];
  const result = await pool.run(async (profile) => {
    attempted.push(profile.alias);
    return success("ok");
  });
  expect(attempted).toEqual(["primary"]);
  expect(result.profile.alias).toBe("primary");
});

it("fails over once after usage exhaustion without accepted output", async () => {
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"] });
  const attempted: string[] = [];
  await expect(pool.run(async (profile) => {
    attempted.push(profile.alias);
    return profile.alias === "primary"
      ? failure(new Error("primary failed"), "You've hit your usage limit", false)
      : success("ok");
  })).resolves.toMatchObject({ profile: { alias: "secondary" }, value: "ok" });
  expect(attempted).toEqual(["primary", "secondary"]);
});

it("does not fail over after an accepted final output", async () => {
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"] });
  const attempted: string[] = [];
  const original = new Error("primary failed after output");
  await expect(pool.run(async (profile) => {
    attempted.push(profile.alias);
    return failure(original, "You've hit your usage limit", true);
  })).rejects.toBe(original);
  expect(attempted).toEqual(["primary"]);
});

it.each(["rate limit", "spawn failed", "timeout", "schema invalid"])(
  "does not fail over for %s",
  async (diagnostic) => {
    const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"] });
    const attempted: string[] = [];
    await expect(pool.run(async (profile) => {
      attempted.push(profile.alias);
      return failure(new Error(diagnostic), diagnostic, false);
    })).rejects.toThrow(diagnostic);
    expect(attempted).toEqual(["primary"]);
  },
);

it("uses reset time plus five minutes as cooldown", async () => {
  let clock = Date.parse("2026-08-08T00:00:00Z");
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"], now: () => clock });
  const attempted: string[] = [];
  const execute = () => pool.run(async (profile) => {
    attempted.push(profile.alias);
    return profile.alias === "primary"
      ? failure(new Error("limit"), "usage limit; try again after 2026-08-08T01:00:00Z", false)
      : success("ok");
  });
  await execute();
  attempted.length = 0;
  clock = Date.parse("2026-08-08T01:04:59Z");
  await execute();
  expect(attempted).toEqual(["secondary"]);
  attempted.length = 0;
  clock = Date.parse("2026-08-08T01:05:00Z");
  await execute();
  expect(attempted).toEqual(["primary", "secondary"]);
});

it("uses one hour when reset time is absent", async () => {
  let clock = 10_000;
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"], now: () => clock });
  const attempted: string[] = [];
  const execute = () => pool.run(async (profile) => {
    attempted.push(profile.alias);
    return profile.alias === "primary"
      ? failure(new Error("limit"), "usage limit", false)
      : success("ok");
  });
  await execute();
  attempted.length = 0;
  clock += 3_599_999;
  await execute();
  expect(attempted).toEqual(["secondary"]);
  attempted.length = 0;
  clock += 1;
  await execute();
  expect(attempted).toEqual(["primary", "secondary"]);
});

it("returns codex_accounts_exhausted after both profiles exhaust", async () => {
  const pool = await createCodexAccountPool({ root: await accountRoot(), aliases: ["primary", "secondary"] });
  const attempted: string[] = [];
  await expect(pool.run(async (profile) => {
    attempted.push(profile.alias);
    return failure(new Error("limit"), "usage limit", false);
  })).rejects.toThrow("codex_accounts_exhausted");
  expect(attempted).toEqual(["primary", "secondary"]);
});

it.each(["../secondary", "PRIMARY", "primary/child", ""])(
  "rejects invalid alias %s",
  async (alias) => {
    await expect(createCodexAccountPool({
      root: await accountRoot(), aliases: ["primary", alias],
    })).rejects.toThrow("codex_account_profile_invalid");
  },
);

it("rejects duplicate aliases", async () => {
  await expect(createCodexAccountPool({
    root: await accountRoot(), aliases: ["primary", "primary"],
  })).rejects.toThrow("codex_account_profile_duplicate");
});

it("rejects a symlinked profile", async () => {
  const root = await accountRoot();
  const external = await mkdtemp(path.join(tmpdir(), "codex-account-external-"));
  roots.push(external);
  await writeFile(path.join(external, "auth.json"), "{}", { mode: 0o600 });
  await rm(path.join(root, "secondary"), { recursive: true });
  await symlink(external, path.join(root, "secondary"), process.platform === "win32" ? "junction" : "dir");
  await expect(createCodexAccountPool({
    root, aliases: ["primary", "secondary"],
  })).rejects.toThrow("codex_account_profile_symlink_forbidden");
});
```

- [ ] **Step 2: Run the new test to verify RED**

Run:

```powershell
npm test --workspace @brand-pilot/worker-runtime -- src/codexAccountPool.test.ts
```

Expected: FAIL because `./codexAccountPool.js` and its exports do not exist.

- [ ] **Step 3: Implement the minimal account-pool module**

Implement these exact public types and helpers:

```ts
export type CodexAccountProfile = Readonly<{ alias: string; home: string }>;
export type CodexAttemptFailure = Readonly<{
  error: Error;
  diagnostic: string;
  acceptedOutput: boolean;
}>;
export type CodexAttemptResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; failure: CodexAttemptFailure }>;

export const success = <T>(value: T): CodexAttemptResult<T> => ({ ok: true, value });
export const failure = (
  error: Error,
  diagnostic: string,
  acceptedOutput: boolean,
): CodexAttemptResult<never> => ({ ok: false, failure: { error, diagnostic, acceptedOutput } });

export class CodexAccountsExhaustedError extends Error {
  constructor() {
    super("codex_accounts_exhausted");
    this.name = "CodexAccountsExhaustedError";
  }
}

export interface CodexAccountPool {
  readonly profiles: readonly CodexAccountProfile[];
  run<T>(attempt: (profile: CodexAccountProfile) => Promise<CodexAttemptResult<T>>):
    Promise<{ profile: CodexAccountProfile; value: T }>;
}
```

Validate aliases with `/^[a-z][a-z0-9-]{0,31}$/`, require two unique aliases, resolve each profile under the real root, require a real directory and regular non-symlink `auth.json`, and never read that file. Normalize diagnostics to lowercase and classify only `usage limit`, `usage_limit`, or `usage-limit` phrases. Explicitly reject `rate limit` as exhaustion. Parse a future timestamp following `after`, `until`, `resets at`, or `try again at` with `Date.parse`; otherwise use `now + 3_600_000`. Add `300_000` only to a parsed reset time.

The run loop must:

```ts
for (const profile of profiles) {
  if ((cooldownUntil.get(profile.alias) ?? 0) > now()) continue;
  const result = await attempt(profile);
  if (result.ok) return { profile, value: result.value };
  if (result.failure.acceptedOutput || !isUsageExhaustion(result.failure.diagnostic)) {
    throw result.failure.error;
  }
  cooldownUntil.set(profile.alias, retryAt(result.failure.diagnostic, now()));
}
throw new CodexAccountsExhaustedError();
```

Add `createCodexAccountPoolFromEnv(env, dependencies)` that requires `CODEX_ACCOUNT_POOL_ROOT` and exactly `primary,secondary` from `CODEX_ACCOUNT_PROFILES` in production. Export all public symbols from `src/index.ts`.

- [ ] **Step 4: Run the account-pool tests to verify GREEN**

Run:

```powershell
npm test --workspace @brand-pilot/worker-runtime -- src/codexAccountPool.test.ts
```

Expected: PASS with no credential content in snapshots or output.

- [ ] **Step 5: Run the existing runtime tests**

Run:

```powershell
npm test --workspace @brand-pilot/worker-runtime
```

Expected: PASS; existing command, lease, and controlled-search behavior is unchanged.

- [ ] **Step 6: Commit the state machine**

```powershell
git add -- workers/brand-pilot-worker-runtime/src/codexAccountPool.ts workers/brand-pilot-worker-runtime/src/codexAccountPool.test.ts workers/brand-pilot-worker-runtime/src/index.ts
git commit -m "feat(content): add codex account failover pool"
```

### Task 2: Integrate failover into one proposal invocation

**Files:**
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/codexModel.ts`
- Modify: `workers/brand-pilot-content-proposal-worker/src/main.ts`

- [ ] **Step 1: Write failing proposal-model tests**

Extend the model fixture to pass a deterministic `CodexAccountPool` backed by temporary profile directories. Add separate tests that prove:

```ts
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
afterEach(async () => Promise.all(accountRoots.splice(0).map((root) =>
  rm(root, { recursive: true, force: true }))));
```

```ts
it("replays the identical prompt under secondary after primary usage exhaustion", async () => {
  const primary = child();
  const secondary = child();
  const spawnProcess = vi.fn()
    .mockReturnValueOnce(primary)
    .mockReturnValueOnce(secondary);
  const model = createCodexContentProposalModel({
    accountPool: await testAccountPool(), command: "codex", timeoutMs: 10_000,
    spawnProcess, ...runtime(),
  });
  const promise = model.generate("frozen prompt");
  await Promise.resolve();
  primary.stderr.write("You've hit your usage limit");
  primary.emit("close", 1, null);
  await Promise.resolve();
  secondary.stdout.write(completed(JSON.stringify({
    contractVersion: "content-proposal.v2", proposals: [],
  })));
  secondary.emit("close", 0, null);
  await expect(promise).resolves.toMatchObject({ syntaxValid: true });
  expect(spawnProcess.mock.calls.map((call) => call[2].env.CODEX_HOME))
    .toEqual([testPrimaryHome, testSecondaryHome]);
  expect(spawnProcess.mock.calls[0][1]).toEqual(spawnProcess.mock.calls[1][1]);
});

it("does not replay a nonzero child that emitted a final agent message", async () => {
  const process = child();
  const spawnProcess = vi.fn(() => process);
  const model = createCodexContentProposalModel({
    accountPool: await testAccountPool(), command: "codex", timeoutMs: 10_000,
    spawnProcess, ...runtime(),
  });
  const promise = model.generate("prompt");
  await Promise.resolve();
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
    accountPool: await testAccountPool(), command: "codex", timeoutMs: 10_000,
    spawnProcess, ...runtime(),
  });
  const promise = model.generate("prompt");
  await Promise.resolve();
  primary.stderr.write("usage limit");
  primary.emit("close", 1, null);
  await Promise.resolve();
  secondary.stderr.write("usage limit");
  secondary.emit("close", 1, null);
  await expect(promise).rejects.toMatchObject({
    message: "codex_accounts_exhausted", outcome: "definite_failure",
  });
  expect(spawnProcess).toHaveBeenCalledTimes(2);
});
```

Retain all existing hash, cleanup, timeout, abort, output-limit, and secret-environment assertions.

- [ ] **Step 2: Run the proposal-model test to verify RED**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker -- src/codexModel.test.ts
```

Expected: FAIL because `createCodexContentProposalModel` does not accept or use an account pool.

- [ ] **Step 3: Refactor one child attempt behind the pool**

Add `accountPool: CodexAccountPool` to `createCodexContentProposalModel`. Move the existing single-child promise into `generateAttempt(prompt, signal, profile)`. Override only the allowed child environment field:

```ts
env: buildContentProposalCodexChildEnv({ ...env, CODEX_HOME: profile.home }),
```

Return `success(result)` on exit zero. On nonzero exit return:

```ts
failure(
  new ContentProposalModelInvocationError(message, "definite_failure", transcriptSha256),
  stderr,
  finalMessage !== null,
)
```

Timeout, abort, output overflow, spawn failure, and stdin failure keep throwing their existing indeterminate/definite errors and therefore never enter account failover. Convert `CodexAccountsExhaustedError` to `ContentProposalModelInvocationError("codex_accounts_exhausted", "definite_failure")`.

In `main.ts`, create one pool before the model:

```ts
const accountPool = await createCodexAccountPoolFromEnv(process.env);
const runner = createContentProposalRunner(createCodexContentProposalModel({
  accountPool,
  command: process.env.CONTENT_PROPOSAL_CODEX_COMMAND?.trim() || "codex",
  timeoutMs,
}));
```

- [ ] **Step 4: Run proposal tests and build**

```powershell
npm test --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/content-proposal-worker
```

Expected: PASS; TypeScript emits with no new diagnostics.

- [ ] **Step 5: Commit proposal integration**

```powershell
git add -- workers/brand-pilot-content-proposal-worker/src/codexModel.ts workers/brand-pilot-content-proposal-worker/src/codexModel.test.ts workers/brand-pilot-content-proposal-worker/src/main.ts
git commit -m "feat(content): fail over proposal codex account"
```

### Task 3: Integrate card-news, blog, reel, and blog assessment

**Files:**
- Create: `workers/brand-pilot-card-news-worker/src/codexAccountFailover.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/index.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/worker.ts`
- Modify: `workers/brand-pilot-card-news-worker/scripts/run-codex-card-news-v2-plan.mjs`
- Create: `workers/brand-pilot-blog-worker/src/codexAccountFailover.test.ts`
- Modify: `workers/brand-pilot-blog-worker/src/index.ts`
- Modify: `workers/brand-pilot-blog-worker/src/worker.ts`
- Modify: `workers/brand-pilot-blog-worker/src/research.ts`
- Modify: `workers/brand-pilot-blog-worker/src/research.test.ts`
- Modify: `workers/brand-pilot-blog-worker/scripts/run-codex-blog-v2-plan.mjs`
- Create: `workers/brand-pilot-reel-worker/src/codexAccountFailover.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/index.ts`
- Modify: `workers/brand-pilot-reel-worker/src/worker.ts`
- Modify: `workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs`

- [ ] **Step 1: Add failing persistent-runner tests**

For each worker, inject a deterministic pool created from temporary profile directories and a child-command dependency into `createCommandRunner`. Make the primary attempt return `failure(new Error("exit 1"), "You've hit your usage limit", false)`, make the secondary attempt write the canonical plan file and return `success(undefined)`, and assert:

```ts
expect(attemptedHomes).toEqual([primaryHome, secondaryHome]);
expect(prompts).toEqual([frozenPrompt, frozenPrompt]);
expect(result.outputDir).toBe(secondaryAttemptOutputDir);
```

Add one generic-error case per runner that asserts only primary was attempted. For blog research, inject the same pool into `createBlogResearch` and assert assessment failover but no change to controlled supplemental search.

- [ ] **Step 2: Run the focused tests to verify RED**

```powershell
npm test --workspace @brand-pilot/card-news-worker -- src/codexAccountFailover.test.ts
npm test --workspace @brand-pilot/blog-worker -- src/codexAccountFailover.test.ts src/research.test.ts
npm test --workspace @brand-pilot/reel-worker -- src/codexAccountFailover.test.ts
```

Expected: FAIL because the factories have no account-pool dependency.

- [ ] **Step 3: Add an opt-in captured command attempt to worker runtime**

Extend `runShellCommandWithTimeout` with optional fields while preserving its default behavior:

```ts
accountProfile?: CodexAccountProfile;
captureDiagnostic?: boolean;
```

When `captureDiagnostic` is true, pipe at most 8 KiB of stderr, inherit stdout, and throw an error carrying a non-enumerable `diagnostic` string on nonzero exit. Build the child env from the existing allowlist and override `CODEX_HOME` with `accountProfile.home`. Do not include the diagnostic in the thrown message or logs.

Add `runShellCommandWithAccountFailover({ pool, buildCommand, ... })` that calls `pool.run`, maps a successful child to `success(outputDir)`, and maps a process error to `failure(error, diagnostic, false)`. Timeout, abort, or spawn errors are thrown directly and never passed to the pool.

- [ ] **Step 4: Make each plan attempt use an isolated output directory**

In each `createCommandRunner`, create one job file but build one output directory per selected alias:

```ts
const attempt = await runShellCommandWithAccountFailover({
  pool: accountPool,
  async buildAttempt(profile) {
    const outputDir = path.join(workDir, `output-${profile.alias}`);
    await mkdir(outputDir, { recursive: true });
    return {
      command: commandTemplate
        .replaceAll("{{jobFile}}", jobFile)
        .replaceAll("{{outputDir}}", outputDir),
      outputDir,
    };
  },
  signal,
  timeoutMs,
  timeoutErrorCode,
  processErrorCode,
});
return { outputDir: attempt.value, cleanup };
```

The three scripts continue to receive the same prompt and schema. Before Codex starts, each script removes only its own `--output` plan file with `rm(outputFile, { force: true })`. Update permission arguments to deny both `/codex` and `/codex-accounts`.

- [ ] **Step 5: Route the blog assessment through the persistent pool**

Change `productionAssessmentChild` to accept a selected profile and use:

```ts
env: buildWorkerCliChildEnv({ ...process.env, CODEX_HOME: profile.home }),
```

Its nonzero result returns `failure(error, stderr.slice(0, 8_192), stdout.trim().length > 0)` to the pool. A parsed successful assessment returns `success(stdout)`. `createBlogResearch(accountPool)` retains deterministic `runControlledSearch` unchanged.

In each worker `index.ts`, await one `createCodexAccountPoolFromEnv(process.env)` and pass the same object to every in-scope model boundary. The blog index passes it to both the plan runner and `createBlogResearch` supplied to `runOnce`.

- [ ] **Step 6: Run the three complete worker suites**

```powershell
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/blog-worker
npm test --workspace @brand-pilot/reel-worker
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/blog-worker
npm run build --workspace @brand-pilot/reel-worker
```

Expected: PASS. Do not run marketing, automated-card-news, DM, Wiki, brand-intelligence, or subject-analysis tests.

- [ ] **Step 7: Commit the three plan-worker integrations**

```powershell
git add -- workers/brand-pilot-worker-runtime/src/index.ts workers/brand-pilot-worker-runtime/src/index.test.ts workers/brand-pilot-card-news-worker workers/brand-pilot-blog-worker/src workers/brand-pilot-blog-worker/scripts/run-codex-blog-v2-plan.mjs workers/brand-pilot-reel-worker
git commit -m "feat(content): fail over format planning accounts"
```

Before committing, inspect `git diff --cached --name-only` and unstage the pre-existing dirty blog schema and production-runtime test if either appears.

### Task 4: Integrate only the V3 manual-content image asset path

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/src/index.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs`
- Modify: `workers/brand-pilot-image-worker/src/codexCommand.mjs`
- Modify: `workers/brand-pilot-image-worker/src/codexCommand.test.ts`

- [ ] **Step 1: Write failing image-child failover tests**

Add tests with a deterministic temporary-directory pool and controlled spawned children:

```ts
type AssetTestChild = EventEmitter & {
  pid: number;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
function assetChild(): AssetTestChild {
  const child = new EventEmitter() as AssetTestChild;
  child.pid = 4321;
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

const fixturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
```

```ts
it("retries a manual asset under secondary after primary usage exhaustion", async () => {
  const spawned = [assetChild(), assetChild()];
  const spawnProcess = vi.fn()
    .mockReturnValueOnce(spawned[0])
    .mockReturnValueOnce(spawned[1]);
  const promise = runAiContentAssetChildProcess({
    accountPool: await testAccountPool(), command: "node", args: ["runner.mjs"],
    cwd: workDir, env: {}, outputFile, signal: new AbortController().signal,
    timeoutMs: 10_000,
  }, { spawnProcess });
  spawned[0].stderr.write("You've hit your usage limit");
  spawned[0].emit("exit", 1);
  await Promise.resolve();
  await writeFile(outputFile, fixturePng);
  spawned[1].emit("exit", 0);
  await expect(promise).resolves.toBeUndefined();
  expect(spawnProcess.mock.calls.map((call) => call[2].env.CODEX_HOME))
    .toEqual([testPrimaryHome, testSecondaryHome]);
});

it("does not retry after the child produced an output file", async () => {
  const process = assetChild();
  const spawnProcess = vi.fn(() => process);
  const promise = runAiContentAssetChildProcess({
    accountPool: await testAccountPool(), command: "node", args: ["runner.mjs"],
    cwd: workDir, env: {}, outputFile, signal: new AbortController().signal,
    timeoutMs: 10_000,
  }, { spawnProcess });
  await writeFile(outputFile, fixturePng);
  process.stderr.write("usage limit");
  process.emit("exit", 1);
  await expect(promise).rejects.toThrow("ai_content_asset_render_failed");
  expect(spawnProcess).toHaveBeenCalledTimes(1);
});

it("does not retry generic image tool failure", async () => {
  const process = assetChild();
  const spawnProcess = vi.fn(() => process);
  const promise = runAiContentAssetChildProcess({
    accountPool: await testAccountPool(), command: "node", args: ["runner.mjs"],
    cwd: workDir, env: {}, outputFile, signal: new AbortController().signal,
    timeoutMs: 10_000,
  }, { spawnProcess });
  process.stderr.write("image tool failed");
  process.emit("exit", 1);
  await expect(promise).rejects.toThrow("ai_content_asset_render_failed");
  expect(spawnProcess).toHaveBeenCalledTimes(1);
});
```

Also assert the legacy renderer and Threads text generator factories are not passed the pool and retain primary `CODEX_HOME`.

- [ ] **Step 2: Run focused image tests to verify RED**

```powershell
npm test --workspace @brand-pilot/image-worker -- src/aiContentAssetRenderer.test.ts src/codexCommand.test.ts
```

Expected: FAIL because the asset child has no pool and still inherits one `CODEX_HOME`.

- [ ] **Step 3: Wrap only `runAiContentAssetChildProcess` with the pool**

Add `accountPool: CodexAccountPool` to `createAiContentAssetRenderer` and its default child runner. For each selected profile:

```ts
const attemptEnv = buildImageWorkerChildEnvironment({
  ...input.env,
  CODEX_HOME: profile.home,
  CODEX_GENERATED_IMAGES_DIR: path.join(profile.home, "generated_images"),
});
```

Capture at most 8 KiB of child stderr while keeping the existing timeout, abort, process-group, graceful TERM, and hard-kill behavior. After a nonzero exit, set `acceptedOutput` from `await stat(outputFile).then(() => true, () => false)`. Return a usage failure to the pool only when `acceptedOutput` is false. Remove no path outside the current job's temporary work directory.

The inner `run-codex-ai-content-asset.mjs` continues to resolve `generated_images` from its selected `CODEX_HOME`; before starting, it removes only the requested job-scoped `outputFile`. Update Codex filesystem permissions to deny `/codex-accounts`.

- [ ] **Step 4: Construct one image-worker pool**

In `src/index.ts`:

```ts
const accountPool = await createCodexAccountPoolFromEnv(process.env);
const aiContentRenderer = createAiContentAssetRenderer({
  accountPool,
  workerRoot,
  readOwned: (storagePath) => aiContentStorage.readOwned(storagePath),
  timeoutMs,
});
```

Do not pass `accountPool` to `createConfiguredRenderer` or `createCodexTextGenerator`; those unrelated/legacy paths continue to use the primary profile configured as the container default.

- [ ] **Step 5: Run image-worker tests and build**

```powershell
npm test --workspace @brand-pilot/image-worker -- src/aiContentAssetRenderer.test.ts src/codexCommand.test.ts src/productionRuntime.test.ts
npm run build --workspace @brand-pilot/image-worker
```

Expected: PASS. Do not run legacy browser or unrelated worker suites.

- [ ] **Step 6: Commit the manual-content image integration**

```powershell
git add -- workers/brand-pilot-image-worker/src/aiContentAssetRenderer.ts workers/brand-pilot-image-worker/src/aiContentAssetRenderer.test.ts workers/brand-pilot-image-worker/src/index.ts workers/brand-pilot-image-worker/src/codexCommand.mjs workers/brand-pilot-image-worker/src/codexCommand.test.ts workers/brand-pilot-image-worker/scripts/run-codex-ai-content-asset.mjs
git commit -m "feat(content): fail over manual asset account"
```

### Task 5: Change production mounts and two-profile preflight

**Files:**
- Modify: `deploy/compose.production.yml`
- Modify: `deploy/scripts/preflight.sh`
- Modify: `deploy/scripts/preflight-ai-content.sh`
- Modify: `deploy/env/content-proposal-worker.env.example`
- Modify: `deploy/env/card-news-worker.env.example`
- Modify: `deploy/env/blog-worker.env.example`
- Modify: `deploy/env/reel-worker.env.example`
- Modify: `deploy/env/image-worker.env.example`
- Modify: `workers/brand-pilot-content-proposal-worker/Dockerfile`
- Modify: `workers/brand-pilot-card-news-worker/Dockerfile`
- Modify: `workers/brand-pilot-blog-worker/Dockerfile`
- Modify: `workers/brand-pilot-reel-worker/Dockerfile`
- Modify: `workers/brand-pilot-image-worker/Dockerfile`
- Modify: `scripts/deployment-contract.test.mjs`
- Modify: `scripts/worker-cli-only-contract.test.mjs`
- Modify: `scripts/canonical-format-schema-runtime.test.mjs`
- Modify: `docs/operations/UBUNTU_DEPLOYMENT.md`

- [ ] **Step 1: Write failing deployment contract assertions**

Assert exactly the five approved services contain:

```yaml
environment:
  CODEX_HOME: /codex-accounts/primary
  CODEX_ACCOUNT_POOL_ROOT: /codex-accounts
  CODEX_ACCOUNT_PROFILES: primary,secondary
volumes:
  - ${CODEX_ACCOUNT_POOL_ROOT_PATH:-/opt/brand-pilot/shared/codex-accounts}:/codex-accounts
```

Assert DM, Wiki, brand-intelligence, and subject-analysis services do not contain `CODEX_ACCOUNT_PROFILES`. Assert preflight loops over literal aliases `primary secondary`, checks `0700` directories and `0600` regular `auth.json` files, and suppresses each `codex login status`. Assert no command reads or greps `auth.json`. Assert no 074/075 migration command is added.

- [ ] **Step 2: Run deployment tests to verify RED**

```powershell
node --test scripts/deployment-contract.test.mjs scripts/worker-cli-only-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs
```

Expected: FAIL on the old single `/codex` mount and one-profile preflight.

- [ ] **Step 3: Update Compose, images, and example environments**

For only the five services, set the three environment values and parent mount shown above. Set each affected Dockerfile's legacy default to:

```dockerfile
ENV CODEX_HOME=/codex-accounts/primary \
    CODEX_ACCOUNT_POOL_ROOT=/codex-accounts \
    CODEX_ACCOUNT_PROFILES=primary,secondary
```

The image Dockerfile additionally sets:

```dockerfile
CODEX_GENERATED_IMAGES_DIR=/codex-accounts/primary/generated_images
```

Create `/codex-accounts/primary/generated_images` in image build setup only as a non-mounted local fallback; production bind mount supplies the real profile. Every in-scope Codex permission string denies both `"/codex"="deny"` and `"/codex-accounts"="deny"`.

- [ ] **Step 4: Implement two-profile preflight without credential output**

Set:

```bash
CODEX_ACCOUNT_POOL_ROOT_PATH="$ROOT/shared/codex-accounts"
CODEX_HOME_PATH="$CODEX_ACCOUNT_POOL_ROOT_PATH/primary"
for profile in primary secondary; do
  profile_home="$CODEX_ACCOUNT_POOL_ROOT_PATH/$profile"
  auth_file="$profile_home/auth.json"
  test ! -L "$profile_home"
  test "$(realpath -e -- "$profile_home")" = "$profile_home"
  test "$(stat -c '%U:%G %a' -- "$profile_home")" = "bpdeploy:bpdeploy 700"
  test -f "$auth_file"
  test ! -L "$auth_file"
  test "$(realpath -e -- "$auth_file")" = "$auth_file"
  test "$(stat -c '%U:%G %a' -- "$auth_file")" = "bpdeploy:bpdeploy 600"
done
export CODEX_ACCOUNT_POOL_ROOT_PATH CODEX_HOME_PATH CODEX_RUNTIME_UID CODEX_RUNTIME_GID
```

Run `codex login status` once per alias in an immutable worker image with the selected profile mounted at `/codex-profile`, `CODEX_HOME=/codex-profile`, and all output redirected to `/dev/null`. Do not inspect credential JSON.

Document the one-time production transition as safe, non-overwriting operations:

```bash
install -d -o bpdeploy -g bpdeploy -m 0700 /opt/brand-pilot/shared/codex-accounts
test -d /opt/brand-pilot/shared/codex
test ! -e /opt/brand-pilot/shared/codex-accounts/primary
mv -- /opt/brand-pilot/shared/codex /opt/brand-pilot/shared/codex-accounts/primary
install -d -o bpdeploy -g bpdeploy -m 0700 /opt/brand-pilot/shared/codex-accounts/secondary
```

Then document a device login with only the secondary directory mounted. Never include email, password, token, or `auth.json` content in the command or output.

- [ ] **Step 5: Run deployment contracts and scoped source scans**

```powershell
node --test scripts/deployment-contract.test.mjs scripts/worker-cli-only-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs
rg -n 'permissions\..*filesystem=.*codex-accounts.*deny' workers/brand-pilot-content-proposal-worker workers/brand-pilot-card-news-worker workers/brand-pilot-blog-worker workers/brand-pilot-reel-worker workers/brand-pilot-image-worker
rg -n 'auth\.json' deploy docs/operations/UBUNTU_DEPLOYMENT.md
```

Expected: tests PASS; every in-scope model permission denies the pool; auth references are permission/status checks only.

- [ ] **Step 6: Commit deployment contracts**

```powershell
git add -- deploy workers/brand-pilot-content-proposal-worker/Dockerfile workers/brand-pilot-card-news-worker/Dockerfile workers/brand-pilot-blog-worker/Dockerfile workers/brand-pilot-reel-worker/Dockerfile workers/brand-pilot-image-worker/Dockerfile scripts/deployment-contract.test.mjs scripts/worker-cli-only-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs docs/operations/UBUNTU_DEPLOYMENT.md
git commit -m "feat(deploy): provision content codex account pool"
```

### Task 6: Scoped verification, review, production rollout, and browser proof

**Files:**
- Verify only; do not change migrations 074/075 or automated-card-news code.

- [ ] **Step 1: Run all and only affected worker tests**

```powershell
npm test --workspace @brand-pilot/worker-runtime
npm test --workspace @brand-pilot/content-proposal-worker
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/blog-worker
npm test --workspace @brand-pilot/reel-worker
npm test --workspace @brand-pilot/image-worker -- src/aiContentAssetRenderer.test.ts src/codexCommand.test.ts src/productionRuntime.test.ts
node --test scripts/deployment-contract.test.mjs scripts/worker-cli-only-contract.test.mjs scripts/canonical-format-schema-runtime.test.mjs
```

Expected: PASS. Do not run the repository-wide suite or unrelated worker tests.

- [ ] **Step 2: Build only affected packages**

```powershell
npm run build --workspace @brand-pilot/worker-runtime
npm run build --workspace @brand-pilot/content-proposal-worker
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/blog-worker
npm run build --workspace @brand-pilot/reel-worker
npm run build --workspace @brand-pilot/image-worker
```

Expected: all six builds exit zero.

- [ ] **Step 3: Review the complete diff against the deployed base**

```powershell
git diff --check 9ff449efbb500f48fff4ff5040b1a3da206e0833..HEAD
git diff --name-status 9ff449efbb500f48fff4ff5040b1a3da206e0833..HEAD
git status --short
```

Confirm no automated-card-news, DM, Wiki, FAQ, brand-intelligence, subject-analysis, migration 074/075, or unrelated UI file is part of the new commits. Review failover classification, accepted-output gates, secret boundaries, process termination, and retry cardinality a second time.

- [ ] **Step 4: Provision secondary authentication on Ubuntu**

Resolve and verify absolute targets before the one-time move. Preserve the current authenticated directory as `primary`, create `secondary`, and run device authentication for `secondary` in the immutable content worker image. Restore ownership/modes and run suppressed `codex login status` for both. Do not print authentication contents.

- [ ] **Step 5: Build, publish, and deploy only affected worker images**

Use the repository's release manifest and rollout scripts. Do not apply database migrations, do not invoke the schema-only proposal preflight, and do not restart unrelated services. Restart in this order:

```text
content-proposal-worker-1
card-news-worker-1
blog-worker-1
reel-worker-1
image-worker-1
```

Require a fresh heartbeat from each before continuing.

- [ ] **Step 6: Prove deterministic failover before a customer flow**

Run one container-local harness with fake Codex child outcomes: primary usage exhaustion and secondary valid schema output. It must not call a model, create a DB row, or consume application quota. Assert two aliases, one accepted output, and no retry loop.

- [ ] **Step 7: Run one Chrome manual-content production flow**

Using the user's authenticated Chrome session, generate one manual content item through the normal V2/V3 flow. Verify proposal, selected format planner, image asset generation, final result, and network/console status. Do not open or test automated card news or unrelated workers.

- [ ] **Step 8: Perform final code review and automatic-deploy decision**

Re-run the focused tests affected by any review fix. Enable automatic deployment only after the production browser flow succeeds and the final review has no P0/P1 findings. If both accounts are exhausted or secondary device authentication cannot be completed, leave automatic deployment disabled and report that operational blocker without changing unrelated code.
