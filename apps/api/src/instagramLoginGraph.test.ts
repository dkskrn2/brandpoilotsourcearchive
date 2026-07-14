import { describe, expect, it, vi } from "vitest";
import { buildInstagramLoginAuthorizeUrl, fetchInstagramMessagingProfile, resolveInstagramLoginConnection } from "./instagramLoginGraph.js";

describe("Instagram Login Graph client", () => {
  it("uses graph.instagram.com and resolves a professional account", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("https://graph.instagram.com/v23.0/me");
      return new Response(JSON.stringify({ id: "app-scoped-user-1", user_id: "ig-user-1", username: "growthline352" }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(resolveInstagramLoginConnection({ accessToken: "token", graphVersion: "v23.0", fetchImpl }))
      .resolves.toEqual({ instagramBusinessAccountId: "ig-user-1", instagramUsername: "growthline352" });
  });

  it("builds an authorization URL with only the requested business scopes", () => {
    const url = new URL(buildInstagramLoginAuthorizeUrl({ appId: "app-1", redirectUri: "https://app.example/auth/meta/callback", state: "state-1" }));
    expect(url.hostname).toBe("www.instagram.com");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages");
  });

  it("fetches a sender-scoped messaging profile without putting the token in the URL", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://graph.instagram.com/v23.0/sender-123456?fields=name%2Cusername%2Cprofile_pic");
      expect(url).not.toContain("secret-token");
      expect(init?.headers).toEqual({ authorization: "Bearer secret-token" });
      return new Response(JSON.stringify({ name: "홍길동", username: "hong", profile_pic: "https://example.com/hong.jpg" }));
    }) as unknown as typeof fetch;

    await expect(fetchInstagramMessagingProfile({
      accessToken: "secret-token", senderId: "sender-123456", graphVersion: "v23.0", fetchImpl,
    })).resolves.toEqual({ name: "홍길동", username: "hong", profilePictureUrl: "https://example.com/hong.jpg" });
  });

  it("uses a stable Korean fallback when Instagram omits the username", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: "고객" }))) as unknown as typeof fetch;
    await expect(fetchInstagramMessagingProfile({ accessToken: "token", senderId: "scoped-987654", fetchImpl }))
      .resolves.toEqual({ name: "고객", username: "사용자-987654", profilePictureUrl: null });
  });
});
