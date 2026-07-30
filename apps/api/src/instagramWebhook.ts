import { createHmac, timingSafeEqual } from "node:crypto";

export interface InstagramMessagingEvent {
  recipientId: string;
  senderId: string;
  messageId: string;
  text: string | null;
  isEcho: boolean;
  timestamp: number | null;
  rawPayload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseMessage(value: unknown): InstagramMessagingEvent | null {
  const item = asRecord(value);
  const sender = asRecord(item?.sender);
  const recipient = asRecord(item?.recipient);
  const message = asRecord(item?.message);
  const senderId = asText(sender?.id);
  const recipientId = asText(recipient?.id);
  const messageId = asText(message?.mid);
  if (!item || !senderId || !recipientId || !messageId) return null;
  return {
    recipientId,
    senderId,
    messageId,
    text: asText(message?.text),
    isEcho: message?.is_echo === true,
    timestamp: typeof item.timestamp === "number" && Number.isFinite(item.timestamp) ? item.timestamp : null,
    rawPayload: item,
  };
}

export function verifyInstagramSignature(rawBody: Buffer, header: string | undefined, appSecret: string) {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseInstagramMessagingEvents(payload: unknown): InstagramMessagingEvent[] {
  const root = asRecord(payload);
  if (root?.object !== "instagram" || !Array.isArray(root.entry)) return [];
  const events: InstagramMessagingEvent[] = [];
  for (const entryValue of root.entry) {
    const entry = asRecord(entryValue);
    if (!Array.isArray(entry?.messaging)) continue;
    for (const message of entry.messaging) {
      const parsed = parseMessage(message);
      if (parsed) events.push(parsed);
    }
  }
  return events;
}
