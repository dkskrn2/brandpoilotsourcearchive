import { describe, expect, it } from "vitest";
import { assessApiReadiness, resolveServerHost } from "./runtime";

describe("server runtime", () => {
  it("binds to all interfaces inside Vercel", () => {
    expect(resolveServerHost({ vercel: "1" })).toBe("0.0.0.0");
  });

  it("keeps the loopback default for local development", () => {
    expect(resolveServerHost({})).toBe("127.0.0.1");
  });

  it("honors an explicit host in either environment", () => {
    expect(resolveServerHost({ host: "10.0.0.2", vercel: "1" })).toBe("10.0.0.2");
  });

  it("reports first-deploy safe mode without requiring disabled workers", () => {
    expect(assessApiReadiness({
      database: "ok",
      schedulerEnabled: false,
      publishingEnabled: false,
      dmWorkersEnabled: false,
      activeDmEnabled: false,
      dmWorker: "offline",
      wikiWorker: "offline",
      contentProposalsEnabled: false,
      contentProposalWorker: "offline",
    })).toEqual({
      statusCode: 200,
      body: {
        ok: true,
        configuration: "ok",
        database: "ok",
        features: {
          scheduler: "disabled",
          publishing: "disabled",
          dm: "disabled",
          wiki: "disabled",
          contentProposals: "disabled",
        },
        workers: {
          dm: "not_required",
          wiki: "not_required",
          contentProposal: "not_required",
        },
      },
    });
  });

  it("does not require offline DM workers while their deployment profile is disabled", () => {
    const result = assessApiReadiness({
      database: "ok", schedulerEnabled: false, publishingEnabled: false,
      dmWorkersEnabled: false, activeDmEnabled: true,
      dmWorker: "offline", wikiWorker: "offline",
      contentProposalsEnabled: false, contentProposalWorker: "offline",
    });
    expect(result.statusCode).toBe(200);
    expect(result.body.workers).toMatchObject({ dm: "not_required", wiki: "not_required" });
  });

  it.each([
    ["dm", "offline", "online"],
    ["dm stale", "stale", "online"],
    ["wiki", "online", "offline"],
    ["wiki stale", "online", "stale"],
  ] as const)(
    "fails readiness when active DM is missing a required %s worker heartbeat",
    (_caseName, dmWorker, wikiWorker) => {
      const result = assessApiReadiness({
        database: "ok",
        schedulerEnabled: false,
        publishingEnabled: false,
        dmWorkersEnabled: true,
        activeDmEnabled: true,
        dmWorker,
        wikiWorker,
        contentProposalsEnabled: false,
        contentProposalWorker: "offline",
      });

      expect(result.statusCode).toBe(503);
      expect(result.body).toMatchObject({
        ok: false,
        database: "ok",
        features: { dm: "enabled", wiki: "enabled" },
        workers: { dm: dmWorker, wiki: wikiWorker },
      });
    },
  );

  it.each(["offline", "stale"] as const)(
    "fails readiness when manual proposals are enabled without a fresh %s worker",
    (contentProposalWorker) => {
      const result = assessApiReadiness({
        database: "ok",
        schedulerEnabled: false,
        publishingEnabled: false,
        dmWorkersEnabled: false,
        activeDmEnabled: false,
        dmWorker: "offline",
        wikiWorker: "offline",
        contentProposalsEnabled: true,
        contentProposalWorker,
      });

      expect(result.statusCode).toBe(503);
      expect(result.body).toMatchObject({
        ok: false,
        features: { contentProposals: "enabled" },
        workers: { contentProposal: contentProposalWorker },
      });
    },
  );

  it("permits manual proposals only with a fresh proposal worker", () => {
    expect(assessApiReadiness({
      database: "ok",
      schedulerEnabled: false,
      publishingEnabled: false,
      dmWorkersEnabled: false,
      activeDmEnabled: false,
      dmWorker: "offline",
      wikiWorker: "offline",
      contentProposalsEnabled: true,
      contentProposalWorker: "online",
    }).statusCode).toBe(200);
  });
});
