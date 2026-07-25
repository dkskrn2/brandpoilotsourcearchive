# Brand Pilot Repository and API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Preserve Brand Pilot revision ec40164, import it into dkskrn2/main/brand_poilot, deploy the customer UI independently on Vercel, and make the API safe to run as an Ubuntu dark deployment without changing production database schema.

**Architecture:** The existing Next.js website remains at the repository root and is isolated from the nested Brand Pilot npm workspace. The customer Vite application is a separate Vercel project using api.danbammsg.co.kr as its only production API base. The API receives an explicit fail-closed runtime policy so Vercel and Ubuntu use the same cookie, CORS, TLS, readiness, scheduler, and publication contracts.

**Tech Stack:** Git, npm workspaces, Next.js, Vite, Fastify, PostgreSQL/Supabase, Vitest, Node test runner, Vercel.

---

## Scope and release rule

This plan is for an internal pilot with no external customers and no continuity-critical webhook traffic. It does not create a callback-only receiver, cutover ledger, private-storage migration, public customer launch, worker-principal schema, or maintenance service. It runs no production DDL. DM/Wiki production packaging and Ubuntu activation start only after the API cutover plan is complete.

The commits in this plan are intentionally small:

1. chore: isolate website tooling from Brand Pilot
2. chore: import Brand Pilot source at ec40164
3. test: align migration and transaction contracts
4. chore: configure customer Vercel deployment
5. feat: add fail-closed API runtime config
6. fix: inject HTTP runtime policy and readiness
7. fix: verify database TLS and bound pools
8. fix: make disabled publication read-only

### Task 1: Preserve the source revision

**Files:**
- External Git reference: brandpoilotsourcearchive tag brand-pilot-import-ec40164
- Verify: source worktree tracked tree at ec4016441a91c2d18e2cd8e0a47fac06ee77b487

- [ ] **Step 1: Verify the exact source state**

Run from PowerShell:

~~~powershell
$sourcePath = "C:\Users\dkskr\.config\superpowers\worktrees\brand_poilot\codex-instagram-dm-wiki-auto-reply"
git -C $sourcePath rev-parse HEAD
git -C $sourcePath status --short --branch
~~~

Expected: HEAD is ec4016441a91c2d18e2cd8e0a47fac06ee77b487, the branch is 131 commits ahead, and the only untracked lockfile is pnpm-lock.yaml. Do not stage that file.

- [ ] **Step 2: Create and push an annotated archive tag**

~~~powershell
git -C $sourcePath tag -a brand-pilot-import-ec40164 ec40164 -m "Brand Pilot source before main monorepo import"
git -C $sourcePath push origin refs/tags/brand-pilot-import-ec40164
~~~

Expected: GitHub contains the named tag. No local .env, pnpm-lock.yaml, node_modules, logs, or .vercel directory is part of the tag.

- [ ] **Step 3: Verify the remote tag**

~~~powershell
git -C $sourcePath ls-remote --tags origin refs/tags/brand-pilot-import-ec40164
~~~

Expected: one annotated tag reference resolves successfully.

### Task 2: Isolate the website and import the committed tree

**Files:**
- Create: tests/repository-boundary.test.js
- Modify: tsconfig.json
- Modify: eslint.config.mjs
- Modify: next.config.ts
- Create: brand_poilot/ from archive tag

- [ ] **Step 1: Write the failing repository-boundary test**

Create tests/repository-boundary.test.js:

~~~javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const read = (path) => readFileSync(path, "utf8");

test("website tooling excludes the nested Brand Pilot source", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"));
  const eslint = read("eslint.config.mjs");
  const next = read("next.config.ts");
  const rootPackage = JSON.parse(read("package.json"));

  assert.ok(tsconfig.exclude.includes("brand_poilot"));
  assert.match(eslint, /brand_poilot\/\*\*/);
  assert.match(next, /outputFileTracingExcludes/);
  assert.match(next, /brand_poilot\/\*\*\/\*/);
  assert.equal(rootPackage.workspaces, undefined);
});
~~~

- [ ] **Step 2: Run the test and verify failure**

~~~powershell
npm test
~~~

Expected: the new boundary test fails because the three exclusions do not exist.

- [ ] **Step 3: Add the three website-tool boundaries**

Add brand_poilot to the existing tsconfig.json exclude array:

~~~json
"exclude": [
  "node_modules",
  "brand_poilot"
]
~~~

Add this entry to globalIgnores in eslint.config.mjs:

~~~javascript
"brand_poilot/**",
~~~

Add this property to next.config.ts:

~~~typescript
outputFileTracingExcludes: {
  "/*": ["./brand_poilot/**/*"]
},
~~~

- [ ] **Step 4: Verify the website before import**

~~~powershell
npm test
npm run lint
npm run build
~~~

Expected: all commands exit 0 and the existing /admin/brandpoilot compatibility test remains green.

- [ ] **Step 5: Commit the website boundary**

~~~powershell
git add tsconfig.json eslint.config.mjs next.config.ts tests/repository-boundary.test.js
git commit -m "chore: isolate website tooling from Brand Pilot"
~~~

Expected: the commit contains exactly the four boundary files and the index is clean.

- [ ] **Step 6: Import the exact tagged tree as ordinary files**

~~~powershell
git remote add brand-pilot-archive https://github.com/dkskrn2/brandpoilotsourcearchive.git
git fetch brand-pilot-archive tag brand-pilot-import-ec40164
git read-tree --prefix=brand_poilot/ -u brand-pilot-import-ec40164
~~~

Expected: 722 tracked files appear under brand_poilot. No submodule is created.

- [ ] **Step 7: Prove that excluded local files were not imported**

~~~powershell
$imported = git diff --cached --name-only
$imported.Count
$imported | Select-String -Pattern '(^|/)(\.env($|\.)|pnpm-lock\.yaml|node_modules|\.vercel|logs?)'
~~~

Expected: count is 722 and the second command prints nothing.

- [ ] **Step 8: Commit the imported tree**

~~~powershell
git add brand_poilot
git commit -m "chore: import Brand Pilot source at ec40164"
~~~

- [ ] **Step 9: Verify both applications after import**

~~~powershell
npm test
npm run lint
npm run build
Push-Location brand_poilot
npm ci
npm run build
Pop-Location
~~~

Expected: website and Brand Pilot builds exit 0. The known migration-manifest contract failure is addressed in Task 3, not hidden here.

### Task 3: Restore migration test determinism without running DDL

**Files:**
- Modify: brand_poilot/scripts/repository-contract.test.mjs
- Modify: brand_poilot/scripts/migrationRunner.mjs
- Modify: brand_poilot/scripts/migrationRunner.test.mjs
- Test: brand_poilot/scripts/migrations.integration.test.mjs

**Working directory:** brand_poilot

- [ ] **Step 1: Extend the exact migration manifest**

Add these names after 049_brand_intelligence_onboarding.sql in the existing expected array:

~~~text
050_support_request_contact_phone.sql
051_ai_content_subject_pipeline_v2.sql
052_ai_content_subject_appeal_regeneration_keys.sql
053_dm_manual_delivery_audit.sql
054_feedback_submissions.sql
~~~

Rename the test description from 001–049 to 001–054.

- [ ] **Step 2: Run the contract suite**

~~~powershell
npm run test:contract
~~~

Expected: 27 of 27 tests pass.

- [ ] **Step 3: Add transaction-unwrapping unit tests**

Append tests covering all four contracts:

~~~javascript
test("unwrapFileTransaction removes only the outer file transaction", () => {
  const sql = "-- migration\nbegin;\ncreate table sample(id integer);\ncommit;\n";
  assert.equal(
    migrationRunner.unwrapFileTransaction(sql),
    "-- migration\n\ncreate table sample(id integer);\n\n",
  );
});

test("unwrapFileTransaction rejects transaction control inside the body", () => {
  assert.throws(
    () => migrationRunner.unwrapFileTransaction(
      "begin;\ncreate table sample(id integer);\ncommit;\nbegin;",
    ),
    /migration_nested_transaction_control/,
  );
});

test("runner records history before committing the runner transaction", async () => {
  const client = createRecordingClient();
  await migrationRunner.runMigrationsWithClient({
    client,
    migrations: [{
      id: "055_atomic.sql",
      checksum: "raw-checksum",
      sql: "begin;\nselect migration_body\ncommit;",
    }],
  });
  const calls = client.calls.map((call) => call.sql);
  assert.ok(calls.indexOf("select migration_body") < calls.findIndex((sql) =>
    sql.startsWith("insert into schema_migrations")
  ));
  assert.ok(calls.findIndex((sql) =>
    sql.startsWith("insert into schema_migrations")
  ) < calls.lastIndexOf("commit"));
});
~~~

- [ ] **Step 4: Implement runner-owned transaction execution**

Add this exported helper to migrationRunner.mjs and execute its return value at the current migration.sql call site:

~~~javascript
export function unwrapFileTransaction(sql) {
  const lines = sql.split(/\r?\n/);
  const significant = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0 && !line.startsWith("--"));
  const first = significant[0];
  const last = significant.at(-1);
  const wrapped = /^begin;$/i.test(first?.line ?? "") &&
    /^commit;$/i.test(last?.line ?? "");
  if (!wrapped) {
    if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) {
      throw new Error("migration_nested_transaction_control");
    }
    return sql;
  }
  const body = lines
    .filter((_, index) => index !== first.index && index !== last.index)
    .join("\n");
  if (/^\s*(begin|commit|rollback)\s*;/im.test(body)) {
    throw new Error("migration_nested_transaction_control");
  }
  return body;
}
~~~

Change execution to:

~~~javascript
await client.query(unwrapFileTransaction(migration.sql));
~~~

The checksum remains computed from the original unmodified SQL so existing schema_migrations history does not change.

- [ ] **Step 5: Run migration tests without touching production**

~~~powershell
node --test scripts/migrationRunner.test.mjs
npm run test:migrations
~~~

Expected: both commands complete with exit 0. If the integration test hangs, fix its lifecycle and timeout before continuing; do not waive it and do not run db:migrate against production.

- [ ] **Step 6: Commit**

~~~powershell
git add scripts/repository-contract.test.mjs scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs
git commit -m "test: align migration and transaction contracts"
~~~

### Task 4: Configure the customer Vercel project

**Files:**
- Create: brand_poilot/vercel.json
- Create: brand_poilot/apps/customer-ui/.env.example
- Create: brand_poilot/apps/customer-ui/buildEnv.ts
- Create: brand_poilot/apps/customer-ui/buildEnv.test.ts
- Modify: brand_poilot/apps/customer-ui/vite.config.ts
- Modify: brand_poilot/apps/customer-ui/src/pages/LoginPage.tsx
- Modify: brand_poilot/README.md

**Working directory:** brand_poilot

- [ ] **Step 1: Write build-environment tests**

Create buildEnv.test.ts:

~~~typescript
import { describe, expect, it } from "vitest";
import { assertCustomerBuildEnv } from "./buildEnv";

describe("assertCustomerBuildEnv", () => {
  it("requires the stable API URL in a Vercel build", () => {
    expect(() => assertCustomerBuildEnv({ VERCEL: "1" })).toThrow(
      "VITE_API_BASE_URL_required",
    );
  });

  it.each([
    "http://api.danbammsg.co.kr",
    "https://localhost:4000",
    "https://api.danbammsg.co.kr/",
    "https://other.example",
  ])("rejects %s", (value) => {
    expect(() => assertCustomerBuildEnv({
      VERCEL: "1",
      VITE_API_BASE_URL: value,
    })).toThrow("VITE_API_BASE_URL_invalid");
  });

  it("accepts the stable production API URL", () => {
    expect(assertCustomerBuildEnv({
      VERCEL: "1",
      VITE_API_BASE_URL: "https://api.danbammsg.co.kr",
    })).toBe("https://api.danbammsg.co.kr");
  });
});
~~~

- [ ] **Step 2: Implement the build guard**

Create buildEnv.ts:

~~~typescript
const productionApiBaseUrl = "https://api.danbammsg.co.kr";

export function assertCustomerBuildEnv(
  env: Record<string, string | undefined>,
) {
  const value = env.VITE_API_BASE_URL?.trim();
  if (env.VERCEL !== "1" && env.VERCEL_ENV !== "production") {
    return value;
  }
  if (!value) throw new Error("VITE_API_BASE_URL_required");
  if (value !== productionApiBaseUrl) {
    throw new Error("VITE_API_BASE_URL_invalid");
  }
  return value;
}
~~~

Change vite.config.ts to call it:

~~~typescript
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { assertCustomerBuildEnv } from "./buildEnv";

export default defineConfig(({ mode }) => {
  assertCustomerBuildEnv({ ...process.env, ...loadEnv(mode, process.cwd(), "") });
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: false },
  };
});
~~~

- [ ] **Step 3: Add the Vercel configuration**

Create brand_poilot/vercel.json:

~~~json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm ci",
  "buildCommand": "npm run build --workspace @brand-pilot/customer-ui",
  "outputDirectory": "apps/customer-ui/dist",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Robots-Tag", "value": "noindex, nofollow, noarchive" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    }
  ]
}
~~~

Create .env.example with no secrets:

~~~dotenv
VITE_API_BASE_URL=https://api.danbammsg.co.kr
~~~

- [ ] **Step 4: Correct production-facing text and documentation**

Change the login recovery text from a localhost-specific instruction to:

~~~text
현재 주소에서 다시 로그인해 주세요.
~~~

Replace README references to VITE_API_URL with VITE_API_BASE_URL. Do not put Meta, Kakao, OpenAI, database, or service secrets in any VITE_ variable.

- [ ] **Step 5: Run targeted customer tests and builds**

~~~powershell
npm exec --workspace @brand-pilot/customer-ui vitest run buildEnv.test.ts src/__tests__/auth.test.tsx src/__tests__/channels.test.tsx src/__tests__/instagramTrends.test.tsx src/__tests__/navigation.test.tsx src/__tests__/support.test.tsx src/components/feedback/FeedbackDialog.test.tsx
$env:VERCEL = "1"
$env:VITE_API_BASE_URL = "https://api.danbammsg.co.kr"
npm run build --workspace @brand-pilot/customer-ui
Remove-Item Env:VERCEL
Remove-Item Env:VITE_API_BASE_URL
~~~

Expected: tests and build pass. The current 618.86 kB warning is recorded but does not block this migration.

- [ ] **Step 6: Commit**

~~~powershell
git add vercel.json apps/customer-ui README.md
git commit -m "chore: configure customer Vercel deployment"
~~~

### Task 5: Add fail-closed API runtime configuration

**Files:**
- Create: brand_poilot/apps/api/src/runtimeConfig.ts
- Create: brand_poilot/apps/api/src/runtimeConfig.test.ts
- Modify: brand_poilot/apps/api/src/index.ts
- Modify: brand_poilot/apps/api/.env.example

**Working directory:** brand_poilot

- [ ] **Step 1: Write runtime policy tests**

Cover these exact cases: missing production key, wildcard CORS, HTTP production origin, frontend origin missing from CORS, COOKIE_SECURE not true, production dev auth enabled, scheduler/publication defaults false, and valid Ubuntu policy.

~~~typescript
it("loads the dark-deploy policy", () => {
  const config = loadApiRuntimeConfig(validProductionEnv());
  expect(config.http).toEqual({
    cookieSecure: true,
    corsAllowedOrigins: [
      "https://app.danbammsg.co.kr",
      "https://www.danbammsg.co.kr",
    ],
    devAuthEnabled: false,
  });
  expect(config.schedulerEnabled).toBe(false);
  expect(config.instagramPublishEnabled).toBe(false);
  expect(config.db.max).toBe(3);
});
~~~

The fixture uses the real hostname app.danbammsg.co.kr; a hostname typo must fail.

- [ ] **Step 2: Implement the runtime config interface**

The module exports:

~~~typescript
export interface ApiHttpRuntimePolicy {
  cookieSecure: boolean;
  corsAllowedOrigins: readonly string[];
  devAuthEnabled: boolean;
}

export interface ApiRuntimeConfig {
  http: ApiHttpRuntimePolicy;
  db: {
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
    caCertificate?: string;
  };
  schedulerEnabled: boolean;
  instagramPublishEnabled: boolean;
}

export function loadApiRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiRuntimeConfig;
~~~

Production validation requires the configured database URL, AUTH_FRONTEND_URL, worker/admin/cron tokens, CREDENTIAL_ENCRYPTION_KEY, Kakao keys and callback, Meta keys/callbacks/webhook token, Supabase URL/service role key, and Blob token. Error messages contain missing variable names only, never values.

Boolean parsing accepts only true or false. Production requires COOKIE_SECURE=true, HTTPS origins with no wildcard/path/query, AUTH_FRONTEND_URL included in CORS_ALLOWED_ORIGINS, DEV_AUTH_ENABLED=false, LOCAL_SCHEDULER_ENABLED=false, and INSTAGRAM_PUBLISH_ENABLED=false. DB_POOL_MAX defaults to 3 and must be between 1 and 10.

- [ ] **Step 3: Load config before constructing dependencies**

At the top of index.ts, after dotenv loading and before createPool:

~~~typescript
const runtimeConfig = loadApiRuntimeConfig();
const pool = createPool(runtimeConfig.db);
~~~

Pass runtimeConfig.http to createServer, runtimeConfig.instagramPublishEnabled to createRepository, and runtimeConfig.schedulerEnabled to the scheduler branch. Remove direct VERCEL-based security decisions.

- [ ] **Step 4: Update the environment example**

The production-safe defaults are:

~~~dotenv
HOST=0.0.0.0
COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://app.danbammsg.co.kr,https://www.danbammsg.co.kr
DEV_AUTH_ENABLED=false
LOCAL_SCHEDULER_ENABLED=false
INSTAGRAM_PUBLISH_ENABLED=false
DB_POOL_MAX=3
DB_POOL_IDLE_TIMEOUT_MS=10000
DB_POOL_CONNECTION_TIMEOUT_MS=10000
DB_SSL_CA_BASE64=
~~~

- [ ] **Step 5: Run tests and commit**

~~~powershell
npm exec --workspace @brand-pilot/api -- vitest run src/runtimeConfig.test.ts --maxWorkers=1
git add apps/api/src/runtimeConfig.ts apps/api/src/runtimeConfig.test.ts apps/api/src/index.ts apps/api/.env.example
git commit -m "feat: add fail-closed API runtime config"
~~~

### Task 6: Inject HTTP policy and split liveness from readiness

**Files:**
- Modify: brand_poilot/apps/api/src/httpServer.ts
- Modify: brand_poilot/apps/api/src/server.test.ts

**Working directory:** brand_poilot

- [ ] **Step 1: Add failing HTTP policy tests**

Add tests named:

~~~text
allows credentialed CORS only for the configured origin
omits CORS headers for an untrusted origin
sets Secure cookies without VERCEL
returns 404 for Meta dev completion when disabled
returns liveness without querying the database
returns 503 readiness when database is unavailable
~~~

Each test injects runtimePolicy explicitly; no test mutates process.env.VERCEL.

- [ ] **Step 2: Add runtimePolicy to CreateServerOptions**

~~~typescript
runtimePolicy?: ApiHttpRuntimePolicy;
~~~

Use this safe test default:

~~~typescript
const runtimePolicy = options.runtimePolicy ?? {
  cookieSecure: false,
  corsAllowedOrigins: [],
  devAuthEnabled: false,
};
~~~

Register CORS with exact origins:

~~~typescript
void app.register(cors, {
  origin: [...runtimePolicy.corsAllowedOrigins],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});
~~~

- [ ] **Step 3: Replace every Vercel cookie decision**

Change sessionCookie to receive cookieSecure and pass runtimePolicy.cookieSecure for the session cookie and all Kakao/Instagram state-cookie set/clear calls. Preserve the current SameSite selection so this task changes hosting detection only.

- [ ] **Step 4: Fail closed on the dev completion route**

The first route statements are:

~~~typescript
if (!runtimePolicy.devAuthEnabled) {
  return reply.code(404).send({ error: "not_found" });
}
~~~

The disabled test must prove repository and provider calls remain at zero.

- [ ] **Step 5: Implement liveness and readiness**

~~~typescript
app.get("/health", async () => ({ ok: true }));

app.get("/ready", async (_request, reply) => {
  try {
    const health = await repository.health();
    return { ok: true, configuration: "ok", database: health.database };
  } catch {
    return reply.code(503).send({
      ok: false,
      configuration: "ok",
      database: "error",
    });
  }
});
~~~

Add /ready to the authentication bypass. Do not return exception messages, URLs, or secret names.

- [ ] **Step 6: Run tests and commit**

~~~powershell
npm exec --workspace @brand-pilot/api -- vitest run src/server.test.ts --maxWorkers=1
git add apps/api/src/httpServer.ts apps/api/src/server.test.ts
git commit -m "fix: inject HTTP runtime policy and readiness"
~~~

### Task 7: Verify PostgreSQL TLS and bound connection pools

**Files:**
- Modify: brand_poilot/apps/api/src/db.ts
- Modify: brand_poilot/apps/api/src/db.test.ts
- Modify: brand_poilot/workers/brand-pilot-dm-worker/src/db.ts
- Modify: brand_poilot/workers/brand-pilot-dm-worker/src/db.test.ts
- Modify: brand_poilot/scripts/migrationRunner.mjs
- Modify: brand_poilot/scripts/migrationRunner.test.mjs

**Working directory:** brand_poilot

- [ ] **Step 1: Replace insecure expectations with verified-TLS tests**

For Supabase URLs expect:

~~~typescript
expect(config.ssl).toEqual({ rejectUnauthorized: true });
expect(config).toMatchObject({
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});
~~~

Add a case whose caCertificate is included in config.ssl.ca. Add equivalent worker tests with max 2.

- [ ] **Step 2: Implement common pool behavior**

API resolvePoolConfig accepts:

~~~typescript
{
  max = 3,
  idleTimeoutMillis = 10_000,
  connectionTimeoutMillis = 10_000,
  caCertificate,
}: {
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  caCertificate?: string;
} = {}
~~~

Every URL receives the pool limits. Supabase hosts remove sslmode and receive:

~~~typescript
ssl: {
  rejectUnauthorized: true,
  ...(caCertificate ? { ca: caCertificate } : {}),
}
~~~

The DM/Wiki helper uses the same contract with max 2. The migration client uses verified TLS as well. There is no rejectUnauthorized:false fallback.

- [ ] **Step 3: Run focused tests**

~~~powershell
npm exec --workspace @brand-pilot/api -- vitest run src/db.test.ts --maxWorkers=1
npm exec --workspace @brand-pilot/dm-worker -- vitest run src/db.test.ts --maxWorkers=1
node --test scripts/migrationRunner.test.mjs
~~~

Expected: all pass. API plus two DM and one Wiki process can use at most nine configured pool connections.

- [ ] **Step 4: Commit**

~~~powershell
git add apps/api/src/db.ts apps/api/src/db.test.ts workers/brand-pilot-dm-worker/src/db.ts workers/brand-pilot-dm-worker/src/db.test.ts scripts/migrationRunner.mjs scripts/migrationRunner.test.mjs
git commit -m "fix: verify database TLS and bound pools"
~~~

### Task 8: Make disabled publication strictly read-only

**Files:**
- Modify: brand_poilot/apps/api/src/repository.ts
- Modify: brand_poilot/apps/api/src/repository.test.ts
- Modify: brand_poilot/apps/api/src/httpServer.ts
- Modify: brand_poilot/apps/api/src/server.test.ts
- Modify: brand_poilot/apps/api/.env.example

**Working directory:** brand_poilot

- [ ] **Step 1: Write zero-query tests**

~~~typescript
it("does not mutate publishing state when publishing is disabled", async () => {
  const query = vi.fn();
  const repository = createRepository({ query } as any, {
    instagramPublish: { enabled: false },
  });
  await expect(repository.publishQueueItem("queue-1")).rejects.toThrow(
    "publishing_disabled",
  );
  expect(query).not.toHaveBeenCalled();
});

it("runDuePublishing performs no queries when publishing is disabled", async () => {
  const query = vi.fn();
  const repository = createRepository({ query } as any, {
    instagramPublish: { enabled: false },
  });
  await expect(repository.runDuePublishing()).resolves.toEqual({
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
  });
  expect(query).not.toHaveBeenCalled();
});
~~~

- [ ] **Step 2: Add the guards before any SQL**

The first statement in publishQueueItemInternal is:

~~~typescript
if (!instagramPublish.enabled) throw new Error("publishing_disabled");
~~~

The first statements in runDuePublishing are:

~~~typescript
if (!instagramPublish.enabled) {
  return { processed: 0, created: 0, updated: 0, failed: 0 };
}
~~~

Map publishing_disabled to HTTP 503 with the same error code. Provider-path tests must explicitly construct the repository with enabled:true.

- [ ] **Step 3: Run focused and complete API tests**

~~~powershell
npm exec --workspace @brand-pilot/api -- vitest run src/repository.test.ts src/server.test.ts --maxWorkers=1
npm run test --workspace @brand-pilot/api
npm run build --workspace @brand-pilot/api
~~~

Expected: all commands exit 0 and disabled publication creates no queue, attempt, channel, or artifact mutation.

- [ ] **Step 4: Commit**

~~~powershell
git add apps/api/src/repository.ts apps/api/src/repository.test.ts apps/api/src/httpServer.ts apps/api/src/server.test.ts apps/api/.env.example
git commit -m "fix: make disabled publication read-only"
~~~

## Plan completion gate

Run from brand_poilot:

~~~powershell
npm run test:contract
node --test scripts/migrationRunner.test.mjs
npm run test:migrations
npm run test --workspace @brand-pilot/api
npm run test --workspace @brand-pilot/dm-worker
$env:VERCEL = "1"
$env:VITE_API_BASE_URL = "https://api.danbammsg.co.kr"
npm run build --workspace @brand-pilot/customer-ui
Remove-Item Env:VERCEL
Remove-Item Env:VITE_API_BASE_URL
npm run build --workspace @brand-pilot/api
~~~

Every command must exit 0 with fresh output. No production migration is executed. After this gate, continue with 2026-07-23-brand-pilot-ubuntu-api-deployment.md.
