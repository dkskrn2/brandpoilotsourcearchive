import { describe, expect, it, vi } from "vitest";
import { buildInstagramLoginAuthorizeUrl, resolveInstagramLoginConnection } from "./instagramLoginGraph.js";

describe("Instagram Login Graph client", () => {
  it("uses graph.instagram.com and resolves a professional account", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("https://graph.instagram.com/v23.0/me");
      return new Response(JSON.stringify({ id: "ig-user-1", username: "growthline352" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(resolveInstagramLoginConnection({ accessToken: "token", graphVersion: "v23.0", fetchImpl }))
      .resolves.toEqual({ instagramBusinessAccountId: "ig-user-1", instagramUsername: "growthline352" });
  });

  it("builds an authorization URL with only the requested business scopes", () => {
    const url = new URL(buildInstagramLoginAuthorizeUrl({ appId: "app-1", redirectUri: "https://app.example/auth/meta/callback", state: "state-1" }));
    expect(url.hostname).toBe("www.instagram.com");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages");
  });
});
