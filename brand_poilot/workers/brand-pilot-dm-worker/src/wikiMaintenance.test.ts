import { describe, expect, it, vi } from "vitest";
import { runWikiMaintenanceOnce, validateWikiMaintenanceOutput } from "./wikiMaintenance.js";

const context = {
  runId: "run-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  wikiVersionId: "version-1",
  questions: ["제품이 뭐가 있어요?"],
  stableKeys: ["brand-overview", "catalog", "product:one"],
  sourceUnits: [{ stableKey: "product:one", title: "상품 1", content: "상품 설명" }],
};

describe("Wiki maintenance", () => {
  it("rejects aliases and links for unknown brand Wiki keys", () => {
    expect(() => validateWikiMaintenanceOutput({
      aliasUpdates: [{ stableKey: "other-brand", aliases: ["상품"] }],
      linkUpdates: [], regenerateStableKeys: [], missingKnowledge: [],
    }, context)).toThrow("wiki_linter_stable_key_unknown");
  });

  it("records source gaps but never turns DM text into facts", async () => {
    const db = {
      claimWikiMaintenance: vi.fn(async () => context),
      completeWikiMaintenance: vi.fn(async () => undefined),
      failWikiMaintenance: vi.fn(async () => undefined),
    };
    const runCodex = vi.fn(async () => ({
      aliasUpdates: [], linkUpdates: [], regenerateStableKeys: [],
      missingKnowledge: [{ question: "가격이 얼마예요?", reason: "원문 가격 없음" }],
    }));
    await expect(runWikiMaintenanceOnce({
      db, runtimeDirectory: "runtime", timeoutMs: 120_000, runCodex,
    })).resolves.toEqual({ status: "completed", runId: "run-1", issueCount: 1 });
    expect(db.completeWikiMaintenance).toHaveBeenCalledWith(context, expect.objectContaining({
      missingKnowledge: [{ question: "가격이 얼마예요?", reason: "원문 가격 없음" }],
    }));
  });
});
