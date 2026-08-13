import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("curated FAQ matcher fixture meets the staged rollout gates", () => {
  const result = spawnSync(process.execPath, ["scripts/faq-matcher-evaluation.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const metrics = JSON.parse(result.stdout.trim());
  assert.ok(metrics.cases >= 60);
  assert.equal(metrics.expandedExactPrecision, 1);
  assert.equal(metrics.falseExpandedExactCount, 0);
  assert.ok(metrics.clarificationPrecision >= 0.9);
  assert.equal(metrics.mismatchCount, 0);
  assert.ok(metrics.p95MatcherLatencyMs <= 25);
});
