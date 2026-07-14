import { describe, expect, it, vi } from "vitest";
import { runProfileRefreshOnce } from "./profileRefresh.js";

const job = {
  id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", leaseToken: "lease-1",
  payload: { conversationId: "conversation-1", senderId: "sender-1" }, attemptCount: 1,
};

function api(claimed: typeof job | null = job) {
  return {
    claimProfile: vi.fn(async () => claimed),
    runProfile: vi.fn(async () => ({})),
    failProfile: vi.fn(async () => ({})),
  };
}

describe("DM profile refresh worker", () => {
  it("is idle when no profile job is available", async () => {
    const client = api(null);
    await expect(runProfileRefreshOnce({ workerId: "worker-1", api: client })).resolves.toEqual({ status: "idle" });
    expect(client.runProfile).not.toHaveBeenCalled();
  });

  it("asks the central API to run the refresh without receiving a credential", async () => {
    const client = api();
    await expect(runProfileRefreshOnce({ workerId: "worker-1", api: client }))
      .resolves.toEqual({ status: "completed", jobId: "job-1" });
    expect(job.payload).toEqual({ conversationId: "conversation-1", senderId: "sender-1" });
    expect(client.runProfile).toHaveBeenCalledWith("job-1", "worker-1", "lease-1");
  });

  it("records a failed refresh without throwing into the DM cycle", async () => {
    const client = api();
    client.runProfile.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(runProfileRefreshOnce({ workerId: "worker-1", api: client }))
      .resolves.toMatchObject({ status: "failed", jobId: "job-1" });
    expect(client.failProfile).toHaveBeenCalledWith("job-1", "worker-1", "lease-1", "fetch failed", true, 5000);
  });
});
