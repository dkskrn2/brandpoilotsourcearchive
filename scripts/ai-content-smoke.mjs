import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import process from "node:process";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.length ? rest.join("=") : true];
}));

const type = process.env.AI_CONTENT_SMOKE_TYPE ?? "card_news";
const supported = new Set(["card_news", "blog", "marketing"]);
assert.ok(supported.has(type), "AI_CONTENT_SMOKE_TYPE must be card_news, blog, or marketing");

const apiUrl = (process.env.BRAND_PILOT_API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const brandId = process.env.AI_CONTENT_SMOKE_BRAND_ID;
const cookie = process.env.AI_CONTENT_SMOKE_COOKIE;
assert.ok(brandId, "AI_CONTENT_SMOKE_BRAND_ID is required");
assert.ok(cookie, "AI_CONTENT_SMOKE_COOKIE is required");

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
  if (!response.ok) throw new Error(`smoke_api_failed:${response.status}:${await response.text()}`);
  return response.json();
}

function runWorkerOnce() {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", workerScript], { shell: true, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`smoke_worker_failed:${code}`)));
  });
}

async function waitFor(generationId, statuses, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const generation = await request(`/brands/${brandId}/ai-content/generations/${generationId}`);
    if (statuses.includes(generation.status)) return generation;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`smoke_generation_timeout:${statuses.join(",")}`);
}

const publishTargets = new Set(["instagram_feed_single", "instagram_feed_carousel", "instagram_story"]);

async function resolvePublishOutput() {
  const requestedOutputId = args.get("--output-id");
  const useLatest = args.has("--latest-completed");
  if (!requestedOutputId && !useLatest) return null;

  const generations = await request(`/brands/${brandId}/ai-content/generations`);
  const completed = generations
    .flatMap((generation) => (generation.outputs ?? []).map((output) => ({ generation, output })))
    .filter(({ output }) => output.status === "completed" && output.manifest?.type !== "blog")
    .sort((a, b) => Date.parse(b.generation.updatedAt) - Date.parse(a.generation.updatedAt));
  const resolved = requestedOutputId
    ? completed.find(({ output }) => output.id === requestedOutputId)
    : completed[0];
  assert.ok(resolved, "No completed image output matched the smoke request");
  return resolved;
}

async function inspectOrPublish() {
  const resolved = await resolvePublishOutput();
  if (!resolved) return false;
  const target = String(args.get("--target") ?? "");
  assert.ok(publishTargets.has(target), "--target must be instagram_feed_single, instagram_feed_carousel, or instagram_story");
  const channels = await request(`/brands/${brandId}/channels`);
  const instagram = channels.find((channel) => channel.type === "instagram" && channel.status === "connected" && channel.enabled);
  assert.ok(instagram, "A connected and enabled Instagram account is required");
  const assetUrls = (resolved.output.manifest?.assets ?? []).map((asset) => asset.url);
  assert.ok(assetUrls.length > 0, "The resolved output has no assets");
  assetUrls.forEach((url) => assert.equal(new URL(url).protocol, "https:"));

  console.log(JSON.stringify({
    execute: args.has("--execute"),
    account: instagram.accountLabel,
    outputId: resolved.output.id,
    target,
    assetUrls,
  }, null, 2));

  if (args.has("--execute")) {
    const result = await request(`/brands/${brandId}/ai-content/outputs/${resolved.output.id}/publish`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), targets: [{ channel: "instagram", deliveryFormat: target }] }),
    });
    console.log(JSON.stringify({ targets: result.targets }, null, 2));
  }
  return true;
}

if (await inspectOrPublish()) process.exit(0);

const key = `${type}-${Date.now()}`;
const draft = {
  type,
  analysisSource: "owned",
  productUrl: "",
  selectedAnalysisImageIds: [],
  audience: { id: null, name: "브랜드 고객", situation: "정보 탐색 중", problem: "선택 기준이 부족함", motivation: "신뢰할 수 있는 판단" },
  coreAppeal: { id: null, title: "명확한 정보", description: "확인 가능한 사실과 실용적인 기준을 전달합니다.", evidenceType: "benefit" },
  secondaryAppeals: [],
  referenceIds: [],
  brief: { purpose: "information", emphasis: "사용자에게 실제로 도움이 되는 내용", cta: "필요할 때 다시 확인하세요.", additionalInstruction: "과장 없이 자연스러운 한국어로 작성", attachments: [], aspectRatio: "1:1", outputCount: 1, outputDirections: [] },
};

console.log(`[smoke] create ${type} analysis`);
const created = await request(`/brands/${brandId}/ai-content/generations`, { method: "POST", body: JSON.stringify({ type, title: `AI 콘텐츠 smoke ${key}`, draft, idempotencyKey: `analysis-${key}` }) });
await runWorkerOnce();
await waitFor(created.id, ["analysis_ready"]);
await request(`/brands/${brandId}/ai-content/generations/${created.id}`, { method: "PATCH", body: JSON.stringify({ draft, referenceIds: [] }) });
await request(`/brands/${brandId}/ai-content/generations/${created.id}/generate`, { method: "POST", body: JSON.stringify({ idempotencyKey: `generate-${key}`, outputCount: 1 }) });
await runWorkerOnce();
const completed = await waitFor(created.id, ["completed", "partial_failed", "failed"], 60_000);
assert.equal(completed.status, "completed");
assert.ok(completed.outputs?.length > 0);
for (const output of completed.outputs) {
  assert.equal(output.status, "completed");
  assert.equal(output.manifest?.version, "ai-content.v1");
  assert.ok(output.manifest.assets.every((asset) => new URL(asset.url).protocol === "https:"));
}
console.log(`[smoke] completed ${type}: ${completed.id}`);
