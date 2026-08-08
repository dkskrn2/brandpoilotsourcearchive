import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const generationId = option("generation-id", process.env.AI_CONTENT_SMOKE_GENERATION_ID);
if (!generationId) {
  process.stderr.write(`${JSON.stringify({
    error: "subject_smoke_generation_id_required",
    safety: "zero_writes",
    requirement: "an existing proposal-v2 generation",
  })}\n`);
  process.exitCode = 2;
} else {
  const apiUrl = (option("api-url", process.env.BRAND_PILOT_API_URL) ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  const mode = option("mode", process.env.AI_CONTENT_SMOKE_MODE ?? "real");
  const brandId = option("brand-id", process.env.AI_CONTENT_SMOKE_BRAND_ID);
  const sourceUrl = option("url", process.env.AI_CONTENT_SMOKE_SUBJECT_URL) ?? null;
  const cookie = process.env.AI_CONTENT_SMOKE_COOKIE;
  const workerToken = process.env.AI_CONTENT_SMOKE_WORKER_TOKEN ?? process.env.WORKER_API_TOKEN;
  const subjectType = option("subject-type", process.env.AI_CONTENT_SMOKE_SUBJECT_TYPE ?? "product");

  assert.ok(["real", "fixture"].includes(mode), "--mode must be real or fixture");
  assert.ok(["product", "service"].includes(subjectType), "--subject-type must be product or service");
  assert.ok(brandId, "--brand-id or AI_CONTENT_SMOKE_BRAND_ID is required");
  assert.ok(cookie, "AI_CONTENT_SMOKE_COOKIE is required");
  if (mode === "fixture") assert.ok(workerToken, "AI_CONTENT_SMOKE_WORKER_TOKEN or WORKER_API_TOKEN is required");

  async function request(path, init = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`subject_smoke_api_failed:${response.status}:${body}`);
    return body ? JSON.parse(body) : null;
  }

  async function workerRequest(path, body) {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`subject_smoke_worker_api_failed:${response.status}:${text}`);
    return text ? JSON.parse(text) : null;
  }

  function runSubjectWorkerOnce() {
    return new Promise((resolve, reject) => {
      const command = process.platform === "win32" ? "npm.cmd" : "npm";
      const child = spawn(command, ["run", "subject-analysis-worker:once"], {
        stdio: "inherit", env: process.env, shell: false,
      });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`subject_smoke_worker_failed:${code}`)));
    });
  }

  async function waitForAnalysis(analysisId, accepted, timeoutMs = 20 * 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await request(`/brands/${brandId}/ai-content/subject-analyses/${analysisId}`);
      if (accepted.includes(value.status)) return value;
      if (value.status === "failed") throw new Error(`subject_smoke_failed:${value.errorCode ?? "unknown"}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`subject_smoke_timeout:${analysisId}`);
  }

  function analysisFixture(type) {
    const common = {
      contractVersion: "subject-analysis-result.v2",
      phase: "analysis",
      subjectType: type,
      summary: `${type} fixture analysis complete`,
      verifiedFacts: [{
        claim: type === "product" ? "Setup is documented." : "The operating process is documented.",
        support: "Confirmed by the smoke fixture input.",
        sourceUrl: `https://example.com/smoke/${type}`,
      }],
      voc: [], alternatives: [], barriers: [], sourceGaps: [],
    };
    if (type === "product") {
      return {
        ...common,
        productProfile: {
          name: "Fixture Widget", category: "Workflow tools", specifications: ["Compact"],
          materials: [], options: ["Blue"], price: "Not verified", discountsAndPromotions: [],
          shipping: [], returns: [],
          functions: [{ function: "Quick setup", benefit: "Less setup time", purchaseReason: "Documented manual input" }],
          useContexts: ["Team onboarding"], purchaseBarriers: ["Fit uncertainty"],
          reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] },
          productImageCandidates: [], detailImageCandidates: [],
        },
        serviceProfile: null,
        serviceSubtype: null,
      };
    }
    return {
      ...common,
      productProfile: null,
      serviceProfile: {
        customerProblem: ["Manual handoffs"], currentAlternatives: ["Spreadsheets"],
        deliveryProcess: ["Audit", "Setup", "Operating support"], deliverables: ["Configured workflow"],
        users: ["Operators"], buyers: ["Team leads"], price: "Not verified",
        beforeAfterWorkflow: { before: ["Manual collection"], after: ["Guided workflow"] },
        afterState: ["Consistent operations"], terms: { contract: [], renewal: [], cancellation: [] },
        support: ["Onboarding"], trustEvidence: [], securityEvidence: [], performanceEvidence: [],
        adoptionBarriers: ["Migration effort"],
      },
      serviceSubtype: "professional",
    };
  }

  function appealFixture(type) {
    const targets = [1, 2, 3].map((index) => ({
      id: `${type}-target-${index}`,
      name: `${type} target ${index}`,
      traits: ["Practical"], painPoints: ["Slow setup"], purchaseMotivations: ["Save time"],
      uspEvidence: [{
        claim: "Guided setup", support: "The fixture input documents the setup flow.",
        sourceUrl: `https://example.com/smoke/${type}`,
      }],
    }));
    return {
      contractVersion: "subject-appeal-result.v2",
      phase: "appeal",
      targets,
      appealsByTarget: Object.fromEntries(targets.map((target) => [target.id, [1, 2].map((index) => ({
        id: `${target.id}-appeal-${index}`, targetId: target.id, title: `Fixture appeal ${index}`,
        description: "Connect the confirmed benefit to the selected target.", evidenceType: "manual_input",
        connectionReason: "The fixture input directly supports this appeal.", sources: [],
      }))])),
    };
  }

  async function claimFixturePhase(analysisId, expectedPhase, workerId) {
    const claimed = await workerRequest("/worker/ai-content-subject-analyses/claim", {
      workerId, leaseSeconds: 180, analysisId,
    });
    assert.ok(claimed?.job, `fixture ${expectedPhase} job was not claimable`);
    assert.equal(claimed.job.analysisId, analysisId);
    assert.equal(claimed.job.contractVersion, "subject-analysis.v2");
    assert.equal(claimed.job.phase, expectedPhase);
    return claimed.job;
  }

  async function completeFixturePhase(job, result) {
    await workerRequest(`/worker/ai-content-subject-analyses/${job.analysisId}/complete`, {
      workerId: job.workerId, leaseToken: job.leaseToken, leaseSeconds: 180, result,
    });
  }

  async function requestAnalysis(type, runKey) {
    const requested = await request(`/brands/${brandId}/ai-content/subject-analyses`, {
      method: "POST",
      body: JSON.stringify({
        contractVersion: "subject-analysis.v2",
        generationId,
        subjectType: type,
        sourceUrl: mode === "real" ? sourceUrl : null,
        attachmentIds: [],
        manualInput: {
          name: option("name", type === "product" ? "Fixture Widget" : "Fixture Operations Service"),
          promotionOrTerms: option("promotion", ""),
          description: option("description", type === "product" ? "A compact workflow tool." : "Audit, setup, and operating support."),
        },
        idempotencyKey: `subject-smoke-${type}-${runKey}`,
      }),
    });
    assert.equal(requested.contractVersion, "subject-analysis.v2");
    assert.equal(requested.generationId, generationId);
    return requested;
  }

  const generation = await request(`/brands/${brandId}/ai-content/generations/${generationId}`);
  assert.equal(generation.draft?.origin, "proposal-v2", "subject smoke requires a proposal-v2 generation");
  const runKey = `${Date.now()}`;
  if (mode === "fixture") {
    const results = [];
    for (const type of ["product", "service"]) {
      const requested = await requestAnalysis(type, runKey);
      const workerId = `subject-smoke-${type}-${process.pid}`;
      const analysisJob = await claimFixturePhase(requested.id, "analysis", workerId);
      await completeFixturePhase(analysisJob, analysisFixture(type));
      const appealJob = await claimFixturePhase(requested.id, "appeal", workerId);
      await completeFixturePhase(appealJob, appealFixture(type));
      const completed = await request(`/brands/${brandId}/ai-content/subject-analyses/${requested.id}`);
      assert.equal(completed.status, "ready");
      results.push({ type, analysisId: completed.id, status: completed.status });
    }
    console.log(JSON.stringify({ mode, generationId, results }, null, 2));
  } else {
    const requested = await requestAnalysis(subjectType, runKey);
    await runSubjectWorkerOnce();
    const afterAnalysis = await waitForAnalysis(requested.id, ["generating_appeals", "ready", "partial"]);
    if (afterAnalysis.status === "generating_appeals") await runSubjectWorkerOnce();
    const completed = await waitForAnalysis(requested.id, ["ready", "partial"]);
    console.log(JSON.stringify({ mode, generationId, analysisId: completed.id, status: completed.status }, null, 2));
  }
}
