import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startProcess } from "./index.mjs";
import {
  createScheduler,
  loadConfig,
  writeHeartbeatAtomic,
} from "./scheduler.mjs";
import { evaluateHeartbeat } from "./healthcheck.mjs";

const dueResult = {
  acquired: true,
  expiredTargets: 1,
  expiredSlots: 1,
  dueQueued: 2,
  published: 2,
  failed: 0,
  resultUnknown: 0,
};

const allocationResult = {
  brandsSelected: 2,
  openSlotsCreated: 4,
  proposalsAssigned: 2,
  quotaBlocked: 0,
  brandsFailed: 0,
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function createHarness({
  now = "2026-08-25T20:00:00.000Z", // 2026-08-26 05:00 KST, before allocation starts
  fetchImpl = async () => jsonResponse(dueResult),
  timeoutMs = 5_000,
} = {}) {
  let current = new Date(now);
  let interval;
  const requests = [];
  const logs = [];
  const heartbeats = [];
  const wrappedFetch = async (url, init) => {
    requests.push({ url, init });
    return fetchImpl(url, init);
  };
  const scheduler = createScheduler({
    config: {
      primaryApiInternalUrl: "http://api-primary:4000",
      cronSecret: "top-secret-customer-text",
      tickMs: 60_000,
      timeoutMs,
    },
    fetchImpl: wrappedFetch,
    now: () => new Date(current),
    setIntervalFn: (fn, ms) => {
      interval = { fn, ms, cleared: false };
      return interval;
    },
    clearIntervalFn: (timer) => { timer.cleared = true; },
    writeHeartbeat: async (heartbeat) => { heartbeats.push(heartbeat); },
    logger: (entry) => { logs.push(entry); },
    pid: 4321,
  });
  return {
    scheduler,
    requests,
    logs,
    heartbeats,
    get interval() { return interval; },
    setNow(value) { current = new Date(value); },
  };
}

test("configuration accepts only the exact primary URL and reads the bearer secret from a file", async () => {
  const readPaths = [];
  const config = await loadConfig({
    PRIMARY_API_INTERNAL_URL: "http://api-primary:4000/",
    CRON_SECRET_FILE: "/run/secrets/cron-secret",
    PUBLISH_TIMEOUT_MS: "240000",
    CRON_SECRET: "must-not-be-read",
    DATABASE_URL: "must-not-be-read",
  }, async (path) => {
    readPaths.push(path);
    return "file-secret\n";
  });

  assert.deepEqual(config, {
    primaryApiInternalUrl: "http://api-primary:4000",
    cronSecret: "file-secret",
    tickMs: 60_000,
    timeoutMs: 240_000,
  });
  assert.deepEqual(readPaths, ["/run/secrets/cron-secret"]);

  for (const invalidSecret of [
    "secret\nsecond-line",
    "secret\n\n",
    "secret\r\n",
    "secret\0suffix",
    "secret\tvalue",
    "secret\u007fvalue",
    "secret\u2028value",
    "secret\u2029value",
  ]) {
    await assert.rejects(
      loadConfig({
        PRIMARY_API_INTERNAL_URL: "http://api-primary:4000",
        CRON_SECRET_FILE: "/secret",
        PUBLISH_TIMEOUT_MS: "1",
      }, async () => invalidSecret),
      /CRON_SECRET_FILE/,
    );
  }

  for (const url of [
    "https://api-primary:4000",
    "http://api-primary:4001",
    "http://api-canary:4000",
    "http://api-primary:4000/path",
    "http://user@api-primary:4000",
  ]) {
    await assert.rejects(
      loadConfig({ PRIMARY_API_INTERNAL_URL: url, CRON_SECRET_FILE: "/secret", PUBLISH_TIMEOUT_MS: "1" }, async () => "secret"),
      /PRIMARY_API_INTERNAL_URL/,
    );
  }
  await assert.rejects(
    loadConfig({ PRIMARY_API_INTERNAL_URL: "http://api-primary:4000", CRON_SECRET_FILE: "/secret" }, async () => "secret"),
    /PUBLISH_TIMEOUT_MS/,
  );
  await assert.rejects(
    loadConfig({ PRIMARY_API_INTERNAL_URL: "http://api-primary:4000", CRON_SECRET_FILE: "/secret", PUBLISH_TIMEOUT_MS: "0" }, async () => "secret"),
    /PUBLISH_TIMEOUT_MS/,
  );
  await assert.rejects(
    loadConfig({ PRIMARY_API_INTERNAL_URL: "http://api-primary:4000", CRON_SECRET_FILE: "/secret", PUBLISH_TICK_MS: "1.5", PUBLISH_TIMEOUT_MS: "1" }, async () => "secret"),
    /PUBLISH_TICK_MS/,
  );
});

test("start runs due immediately, schedules 60-second ticks, and writes a count-only heartbeat", async () => {
  const harness = createHarness();
  await harness.scheduler.start();

  assert.equal(harness.interval.ms, 60_000);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, "http://api-primary:4000/internal/cron/publish-due");
  assert.equal(harness.requests[0].init.method, "POST");
  assert.equal(harness.requests[0].init.redirect, "error");
  assert.equal(harness.requests[0].init.headers.authorization, "Bearer top-secret-customer-text");
  assert.deepEqual(harness.heartbeats.at(-1), {
    schemaVersion: 1,
    pid: 4321,
    lastSuccessAt: "2026-08-25T20:00:00.000Z",
    inFlightSince: null,
    lastAllocationBucket: null,
  });
  assert.deepEqual(harness.logs.at(-1), { event: "publish_due_succeeded", ...dueResult });
  assert.equal(JSON.stringify(harness.logs).includes("top-secret"), false);

  harness.interval.fn();
  while (harness.requests.length < 2) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.requests.length, 2);
});

test("allocation runs after due in KST hourly :20 buckets, dedupes success, and retries a failed bucket", async () => {
  let allocationAttempts = 0;
  const order = [];
  const harness = createHarness({
    now: "2026-08-25T20:19:59.000Z", // 2026-08-26 05:19:59 KST
    fetchImpl: async (url) => {
      if (url.endsWith("publish-due")) {
        order.push("due");
        return jsonResponse(dueResult);
      }
      order.push("allocation");
      allocationAttempts += 1;
      return allocationAttempts === 1
        ? jsonResponse({ error: "do-not-log-this-body" }, 503)
        : jsonResponse(allocationResult);
    },
  });

  await harness.scheduler.tick();
  assert.deepEqual(order, ["due"]);

  harness.setNow("2026-08-25T20:20:00.000Z");
  await harness.scheduler.tick();
  assert.deepEqual(order.slice(-2), ["due", "allocation"]);

  harness.setNow("2026-08-25T20:21:00.000Z");
  await harness.scheduler.tick();
  assert.deepEqual(order.slice(-2), ["due", "allocation"]);

  harness.setNow("2026-08-25T20:22:00.000Z");
  await harness.scheduler.tick();
  assert.equal(order.at(-1), "due");

  harness.setNow("2026-08-25T21:20:00.000Z");
  await harness.scheduler.tick();
  assert.deepEqual(order.slice(-2), ["due", "allocation"]);
  assert.equal(JSON.stringify(harness.logs).includes("do-not-log-this-body"), false);
});

test("a second tick skips while the first due request is active", async () => {
  let resolveFetch;
  const firstFetch = new Promise((resolve) => { resolveFetch = resolve; });
  const harness = createHarness({ fetchImpl: () => firstFetch });

  const first = harness.scheduler.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await harness.scheduler.tick();
  assert.deepEqual(second, { skipped: true });
  assert.equal(harness.requests.length, 1);
  assert.deepEqual(harness.logs.at(-1), { event: "publish_tick_skipped_overlap" });

  resolveFetch(jsonResponse(dueResult));
  await first;
  await harness.scheduler.tick();
  assert.equal(harness.requests.length, 2);
});

test("a slow allocation remains heartbeat-visible as in flight until it settles", async () => {
  let resolveAllocation;
  const allocationResponse = new Promise((resolve) => { resolveAllocation = resolve; });
  const harness = createHarness({
    now: "2026-08-25T20:20:00.000Z",
    timeoutMs: 240_000,
    fetchImpl: async (url) => url.endsWith("publish-due")
      ? jsonResponse(dueResult)
      : allocationResponse,
  });

  const ticking = harness.scheduler.tick();
  while (harness.requests.length < 2) await new Promise((resolve) => setImmediate(resolve));

  const activeHeartbeat = harness.heartbeats.at(-1);
  resolveAllocation(jsonResponse(allocationResult));
  await ticking;

  assert.equal(activeHeartbeat.inFlightSince, "2026-08-25T20:20:00.000Z");
  assert.deepEqual(evaluateHeartbeat(activeHeartbeat, {
    now: new Date("2026-08-25T20:24:59.000Z"),
    tickMs: 60_000,
    timeoutMs: 240_000,
    isPidAlive: () => true,
  }), { healthy: true });

  assert.equal(harness.heartbeats.at(-1).inFlightSince, null);
});

test("timeout aborts a request and the next tick recovers", async () => {
  let attempts = 0;
  const harness = createHarness({
    timeoutMs: 10,
    fetchImpl: async (_url, init) => {
      attempts += 1;
      if (attempts > 1) return jsonResponse(dueResult);
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("secret-url"), { name: "AbortError" })));
      });
    },
  });

  await harness.scheduler.tick();
  assert.deepEqual(harness.logs.at(-1), { event: "publish_due_failed", failure: "timeout" });
  await harness.scheduler.tick();
  assert.equal(attempts, 2);
  assert.equal(harness.logs.at(-1).event, "publish_due_succeeded");
  assert.equal(JSON.stringify(harness.logs).includes("secret-url"), false);
});

test("401, 409, 5xx, invalid JSON, and invalid DTO are sanitized and recover on later ticks", async () => {
  const responses = [
    jsonResponse({ error: "secret-401-body" }, 401),
    jsonResponse({ error: "secret-409-body" }, 409),
    jsonResponse({ error: "secret-500-body" }, 500),
    { ok: true, status: 200, async json() { throw new SyntaxError("customer-text"); } },
    jsonResponse({ acquired: true, customerText: "private" }),
    jsonResponse(dueResult),
  ];
  const harness = createHarness({ fetchImpl: async () => responses.shift() });

  for (let index = 0; index < 6; index += 1) await harness.scheduler.tick();

  assert.deepEqual(
    harness.logs.map((entry) => [entry.event, entry.failure, entry.status]),
    [
      ["publish_due_failed", "http", 401],
      ["publish_due_failed", "primary_fenced", 409],
      ["publish_due_failed", "http", 500],
      ["publish_due_failed", "invalid_json", undefined],
      ["publish_due_failed", "invalid_dto", undefined],
      ["publish_due_succeeded", undefined, undefined],
    ],
  );
  const serialized = JSON.stringify(harness.logs);
  for (const forbidden of ["secret-401-body", "secret-409-body", "secret-500-body", "customer-text", "private", "api-primary"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("a network failure is sanitized and does not prevent a successful next tick", async () => {
  let attempts = 0;
  const harness = createHarness({
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("http://api-primary:4000/private-customer");
      return jsonResponse(dueResult);
    },
  });

  await harness.scheduler.tick();
  await harness.scheduler.tick();

  assert.deepEqual(harness.logs[0], { event: "publish_due_failed", failure: "network" });
  assert.equal(harness.logs.at(-1).event, "publish_due_succeeded");
  assert.equal(JSON.stringify(harness.logs).includes("private-customer"), false);
});

test("heartbeat writes atomically with mode 0600 and health validates PID, future, stale, and in-flight allowance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "publish-scheduler-"));
  const path = join(directory, "heartbeat.json");
  await writeHeartbeatAtomic(path, {
    schemaVersion: 1,
    pid: process.pid,
    lastSuccessAt: "2026-08-26T00:00:00.000Z",
    inFlightSince: null,
    lastAllocationBucket: "2026-08-26T09:20",
  });
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.pid, process.pid);

  const base = {
    now: new Date("2026-08-26T00:01:30.000Z"),
    tickMs: 60_000,
    timeoutMs: 240_000,
    isPidAlive: () => true,
  };
  assert.deepEqual(evaluateHeartbeat(parsed, base), { healthy: true });
  assert.deepEqual(evaluateHeartbeat(parsed, {
    ...base,
    now: new Date("2026-08-26T00:02:30.000Z"),
  }), { healthy: true });
  assert.equal(evaluateHeartbeat({ ...parsed, pid: -1 }, base).healthy, false);
  assert.equal(evaluateHeartbeat({ ...parsed, lastSuccessAt: "2026-08-26T00:02:00.000Z" }, base).healthy, false);
  assert.equal(evaluateHeartbeat({ ...parsed, lastSuccessAt: "2026-08-25T23:58:00.000Z" }, base).healthy, false);
  assert.deepEqual(evaluateHeartbeat({
    ...parsed,
    lastSuccessAt: null,
    inFlightSince: "2026-08-25T23:57:00.000Z",
  }, base), { healthy: true });
  assert.equal(evaluateHeartbeat({
    ...parsed,
    lastSuccessAt: "2026-08-26T00:02:00.000Z",
    inFlightSince: "2026-08-26T00:01:00.000Z",
  }, base).healthy, false);
  assert.equal(evaluateHeartbeat({
    ...parsed,
    lastSuccessAt: null,
    inFlightSince: "2026-08-25T23:56:00.000Z",
  }, base).healthy, false);
  assert.equal(evaluateHeartbeat(parsed, { ...base, isPidAlive: () => false }).healthy, false);
});

test("graceful stop clears the timer, aborts the active request, and prevents new work", async () => {
  let aborted = false;
  let rejectRequest;
  const harness = createHarness({
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      rejectRequest = reject;
      init.signal.addEventListener("abort", () => {
        aborted = true;
      });
    }),
  });
  const start = harness.scheduler.start();
  while (harness.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const stopping = harness.scheduler.stop();
  let stopSettled = false;
  stopping.then(() => { stopSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(aborted, true);
  assert.equal(stopSettled, false);
  assert.deepEqual(await harness.scheduler.tick(), { stopped: true });
  assert.equal(harness.requests.length, 1);

  rejectRequest(Object.assign(new Error("aborted"), { name: "AbortError" }));
  await stopping;
  await start;

  assert.equal(stopSettled, true);
  assert.equal(harness.interval.cleared, true);
  assert.equal(harness.requests.length, 1);
});

test("process entrypoint loads file-backed config and handles SIGTERM without exposing configuration", async () => {
  let signalHandler;
  let started = 0;
  let stopped = 0;
  let finishStop;
  const logs = [];
  const processLike = {
    env: {
      PRIMARY_API_INTERNAL_URL: "http://api-primary:4000",
      CRON_SECRET_FILE: "/run/secrets/cron-secret",
      PUBLISH_TIMEOUT_MS: "240000",
    },
    once(signal, handler) {
      assert.equal(signal, "SIGTERM");
      signalHandler = handler;
    },
  };

  await startProcess({
    processLike,
    readSecretFile: async () => "entry-secret",
    schedulerFactory: ({ config }) => {
      assert.equal(config.cronSecret, "entry-secret");
      return {
        async start() { started += 1; },
        async stop() {
          stopped += 1;
          await new Promise((resolve) => { finishStop = resolve; });
        },
      };
    },
    logger: (entry) => logs.push(entry),
  });
  const signalCompletion = signalHandler();
  let signalSettled = false;
  signalCompletion.then(() => { signalSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(started, 1);
  assert.equal(stopped, 1);
  assert.equal(signalSettled, false);
  assert.deepEqual(logs, [{ event: "publish_scheduler_stopping" }]);

  finishStop();
  await signalCompletion;
  assert.equal(signalSettled, true);
  assert.deepEqual(logs.at(-1), { event: "publish_scheduler_stopped" });
  assert.equal(JSON.stringify(logs).includes("entry-secret"), false);
});

test("Dockerfile is dependency-free, Node 22 slim, non-root, and healthchecked", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^HEALTHCHECK /m);
  assert.match(dockerfile, /CMD \["node", "src\/index\.mjs"\]/);
  assert.doesNotMatch(dockerfile, /\bnpm\b|package\.json|package-lock/);
});
