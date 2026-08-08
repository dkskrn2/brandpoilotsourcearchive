import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  AUTOMATED_CARD_NEWS_DEFERRED_FILES,
  PRODUCTION_FILE_ALLOWLIST,
  inspectThreeFormatCutover,
} from "./three-format-cutover-static-check.mjs";

const baseline = Object.freeze({
  "packages/brand-pilot-content-contracts/src/catalog.ts": `
    export const CONTENT_PROMPT_DEFINITION_VERSIONS = {
      card_news: { informational: "card.info", marketing: "card.marketing" },
      blog: { informational: "blog.info", marketing: "blog.marketing" },
      reel: { informational: "reel.info", marketing: "reel.marketing" },
    };
    export const CONTENT_FORMAT_CATALOG = {
      card_news: { model: "gpt-5.6-terra" },
      blog: { model: "gpt-5.6-terra" },
      reel: { model: "gpt-5.6-terra" },
    };
  `,
  "packages/brand-pilot-content-contracts/src/binding.ts": `
    export function promptBindingFor(outputFormat, purpose, catalog) {
      return { model: catalog.formats[outputFormat].model,
        prompt: CONTENT_PROMPT_DEFINITION_VERSIONS[outputFormat][purpose] };
    }
  `,
  "apps/api/src/aiContentRepository.ts": `
    import { assembleAiContentFixedInput } from "./aiContentFixedInputAssembler.js";
    const activeManifestVersion = "ai-content.v3";
    const assembly = assembleAiContentFixedInput(lockedSources);
    await tx.query("select create_ai_content_generation_prompt_binding($1,$2)", [id, assembly.binding]);
    await tx.query(\`select generation.output_format from ai_content_generations generation where generation.id=$1\`);
    await tx.query(\`insert into ai_content_generation_jobs(generation_id,output_format,status) values($1,$2,'queued')\`);
  `,
  "apps/api/src/aiContentRenderJobs.ts": `export const versions = ["card-news-plan.v2", "blog-plan.v2", "reel-plan.v2", "ai-content.v3"];`,
  "apps/api/src/aiContentDownload.ts": `const sql = \`select generation.output_format from ai_content_generations generation\`;`,
  "apps/api/src/aiContentPublish.ts": `const sql = \`select generation.output_format from ai_content_generations generation\`;`,
  "apps/api/src/aiContentPlanContracts.ts": `export const plans = ["card-news-plan.v2", "blog-plan.v2", "reel-plan.v2"];`,
  "apps/api/src/aiContentContracts.ts": `export const activeProposalContract = "content-proposal.v2";`,
  "apps/api/src/httpServer.ts": `
    app.post("/worker/ai-content-jobs/reel/claim", claimReelJob);
    const workerId = "reel-worker";
    const proposalContract = "content-orchestration.v2";
    const startContract = "content-generation-start.v2";
  `,
  "workers/brand-pilot-card-news-worker/src/promptBuilder.ts": `const branch = purpose === "informational" ? informationalPrompt : purpose === "marketing" ? marketingPrompt : fail();`,
  "workers/brand-pilot-card-news-worker/src/contracts.ts": `import { parseContentGenerationInputV3 } from "@brand-pilot/content-contracts"; export const jobType = "generate"; export const outputFormat = "card_news";`,
  "workers/brand-pilot-card-news-worker/src/client.ts": `request("/worker/ai-content-jobs/card_news/claim");`,
  "workers/brand-pilot-card-news-worker/src/worker.ts": `export const run = "v3-generate-only";`,
  "workers/brand-pilot-blog-worker/src/promptBuilder.ts": `const branch = purpose === "informational" ? informationalPrompt : purpose === "marketing" ? marketingPrompt : fail();`,
  "workers/brand-pilot-blog-worker/src/contracts.ts": `import { parseContentGenerationInputV3 } from "@brand-pilot/content-contracts"; export const jobType = "generate"; export const outputFormat = "blog";`,
  "workers/brand-pilot-blog-worker/src/client.ts": `request("/worker/ai-content-jobs/blog/claim");`,
  "workers/brand-pilot-blog-worker/src/worker.ts": `export const run = "v3-generate-only";`,
  "workers/brand-pilot-reel-worker/src/promptBuilder.ts": `const branch = purpose === "informational" ? informationalPrompt : purpose === "marketing" ? marketingPrompt : fail();`,
  "workers/brand-pilot-reel-worker/src/contracts.ts": `import { parseContentGenerationInputV3 } from "@brand-pilot/content-contracts"; export const plan = "reel-plan.v2"; export const outputFormat = "reel";`,
  "workers/brand-pilot-reel-worker/src/client.ts": `request("/worker/ai-content-jobs/reel/claim", { workerId });`,
  "workers/brand-pilot-reel-worker/src/index.ts": `const workerId = process.env.REEL_WORKER_ID ?? "reel-worker";`,
  "workers/brand-pilot-reel-worker/src/worker.ts": `export const workerFailure = "reel_worker_failed";`,
  "workers/brand-pilot-image-worker/src/aiContentFinalizer.ts": `const plans = ["card-news-plan.v2", "blog-plan.v2", "reel-plan.v2"]; const manifest = "ai-content.v3";`,
  "workers/brand-pilot-image-worker/src/aiContentRenderClient.ts": `import { parseImageGenerationPackageV1 } from "@brand-pilot/content-contracts";`,
  "apps/api/src/automatedCardNews.ts": `const intentionallyDeferred = "marketing-plan.v2 ai-content.v2 marketing-worker content_type";`,
  "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts": `
    import { parseAiContentManifestV3, parseContentStudioOutputFormat, parseContentPurpose } from "@brand-pilot/content-contracts";
    const activeManifestVersion = "ai-content.v3";
    const outputFormats = ["card_news", "blog", "reel"];
  `,
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "three-format-cutover-"));
  for (const [relativePath, content] of Object.entries(baseline)) {
    const absolutePath = join(root, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

async function overwrite(root, relativePath, content) {
  const absolutePath = join(root, ...relativePath.split("/"));
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

test("fixture baseline passes closed production allowlists and reports automated card news as deferred", async () => {
  const root = await createFixture();
  try {
    const report = await inspectThreeFormatCutover(root);
    assert.deepEqual(report.violations, []);
    assert.deepEqual(report.deferred, [{
      id: "automated_card_news",
      status: "deferred",
      files: [...AUTOMATED_CARD_NEWS_DEFERRED_FILES],
    }]);
    assert.equal(new Set(PRODUCTION_FILE_ALLOWLIST).size, PRODUCTION_FILE_ALLOWLIST.length);
    assert.ok(!PRODUCTION_FILE_ALLOWLIST.includes("apps/api/src/automatedCardNews.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const violationFixtures = [
  ["legacy_generation_sql_column", "apps/api/src/aiContentRepository.ts", "const sql = `select generation.type from ai_content_generations generation`;"],
  ["legacy_generation_sql_column", "apps/api/src/aiContentPublish.ts", "const sql = `select generation.type\nfrom ai_content_generations generation\nwhere generation.id=$1`;"],
  ["legacy_generation_sql_column", "apps/api/src/aiContentRepository.ts", "const sql = `select generation.content_family from ai_content_generations generation`;"],
  ["legacy_generation_job_content_type_sql", "apps/api/src/aiContentRepository.ts", "const sql = `insert into ai_content_generation_jobs(generation_id,content_type) values($1,$2)`;"],
  ["legacy_marketing_claim_or_worker", "workers/brand-pilot-reel-worker/src/client.ts", "request('/worker/ai-content-jobs/marketing/claim')"],
  ["legacy_marketing_claim_or_worker", "workers/brand-pilot-reel-worker/src/index.ts", "const workerId = 'marketing-worker'"],
  ["legacy_marketing_claim_or_worker", "apps/api/src/httpServer.ts", "const contentTypeByWorkerSlug = { marketing: 'marketing' };"],
  ["legacy_pipeline_contract", "apps/api/src/aiContentPlanContracts.ts", "const version = 'marketing-plan.v2'"],
  ["legacy_pipeline_contract", "workers/brand-pilot-image-worker/src/aiContentFinalizer.ts", "const version = 'ai-content.v2'"],
  ["legacy_pipeline_contract", "workers/brand-pilot-blog-worker/src/worker.ts", "const version = 'content-generation-input.v2'"],
  ["legacy_planner_worker_execution", "workers/brand-pilot-card-news-worker/src/contracts.ts", "type Job = { contentType: string };"],
  ["legacy_planner_worker_execution", "workers/brand-pilot-blog-worker/src/worker.ts", "if (job.jobType === 'analyze') run();"],
  ["missing_canonical_worker_contract", "workers/brand-pilot-reel-worker/src/contracts.ts", "export const outputFormat = 'reel';"],
  ["legacy_customer_content_writer", "apps/api/src/httpServer.ts", `${baseline["apps/api/src/httpServer.ts"]}\nrepository.startAiContentGeneration(input);`],
  ["legacy_v1_customer_contract", "apps/api/src/httpServer.ts", `${baseline["apps/api/src/httpServer.ts"]}\nfunction parseContentProposalRequest(): ContentProposalRequestV1 { return { contractVersion: "content-proposal-request.v1" }; }`],
  ["legacy_v1_customer_contract", "apps/api/src/aiContentContracts.ts", `export interface ContentProposalV1 { contractVersion: "content-proposal.v1" }`],
  ["legacy_proposal_repository_writer", "apps/api/src/aiContentRepository.ts", `${baseline["apps/api/src/aiContentRepository.ts"]}\nasync function createAiContentProposalBatchV2(input) { return input; }`],
  ["missing_v2_customer_content_writer", "apps/api/src/httpServer.ts", "app.post('/worker/ai-content-jobs/reel/claim', claimReelJob);"],
  ["missing_terra_format_model:blog", "packages/brand-pilot-content-contracts/src/catalog.ts", baseline["packages/brand-pilot-content-contracts/src/catalog.ts"].replace('blog: { model: "gpt-5.6-terra" }', 'blog: { model: "gpt-5.6-sol" }')],
  ["missing_prompt_binding_catalog_lookup", "packages/brand-pilot-content-contracts/src/binding.ts", "export function promptBindingFor() { return {}; }"],
  ["missing_purpose_prompt_branch:reel", "workers/brand-pilot-reel-worker/src/promptBuilder.ts", "const prompt = informationalPrompt;"],
  ["missing_fixed_assembler_import", "apps/api/src/aiContentRepository.ts", baseline["apps/api/src/aiContentRepository.ts"].replace('import { assembleAiContentFixedInput } from "./aiContentFixedInputAssembler.js";', "")],
  ["missing_fixed_assembler_call", "apps/api/src/aiContentRepository.ts", baseline["apps/api/src/aiContentRepository.ts"].replace("const assembly = assembleAiContentFixedInput(lockedSources);", "const assembly = lockedSources;")],
  ["missing_prompt_binding_sql_call", "apps/api/src/aiContentRepository.ts", baseline["apps/api/src/aiContentRepository.ts"].replace("create_ai_content_generation_prompt_binding", "insert_prompt_binding_directly")],
  ["missing_active_v3_repository_reader", "apps/api/src/aiContentRepository.ts", baseline["apps/api/src/aiContentRepository.ts"].replace("ai-content.v3", "unknown-manifest")],
  ["missing_active_v3_ui_reader", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", "const outputFormats = ['card_news', 'blog', 'reel'];"],
  ["legacy_marketing_content_ui_path", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", "const activeManifestVersion = 'ai-content.v3'; const oldFormat = 'marketing_content';"],
  ["legacy_generation_dto_fallback", "apps/api/src/aiContentRepository.ts", `${baseline["apps/api/src/aiContentRepository.ts"]}\nconst outputFormat = row.output_format ?? row.type;`],
  ["missing_canonical_v3_ui_parsers", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", "const activeManifestVersion = 'ai-content.v3';"],
  ["legacy_generation_type_ui_fallback", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", `${baseline["apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts"]}\nconst kind = value.type;`],
  ["legacy_generation_type_ui_fallback", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", `${baseline["apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts"]}\nconst kind = source.type;`],
  ["unscoped_automated_card_news_ui_fallback", "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts", `${baseline["apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts"]}\nif (request.contractVersion !== "content-proposal-request.v2") return value as ContentProposalBatch;`],
];

for (const [expectedId, relativePath, content] of violationFixtures) {
  test(`rejects ${expectedId} in its production allowlist`, async () => {
    const root = await createFixture();
    try {
      await overwrite(root, relativePath, content);
      const report = await inspectThreeFormatCutover(root);
      assert.ok(report.violations.some(({ id }) => id === expectedId), JSON.stringify(report, null, 2));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("does not scan forbidden words outside the production allowlist or inside deferred automated card news", async () => {
  const root = await createFixture();
  try {
    await overwrite(root, "notes/legacy-example.ts", "marketing-plan.v2 marketing_content ai-content.v2 content_type");
    await overwrite(root, "apps/api/src/automatedCardNews.ts", "generation.type marketing-worker ai-content.v2");
    const report = await inspectThreeFormatCutover(root);
    assert.deepEqual(report.violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plain diagnostic strings are not treated as SQL column references", async () => {
  const root = await createFixture();
  try {
    await overwrite(root, "apps/api/src/aiContentRepository.ts", `${baseline["apps/api/src/aiContentRepository.ts"]}\nconst diagnostic = "ai_content_generation_jobs.content_type generation.type";`);
    const report = await inspectThreeFormatCutover(root);
    assert.deepEqual(report.violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a different joined table type column is not attributed to ai_content_generations", async () => {
  const root = await createFixture();
  try {
    await overwrite(root, "apps/api/src/aiContentPublish.ts", "const sql = `select job.type from ai_content_generations generation join jobs job on job.id=generation.id`;");
    const report = await inspectThreeFormatCutover(root);
    assert.deepEqual(report.violations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
