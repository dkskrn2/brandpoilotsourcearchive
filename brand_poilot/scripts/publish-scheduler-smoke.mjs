import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const PREVIEW_PATH = "/internal/cron/publish-due/preview";
const EXECUTE_PATH = "/internal/cron/publish-due";
const PREVIEW_ID_FIELDS = [
  ["recovery", "publishedQueueIds"],
  ["recovery", "resultUnknownQueueIds"],
  ["expiry", "targetQueueIds"],
  ["expiry", "slotIds"],
  [null, "delayedQueueIds"],
  [null, "providerCandidateQueueIds"],
];
const COUNT_FIELDS = {
  recoveredPublished: ["recovery", "publishedQueueIds"],
  resultUnknown: ["recovery", "resultUnknownQueueIds"],
  expiredTargets: ["expiry", "targetQueueIds"],
  expiredSlots: ["expiry", "slotIds"],
  delayedQueued: [null, "delayedQueueIds"],
  providerCandidates: [null, "providerCandidateQueueIds"],
};
const DUE_COUNT_FIELDS = ["expiredTargets", "expiredSlots", "dueQueued", "published", "failed", "resultUnknown"];

function smokeError(code, status) {
  return new Error(status === undefined ? code : `${code}:${status}`);
}

function exactPrimaryUrl(rawUrl, allowLoopback = false) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw smokeError("publish_scheduler_primary_url_required");
  }
  const productionPrimary = url.protocol === "http:" && url.hostname === "api-primary" && url.port === "4000";
  const publicPrimary = url.protocol === "https:" && url.hostname === "api.danbammsg.co.kr" && url.port === "";
  const loopback = allowLoopback
    && url.protocol === "http:"
    && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    && url.port !== "";
  if ((!productionPrimary && !publicPrimary && !loopback)
    || url.username || url.password || url.search || url.hash
    || !["", "/"].includes(url.pathname)) {
    throw smokeError("publish_scheduler_primary_url_required");
  }
  return url.origin;
}

function idsAt(value, [parent, field]) {
  return parent ? value?.[parent]?.[field] : value?.[field];
}

function validateIdList(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function sameIdSet(actual, expected) {
  return validateIdList(actual)
    && validateIdList(expected)
    && actual.length === expected.length
    && actual.every((id) => new Set(expected).has(id));
}

function canonicalPreview(value, { requireObservedAt }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw smokeError("publish_scheduler_preview_invalid");
  }
  if (requireObservedAt && (typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)))) {
    throw smokeError("publish_scheduler_preview_invalid");
  }
  if (!value.counts || typeof value.counts !== "object" || Array.isArray(value.counts)) {
    throw smokeError("publish_scheduler_preview_invalid");
  }
  for (const path of PREVIEW_ID_FIELDS) {
    if (!validateIdList(idsAt(value, path))) throw smokeError("publish_scheduler_preview_invalid");
  }
  const counts = {};
  for (const [field, path] of Object.entries(COUNT_FIELDS)) {
    const count = value.counts[field];
    if (!Number.isSafeInteger(count) || count < 0 || count !== idsAt(value, path).length) {
      throw smokeError("publish_scheduler_preview_invalid");
    }
    counts[field] = count;
  }
  return {
    counts,
    recovery: {
      publishedQueueIds: [...value.recovery.publishedQueueIds].sort(),
      resultUnknownQueueIds: [...value.recovery.resultUnknownQueueIds].sort(),
    },
    expiry: {
      targetQueueIds: [...value.expiry.targetQueueIds].sort(),
      slotIds: [...value.expiry.slotIds].sort(),
    },
    delayedQueueIds: [...value.delayedQueueIds].sort(),
    providerCandidateQueueIds: [...value.providerCandidateQueueIds].sort(),
  };
}

function emptyPreview(value) {
  return PREVIEW_ID_FIELDS.every((path) => idsAt(value, path).length === 0);
}

function samePreview(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateApprovedPreview(value) {
  const canonical = canonicalPreview(value, { requireObservedAt: false });
  const nonProviderIds = PREVIEW_ID_FIELDS
    .filter(([parent, field]) => !(parent === null && field === "providerCandidateQueueIds"))
    .flatMap((path) => idsAt(canonical, path));
  if (nonProviderIds.length > 0 || canonical.providerCandidateQueueIds.length === 0) {
    throw smokeError("publish_scheduler_approved_preview_must_contain_only_due_candidates");
  }
  return canonical;
}

function validateDueResult(value, expectedProviderCandidateQueueIds) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.acquired !== "boolean") {
    throw smokeError("publish_scheduler_execute_invalid");
  }
  for (const field of DUE_COUNT_FIELDS) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw smokeError("publish_scheduler_execute_invalid");
    }
  }
  const selected = value.selectedProviderCandidateQueueIds;
  const processed = value.processedProviderCandidateQueueIds;
  if (!sameIdSet(selected, expectedProviderCandidateQueueIds)
    || !sameIdSet(processed, expectedProviderCandidateQueueIds)) {
    throw smokeError("publish_scheduler_execute_mismatch");
  }
  return {
    ...Object.fromEntries(["acquired", ...DUE_COUNT_FIELDS].map((field) => [field, value[field]])),
    selectedProviderCandidateQueueIds: selected,
    processedProviderCandidateQueueIds: processed,
  };
}

async function requestJson({ url, method, body, cronSecret, fetchImpl, requestTimeoutMs }) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${cronSecret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw smokeError("publish_scheduler_http_failure", Number.isInteger(response?.status) ? response.status : 0);
    }
    try {
      return await response.json();
    } catch {
      throw smokeError("publish_scheduler_invalid_json");
    }
  } catch (error) {
    if (timedOut) throw smokeError("publish_scheduler_request_timeout");
    if (error instanceof Error && error.message.startsWith("publish_scheduler_")) throw error;
    throw smokeError("publish_scheduler_network_failure");
  } finally {
    clearTimeout(timeout);
  }
}

async function getPreview(input) {
  return canonicalPreview(await requestJson({
    ...input,
    method: "GET",
    url: `${input.primaryUrl}${PREVIEW_PATH}`,
  }), { requireObservedAt: true });
}

async function executeDue(input, expectedProviderCandidateQueueIds) {
  return validateDueResult(await requestJson({
    ...input,
    method: "POST",
    url: `${input.primaryUrl}${EXECUTE_PATH}`,
    body: { expectedProviderCandidateQueueIds },
  }), expectedProviderCandidateQueueIds);
}

export async function loadApprovedPreview(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw smokeError("publish_scheduler_approved_preview_invalid");
  }
  const withCounts = {
    ...value,
    counts: Object.fromEntries(Object.entries(COUNT_FIELDS).map(([field, idPath]) => [field, idsAt(value, idPath)?.length])),
  };
  return validateApprovedPreview(withCounts);
}

export async function runExecutionSmoke({
  primaryUrl: rawPrimaryUrl,
  cronSecret,
  approvedPreview,
  fetchImpl = globalThis.fetch,
  allowLoopback = false,
  requestTimeoutMs = 30_000,
  logger = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
}) {
  const primaryUrl = exactPrimaryUrl(rawPrimaryUrl, allowLoopback);
  if (typeof cronSecret !== "string" || cronSecret.length === 0) throw smokeError("publish_scheduler_cron_secret_required");
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(cronSecret)) throw smokeError("publish_scheduler_cron_secret_invalid");
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw smokeError("publish_scheduler_request_timeout_invalid");
  }
  const approved = validateApprovedPreview(approvedPreview);
  const requestInput = { primaryUrl, cronSecret, fetchImpl, requestTimeoutMs };

  const firstPreview = await getPreview(requestInput);
  const secondPreview = await getPreview(requestInput);
  if (!samePreview(firstPreview, approved) || !samePreview(secondPreview, approved)) {
    throw smokeError("publish_scheduler_preview_mismatch");
  }
  logger({ event: "publish_scheduler_preview_approved", preview: approved });

  const expectedCount = approved.providerCandidateQueueIds.length;
  const firstRun = await executeDue(requestInput, approved.providerCandidateQueueIds);
  if (!firstRun.acquired
    || firstRun.expiredTargets !== 0
    || firstRun.expiredSlots !== 0
    || firstRun.dueQueued !== expectedCount
    || firstRun.published !== expectedCount
    || firstRun.failed !== 0
    || firstRun.resultUnknown !== 0) {
    throw smokeError("publish_scheduler_execute_mismatch");
  }

  const afterFirst = await getPreview(requestInput);
  if (!emptyPreview(afterFirst)) throw smokeError("publish_scheduler_post_execute_candidates_remain");

  const secondRun = await executeDue(requestInput, []);
  if (!secondRun.acquired || DUE_COUNT_FIELDS.some((field) => secondRun[field] !== 0)) {
    throw smokeError("publish_scheduler_second_execute_not_idempotent");
  }
  const afterSecond = await getPreview(requestInput);
  if (!emptyPreview(afterSecond)) throw smokeError("publish_scheduler_second_execute_candidates_remain");

  const result = {
    event: "publish_scheduler_execution_smoke_passed",
    approvedCandidateIds: approved.providerCandidateQueueIds,
    published: firstRun.published,
  };
  logger(result);
  return { executedCandidateCount: expectedCount };
}

function parseHeartbeat(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw smokeError("publish_scheduler_heartbeat_invalid");
  }
  const keys = Object.keys(value ?? {}).sort();
  const expectedKeys = ["inFlightSince", "lastAllocationBucket", "lastSuccessAt", "pid", "schemaVersion"].sort();
  const lastSuccessValid = value?.lastSuccessAt === null
    || (typeof value?.lastSuccessAt === "string" && Number.isFinite(Date.parse(value.lastSuccessAt)));
  const inFlightValid = value?.inFlightSince === null
    || (typeof value?.inFlightSince === "string" && Number.isFinite(Date.parse(value.inFlightSince)));
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.pid) || value.pid <= 0
    || !inFlightValid
    || (value.lastAllocationBucket !== null && typeof value.lastAllocationBucket !== "string")
    || !lastSuccessValid) {
    throw smokeError("publish_scheduler_heartbeat_invalid");
  }
  return value;
}

export async function waitForHeartbeatTicks({
  heartbeatPath,
  ticks = 3,
  timeoutMs = 240_000,
  pollMs = 1_000,
  readHeartbeat = (path) => readFile(path, "utf8"),
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  nowMs = Date.now,
  logger = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
}) {
  if (!Number.isSafeInteger(ticks) || ticks <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw smokeError("publish_scheduler_heartbeat_options_invalid");
  }
  const deadline = nowMs() + timeoutMs;
  const boundedRead = async () => {
    const remainingMs = deadline - nowMs();
    if (remainingMs <= 0) throw smokeError("publish_scheduler_heartbeat_stale");
    let timeout;
    try {
      return await Promise.race([
        readHeartbeat(heartbeatPath, remainingMs),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(smokeError("publish_scheduler_heartbeat_stale")), remainingMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const baseline = parseHeartbeat(await boundedRead());
  let lastTimestamp = baseline.lastSuccessAt === null ? Number.NEGATIVE_INFINITY : Date.parse(baseline.lastSuccessAt);
  let ticksObserved = 0;
  let lastSuccessAt = baseline.lastSuccessAt;
  let settled = false;
  while ((!settled || ticksObserved < ticks) && nowMs() <= deadline) {
    await sleep(pollMs);
    const heartbeat = parseHeartbeat(await boundedRead());
    if (heartbeat.lastSuccessAt === null) continue;
    const timestamp = Date.parse(heartbeat.lastSuccessAt);
    if (timestamp > lastTimestamp) {
      ticksObserved += 1;
      lastTimestamp = timestamp;
      lastSuccessAt = heartbeat.lastSuccessAt;
    }
    settled = ticksObserved >= ticks && timestamp >= lastTimestamp && heartbeat.inFlightSince === null;
  }
  if (ticksObserved !== ticks || !settled) throw smokeError("publish_scheduler_heartbeat_stale");
  const result = { event: "publish_scheduler_heartbeat_smoke_passed", ticksObserved, lastSuccessAt };
  logger(result);
  return result;
}

export function createDockerHeartbeatReader({ containerId, execFileImpl = execFileAsync }) {
  if (typeof containerId !== "string" || !/^[0-9a-f]{12,64}$/.test(containerId)) {
    throw smokeError("publish_scheduler_heartbeat_container_invalid");
  }
  return async (heartbeatPath, remainingMs = 5_000) => {
    try {
      const { stdout } = await execFileImpl("docker", [
        "exec",
        containerId,
        "node",
        "-e",
        "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))",
        heartbeatPath,
      ], { encoding: "utf8", windowsHide: true, timeout: remainingMs, killSignal: "SIGKILL" });
      return stdout;
    } catch {
      throw smokeError("publish_scheduler_heartbeat_read_failed");
    }
  };
}

async function main() {
  const phase = process.argv.find((argument) => argument.startsWith("--phase="))?.slice("--phase=".length) ?? "execution";
  if (phase === "execution") {
    const primaryUrl = process.env.PUBLISH_SCHEDULER_PRIMARY_URL;
    const approvedPath = process.env.PUBLISH_SCHEDULER_APPROVED_PREVIEW_FILE;
    const secretPath = process.env.CRON_SECRET_FILE;
    if (!approvedPath) throw smokeError("publish_scheduler_approved_preview_file_required");
    if (!secretPath) throw smokeError("publish_scheduler_cron_secret_file_required");
    const cronSecret = (await readFile(secretPath, "utf8")).replace(/\r?\n$/, "");
    await runExecutionSmoke({
      primaryUrl,
      cronSecret,
      approvedPreview: await loadApprovedPreview(approvedPath),
      requestTimeoutMs: Number(process.env.PUBLISH_SCHEDULER_SMOKE_TIMEOUT_MS ?? "30000"),
    });
    return;
  }
  if (phase === "heartbeat") {
    const containerId = process.env.PUBLISH_SCHEDULER_CONTAINER_ID;
    await waitForHeartbeatTicks({
      heartbeatPath: process.env.PUBLISH_SCHEDULER_HEARTBEAT_FILE
        ?? "/tmp/brand-pilot-publish-scheduler-heartbeat.json",
      ticks: Number(process.env.PUBLISH_SCHEDULER_HEARTBEAT_TICKS ?? "3"),
      timeoutMs: Number(process.env.PUBLISH_SCHEDULER_HEARTBEAT_TIMEOUT_MS ?? "240000"),
      ...(containerId ? { readHeartbeat: createDockerHeartbeatReader({ containerId }) } : {}),
    });
    return;
  }
  throw smokeError("publish_scheduler_smoke_phase_invalid");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "publish_scheduler_smoke_failed"}\n`);
    process.exitCode = 1;
  });
}
