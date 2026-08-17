import assert from "node:assert/strict";
import test from "node:test";
import {
  QUALITY_CASES,
  QUALITY_SOURCE_URL,
  buildQualityReport,
  renderQualityReportHtml,
} from "./ai-content-quality-cases.mjs";

test("quality manifest fixes one source URL and the six approved manual visual combinations", () => {
  assert.equal(QUALITY_SOURCE_URL, "https://www.theverge.com/streaming/977474/youtube-partner-program-new-requirements");
  assert.deepEqual(QUALITY_CASES.map(({ id }) => id), [
    "none",
    "product-text",
    "product-image",
    "style",
    "style-avatar",
    "all",
  ]);
  assert.deepEqual(QUALITY_CASES.map(({ product, productImage, style, avatar }) => ({ product, productImage, style, avatar })), [
    { product: false, productImage: false, style: false, avatar: false },
    { product: true, productImage: false, style: false, avatar: false },
    { product: true, productImage: true, style: false, avatar: false },
    { product: false, productImage: false, style: true, avatar: false },
    { product: false, productImage: false, style: true, avatar: true },
    { product: true, productImage: true, style: true, avatar: true },
  ]);
});

test("quality report records selections, timing, attempts, scenes and staged IDs without scoring or actions", () => {
  const report = buildQualityReport([{
    caseId: "style-avatar",
    proposalId: "proposal-1",
    proposalTitle: "새 기준 핵심 정리",
    generationId: "generation-1",
    selection: { productServiceId: null, productImageAssetIds: [], stylePresetId: "preset-1", avatarId: "avatar-1" },
    timing: { proposalMs: 1200, planningMs: 1800, renderMs: 3000, totalMs: 6000 },
    attempts: { proposal: 1, planning: 1, renderByScene: [1, 1] },
    stagedIds: { productImageAssetIds: [], styleReferenceItemIds: ["reference-1"], avatarImageAssetIds: ["avatar-image-1"], attachmentIds: [] },
    scenes: [{ index: 1, status: "completed", imageUrl: "https://example.com/scene-1.png" }],
  }]);
  const serialized = JSON.stringify(report);
  assert.equal(report.sourceUrl, QUALITY_SOURCE_URL);
  assert.equal(report.runs[0].generationId, "generation-1");
  assert.match(renderQualityReportHtml(report), /scene-1\.png/);
  for (const forbidden of ["score", "retry", "regenerate", "deploy", "rawPrompt", "storagePath", "checksum"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
