import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDockerHeartbeatReader,
  loadApprovedPreview,
  runExecutionSmoke,
  waitForHeartbeatTicks,
} from "./publish-scheduler-smoke.mjs";

const preview = {
  observedAt: "2026-08-26T03:00:00.000Z",
  counts: {
    recoveredPublished: 0,
    resultUnknown: 0,
    expiredTargets: 0,
    expiredSlots: 0,
    delayedQueued: 0,
    providerCandidates: 1,
  },
  recovery: { publishedQueueIds: [], resultUnknownQueueIds: [] },
  expiry: { targetQueueIds: [], slotIds: [] },
  delayedQueueIds: [],
  providerCandidateQueueIds: ["queue-approved-1"],
};

const dueResult = {
  acquired: true,
  expiredTargets: 0,
  expiredSlots: 0,
  dueQueued: 1,
  published: 1,
  failed: 0,
  resultUnknown: 0,
};

async function withFakePrimary(handler, callback) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization, body });
    const result = await handler(request, requests.length);
    response.writeHead(result.status ?? 200, { "content-type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      primaryUrl: `http://127.0.0.1:${address.port}`,
      requests,
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("execution smoke proves preview is read-only, advances only the approved due ID, and is idempotent", async () => {
  let executions = 0;
  const logs = [];
  const result = await withFakePrimary((request) => {
    assert.equal(request.headers.authorization, "Bearer cron-secret");
    if (request.method === "GET" && request.url === "/internal/cron/publish-due/preview") {
      return { body: executions === 0 ? preview : {
        ...preview,
        observedAt: "2026-08-26T03:01:00.000Z",
        counts: { ...preview.counts, providerCandidates: 0 },
        providerCandidateQueueIds: [],
      } };
    }
    if (request.method === "POST" && request.url === "/internal/cron/publish-due") {
      executions += 1;
      return { body: executions === 1 ? dueResult : {
        ...dueResult,
        dueQueued: 0,
        published: 0,
      } };
    }
    return { status: 404, body: { error: "not_found" } };
  }, ({ primaryUrl, requests }) => runExecutionSmoke({
    primaryUrl,
    cronSecret: "cron-secret",
    approvedPreview: preview,
    allowLoopback: true,
    logger: (entry) => logs.push(entry),
  }).then((value) => ({ value, requests })));

  assert.equal(result.value.executedCandidateCount, 1);
  assert.deepEqual(result.requests.map(({ method, url }) => `${method} ${url}`), [
    "GET /internal/cron/publish-due/preview",
    "GET /internal/cron/publish-due/preview",
    "POST /internal/cron/publish-due",
    "GET /internal/cron/publish-due/preview",
    "POST /internal/cron/publish-due",
    "GET /internal/cron/publish-due/preview",
  ]);
  assert.equal(result.requests.some(({ url }) => /canary/i.test(url)), false);
  const { observedAt: _observedAt, ...approvedPreview } = preview;
  assert.deepEqual(logs[0], {
    event: "publish_scheduler_preview_approved",
    preview: approvedPreview,
  });
  assert.deepEqual(logs.at(-1), {
    event: "publish_scheduler_execution_smoke_passed",
    approvedCandidateIds: ["queue-approved-1"],
    published: 1,
  });
});

test("execution smoke stops before mutation for unexpected candidates or count mismatches", async () => {
  const unexpected = {
    ...preview,
    counts: { ...preview.counts, providerCandidates: 2 },
    providerCandidateQueueIds: ["queue-approved-1", "queue-unexpected"],
  };
  await withFakePrimary((request) => ({ body: request.method === "GET" ? unexpected : dueResult }), async ({ primaryUrl, requests }) => {
    await assert.rejects(
      runExecutionSmoke({
        primaryUrl,
        cronSecret: "cron-secret",
        approvedPreview: preview,
        allowLoopback: true,
        logger: () => undefined,
      }),
      /publish_scheduler_preview_mismatch/,
    );
    assert.equal(requests.some(({ method }) => method === "POST"), false);
  });
});

test("execution smoke rejects canary URLs and sanitizes HTTP response content", async () => {
  await assert.rejects(
    runExecutionSmoke({
      primaryUrl: "https://api-canary.example.com",
      cronSecret: "top-secret",
      approvedPreview: preview,
      logger: () => undefined,
    }),
    /publish_scheduler_primary_url_required/,
  );

  const logs = [];
  let message = "";
  await withFakePrimary(() => ({
    status: 500,
    body: { customerText: "private customer caption", secret: "top-secret", error: "provider failed" },
  }), async ({ primaryUrl }) => {
    try {
      await runExecutionSmoke({
        primaryUrl,
        cronSecret: "top-secret",
        approvedPreview: preview,
        allowLoopback: true,
        logger: (entry) => logs.push(entry),
      });
    } catch (error) {
      message = error.message;
    }
  });
  const rendered = JSON.stringify({ logs, message });
  assert.doesNotMatch(rendered, /private customer caption|top-secret|provider failed/);
  assert.match(rendered, /publish_scheduler_http_failure/);
});

test("execution smoke accepts only the exact public primary hostname", async () => {
  const calls = [];
  await assert.rejects(
    runExecutionSmoke({
      primaryUrl: "https://api.danbammsg.co.kr.example.com",
      cronSecret: "cron-secret",
      approvedPreview: preview,
      fetchImpl: async (...args) => { calls.push(args); },
      logger: () => undefined,
    }),
    /publish_scheduler_primary_url_required/,
  );
  assert.equal(calls.length, 0);
});

test("execution smoke bounds a stalled primary request without leaking request data", async () => {
  let message = "";
  try {
    await runExecutionSmoke({
      primaryUrl: "http://127.0.0.1:4000",
      cronSecret: "top-secret",
      approvedPreview: preview,
      allowLoopback: true,
      requestTimeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("private customer caption top-secret");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
      logger: () => undefined,
    });
  } catch (error) {
    message = error.message;
  }
  assert.equal(message, "publish_scheduler_request_timeout");
});

test("execution smoke rejects control characters in the cron secret before any request", async () => {
  const calls = [];
  await assert.rejects(
    runExecutionSmoke({
      primaryUrl: "http://127.0.0.1:4000",
      cronSecret: "secret\nprivate customer caption",
      approvedPreview: preview,
      allowLoopback: true,
      fetchImpl: async (...args) => { calls.push(args); },
      logger: () => undefined,
    }),
    /^Error: publish_scheduler_cron_secret_invalid$/,
  );
  assert.equal(calls.length, 0);
});

test("approved preview file accepts IDs only and derives exact counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "publish-scheduler-approved-"));
  const path = join(directory, "approved.json");
  await writeFile(path, JSON.stringify({
    recovery: { publishedQueueIds: [], resultUnknownQueueIds: [] },
    expiry: { targetQueueIds: [], slotIds: [] },
    delayedQueueIds: [],
    providerCandidateQueueIds: ["queue-approved-1"],
  }));
  const approved = await loadApprovedPreview(path);
  const { observedAt: _observedAt, ...expected } = preview;
  assert.deepEqual(approved, expected);
});

test("heartbeat smoke observes three distinct successful tick updates", async () => {
  const heartbeats = [
    { schemaVersion: 1, pid: 10, lastSuccessAt: null, inFlightSince: "2026-08-26T02:59:59.000Z", lastAllocationBucket: null },
    { schemaVersion: 1, pid: 10, lastSuccessAt: "2026-08-26T03:01:00.000Z", inFlightSince: "2026-08-26T03:01:59.000Z", lastAllocationBucket: null },
    { schemaVersion: 1, pid: 10, lastSuccessAt: "2026-08-26T03:01:00.000Z", inFlightSince: null, lastAllocationBucket: null },
    { schemaVersion: 1, pid: 10, lastSuccessAt: "2026-08-26T03:02:00.000Z", inFlightSince: null, lastAllocationBucket: null },
    { schemaVersion: 1, pid: 10, lastSuccessAt: "2026-08-26T03:03:00.000Z", inFlightSince: null, lastAllocationBucket: null },
  ];
  let readIndex = 0;
  const logs = [];
  const result = await waitForHeartbeatTicks({
    heartbeatPath: "/tmp/heartbeat.json",
    ticks: 3,
    timeoutMs: 1_000,
    pollMs: 1,
    readHeartbeat: async () => JSON.stringify(heartbeats[Math.min(readIndex++, heartbeats.length - 1)]),
    sleep: async () => undefined,
    nowMs: (() => { let value = 0; return () => value += 10; })(),
    logger: (entry) => logs.push(entry),
  });
  assert.equal(result.ticksObserved, 3);
  assert.equal(result.lastSuccessAt, "2026-08-26T03:03:00.000Z");
  assert.deepEqual(logs.at(-1), {
    event: "publish_scheduler_heartbeat_smoke_passed",
    ticksObserved: 3,
    lastSuccessAt: "2026-08-26T03:03:00.000Z",
  });
});

test("heartbeat smoke fails closed for stale or malformed heartbeat content without echoing it", async () => {
  const secretPayload = JSON.stringify({ schemaVersion: 1, pid: 10, lastSuccessAt: null, inFlightSince: null, customerText: "private caption" });
  let message = "";
  try {
    await waitForHeartbeatTicks({
      heartbeatPath: "/tmp/heartbeat.json",
      ticks: 1,
      timeoutMs: 20,
      pollMs: 1,
      readHeartbeat: async () => secretPayload,
      sleep: async () => undefined,
      nowMs: (() => { let value = 0; return () => value += 10; })(),
      logger: () => undefined,
    });
  } catch (error) {
    message = error.message;
  }
  assert.equal(message, "publish_scheduler_heartbeat_invalid");
  assert.doesNotMatch(message, /private caption/);
});

test("Docker heartbeat reader uses argv without a shell and sanitizes command failures", async () => {
  const calls = [];
  const readHeartbeat = createDockerHeartbeatReader({
    containerId: "0123456789abcdef",
    execFileImpl: async (...args) => {
      calls.push(args);
      return { stdout: '{"schemaVersion":1}' };
    },
  });
  assert.equal(await readHeartbeat("/tmp/heartbeat.json"), '{"schemaVersion":1}');
  assert.deepEqual(calls, [[
    "docker",
    ["exec", "0123456789abcdef", "node", "-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))", "/tmp/heartbeat.json"],
    { encoding: "utf8", windowsHide: true },
  ]]);

  const failingReader = createDockerHeartbeatReader({
    containerId: "0123456789abcdef",
    execFileImpl: async () => { throw new Error("private caption and top-secret"); },
  });
  await assert.rejects(failingReader("/tmp/heartbeat.json"), /^Error: publish_scheduler_heartbeat_read_failed$/);
});

test("package exposes the smoke command without adding a dependency", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["smoke:publish-scheduler"], "node scripts/publish-scheduler-smoke.mjs");
});
