import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

function serviceSection(compose, service) {
  const marker = `\n  ${service}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `${service} missing`);
  const tail = compose.slice(start + marker.length);
  const next = /\n  [a-zA-Z0-9_-]+:\n/.exec(tail);
  return compose.slice(start, next ? start + marker.length + next.index : compose.length);
}

test("only the five manual-content services mount the Codex account pool", async () => {
  const compose = await read("deploy/compose.production.yml");
  const approved = [
    "content-proposal-worker-1",
    "card-news-worker-1",
    "blog-worker-1",
    "reel-worker-1",
    "image-worker-1",
  ];
  for (const service of approved) {
    const section = serviceSection(compose, service);
    assert.match(section, /CODEX_HOME:\s*\/codex-accounts\/primary/);
    assert.match(section, /CODEX_ACCOUNT_POOL_ROOT:\s*\/codex-accounts/);
    assert.match(section, /CODEX_ACCOUNT_PROFILES:\s*primary,secondary/);
    assert.match(section, /CODEX_ACCOUNT_POOL_ROOT_PATH[^\n]*codex-accounts[^\n]*:\/codex-accounts/);
  }

  for (const service of [
    "dm-worker-1",
    "dm-worker-2",
    "wiki-worker-1",
    "brand-intelligence-worker-1",
    "subject-analysis-worker-1",
  ]) {
    const section = serviceSection(compose, service);
    assert.doesNotMatch(section, /CODEX_ACCOUNT_PROFILES/);
    assert.doesNotMatch(section, /:\/codex-accounts/);
  }
});

test("production preflight validates both profiles without reading credentials", async () => {
  for (const file of ["deploy/scripts/preflight.sh", "deploy/scripts/preflight-ai-content.sh"]) {
    const source = await read(file);
    assert.match(source, /CODEX_ACCOUNT_POOL_ROOT_PATH="\$ROOT\/shared\/codex-accounts"/);
    assert.match(source, /for profile in primary secondary/);
    assert.match(source, /auth_file="\$profile_home\/auth\.json"/);
    assert.match(source, /codex login status/);
    assert.match(source, />\/dev\/null 2>&1/);
    assert.doesNotMatch(source, /(?:cat|jq|grep|sed|awk)[^\n]*auth\.json/);
    assert.doesNotMatch(source, /(?:074|075)[^\n]*(?:migrate|migration|psql)/i);
  }
});

test("affected images default legacy paths to primary and deny the whole pool", async () => {
  const workers = [
    "brand-pilot-content-proposal-worker",
    "brand-pilot-card-news-worker",
    "brand-pilot-blog-worker",
    "brand-pilot-reel-worker",
    "brand-pilot-image-worker",
  ];
  for (const worker of workers) {
    const dockerfile = await read(`workers/${worker}/Dockerfile`);
    assert.match(dockerfile, /CODEX_HOME=\/codex-accounts\/primary/);
    assert.match(dockerfile, /CODEX_ACCOUNT_POOL_ROOT=\/codex-accounts/);
    assert.match(dockerfile, /CODEX_ACCOUNT_PROFILES=primary,secondary/);
  }

  for (const file of [
    "workers/brand-pilot-content-proposal-worker/src/codexModel.ts",
    "workers/brand-pilot-card-news-worker/scripts/run-codex-card-manuscript-plan.mjs",
    "workers/brand-pilot-blog-worker/scripts/run-codex-blog-v2-plan.mjs",
    "workers/brand-pilot-blog-worker/src/research.ts",
    "workers/brand-pilot-reel-worker/scripts/run-codex-reel-plan.mjs",
    "workers/brand-pilot-image-worker/src/codexCommand.mjs",
  ]) {
    const source = await read(file);
    assert.match(source, /\/codex-accounts[^\n]*deny/);
  }
});

test("account identities stay out of source, configuration, and operations docs", async () => {
  for (const file of [
    "deploy/compose.production.yml",
    "deploy/scripts/preflight.sh",
    "deploy/scripts/preflight-ai-content.sh",
    "docs/operations/UBUNTU_DEPLOYMENT.md",
    "workers/brand-pilot-worker-runtime/src/codexAccountPool.ts",
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /[a-z0-9._%+-]+@gmail\.com/i);
  }
});

test("the production transition preserves primary and refuses to overwrite a profile", async () => {
  const runbook = await read("docs/operations/UBUNTU_DEPLOYMENT.md");
  assert.match(runbook, /test ! -e "\$account_pool"/);
  assert.match(runbook, /test ! -e "\$account_pool\/primary"/);
  assert.match(runbook, /mv -- "\$legacy_home" "\$account_pool\/primary"/);
  assert.doesNotMatch(runbook, /(?:rm -rf|cp -f)[^\n]*(?:codex-accounts|auth\.json)/);
});
