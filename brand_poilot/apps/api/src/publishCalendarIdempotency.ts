import { createHash } from "node:crypto";
import type { Channel, PublishCalendarManualSlotSourceDto } from "./types.js";

function digestHex(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function digest(namespace: string, values: unknown[]) {
  return `${namespace}:v1:${digestHex(values)}`;
}

function sourceValues(source: PublishCalendarManualSlotSourceDto) {
  if (source.kind === "existing_content_topic") return [source.kind, source.contentTopicId.trim()];
  if (source.kind === "existing_generation") return [source.kind, source.generationId.trim()];
  return [source.kind, source.generationOutputId.trim()];
}

function requestIdentity(
  namespace: "manual" | "batch",
  requestValues: string[],
  source: PublishCalendarManualSlotSourceDto,
  legacyKey: string,
) {
  const prefix = `${namespace}:v2:${digestHex(requestValues)}:`;
  return {
    prefix,
    key: `${prefix}${digestHex(sourceValues(source))}`,
    legacyKey,
  };
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

export function manualSlotIdentity(value: string, source: PublishCalendarManualSlotSourceDto) {
  const legacyKey = manualSlotKey(value);
  return requestIdentity("manual", [value.trim()], source, legacyKey);
}

export function batchSlotIdentity(
  batchKey: string,
  clientRowId: string,
  source: PublishCalendarManualSlotSourceDto,
) {
  const normalizedBatchKey = batchKey.trim();
  const normalizedRowId = clientRowId.trim();
  return requestIdentity(
    "batch",
    [normalizedBatchKey, normalizedRowId],
    source,
    batchSlotKey(normalizedBatchKey, normalizedRowId),
  );
}

export function automaticSlotKey(input: { scheduleEntryId: string; kstDate: string }) {
  return digestHex(["weekly-auto", input.scheduleEntryId, input.kstDate]);
}
