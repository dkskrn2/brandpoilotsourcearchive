import { describe, expect, it, vi } from "vitest";
import { MetaGraphRequestError } from "./metaGraph.js";
import { classifyInstagramDmSendError, sendInstagramDirectMessage } from "./instagramMessaging.js";

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

  it("adds the HUMAN_AGENT tag for a manual reply", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toMatchObject({
        recipient: JSON.stringify({ id: "sender-1" }),
        message: JSON.stringify({ text: "담당자 답변입니다" }),
        tag: "HUMAN_AGENT",
      });
      return new Response(JSON.stringify({ message_id: "outbound-manual-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(sendInstagramDirectMessage({
      accessToken: "token",
      instagramBusinessAccountId: "ig-account-1",
      recipientId: "sender-1",
      text: "담당자 답변입니다",
      tag: "HUMAN_AGENT",
    }, { fetchImpl })).resolves.toEqual({ externalMessageId: "outbound-manual-1" });
  });

  it("does not retry an ambiguous provider 5xx after a DM send attempt", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 2 } }), { status: 503 })) as unknown as typeof fetch;

    await expect(sendInstagramDirectMessage({
      accessToken: "token",
      instagramBusinessAccountId: "ig-account-1",
      recipientId: "sender-1",
      text: "안녕하세요",
    }, { fetchImpl })).rejects.toThrow("meta_graph_request_failed:503");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a clear provider 4xx as failed", () => {
    expect(classifyInstagramDmSendError(new MetaGraphRequestError({ status: 400, code: 100 }))).toEqual({
      status: "failed",
      errorCode: "meta_graph_400",
    });
  });

  it("classifies a provider 5xx after sending as an unknown delivery outcome", () => {
    expect(classifyInstagramDmSendError(new MetaGraphRequestError({ status: 503 }))).toEqual({
      status: "unknown",
      errorCode: "meta_graph_503",
    });
  });

  it.each([
    new TypeError("fetch failed"),
    Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
    new Error("instagram_dm_message_id_missing"),
  ])("classifies an ambiguous post-call failure as unknown", (error) => {
    expect(classifyInstagramDmSendError(error)).toEqual({ status: "unknown", errorCode: expect.any(String) });
  });
});
