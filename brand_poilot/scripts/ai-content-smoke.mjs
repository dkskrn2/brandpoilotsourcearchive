import assert from "node:assert/strict";
import process from "node:process";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.length ? rest.join("=") : true];
}));

const schedulerRequested = args.has("--scheduler-contract");
const publishingRequested = args.has("--output-id") || args.has("--latest-completed");
assert.ok(!(schedulerRequested && publishingRequested), "choose one smoke mode");

if (!schedulerRequested && !publishingRequested) {
  process.stderr.write(`${JSON.stringify({
    error: "ai_content_smoke_replaced_by_authenticated_browser_canary",
    safety: "zero_writes",
    replacement: "authenticated /ai-content/new browser canary",
  })}\n`);
  process.exitCode = 2;
} else {
  const apiUrl = (process.env.BRAND_PILOT_API_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  const brandId = process.env.AI_CONTENT_SMOKE_BRAND_ID;
  const cookie = process.env.AI_CONTENT_SMOKE_COOKIE;
  assert.ok(brandId, "AI_CONTENT_SMOKE_BRAND_ID is required");
  assert.ok(cookie, "AI_CONTENT_SMOKE_COOKIE is required");

  async function request(path, init = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`smoke_api_failed:${response.status}:${body}`);
    return body ? JSON.parse(body) : null;
  }

  async function verifyProposalSchedulerContract() {
    const enabled = process.env.AI_CONTENT_PROPOSAL_SCHEDULER_ENABLED === "true";
    const cronSecret = process.env.CRON_SECRET;
    assert.ok(cronSecret, "CRON_SECRET is required for scheduler contract smoke");
    const beforeProposals = await request(`/brands/${brandId}/ai-content/proposals?status=suggested`);
    const beforeGenerations = await request(`/brands/${brandId}/ai-content/generations`);
    await request("/internal/cron/source-crawl", {
      method: "GET",
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const afterProposals = await request(`/brands/${brandId}/ai-content/proposals?status=suggested`);
    const afterGenerations = await request(`/brands/${brandId}/ai-content/generations`);
    assert.equal(afterGenerations.length, beforeGenerations.length, "proposal-only scheduler must not create a generation");
    if (enabled) {
      const batches = await Promise.all(afterProposals.map((item) =>
        request(`/brands/${brandId}/ai-content/proposal-batches/${item.batchId}`),
      ));
      const scheduled = batches.filter((item) => item.origin === "scheduled_crawl");
      assert.ok(afterProposals.length >= beforeProposals.length);
      assert.ok(scheduled.length > 0, "ON proposal-only scheduler must expose a scheduled_crawl proposal");
    } else {
      assert.equal(afterProposals.length, beforeProposals.length, "OFF scheduler must not create a proposal");
    }
    console.log(`[smoke] scheduler ${enabled ? "ON proposal-only" : "OFF"} verified`);
  }

  async function inspectOrPublish() {
    const generations = await request(`/brands/${brandId}/ai-content/generations`);
    const requestedOutputId = args.get("--output-id");
    const completed = generations
      .flatMap((generation) => (generation.outputs ?? []).map((output) => ({ generation, output })))
      .filter(({ output }) => output.status === "completed"
        && output.manifestVersion === "ai-content.v3"
        && output.outputFormat !== "blog"
        && output.publishSupported !== false)
      .sort((left, right) => Date.parse(right.generation.updatedAt) - Date.parse(left.generation.updatedAt));
    const resolved = requestedOutputId
      ? completed.find(({ output }) => output.id === requestedOutputId)
      : completed[0];
    assert.ok(resolved, "No completed V3 publishable output matched the smoke request");
    const target = String(args.get("--target") ?? "");
    assert.ok(new Set(["instagram_feed_single", "instagram_feed_carousel", "instagram_story"]).has(target),
      "--target must be instagram_feed_single, instagram_feed_carousel, or instagram_story");
    const channels = await request(`/brands/${brandId}/channels`);
    const instagram = channels.find((channel) => channel.type === "instagram" && channel.status === "connected" && channel.enabled);
    assert.ok(instagram, "A connected and enabled Instagram account is required");
    const assetUrls = (resolved.output.manifest?.assets ?? []).map((asset) => asset.url);
    assert.ok(assetUrls.length > 0, "The resolved output has no assets");
    assetUrls.forEach((url) => assert.equal(new URL(url).protocol, "https:"));
    console.log(JSON.stringify({
      execute: args.has("--execute"), account: instagram.accountLabel,
      outputId: resolved.output.id, target, assetUrls,
    }, null, 2));
    if (args.has("--execute")) {
      const result = await request(`/brands/${brandId}/ai-content/outputs/${resolved.output.id}/publish`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          targets: [{ channel: "instagram", deliveryFormat: target }],
        }),
      });
      console.log(JSON.stringify({ targets: result.targets }, null, 2));
    }
  }

  if (schedulerRequested) await verifyProposalSchedulerContract();
  else await inspectOrPublish();
}
