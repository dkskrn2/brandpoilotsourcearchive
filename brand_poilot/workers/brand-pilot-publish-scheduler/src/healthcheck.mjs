import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { HEARTBEAT_PATH } from "./scheduler.mjs";

function invalid(reason) {
  return { healthy: false, reason };
}

function validTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateHeartbeat(heartbeat, {
  now = new Date(),
  tickMs,
  timeoutMs,
  isPidAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
}) {
  if (!heartbeat || typeof heartbeat !== "object" || Array.isArray(heartbeat)) return invalid("schema");
  if (heartbeat.schemaVersion !== 1) return invalid("schema");
  if (!Number.isSafeInteger(heartbeat.pid) || heartbeat.pid <= 0) return invalid("pid");
  if (!isPidAlive(heartbeat.pid)) return invalid("pid_dead");
  if (!Number.isSafeInteger(tickMs) || tickMs <= 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return invalid("configuration");
  }
  if (heartbeat.lastAllocationBucket !== null
    && (typeof heartbeat.lastAllocationBucket !== "string"
      || !/^\d{4}-\d{2}-\d{2}T(?:0[5-9]|1\d|2[0-3]):20$/.test(heartbeat.lastAllocationBucket))) {
    return invalid("schema");
  }

  const nowMs = now.getTime();
  let lastSuccessAt = null;
  if (heartbeat.lastSuccessAt !== null) {
    lastSuccessAt = validTimestamp(heartbeat.lastSuccessAt);
    if (lastSuccessAt === null) return invalid("schema");
    if (lastSuccessAt > nowMs) return invalid("future");
  }
  if (heartbeat.inFlightSince !== null) {
    const inFlightSince = validTimestamp(heartbeat.inFlightSince);
    if (inFlightSince === null) return invalid("schema");
    const age = nowMs - inFlightSince;
    if (age < 0) return invalid("future");
    return age <= timeoutMs + tickMs ? { healthy: true } : invalid("in_flight_stale");
  }
  if (lastSuccessAt === null) return invalid("schema");
  const age = nowMs - lastSuccessAt;
  if (age < 0) return invalid("future");
  return age <= tickMs * 3 ? { healthy: true } : invalid("stale");
}

export async function runHealthcheck({
  env = process.env,
  path = HEARTBEAT_PATH,
  readHeartbeat = readFile,
  isPidAlive,
  now = new Date(),
} = {}) {
  try {
    const tickMs = Number(env.PUBLISH_TICK_MS || "60000");
    const timeoutMs = Number(env.PUBLISH_TIMEOUT_MS);
    const heartbeat = JSON.parse(await readHeartbeat(path, "utf8"));
    return evaluateHeartbeat(heartbeat, { now, tickMs, timeoutMs, isPidAlive });
  } catch {
    return invalid("unreadable");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runHealthcheck();
  if (!result.healthy) process.exitCode = 1;
}
