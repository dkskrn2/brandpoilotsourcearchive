import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");

const entryPoints = [
  "workers/brand-pilot-content-proposal-worker/src/main.ts",
  "workers/brand-pilot-image-worker/src/index.ts",
  "workers/brand-pilot-card-news-worker/src/index.ts",
  "workers/brand-pilot-blog-worker/src/index.ts",
  "workers/brand-pilot-reel-worker/src/index.ts",
];

test("all five content-worker watch loops emit the same safe structured poll observation", async () => {
  for (const path of entryPoints) {
    const source = await read(path);
    assert.match(source, /contentWorkerPollObservation/,
      `${path} does not classify watch errors through the shared safe observer`);
    assert.match(source, /JSON\.stringify\(contentWorkerPollObservation\(error\)\)/,
      `${path} does not emit the structured observation`);
    assert.match(source, /process\.once\("SIGTERM"/,
      `${path} lost its SIGTERM handler`);
  }
});

test("card-news, blog, and reel clients preserve only the exact maintenance error code", async () => {
  for (const path of [
    "workers/brand-pilot-card-news-worker/src/client.ts",
    "workers/brand-pilot-blog-worker/src/client.ts",
    "workers/brand-pilot-reel-worker/src/client.ts",
  ]) {
    const source = await read(path);
    assert.match(source, /contentWorkerApiError/,
      `${path} discards the maintenance response code`);
    assert.match(source, /throw await contentWorkerApiError\(response\)/,
      `${path} does not use the safe API error parser`);
  }
});

test("blog and reel contain watch failures, delay before polling, and leave run-once fail-fast", async () => {
  for (const path of [
    "workers/brand-pilot-blog-worker/src/index.ts",
    "workers/brand-pilot-reel-worker/src/index.ts",
  ]) {
    const source = await read(path);
    const watchStart = source.indexOf('if (mode === "watch")');
    const watchEnd = source.indexOf("return;", watchStart);
    const watch = source.slice(watchStart, watchEnd);
    const runOnce = source.slice(watchEnd);
    assert.match(watch, /try\s*\{[\s\S]*await execute\(\)[\s\S]*\}\s*catch\s*\(error\)/,
      `${path} still lets a claim 503 terminate watch mode`);
    assert.match(watch, /if \(!shutdown\.signal\.aborted\) await wait\(pollMs\)/,
      `${path} can retry without its bounded poll delay`);
    assert.match(runOnce, /JSON\.stringify\(await execute\(\)\)/,
      `${path} no longer fails run-once through the top-level error path`);
    assert.doesNotMatch(runOnce, /execute\(\)\.catch/,
      `${path} incorrectly contains run-once failures`);
  }
});

test("the three already resilient loops retain a bounded wait after watch errors", async () => {
  const [proposal, image, cardNews] = await Promise.all([
    read(entryPoints[0]), read(entryPoints[1]), read(entryPoints[2]),
  ]);
  assert.match(proposal, /runContentProposalWatchIteration\([\s\S]*pollMs/);
  assert.match(image, /catch\(\(error\)[\s\S]*waitForShutdownOrTimeout\(interval, shutdown\.signal\)/);
  assert.match(cardNews, /catch\s*\(error\)[\s\S]*await wait\(pollMs\)/);
});

test("poll environment parsing cannot turn maintenance retries into a tight loop", async () => {
  for (const path of [entryPoints[1], entryPoints[2], entryPoints[3], entryPoints[4]]) {
    const source = await read(path);
    assert.match(source, /contentWorkerPollDelayMs/,
      `${path} does not guard a non-numeric poll interval`);
  }
  const proposal = await read(entryPoints[0]);
  assert.match(proposal, /boundedNumber\("CONTENT_PROPOSAL_POLL_MS",\s*5_000,\s*250,\s*60_000\)/,
    "proposal polling lost its finite lower and upper bounds");
});
