import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthConsentPage, type OAuthConsentClient } from "../pages/OAuthConsentPage";

const sdk = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  signInWithOtp: vi.fn(),
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  localStorage.clear();
});

function client(overrides: Partial<OAuthConsentClient> = {}): OAuthConsentClient {
  return {
    getUser: vi.fn(async () => ({ user: null })),
    sendSignInLink: vi.fn(async () => undefined),
    getAuthorizationDetails: vi.fn(async () => ({
      kind: "consent" as const,
      authorizationId: "auth-1",
      clientName: "ChatGPT",
      redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
      scopes: ["email"],
    })),
    approveAuthorization: vi.fn(async () => "https://chatgpt.com/approved"),
    denyAuthorization: vi.fn(async () => "https://chatgpt.com/denied"),
    ...overrides,
  };
}

function renderPage(oauthClient: OAuthConsentClient, redirect = vi.fn(), path = "/oauth/consent?authorization_id=auth-1") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <OAuthConsentPage client={oauthClient} redirect={redirect} />
    </MemoryRouter>,
  );
  return redirect;
}

describe("OAuth consent", () => {
  it("rejects a request without an authorization id", async () => {
    const oauthClient = client();
    renderPage(oauthClient, vi.fn(), "/oauth/consent");

    expect(await screen.findByRole("alert")).toHaveTextContent("유효하지 않은 연결 요청입니다.");
    expect(oauthClient.getUser).not.toHaveBeenCalled();
  });

  it("sends a login link only for a pre-created operator account", async () => {
    const user = userEvent.setup();
    const oauthClient = client();
    renderPage(oauthClient);

    await user.type(await screen.findByRole("textbox", { name: "운영자 이메일" }), "operator@example.com");
    await user.click(screen.getByRole("button", { name: "로그인 링크 받기" }));

    await waitFor(() => expect(oauthClient.sendSignInLink).toHaveBeenCalledWith(
      "operator@example.com",
      `${window.location.origin}/oauth/consent`,
    ));
    expect(JSON.parse(localStorage.getItem("mojong:oauth-authorization-id") ?? "null")).toMatchObject({
      authorizationId: "auth-1",
      savedAt: expect.any(Number),
    });
    expect(await screen.findByRole("status")).toHaveTextContent("로그인 링크를 보냈습니다.");
  });

  it("shows the requesting client and redirects after approval", async () => {
    const user = userEvent.setup();
    const oauthClient = client({ getUser: vi.fn(async () => ({ user: { id: "operator-1" } })) });
    const redirect = renderPage(oauthClient);

    expect(await screen.findByRole("heading", { name: "ChatGPT 연결 승인" })).toBeVisible();
    expect(screen.getByText("계정 식별 이메일")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "연결 승인" }));

    await waitFor(() => expect(oauthClient.approveAuthorization).toHaveBeenCalledWith("auth-1"));
    expect(redirect).toHaveBeenCalledWith("https://chatgpt.com/approved");
  });

  it("redirects immediately when consent was already granted", async () => {
    const oauthClient = client({
      getUser: vi.fn(async () => ({ user: { id: "operator-1" } })),
      getAuthorizationDetails: vi.fn(async () => ({ kind: "redirect" as const, redirectUrl: "https://chatgpt.com/existing" })),
    });
    const redirect = renderPage(oauthClient);

    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://chatgpt.com/existing"));
  });

  it("restores the authorization id after returning from an email login link", async () => {
    localStorage.setItem("mojong:oauth-authorization-id", JSON.stringify({
      authorizationId: "auth-restored",
      savedAt: Date.now(),
    }));
    const oauthClient = client({ getUser: vi.fn(async () => ({ user: { id: "operator-1" } })) });
    renderPage(oauthClient, vi.fn(), "/oauth/consent");

    await waitFor(() => expect(oauthClient.getAuthorizationDetails).toHaveBeenCalledWith("auth-restored"));
  });

  it("rejects an expired stored authorization request", async () => {
    localStorage.setItem("mojong:oauth-authorization-id", JSON.stringify({
      authorizationId: "auth-expired",
      savedAt: Date.now() - 16 * 60 * 1000,
    }));
    const oauthClient = client({ getUser: vi.fn(async () => ({ user: { id: "operator-1" } })) });
    renderPage(oauthClient, vi.fn(), "/oauth/consent");

    expect(await screen.findByRole("alert")).toHaveTextContent("유효하지 않은 연결 요청입니다.");
    expect(oauthClient.getUser).not.toHaveBeenCalled();
    expect(localStorage.getItem("mojong:oauth-authorization-id")).toBeNull();
  });

  it("uses the configured Supabase project without creating new operator accounts", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    sdk.getUser.mockResolvedValue({ data: { user: null }, error: null });
    sdk.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    sdk.createClient.mockReturnValue({
      auth: {
        getUser: sdk.getUser,
        signInWithOtp: sdk.signInWithOtp,
        oauth: {
          getAuthorizationDetails: sdk.getAuthorizationDetails,
          approveAuthorization: sdk.approveAuthorization,
          denyAuthorization: sdk.denyAuthorization,
        },
      },
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth-1"]}>
        <OAuthConsentPage />
      </MemoryRouter>,
    );
    await user.type(await screen.findByRole("textbox", { name: "운영자 이메일" }), "operator@example.com");
    await user.click(screen.getByRole("button", { name: "로그인 링크 받기" }));

    expect(sdk.createClient).toHaveBeenCalledWith("https://project.supabase.co", "publishable-key");
    expect(sdk.getUser).toHaveBeenCalled();
    expect(sdk.signInWithOtp).toHaveBeenCalledWith({
      email: "operator@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/oauth/consent`,
      },
    });
  });

  it("shows operator login when Supabase reports a missing session", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    sdk.getUser.mockResolvedValue({
      data: { user: null },
      error: { name: "AuthSessionMissingError" },
    });
    sdk.createClient.mockReturnValue({
      auth: {
        getUser: sdk.getUser,
        signInWithOtp: sdk.signInWithOtp,
        oauth: {
          getAuthorizationDetails: sdk.getAuthorizationDetails,
          approveAuthorization: sdk.approveAuthorization,
          denyAuthorization: sdk.denyAuthorization,
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth-1"]}>
        <OAuthConsentPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("textbox", { name: "운영자 이메일" })).toBeVisible();
  });
});
