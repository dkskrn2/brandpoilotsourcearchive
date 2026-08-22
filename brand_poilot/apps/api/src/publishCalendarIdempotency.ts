import { createHash } from "node:crypto";
import type { Channel } from "./types.js";

function digest(namespace: string, values: unknown[]) {
  const hash = createHash("sha256").update(JSON.stringify(values)).digest("hex");
  return `${namespace}:v1:${hash}`;
}

export function normalizeCalendarChannels(channels: Channel[]) {
  return [...new Set(channels)].sort();
}

export function manualSlotKey(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error("publish_calendar_idempotency_key_invalid");
  }
  return digest("manual", [normalized]);
}

export function batchSlotKey(batchKey: string, clientRowId: string) {
  return digest("batch", [batchKey.trim(), clientRowId.trim()]);
}

export function automaticSlotKey(input: { kstDate: string; time: string; occurrence: number }) {
  return digest("automatic", [input.kstDate, input.time, input.occurrence]);
}
