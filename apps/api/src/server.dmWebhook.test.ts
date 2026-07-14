import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";

const webhookPayload = {
  object: "instagram",
  entry: [{
    messaging: [{
      sender: { id: "sender-1" },
      recipient: { id: "ig-account-1" },
      timestamp: 1_720_000_000_000,
      message: { mid: "mid-1", text: "운영 시간이 궁금해요" },
    }],
  }],
};

function createWebhookServer(receiveInstagramWebhookMessage = vi.fn(async () => ({ status: "queued" }))) {
  const repository = {
    health: vi.fn(async () => ({ database: "ok" as const })),
    receiveInstagramWebhookMessage,
  } as any;
  return { repository, app: createServer({
    repository,
    metaWebhook: { appSecret: "app-secret", verifyToken: "verify-token" },
    logger: false,
  }) };
}

describe("Instagram DM webhook routes", () => {
  it("returns Meta's challenge only for the configured verification token", async () => {
    const { app } = createWebhookServer();
    const response = await app.inject({
      method: "GET",
      url: "/webhooks/meta/instagram?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("challenge-1");
  });

  it("rejects an invalid signature and forwards a valid message to the repository", async () => {
    const receive = vi.fn(async () => ({ status: "queued" }));
    const { app } = createWebhookServer(receive);
    const raw = JSON.stringify(webhookPayload);
    const invalid = await app.inject({
      method: "POST",
      url: "/webhooks/meta/instagram",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      payload: raw,
    });
    expect(invalid.statusCode).toBe(403);

    const signature = createHmac("sha256", "app-secret").update(raw).digest("hex");
    const valid = await app.inject({
      method: "POST",
      url: "/webhooks/meta/instagram",
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${signature}` },
      payload: raw,
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ ok: true, received: 1, outcomes: ["queued"] });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ messageId: "mid-1", senderId: "sender-1" }));
  });

  it("exposes authenticated profile claim/run/fail worker hooks", async () => {
    const repository = {
      health: vi.fn(async () => ({ database: "ok" as const })),
      claimDmProfileRefreshJob: vi.fn(async () => ({ id: "job-1", leaseToken: "lease-1" })),
      runDmProfileRefreshJob: vi.fn(async () => ({ id: "job-1", status: "succeeded" })),
      failDmProfileRefreshJob: vi.fn(async () => ({ id: "job-1", status: "failed" })),
    } as any;
    const app = createServer({ repository, workerApiToken: "worker-token", logger: false });
    const headers = { authorization: "Bearer worker-token", "content-type": "application/json" };
    expect((await app.inject({ method: "POST", url: "/workers/dm/profile-jobs/claim", headers, payload: { workerId: "worker-1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/workers/dm/profile-jobs/job-1/run", headers, payload: { workerId: "worker-1", leaseToken: "lease-1" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/workers/dm/profile-jobs/job-1/fail", headers, payload: { workerId: "worker-1", leaseToken: "lease-1", error: "failed", retryable: false, retryAfterMs: 0 } })).statusCode).toBe(200);
  });
});
