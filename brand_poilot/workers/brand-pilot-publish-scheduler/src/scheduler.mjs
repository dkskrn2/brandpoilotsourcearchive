import { chmod, open, readFile, rename, unlink } from "node:fs/promises";

export const HEARTBEAT_PATH = "/tmp/brand-pilot-publish-scheduler-heartbeat.json";

const DUE_PATH = "/internal/cron/publish-due";
const ALLOCATION_PATH = "/internal/cron/publish-calendar-allocate";
const PRIMARY_URL_PATTERN = /^http:\/\/api-primary:4000\/?$/;
const ALLOCATION_FIELDS = [
  "brandsSelected",
  "openSlotsCreated",
  "proposalsAssigned",
  "quotaBlocked",
  "brandsFailed",
];
const DUE_FIELDS = [
  "expiredTargets",
  "expiredSlots",
  "dueQueued",
  "published",
  "failed",
  "resultUnknown",
];

function positiveInteger(value, name, defaultValue) {
  const candidate = value === undefined || value === "" ? defaultValue : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(`${name}_must_be_a_positive_integer`);
  }
  return candidate;
}

export async function loadConfig(env = process.env, readSecretFile = readFile) {
  const rawUrl = env.PRIMARY_API_INTERNAL_URL;
  if (typeof rawUrl !== "string" || !PRIMARY_URL_PATTERN.test(rawUrl)) {
    throw new Error("PRIMARY_API_INTERNAL_URL_must_be_exact_primary_service_url");
  }
  if (typeof env.CRON_SECRET_FILE !== "string" || env.CRON_SECRET_FILE.trim() === "") {
    throw new Error("CRON_SECRET_FILE_is_required");
  }
  const secretFileContents = String(await readSecretFile(env.CRON_SECRET_FILE, "utf8"));
  const cronSecret = secretFileContents.endsWith("\n")
    ? secretFileContents.slice(0, -1)
    : secretFileContents;
  if (cronSecret === "") throw new Error("CRON_SECRET_FILE_is_empty");
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(cronSecret)) {
    throw new Error("CRON_SECRET_FILE_contains_control_characters");
  }

  return {
    primaryApiInternalUrl: rawUrl.replace(/\/$/, ""),
    cronSecret,
    tickMs: positiveInteger(env.PUBLISH_TICK_MS, "PUBLISH_TICK_MS", 60_000),
    timeoutMs: positiveInteger(env.PUBLISH_TIMEOUT_MS, "PUBLISH_TIMEOUT_MS"),
  };
}

function isCountDto(value, fields, requireAcquired = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (requireAcquired && typeof value.acquired !== "boolean") return false;
  return fields.every((field) => Number.isSafeInteger(value[field]) && value[field] >= 0);
}

function countDto(value, fields, includeAcquired = false) {
  const result = Object.fromEntries(fields.map((field) => [field, value[field]]));
  return includeAcquired ? { acquired: value.acquired, ...result } : result;
}

function failureOf(error) {
  if (error?.code === "scheduler_stopped") return "aborted";
  if (error?.name === "AbortError") return "timeout";
  if (error?.code === "invalid_json") return "invalid_json";
  if (error?.code === "invalid_dto") return "invalid_dto";
  if (error?.status === 409) return "primary_fenced";
  if (Number.isInteger(error?.status)) return "http";
  return "network";
}

function latestAllocationBucket(now) {
  const kst = new Date(now.getTime() + (9 * 60 * 60 * 1_000));
  const year = kst.getUTCFullYear();
  const month = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  let hour = kst.getUTCHours();
  if (kst.getUTCMinutes() < 20) hour -= 1;
  if (hour < 5 || hour > 23) return null;
  return `${year}-${month}-${day}T${String(hour).padStart(2, "0")}:20`;
}

async function requestJson({ url, secret, timeoutMs, fetchImpl, activeControllers, stopped }) {
  const controller = new AbortController();
  activeControllers.add(controller);
  let timedOut = false;
  const timeout = setTimeout(() => {
    // Aborting the client bounds this worker tick. The API advisory lock, not
    // the client abort, prevents a still-running server execution from duplicating work.
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response?.ok) {
      const error = new Error("scheduler_http_failure");
      error.status = Number.isInteger(response?.status) ? response.status : 0;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      const error = new Error("scheduler_invalid_json");
      error.code = "invalid_json";
      throw error;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const aborted = new Error("scheduler_request_aborted");
      aborted.name = timedOut ? "AbortError" : "Error";
      if (!timedOut && stopped()) aborted.code = "scheduler_stopped";
      throw aborted;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    activeControllers.delete(controller);
  }
}

export async function writeHeartbeatAtomic(path, heartbeat) {
  const temporaryPath = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(heartbeat)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function createScheduler({
  config,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  writeHeartbeat = (heartbeat) => writeHeartbeatAtomic(HEARTBEAT_PATH, heartbeat),
  logger = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`),
  pid = process.pid,
}) {
  let interval = null;
  let activeTick = null;
  let stopped = false;
  let stopPromise = null;
  let lastSuccessAt = null;
  let inFlightSince = null;
  let lastAllocationBucket = null;
  const activeControllers = new Set();

  const heartbeat = () => ({
    schemaVersion: 1,
    pid,
    lastSuccessAt,
    inFlightSince,
    lastAllocationBucket,
  });

  async function runOperation(path, fields, requireAcquired) {
    const value = await requestJson({
      url: `${config.primaryApiInternalUrl}${path}`,
      secret: config.cronSecret,
      timeoutMs: config.timeoutMs,
      fetchImpl,
      activeControllers,
      stopped: () => stopped,
    });
    if (!isCountDto(value, fields, requireAcquired)) {
      const error = new Error("scheduler_invalid_dto");
      error.code = "invalid_dto";
      throw error;
    }
    return countDto(value, fields, requireAcquired);
  }

  async function runTick() {
    const tickNow = now();
    inFlightSince = tickNow.toISOString();
    await writeHeartbeat(heartbeat()).catch(() => {
      logger({ event: "publish_heartbeat_failed" });
    });
    if (stopped) {
      inFlightSince = null;
      return { stopped: true };
    }

    try {
      const due = await runOperation(DUE_PATH, DUE_FIELDS, true);
      lastSuccessAt = now().toISOString();
      inFlightSince = null;
      await writeHeartbeat(heartbeat()).catch(() => {
        logger({ event: "publish_heartbeat_failed" });
      });
      logger({ event: "publish_due_succeeded", ...due });
    } catch (error) {
      inFlightSince = null;
      await writeHeartbeat(heartbeat()).catch(() => undefined);
      const failure = failureOf(error);
      const entry = { event: "publish_due_failed", failure };
      if (Number.isInteger(error?.status)) entry.status = error.status;
      logger(entry);
    }

    if (stopped) return { stopped: true };
    const bucket = latestAllocationBucket(tickNow);
    if (bucket && bucket !== lastAllocationBucket) {
      inFlightSince = now().toISOString();
      await writeHeartbeat(heartbeat()).catch(() => {
        logger({ event: "publish_heartbeat_failed" });
      });
      if (stopped) {
        inFlightSince = null;
        await writeHeartbeat(heartbeat()).catch(() => undefined);
        return { stopped: true };
      }
      try {
        const allocation = await runOperation(ALLOCATION_PATH, ALLOCATION_FIELDS, false);
        lastAllocationBucket = bucket;
        await writeHeartbeat(heartbeat()).catch(() => {
          logger({ event: "publish_heartbeat_failed" });
        });
        logger({ event: "publish_allocation_succeeded", bucket, ...allocation });
      } catch (error) {
        const failure = failureOf(error);
        const entry = { event: "publish_allocation_failed", bucket, failure };
        if (Number.isInteger(error?.status)) entry.status = error.status;
        logger(entry);
      }
      inFlightSince = null;
      await writeHeartbeat(heartbeat()).catch(() => undefined);
    }
    return { stopped: false };
  }

  async function tick() {
    if (stopped) return { stopped: true };
    if (activeTick) {
      logger({ event: "publish_tick_skipped_overlap" });
      return { skipped: true };
    }
    activeTick = runTick();
    try {
      return await activeTick;
    } finally {
      activeTick = null;
    }
  }

  async function start() {
    if (stopped) return { stopped: true };
    if (!interval) interval = setIntervalFn(() => { void tick(); }, config.tickMs);
    return tick();
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopped = true;
    if (interval) clearIntervalFn(interval);
    interval = null;
    const pendingTick = activeTick;
    for (const controller of activeControllers) controller.abort();
    stopPromise = (async () => {
      if (pendingTick) await pendingTick;
    })();
    return stopPromise;
  }

  return { start, stop, tick };
}
