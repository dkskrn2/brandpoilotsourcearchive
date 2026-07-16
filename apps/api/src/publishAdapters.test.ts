import { describe, expect, it, vi } from "vitest";
import { createPublishAdapterRegistry } from "./publishAdapters.js";

describe("publish adapter registry", () => {
  it("contains exactly the runtime-supported channels", () => {
    const registry = createPublishAdapterRegistry({ publishInstagram: vi.fn() });

    expect(Object.keys(registry)).toEqual(["instagram", "threads", "x", "linkedin", "youtube", "tiktok"]);
  });

  it("delegates Instagram publication to the existing publisher boundary", async () => {
    const publishInstagram = vi.fn(async () => ({
      status: "published" as const,
      externalPostId: "ig-1",
      externalUrl: "https://instagram.com/p/ig-1",
    }));
    const registry = createPublishAdapterRegistry({ publishInstagram });

    expect(registry.instagram.validate({
      channel: "instagram",
      credentialState: "connected",
      queueId: "queue-1",
      outputJson: {},
    })).toEqual({ valid: true });

    await expect(registry.instagram.publish({
      channel: "instagram",
      credentialState: "connected",
      queueId: "queue-1",
      outputJson: {},
    })).resolves.toEqual(expect.objectContaining({ status: "published", externalPostId: "ig-1" }));
    expect(publishInstagram).toHaveBeenCalledOnce();
  });

  it.each(["threads", "x", "linkedin", "youtube", "tiktok"] as const)(
    "blocks %s before OAuth without making an external request",
    async (channel) => {
      const registry = createPublishAdapterRegistry({
        publishInstagram: vi.fn(),
      });
      const request = {
        channel,
        credentialState: "not_connected" as const,
        queueId: "queue-1",
        outputJson: {},
      };

      expect(registry[channel].validate(request)).toEqual({ valid: false, errorCode: "oauth_required" });
      await expect(registry[channel].publish(request)).resolves.toEqual({
        status: "blocked",
        errorCode: "oauth_required",
        retryable: false,
      });
    },
  );

  it("keeps a connected placeholder recoverable until the provider implementation exists", async () => {
    const registry = createPublishAdapterRegistry({ publishInstagram: vi.fn() });

    await expect(registry.linkedin.publish({
      channel: "linkedin",
      credentialState: "connected",
      queueId: "queue-1",
      outputJson: {},
    })).resolves.toEqual({
      status: "blocked",
      errorCode: "provider_not_implemented",
      retryable: false,
    });
  });
});
