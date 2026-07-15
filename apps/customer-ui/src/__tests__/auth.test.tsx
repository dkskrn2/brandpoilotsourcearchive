import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../lib/auth";
import { LoginPage } from "../pages/LoginPage";

describe("authentication redirects", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:4000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects an anonymous visitor to Danbam", async () => {
    const redirect = vi.fn();

    render(
      <MemoryRouter>
        <AuthGate
          loadSession={async () => { throw new Error("API request failed: 401:authentication_required"); }}
          redirect={redirect}
        >
          <div>Protected content</div>
        </AuthGate>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith("https://www.danbammsg.co.kr/");
    });
  });

  it("keeps the internal Kakao login entry available", () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /카카오로 시작하기/ })).toHaveAttribute(
      "href",
      "http://localhost:4000/auth/kakao/login"
    );
  });
});
