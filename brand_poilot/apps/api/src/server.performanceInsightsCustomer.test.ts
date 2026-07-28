import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "./httpServer.js";
import type { ApiRepository, PerformanceInsightsDto } from "./types.js";

const brandId = "22222222-2222-4222-8222-222222222222";
const auth = { cookie: "bp_session=session-1" };

function setup() {
  const insights: PerformanceInsightsDto = {
    period: "30d",
    summary: { dataStatus: "insufficient", measuredContentCount: 0, totalExposure: null },
    windows: [],
    observations: [],
    experiments: [],
    sampleSize: 0,
    lastCollectedAt: null,
    topContents: [],
  };
  const repository = {
    getPerformanceInsights: vi.fn(async () => insights),
  } as unknown as ApiRepository;
  const kakaoAuth = {
    getSession: vi.fn(async () => ({
      userId: "88888888-8888-4888-8888-888888888888",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspaceName: "Workspace",
      brandId,
      brandName: "Brand",
      displayName: "Tester",
      email: null,
    })),
    canAccessBrand: vi.fn(async (_userId: string, requestedBrandId: string) => requestedBrandId === brandId),
  };
  const app = createServer({ repository, kakaoAuth: kakaoAuth as never, logger: false }, Fastify({ logger: false }));
  return { app, repository, kakaoAuth };
}

describe("performance insights customer endpoint", () => {
  it("returns the tenant-scoped 30-day insights response", async () => {
    const { app, repository, kakaoAuth } = setup();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/performance/insights?period=30d`,
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ period: "30d", sampleSize: 0 });
    expect(kakaoAuth.canAccessBrand).toHaveBeenCalledWith(expect.any(String), brandId);
    expect(repository.getPerformanceInsights).toHaveBeenCalledWith(brandId);
  });

  it("rejects unsupported periods before querying snapshots", async () => {
    const { app, repository } = setup();
    const response = await app.inject({
      method: "GET",
      url: `/brands/${brandId}/performance/insights?period=7d`,
      headers: auth,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "performance_insights_period_invalid" });
    expect(repository.getPerformanceInsights).not.toHaveBeenCalled();
  });
});
