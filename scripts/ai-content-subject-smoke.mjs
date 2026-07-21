import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const apiUrl = (option("api-url", process.env.BRAND_PILOT_API_URL) ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const mode = option("mode", process.env.AI_CONTENT_SMOKE_MODE ?? "real");
const brandId = option("brand-id", process.env.AI_CONTENT_SMOKE_BRAND_ID);
const sourceUrl = option("url", process.env.AI_CONTENT_SMOKE_SUBJECT_URL);
const cookie = process.env.AI_CONTENT_SMOKE_COOKIE;
const workerToken = process.env.AI_CONTENT_SMOKE_WORKER_TOKEN ?? process.env.WORKER_API_TOKEN;
const type = option("type", process.env.AI_CONTENT_SMOKE_TYPE ?? "card_news");
const outputCount = Number(option("output-count", "1"));
const supportedTypes = new Set(["card_news", "blog", "marketing"]);

assert.ok(["real", "fixture"].includes(mode), "--mode must be real or fixture");
assert.ok(brandId, "--brand-id or AI_CONTENT_SMOKE_BRAND_ID is required");
assert.ok(cookie, "AI_CONTENT_SMOKE_COOKIE is required");
if (mode === "fixture") {
  assert.ok(workerToken, "AI_CONTENT_SMOKE_WORKER_TOKEN or WORKER_API_TOKEN is required in fixture mode");
} else {
  assert.ok(sourceUrl, "--url or AI_CONTENT_SMOKE_SUBJECT_URL is required");
  assert.ok(supportedTypes.has(type), "--type must be card_news, blog, or marketing");
  assert.ok(Number.isInteger(outputCount) && outputCount >= 1 && outputCount <= 3, "--output-count must be 1, 2, or 3");
}

const workerScript = {
  card_news: "card-news-worker:once",
  blog: "blog-worker:once",
  marketing: "marketing-worker:once",
}[type];

async function request(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`smoke_api_failed:${response.status}:${body}`);
  return body ? JSON.parse(body) : null;
}

async function workerRequest(path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${workerToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`smoke_worker_api_failed:${response.status}:${text}`);
  return text ? JSON.parse(text) : null;
}

function runNpm(script) {
  return new Promise((resolve, reject) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(command, ["run", script], { stdio: "inherit", env: process.env, shell: false });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`smoke_worker_failed:${script}:${code}`)));
  });
}

async function waitFor(path, accepted, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await request(path);
    if (accepted.includes(value.status)) return value;
    if (value.status === "failed") throw new Error(`smoke_job_failed:${value.errorCode ?? "unknown"}:${value.errorMessage ?? ""}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`smoke_timeout:${path}:${accepted.join(",")}`);
}

async function ensureSubjectReady(analysis) {
  if (["ready", "partial"].includes(analysis.status)) return analysis;
  await runNpm("subject-analysis-worker:once");
  return waitFor(`/brands/${brandId}/ai-content/subject-analyses/${analysis.id}`, ["ready", "partial"], 20 * 60_000);
}

async function ensureGenerationStatus(generationId, status) {
  await runNpm(workerScript);
  return waitFor(`/brands/${brandId}/ai-content/generations/${generationId}`, [status], 20 * 60_000);
}

function analysisFixture(subjectType) {
  const common = {
    contractVersion: "subject-analysis-result.v2",
    phase: "analysis",
    subjectType,
    summary: subjectType === "product" ? "제품 fixture 분석 완료" : "서비스 fixture 분석 완료",
    verifiedFacts: [{
      claim: subjectType === "product" ? "설치가 간단합니다." : "진단 후 운영 설정을 제공합니다.",
      support: "스모크 테스트 수동 입력에서 확인했습니다.",
      sourceUrl: `https://example.com/smoke/${subjectType}`,
    }],
    voc: [],
    alternatives: [],
    barriers: [],
    sourceGaps: [],
  };
  if (subjectType === "product") {
    return {
      ...common,
      productProfile: {
        name: "Fixture Widget",
        category: "Workflow tools",
        specifications: ["Compact"],
        materials: [],
        options: ["Blue"],
        price: "Not verified",
        discountsAndPromotions: [],
        shipping: [],
        returns: [],
        functions: [{ function: "Quick setup", benefit: "Less setup time", purchaseReason: "Documented manual input" }],
        useContexts: ["Team onboarding"],
        purchaseBarriers: ["Fit uncertainty"],
        reviewPatterns: { recurringSatisfaction: [], recurringComplaints: [] },
        productImageCandidates: [],
        detailImageCandidates: [],
      },
      serviceProfile: null,
      serviceSubtype: null,
    };
  }
  return {
    ...common,
    productProfile: null,
    serviceProfile: {
      customerProblem: ["Manual handoffs"],
      currentAlternatives: ["Spreadsheets"],
      deliveryProcess: ["Audit", "Setup", "Operating support"],
      deliverables: ["Configured workflow"],
      users: ["Operators"],
      buyers: ["Team leads"],
      price: "Not verified",
      beforeAfterWorkflow: { before: ["Manual collection"], after: ["Guided workflow"] },
      afterState: ["Consistent operations"],
      terms: { contract: [], renewal: [], cancellation: [] },
      support: ["Onboarding"],
      trustEvidence: [],
      securityEvidence: [],
      performanceEvidence: [],
      adoptionBarriers: ["Migration effort"],
    },
    serviceSubtype: "professional",
  };
}

function appealFixture(subjectType) {
  const targets = [1, 2, 3].map((index) => ({
    id: `${subjectType}-target-${index}`,
    name: `${subjectType} target ${index}`,
    traits: ["Practical"],
    painPoints: ["Slow setup"],
    purchaseMotivations: ["Save time"],
    uspEvidence: [{
      claim: "Guided setup",
      support: "The fixture input documents the setup flow.",
      sourceUrl: `https://example.com/smoke/${subjectType}`,
    }],
  }));
  return {
    contractVersion: "subject-appeal-result.v2",
    phase: "appeal",
    targets,
    appealsByTarget: Object.fromEntries(targets.map((target) => [target.id, [1, 2].map((index) => ({
      id: `${target.id}-appeal-${index}`,
      targetId: target.id,
      title: `Fixture appeal ${index}`,
      description: "Connect the confirmed benefit to the selected target.",
      evidenceType: "manual_input",
      connectionReason: "The fixture input directly supports this appeal.",
      sources: [],
    }))])),
  };
}

async function claimFixturePhase(expectedAnalysisId, expectedPhase, workerId) {
  const claimed = await workerRequest("/worker/ai-content-subject-analyses/claim", {
    workerId,
    leaseSeconds: 180,
    analysisId: expectedAnalysisId,
  });
  assert.ok(claimed?.job, `fixture ${expectedPhase} job was not claimable`);
  assert.equal(claimed.job.analysisId, expectedAnalysisId, "fixture queue contains an earlier subject-analysis job");
  assert.equal(claimed.job.contractVersion, "subject-analysis.v2");
  assert.equal(claimed.job.phase, expectedPhase);
  return claimed.job;
}

async function completeFixturePhase(job, result) {
  await workerRequest(`/worker/ai-content-subject-analyses/${job.analysisId}/complete`, {
    workerId: job.workerId,
    leaseToken: job.leaseToken,
    leaseSeconds: 180,
    result,
  });
}

async function runFixtureCase(subjectType, runKey) {
  console.log(`[smoke:fixture] ${subjectType} v2 analysis`);
  const generation = await request(`/brands/${brandId}/ai-content/generations`, {
    method: "POST",
    body: JSON.stringify({
      type: "card_news",
      title: `${subjectType} fixture ${runKey}`,
      draft: { fixtureMode: true, subjectType },
      idempotencyKey: `fixture-generation-${subjectType}-${runKey}`,
    }),
  });
  assert.ok(generation?.id, "fixture generation was not created");

  const requested = await request(`/brands/${brandId}/ai-content/subject-analyses`, {
    method: "POST",
    body: JSON.stringify({
      contractVersion: "subject-analysis.v2",
      generationId: generation.id,
      subjectType,
      sourceUrl: null,
      attachmentIds: [],
      manualInput: {
        name: subjectType === "product" ? "Fixture Widget" : "Fixture Operations Service",
        promotionOrTerms: "",
        description: subjectType === "product" ? "A compact workflow tool." : "Audit, setup, and operating support.",
      },
      idempotencyKey: `fixture-analysis-${subjectType}-${runKey}`,
    }),
  });
  assert.equal(requested.contractVersion, "subject-analysis.v2");
  assert.equal(requested.generationId, generation.id);
  assert.equal(requested.status, "queued");

  const workerId = `subject-smoke-${subjectType}-${process.pid}`;
  const analysisJob = await claimFixturePhase(requested.id, "analysis", workerId);
  assert.equal(analysisJob.subject.type, subjectType);
  await completeFixturePhase(analysisJob, analysisFixture(subjectType));
  const appealQueued = await request(`/brands/${brandId}/ai-content/subject-analyses/${requested.id}`);
  assert.equal(appealQueued.status, "generating_appeals");

  const appealJob = await claimFixturePhase(requested.id, "appeal", workerId);
  assert.equal(appealJob.analysisResult.subjectType, subjectType);
  await completeFixturePhase(appealJob, appealFixture(subjectType));

  const completed = await request(`/brands/${brandId}/ai-content/subject-analyses/${requested.id}`);
  assert.equal(completed.contractVersion, "subject-analysis.v2");
  assert.equal(completed.status, "ready");
  assert.equal(completed.targets.length, 3);
  assert.ok(completed.targets.every((target) => completed.appealsByTarget[target.id]?.length === 2));
  return { subjectType, generationId: generation.id, analysisId: requested.id, status: completed.status };
}

async function runFixtureSmoke() {
  const runKey = `${Date.now()}`;
  const results = [];
  for (const subjectType of ["product", "service"]) {
    results.push(await runFixtureCase(subjectType, runKey));
  }
  console.log(JSON.stringify({ mode: "fixture", results }, null, 2));
}

async function runRealSmoke() {
const runKey = `${type}-${Date.now()}`;
const subjectBody = {
  subjectType: "product",
  sourceUrl,
  manualInput: { name: "스모크 테스트 제품", promotion: "", description: "공개 URL 근거 확인" },
  idempotencyKey: `subject-${runKey}`,
};

console.log("[smoke] request and cache subject analysis");
const firstRequested = await request(`/brands/${brandId}/ai-content/subject-analyses`, { method: "POST", body: JSON.stringify(subjectBody) });
const duplicateRequested = await request(`/brands/${brandId}/ai-content/subject-analyses`, { method: "POST", body: JSON.stringify(subjectBody) });
assert.equal(duplicateRequested.id, firstRequested.id);
const firstAnalysis = await ensureSubjectReady(firstRequested);
assert.equal(firstAnalysis.targets.length, 3);

console.log("[smoke] force one new analysis version");
const forcedRequested = await request(`/brands/${brandId}/ai-content/subject-analyses/${firstAnalysis.id}/reanalyze`, {
  method: "POST",
  body: JSON.stringify({ idempotencyKey: `subject-force-${runKey}` }),
});
assert.equal(forcedRequested.analysisVersion, firstAnalysis.analysisVersion + 1);
let analysis = await ensureSubjectReady(forcedRequested);
assert.equal(analysis.targets.length, 3);

if (analysis.images.length > 0) {
  const imageId = analysis.selectedImageId ?? analysis.images[0].id;
  analysis = await request(`/brands/${brandId}/ai-content/subject-analyses/${analysis.id}/selection`, {
    method: "PATCH",
    body: JSON.stringify({ imageId }),
  });
  assert.equal(analysis.selectedImageId, imageId);
}

const target = analysis.targets[0];
const appeal = analysis.appealsByTarget[target.id]?.[0];
assert.ok(appeal, "the first target must have at least one appeal");
const selectedImageIds = analysis.selectedImageId ? [analysis.selectedImageId] : [];
const draft = {
  type,
  subjectType: "product",
  subjectInput: { sourceUrl, name: analysis.input.name, promotion: analysis.input.promotion, description: analysis.input.description },
  subjectAnalysisId: analysis.id,
  subjectAnalysisVersion: analysis.analysisVersion,
  selectedSubjectImageIds: selectedImageIds,
  selectedTarget: target,
  selectedAppeal: appeal,
  referenceIds: [],
  brief: {
    purpose: "information",
    emphasis: "확인 가능한 핵심 정보를 구체적으로 전달",
    cta: "필요할 때 다시 확인하세요.",
    additionalInstruction: "과장 없이 사람이 설명하듯 자연스러운 한국어로 작성",
    selectedColor: "#0057B8",
    attachments: [],
    aspectRatio: "1:1",
    outputCount,
    outputDirections: Array.from({ length: outputCount }, (_, index) => `${index + 1}번 결과는 서로 다른 훅을 사용`),
  },
  analysisSource: "product_url",
  productUrl: sourceUrl,
  selectedAnalysisImageIds: selectedImageIds,
  audience: null,
  coreAppeal: null,
  secondaryAppeals: [],
};

const usageBefore = await request(`/brands/${brandId}/ai-content/usage`);
const createBody = { type, title: `제품 분석 smoke ${runKey}`, draft, idempotencyKey: `generation-analysis-${runKey}` };
const created = await request(`/brands/${brandId}/ai-content/generations`, { method: "POST", body: JSON.stringify(createBody) });
const duplicateCreated = await request(`/brands/${brandId}/ai-content/generations`, { method: "POST", body: JSON.stringify(createBody) });
assert.equal(duplicateCreated.id, created.id);

await ensureGenerationStatus(created.id, "analysis_ready");
await request(`/brands/${brandId}/ai-content/generations/${created.id}`, {
  method: "PATCH",
  body: JSON.stringify({ draft, referenceIds: [] }),
});

const generateBody = { idempotencyKey: `generation-start-${runKey}`, outputCount };
const started = await request(`/brands/${brandId}/ai-content/generations/${created.id}/generate`, { method: "POST", body: JSON.stringify(generateBody) });
const duplicateStarted = await request(`/brands/${brandId}/ai-content/generations/${created.id}/generate`, { method: "POST", body: JSON.stringify(generateBody) });
assert.equal(duplicateStarted.id, started.id);
assert.equal(started.status, "analyzing");
const usageAfter = await request(`/brands/${brandId}/ai-content/usage`);
assert.equal(usageAfter.generationCount - usageBefore.generationCount, outputCount);

const queuedGeneration = await ensureGenerationStatus(created.id, "queued");
assert.equal(queuedGeneration.currentStage, "generate");
for (let index = 0; index < outputCount; index += 1) {
  await runNpm(workerScript);
  if (index < outputCount - 1) {
    const inProgress = await request(`/brands/${brandId}/ai-content/generations/${created.id}`);
    assert.ok(["queued", "generating"].includes(inProgress.status));
    assert.equal(inProgress.outputs.filter((output) => output.status === "completed").length, index + 1);
  }
}
const completed = await waitFor(`/brands/${brandId}/ai-content/generations/${created.id}`, ["completed", "partial_failed"], 20 * 60_000);
assert.equal(completed.status, "completed");
assert.equal(completed.outputs.length, outputCount);
assert.ok(completed.outputs.every((output) => output.status === "completed"));

console.log(JSON.stringify({ analysisId: analysis.id, analysisVersion: analysis.analysisVersion, generationId: completed.id, outputs: completed.outputs.length }, null, 2));
}

if (mode === "fixture") {
  await runFixtureSmoke();
} else {
  await runRealSmoke();
}
