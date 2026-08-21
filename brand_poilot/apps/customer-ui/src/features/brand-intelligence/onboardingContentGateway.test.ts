import { describe, expect, it, vi } from "vitest";
import { createOnboardingContentGateway } from "./onboardingContentGateway";

const state = {
  state: "preparing" as const,
  proposalBatchId: "batch-1",
  generationId: null,
  title: "추천 주제",
  progress: null,
  outputs: [],
  errorCode: null,
  errorMessage: null,
};

describe("onboardingContentGateway", () => {
  it("starts the first selection with a session-authenticated POST", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(state), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    const gateway = createOnboardingContentGateway({
      baseUrl: "https://api.example.test",
      fetcher,
    });
    const input = {
      categoryCode: "beauty",
      subcategoryCodes: ["skin_care"],
      suggestionId: "suggestion-1",
      contentInstruction: null,
      idempotencyKey: "request-1",
    };

    await expect(gateway.start("brand-1", "analysis-1", input)).resolves.toEqual(state);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/brands/brand-1/brand-analyses/analysis-1/onboarding-content",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify(input),
      }),
    );
  });

  it("reconciles generation through an explicit POST instead of a mutating GET", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(state), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const gateway = createOnboardingContentGateway({
      baseUrl: "https://api.example.test",
      fetcher,
    });
    const controller = new AbortController();

    await expect(gateway.reconcile("brand-1", "analysis-1", controller.signal)).resolves.toEqual(state);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/brands/brand-1/brand-analyses/analysis-1/onboarding-content/reconcile",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        signal: controller.signal,
      }),
    );
  });
});
