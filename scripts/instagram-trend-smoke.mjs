import assert from "node:assert/strict";

const requiredEnvironment = [
  "BRAND_PILOT_API_URL",
  "BRAND_PILOT_SESSION_COOKIE",
  "BRAND_PILOT_SMOKE_BRAND_ID",
  "BRAND_PILOT_SMOKE_HASHTAG",
];
const sensitiveKeyPattern = /token|secret|credential/i;

function getEnvironment() {
  const config = {
    BRAND_PILOT_API_URL: process.env.BRAND_PILOT_API_URL?.trim(),
    BRAND_PILOT_SESSION_COOKIE: process.env.BRAND_PILOT_SESSION_COOKIE?.trim(),
    BRAND_PILOT_SMOKE_BRAND_ID: process.env.BRAND_PILOT_SMOKE_BRAND_ID?.trim(),
    BRAND_PILOT_SMOKE_HASHTAG: process.env.BRAND_PILOT_SMOKE_HASHTAG?.trim(),
  };
  const missing = requiredEnvironment.filter((name) => !config[name]);
  if (missing.length > 0) {
    throw new Error(`missing_environment: ${missing.join(", ")}`);
  }
  config.BRAND_PILOT_API_URL = validateApiBaseUrl(config.BRAND_PILOT_API_URL);
  return config;
}

function validateApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_environment: BRAND_PILOT_API_URL");
  }
  const isLoopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) || url.username || url.password) {
    throw new Error("invalid_environment: BRAND_PILOT_API_URL");
  }
  return url.toString();
}

function assertSafeJson(value, path = "$", seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`unsafe_json: circular value at ${path}`);
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKeyPattern.test(key)) {
        throw new Error(`unsafe_json: sensitive key at ${path}`);
      }
      assertSafeJson(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function apiUrl(baseUrl, path) {
  return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

async function readJsonResponse(response, method, path) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`invalid_json: ${method} ${path} status=${response.status}`);
  }
  assertSafeJson(payload);
  if (!response.ok) {
    throw new Error(`request_failed: ${method} status=${response.status}`);
  }
  return payload;
}

async function apiRequest(config, path, options = {}) {
  const method = options.method ?? "GET";
  let response;
  try {
    response = await fetch(apiUrl(config.BRAND_PILOT_API_URL, path), {
      method,
      redirect: "error",
      headers: {
        accept: "application/json",
        cookie: config.BRAND_PILOT_SESSION_COOKIE,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error(`network_error: ${method} ${path}`);
  }
  return readJsonResponse(response, method, path);
}

function isPublicInstagramPermalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["instagram.com", "www.instagram.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function openCheckPublicPermalink(permalink) {
  if (!isPublicInstagramPermalink(permalink)) return "skipped";
  let response;
  try {
    response = await fetch(permalink, { method: "HEAD", redirect: "manual" });
  } catch {
    throw new Error("public_permalink_failed: network_error");
  }
  if (response.status === 405 || response.status === 501) {
    try {
      response = await fetch(permalink, { method: "GET", redirect: "manual" });
    } catch {
      throw new Error("public_permalink_failed: network_error");
    }
  }
  if (!(response.ok || (response.status >= 300 && response.status < 400))) {
    throw new Error(`public_permalink_failed: status=${response.status}`);
  }
  return response.status;
}

async function main() {
  const config = getEnvironment();
  const brandPath = `/brands/${encodeURIComponent(config.BRAND_PILOT_SMOKE_BRAND_ID)}`;
  const searchPath = `${brandPath}/instagram-trends/search`;
  const searchBody = { hashtag: config.BRAND_PILOT_SMOKE_HASHTAG };

  const firstSearch = await apiRequest(config, searchPath, { method: "POST", body: searchBody });
  assert.ok(Array.isArray(firstSearch.items), "first search must return items");
  assert.ok(firstSearch.items.length <= 50, "first search returned more than 50 items");

  const secondSearch = await apiRequest(config, searchPath, { method: "POST", body: searchBody });
  assert.equal(secondSearch.source, "cache", "second search must use the cache");
  assert.equal(secondSearch.refreshed, false, "second search must not refresh the cache");

  const pagePath = `${brandPath}/instagram-trends?hashtag=${encodeURIComponent(config.BRAND_PILOT_SMOKE_HASHTAG)}&page=1`;
  const page = await apiRequest(config, pagePath);
  assert.ok(Array.isArray(page.items), "trend page must return items");
  assert.ok(page.items.length <= 50, "trend page returned more than 50 items");

  const firstMedia = page.items[0];
  assert.ok(firstMedia?.id, "trend page must contain one media item");
  assert.ok(typeof firstMedia.permalink === "string", "trend media must contain a permalink");
  const permalinkStatus = await openCheckPublicPermalink(firstMedia.permalink);

  const savePath = `${brandPath}/instagram-trends/${encodeURIComponent(firstMedia.id)}/save-source`;
  await apiRequest(config, savePath, { method: "POST" });
  const secondSave = await apiRequest(config, savePath, { method: "POST" });
  assert.equal(secondSave.alreadySaved, true, "second save must be idempotent");

  console.log(`Instagram trend smoke passed: items=${page.items.length}, permalink=${permalinkStatus}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "smoke_failed: unknown_error");
  process.exitCode = 1;
});
