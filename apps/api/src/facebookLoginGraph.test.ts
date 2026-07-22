import { describe, expect, it, vi } from "vitest";
import { buildFacebookLoginAuthorizeUrl, exchangeFacebookLoginCode } from "./facebookLoginGraph";

describe("Facebook Login for Instagram trends", () => {
  it("requests only the Facebook Login permissions used by hashtag search", () => {
    const url = new URL(buildFacebookLoginAuthorizeUrl({ appId: "app-1", redirectUri: "https://api.example/auth/meta/trends/callback", state: "state-1" }));
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
    ]);
    expect(url.searchParams.get("state")).toBe("state-1");
  });

  it("exchanges the callback code for a long-lived Facebook user token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-token", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-token", expires_in: 5_184_000 }), { status: 200 }));
    await expect(exchangeFacebookLoginCode({
      code: "oauth-code",
      appId: "app-1",
      appSecret: "secret-1",
      redirectUri: "https://api.example/auth/meta/trends/callback",
      fetchImpl: fetchMock as typeof fetch,
    })).resolves.toEqual({ accessToken: "long-token", expiresIn: 5_184_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("grant_type=fb_exchange_token");
  });
});
