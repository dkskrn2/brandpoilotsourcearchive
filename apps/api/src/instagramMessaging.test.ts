import { describe, expect, it, vi } from "vitest";
import { sendInstagramDirectMessage } from "./instagramMessaging.js";

describe("Instagram messaging", () => {
  it("sends a text message through the Instagram Login Graph host", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://graph.instagram.com/v23.0/ig-account-1/messages");
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toMatchObject({
        recipient: JSON.stringify({ id: "sender-1" }),
        message: JSON.stringify({ text: "안녕하세요" }),
      });
      return new Response(JSON.stringify({ message_id: "outbound-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(sendInstagramDirectMessage({
      accessToken: "token",
      instagramBusinessAccountId: "ig-account-1",
      recipientId: "sender-1",
      text: "안녕하세요",
    }, { graphVersion: "v23.0", fetchImpl })).resolves.toEqual({ externalMessageId: "outbound-1" });
  });
});
