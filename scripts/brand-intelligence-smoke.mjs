import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = (option("api-url", process.env.BRAND_PILOT_API_URL) ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const brandId = option("brand-id", process.env.BRAND_INTELLIGENCE_SMOKE_BRAND_ID);
const ownedUrl = option("url", process.env.BRAND_INTELLIGENCE_SMOKE_URL);
const cookie = process.env.BRAND_INTELLIGENCE_SMOKE_COOKIE;

assert.ok(brandId, "--brand-id or BRAND_INTELLIGENCE_SMOKE_BRAND_ID is required");
assert.ok(ownedUrl, "--url or BRAND_INTELLIGENCE_SMOKE_URL is required");
assert.ok(cookie, "BRAND_INTELLIGENCE_SMOKE_COOKIE is required");
assert.equal(new URL(ownedUrl).protocol, "https:", "the smoke URL must use https");

async function request(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`brand_intelligence_smoke_api_failed:${response.status}:${body}`);
  return body ? JSON.parse(body) : null;
}

function runWorkerOnce() {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["run", "brand-intelligence-worker:once"], {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`brand_intelligence_smoke_worker_failed:${code}`)));
  });
}

async function waitForReview(analysisId) {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const analysis = await request(`/brands/${brandId}/brand-intelligence/analyses/${analysisId}`);
    if (analysis.status === "review_ready") return analysis;
    if (analysis.status === "failed") {
      throw new Error(`brand_intelligence_smoke_analysis_failed:${analysis.errorCode ?? "unknown"}:${analysis.errorMessage ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("brand_intelligence_smoke_timeout");
}

const runId = Date.now();
console.log("[smoke] request brand analysis");
const created = await request(`/brands/${brandId}/brand-intelligence/analyses`, {
  method: "POST",
  body: JSON.stringify({ ownedUrl, uploadIds: [], idempotencyKey: `brand-intelligence-smoke-${runId}` }),
});

await runWorkerOnce();
const review = await waitForReview(created.id);
assert.ok(review.effectiveResult, "analysis must provide an editable result");

const editedResult = {
  ...review.effectiveResult,
  primaryTarget: `${review.effectiveResult.primaryTarget} (스모크 확인)`,
};
await request(`/brands/${brandId}/brand-intelligence/analyses/${created.id}`, {
  method: "PATCH",
  body: JSON.stringify({ editedResult }),
});
const confirmed = await request(`/brands/${brandId}/brand-intelligence/analyses/${created.id}/confirm`, { method: "POST" });
const current = await request(`/brands/${brandId}/brand-intelligence`);
const aiContext = await request(`/brands/${brandId}/ai-content/brand-context`);

assert.equal(confirmed.status, "confirmed");
assert.equal(current.intelligence.id, confirmed.id);
assert.equal(current.intelligence.effectiveResult.primaryTarget, editedResult.primaryTarget);
assert.equal(aiContext.brandIntelligenceVersionId, confirmed.id);
assert.equal(aiContext.context.brandIntelligence.profile.primaryTarget, editedResult.primaryTarget);

console.log(JSON.stringify({
  analysisId: confirmed.id,
  status: confirmed.status,
  primaryTarget: editedResult.primaryTarget,
  aiContentVersionId: aiContext.brandIntelligenceVersionId,
}, null, 2));
