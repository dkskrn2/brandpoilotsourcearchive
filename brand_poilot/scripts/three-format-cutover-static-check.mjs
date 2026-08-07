import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CATALOG_FILE = "packages/brand-pilot-content-contracts/src/catalog.ts";
const BINDING_FILE = "packages/brand-pilot-content-contracts/src/binding.ts";
const REPOSITORY_FILE = "apps/api/src/aiContentRepository.ts";
const API_CONTRACTS_FILE = "apps/api/src/aiContentContracts.ts";
const CUSTOMER_UI_GATEWAY_FILE = "apps/customer-ui/src/features/ai-content/aiContentApiGateway.ts";
const HTTP_SERVER_FILE = "apps/api/src/httpServer.ts";

const SQL_FILES = Object.freeze([
  REPOSITORY_FILE,
  "apps/api/src/aiContentRenderJobs.ts",
  "apps/api/src/aiContentDownload.ts",
  "apps/api/src/aiContentPublish.ts",
]);

const CLAIM_WORKER_FILES = Object.freeze([
  REPOSITORY_FILE,
  HTTP_SERVER_FILE,
  "workers/brand-pilot-reel-worker/src/contracts.ts",
  "workers/brand-pilot-reel-worker/src/client.ts",
  "workers/brand-pilot-reel-worker/src/index.ts",
  "workers/brand-pilot-reel-worker/src/worker.ts",
]);

const NEW_PIPELINE_FILES = Object.freeze([
  "apps/api/src/aiContentPlanContracts.ts",
  "apps/api/src/aiContentRenderJobs.ts",
  "workers/brand-pilot-card-news-worker/src/promptBuilder.ts",
  "workers/brand-pilot-card-news-worker/src/contracts.ts",
  "workers/brand-pilot-card-news-worker/src/client.ts",
  "workers/brand-pilot-card-news-worker/src/worker.ts",
  "workers/brand-pilot-blog-worker/src/promptBuilder.ts",
  "workers/brand-pilot-blog-worker/src/contracts.ts",
  "workers/brand-pilot-blog-worker/src/client.ts",
  "workers/brand-pilot-blog-worker/src/worker.ts",
  "workers/brand-pilot-reel-worker/src/promptBuilder.ts",
  "workers/brand-pilot-reel-worker/src/contracts.ts",
  "workers/brand-pilot-image-worker/src/aiContentFinalizer.ts",
]);

const PROMPT_BRANCH_FILES = Object.freeze({
  card_news: "workers/brand-pilot-card-news-worker/src/promptBuilder.ts",
  blog: "workers/brand-pilot-blog-worker/src/promptBuilder.ts",
  reel: "workers/brand-pilot-reel-worker/src/promptBuilder.ts",
});

const CANONICAL_CONSUMER_FILES = Object.freeze([
  "workers/brand-pilot-card-news-worker/src/contracts.ts",
  "workers/brand-pilot-blog-worker/src/contracts.ts",
  "workers/brand-pilot-reel-worker/src/contracts.ts",
  "workers/brand-pilot-image-worker/src/aiContentRenderClient.ts",
]);

export const AUTOMATED_CARD_NEWS_DEFERRED_FILES = Object.freeze([
  "apps/api/src/automatedCardNews.ts",
]);

export const PRODUCTION_FILE_ALLOWLIST = Object.freeze([
  ...new Set([
    CATALOG_FILE,
    BINDING_FILE,
    API_CONTRACTS_FILE,
    ...SQL_FILES,
    ...CLAIM_WORKER_FILES,
    ...NEW_PIPELINE_FILES,
    ...Object.values(PROMPT_BRANCH_FILES),
    CUSTOMER_UI_GATEWAY_FILE,
    ...CANONICAL_CONSUMER_FILES,
  ]),
].sort());

function violation(id, file, detail) {
  return { id, file, detail };
}

function safeAbsolute(root, relativePath) {
  if (isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").includes("..")) {
    throw new Error(`cutover_allowlist_path_invalid:${relativePath}`);
  }
  const absolute = resolve(root, ...relativePath.split("/"));
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`cutover_allowlist_path_invalid:${relativePath}`);
  return absolute;
}

async function readProductionFiles(root) {
  const files = new Map();
  const violations = [];
  for (const file of PRODUCTION_FILE_ALLOWLIST) {
    try {
      files.set(file, await readFile(safeAbsolute(root, file), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      violations.push(violation("required_production_file_missing", file, "allowlisted production file is missing"));
      files.set(file, "");
    }
  }
  return { files, violations };
}

function sqlTemplateLiterals(source) {
  return [...source.matchAll(/`(?:\\[\s\S]|[^`])*`/g)]
    .map(([value]) => value.slice(1, -1))
    .filter((value) => /\b(?:select|insert|update|delete|from|join)\b/i.test(value));
}

function referencesLegacyGenerationColumn(sql) {
  if (!/\bai_content_generations\b/i.test(sql)) return false;
  if (/\bai_content_generations\s*\.\s*(?:type|content_family)\b/i.test(sql)) return true;
  if (/\binsert\s+into\s+ai_content_generations\s*\([^)]*\b(?:type|content_family)\b/i.test(sql)) return true;
  if (/\bupdate\s+ai_content_generations\b[\s\S]*?\bset\b[\s\S]*?\b(?:type|content_family)\s*=/i.test(sql)) return true;

  const aliases = [...sql.matchAll(/\b(?:from|join|update)\s+ai_content_generations(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)]
    .map((match) => match[1])
    .filter((alias) => alias && !/^(?:where|join|on|set|returning|order|group|limit|offset)$/i.test(alias));
  return aliases.some((alias) => new RegExp(`\\b${alias}\\s*\\.\\s*(?:type|content_family)\\b`, "i").test(sql));
}

function checkLegacySql(files, violations) {
  for (const file of SQL_FILES) {
    for (const sql of sqlTemplateLiterals(files.get(file) ?? "")) {
      if (referencesLegacyGenerationColumn(sql)) {
        violations.push(violation("legacy_generation_sql_column", file, "generation type/content_family SQL reference"));
      }
      if (/\bai_content_generation_jobs\b/i.test(sql) && /\bcontent_type\b/i.test(sql)) {
        violations.push(violation("legacy_generation_job_content_type_sql", file, "generation job content_type SQL reference"));
      }
    }
  }
}

function checkLegacyClaims(files, violations) {
  const forbidden = /(?:marketing-worker|marketing_worker|brand-pilot-marketing-worker|\/marketing\/claim|MARKETING_(?:WORKER|CODEX)|contentType\s*[:=]\s*["']marketing["']|content_type\s*={1,3}\s*["']marketing["']|\bmarketing\s*:\s*["']marketing["'])/g;
  for (const file of CLAIM_WORKER_FILES) {
    if (forbidden.test(files.get(file) ?? "")) {
      violations.push(violation("legacy_marketing_claim_or_worker", file, "legacy marketing claim or worker identity"));
    }
    forbidden.lastIndex = 0;
  }
}

function checkLegacyPipelineContracts(files, violations) {
  const forbidden = /marketing-plan\.v2|\bmarketing_content\b|ai-content\.v2|content-generation-input\.v2/g;
  for (const file of NEW_PIPELINE_FILES) {
    if (forbidden.test(files.get(file) ?? "")) {
      violations.push(violation("legacy_pipeline_contract", file, "legacy writer/plan/finalizer contract"));
    }
    forbidden.lastIndex = 0;
  }
}

function checkGenerateOnlyPlannerWorkers(files, violations) {
  for (const file of [
    "workers/brand-pilot-card-news-worker/src/contracts.ts",
    "workers/brand-pilot-card-news-worker/src/client.ts",
    "workers/brand-pilot-card-news-worker/src/worker.ts",
    "workers/brand-pilot-blog-worker/src/contracts.ts",
    "workers/brand-pilot-blog-worker/src/client.ts",
    "workers/brand-pilot-blog-worker/src/worker.ts",
    "workers/brand-pilot-reel-worker/src/contracts.ts",
    "workers/brand-pilot-reel-worker/src/client.ts",
    "workers/brand-pilot-reel-worker/src/worker.ts",
  ]) {
    const source = files.get(file) ?? "";
    if (/\bcontentType\b|jobType\s*===?\s*["']analyze["']/.test(source)) {
      violations.push(violation("legacy_planner_worker_execution", file, "content planners must be V3 generate-only workers"));
    }
  }
}

function checkCanonicalWorkerConsumers(files, violations) {
  for (const file of CANONICAL_CONSUMER_FILES) {
    if (!/from\s*["']@brand-pilot\/content-contracts["']/.test(files.get(file) ?? "")) {
      violations.push(violation("missing_canonical_worker_contract", file, "active V3 workers must import canonical content contracts directly"));
    }
  }
}

function checkCatalogAndPromptBranches(files, violations) {
  const catalog = files.get(CATALOG_FILE) ?? "";
  for (const format of ["card_news", "blog", "reel"]) {
    const entries = [...catalog.matchAll(new RegExp(`\\b${format}\\s*:\\s*\\{([^{}]*)\\}`, "g"))]
      .map((match) => match[1] ?? "");
    if (!entries.some((entry) => /\bmodel\s*:\s*["']gpt-5\.6-terra["']/.test(entry))) {
      violations.push(violation(`missing_terra_format_model:${format}`, CATALOG_FILE, `${format} must bind Terra`));
    }
    const promptFile = PROMPT_BRANCH_FILES[format];
    const prompt = files.get(promptFile) ?? "";
    if (!/purpose\s*===\s*["']informational["']/.test(prompt)
      || !/purpose\s*===\s*["']marketing["']/.test(prompt)) {
      violations.push(violation(`missing_purpose_prompt_branch:${format}`, promptFile, "informational and marketing prompt branches are required"));
    }
  }
  const binding = files.get(BINDING_FILE) ?? "";
  if (!/\bpromptBindingFor\b/.test(binding)
    || !/CONTENT_PROMPT_DEFINITION_VERSIONS\s*\[\s*outputFormat\s*\]\s*\[\s*purpose\s*\]/.test(binding)) {
    violations.push(violation("missing_prompt_binding_catalog_lookup", BINDING_FILE, "binding must select format/purpose from the verified catalog"));
  }
}

function checkAssemblerIntegration(files, violations) {
  const repository = files.get(REPOSITORY_FILE) ?? "";
  if (!/import\s*\{[^}]*\bassembleAiContentFixedInput\b[^}]*\}\s*from\s*["'][^"']*aiContentFixedInputAssembler\.js["']/.test(repository)) {
    violations.push(violation("missing_fixed_assembler_import", REPOSITORY_FILE, "production repository import is required"));
  }
  if (!/\bassembleAiContentFixedInput\s*\(/.test(repository)) {
    violations.push(violation("missing_fixed_assembler_call", REPOSITORY_FILE, "production start path must call the fixed assembler"));
  }
  if (!/\bquery\s*\([\s\S]{0,200}?create_ai_content_generation_prompt_binding\s*\(/.test(repository)) {
    violations.push(violation("missing_prompt_binding_sql_call", REPOSITORY_FILE, "start transaction must call the prompt-binding SQL function"));
  }
}

function checkV2OnlyCustomerWriters(files, violations) {
  const server = files.get(HTTP_SERVER_FILE) ?? "";
  const repository = files.get(REPOSITORY_FILE) ?? "";
  const forbidden = [
    /repository\.createAiContentAnalysis\s*\(/,
    /repository\.updateAiContentDraft\s*\(/,
    /repository\.startAiContentGeneration\s*\(/,
    /requireContentProposalCustomerRepository\(repository\)\.createAiContentProposalBatch\s*\(/,
  ];
  if (forbidden.some((pattern) => pattern.test(server))) {
    violations.push(violation("legacy_customer_content_writer", HTTP_SERVER_FILE, "customer writes must use Proposal V2 selection and Generation V3 start only"));
  }
  if ([
    /\bcreateAiContentProposalBatch\s*\(/,
    /\bcreateAiContentProposalBatchV2\s*\(/,
    /\bgetAiContentProposalBatchV2Replay\s*\(/,
  ].some((pattern) => pattern.test(repository))) {
    violations.push(violation(
      "legacy_proposal_repository_writer",
      REPOSITORY_FILE,
      "general proposal creation must use AiContentProposalV2Service and its dedicated V2 repository",
    ));
  }
  if (!/content-orchestration\.v2/.test(server) || !/content-generation-start\.v2/.test(server)) {
    violations.push(violation("missing_v2_customer_content_writer", HTTP_SERVER_FILE, "exact Proposal V2 and Generation V3-start contracts are required"));
  }
}

function checkRetiredV1CustomerContracts(files, violations) {
  const server = files.get(HTTP_SERVER_FILE) ?? "";
  const contracts = files.get(API_CONTRACTS_FILE) ?? "";
  const retired = /\b(?:ContentProposalV1|ContentProposalRequestV1|parseContentProposalRequest)\b|content-proposal(?:-request)?\.v1/;
  for (const [file, source] of [[HTTP_SERVER_FILE, server], [API_CONTRACTS_FILE, contracts]]) {
    if (retired.test(source)) {
      violations.push(violation(
        "legacy_v1_customer_contract",
        file,
        "general customer proposal paths must not retain the retired Proposal V1 parser or types",
      ));
    }
  }
}

function checkActiveV3Readers(files, violations) {
  const repository = files.get(REPOSITORY_FILE) ?? "";
  if (!/ai-content\.v3/.test(repository)) {
    violations.push(violation("missing_active_v3_repository_reader", REPOSITORY_FILE, "generation DTOs must recognize active V3 manifests"));
  }
  if (/row\.output_format\s*\?\?\s*row\.type|row\.purpose\s*\?\?\s*row\.content_family/.test(repository)) {
    violations.push(violation("legacy_generation_dto_fallback", REPOSITORY_FILE, "generation DTOs must use outputFormat and purpose without legacy aliases"));
  }

  const gateway = files.get(CUSTOMER_UI_GATEWAY_FILE) ?? "";
  if (!/(?:ai-content\.v3|parseAiContentManifestV3)/.test(gateway)) {
    violations.push(violation("missing_active_v3_ui_reader", CUSTOMER_UI_GATEWAY_FILE, "customer UI must recognize active V3 manifests"));
  }
  if (/\bmarketing_content\b/.test(gateway)) {
    violations.push(violation("legacy_marketing_content_ui_path", CUSTOMER_UI_GATEWAY_FILE, "customer UI must not route new output through marketing_content"));
  }
  if (!/parseAiContentManifestV3/.test(gateway)
    || !/parseContentStudioOutputFormat/.test(gateway)
    || !/parseContentPurpose/.test(gateway)
    || !/from\s*["']@brand-pilot\/content-contracts["']/.test(gateway)) {
    violations.push(violation("missing_canonical_v3_ui_parsers", CUSTOMER_UI_GATEWAY_FILE, "customer UI must import canonical V3 manifest, format, and purpose parsers"));
  }
  if (/legacyTypeForOrchestration|(?:generation|value|source)\.type/.test(gateway)) {
    violations.push(violation("legacy_generation_type_ui_fallback", CUSTOMER_UI_GATEWAY_FILE, "customer UI must not use generation type aliases"));
  }
  const broadProposalFallback = /request\.contractVersion\s*!==\s*["']content-proposal-request\.v2["'](?:(?!scheduled_crawl)[\s\S]){0,240}return\s+value\s+as\s+ContentProposalBatch/;
  if (broadProposalFallback.test(gateway)
    || (/content-proposal-request\.v1/.test(gateway)
      && !/source\.origin\s*===\s*["']scheduled_crawl["'][\s\S]{0,200}content-proposal-request\.v1/.test(gateway))) {
    violations.push(violation(
      "unscoped_automated_card_news_ui_fallback",
      CUSTOMER_UI_GATEWAY_FILE,
      "retired proposal reads are allowed only for the explicitly deferred scheduled-card path",
    ));
  }
}

export async function inspectThreeFormatCutover(rootDirectory) {
  const root = resolve(rootDirectory);
  const { files, violations } = await readProductionFiles(root);
  checkLegacySql(files, violations);
  checkLegacyClaims(files, violations);
  checkLegacyPipelineContracts(files, violations);
  checkGenerateOnlyPlannerWorkers(files, violations);
  checkCanonicalWorkerConsumers(files, violations);
  checkCatalogAndPromptBranches(files, violations);
  checkAssemblerIntegration(files, violations);
  checkV2OnlyCustomerWriters(files, violations);
  checkRetiredV1CustomerContracts(files, violations);
  checkActiveV3Readers(files, violations);
  const uniqueViolations = [...new Map(
    violations.map((item) => [`${item.id}:${item.file}:${item.detail}`, item]),
  ).values()];
  uniqueViolations.sort((left, right) => `${left.id}:${left.file}`.localeCompare(`${right.id}:${right.file}`));
  return {
    ok: uniqueViolations.length === 0,
    inspectedFiles: [...PRODUCTION_FILE_ALLOWLIST],
    violations: uniqueViolations,
    deferred: [{
      id: "automated_card_news",
      status: "deferred",
      files: [...AUTOMATED_CARD_NEWS_DEFERRED_FILES],
    }],
  };
}

function cliRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length === 2 && argv[0] === "--root" && argv[1]) return resolve(argv[1]);
  throw new Error("usage: node scripts/three-format-cutover-static-check.mjs [--root <repository-root>]");
}

async function main() {
  const report = await inspectThreeFormatCutover(cliRoot(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
}
