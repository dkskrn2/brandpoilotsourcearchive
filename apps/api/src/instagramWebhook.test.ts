import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInstagramMessagingEvents, verifyInstagramSignature } from "./instagramWebhook.js";

const fixture = {
  object: "instagram",
  entry: [{
    id: "17890000000000000",
    messaging: [{
      sender: { id: "sender-1" },
      recipient: { id: "17890000000000000" },
      timestamp: 1_720_000_000_000,
      message: { mid: "mid-1", text: "운영 시간이 궁금해요" },
    }],
  }],
};

describe("Instagram webhook", () => {
  it("accepts a valid raw-body HMAC and parses messaging events", () => {
    const raw = Buffer.from(JSON.stringify(fixture));
    const signature = createHmac("sha256", "app-secret").update(raw).digest("hex");

    expect(verifyInstagramSignature(raw, `sha256=${signature}`, "app-secret")).toBe(true);
    expect(parseInstagramMessagingEvents(fixture)).toEqual([expect.objectContaining({
      recipientId: "17890000000000000",
      senderId: "sender-1",
      messageId: "mid-1",
      text: "운영 시간이 궁금해요",
    })]);
  });

  it("rejects a bad signature and ignores malformed events", () => {
    expect(verifyInstagramSignature(Buffer.from("{}"), "sha256=deadbeef", "app-secret")).toBe(false);
    expect(parseInstagramMessagingEvents({ object: "instagram", entry: [{ messaging: [{ message: { text: "missing ids" } }] }] })).toEqual([]);
  });
});
