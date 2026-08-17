import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QUALITY_SOURCE_URL = "https://www.theverge.com/streaming/977474/youtube-partner-program-new-requirements";

export const QUALITY_CASES = Object.freeze([
  { id: "none", label: "선택 없음", product: false, productImage: false, style: false, avatar: false },
  { id: "product-text", label: "제품 설명만", product: true, productImage: false, style: false, avatar: false },
  { id: "product-image", label: "제품 설명과 이미지", product: true, productImage: true, style: false, avatar: false },
  { id: "style", label: "스타일만", product: false, productImage: false, style: true, avatar: false },
  { id: "style-avatar", label: "스타일과 기본 아바타", product: false, productImage: false, style: true, avatar: true },
  { id: "all", label: "제품·이미지·스타일·아바타", product: true, productImage: true, style: true, avatar: true },
]);

const CASE_IDS = new Set(QUALITY_CASES.map(({ id }) => id));

function row(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
}

function text(value, code) {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function nullableText(value, code) {
  return value === null ? null : text(value, code);
}

function strings(value, code) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(code);
  if (new Set(value).size !== value.length) throw new Error(code);
  return value.map((item) => item.trim());
}

function integer(value, code, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(code);
  return value;
}

function parseRun(value) {
  const source = row(value, "quality_case_invalid");
  if (!CASE_IDS.has(source.caseId)) throw new Error("quality_case_invalid");
  const selection = row(source.selection, "quality_selection_invalid");
  const timing = row(source.timing, "quality_timing_invalid");
  const attempts = row(source.attempts, "quality_attempts_invalid");
  const stagedIds = row(source.stagedIds, "quality_staged_ids_invalid");
  if (!Array.isArray(source.scenes)) throw new Error("quality_scenes_invalid");
  return {
    caseId: source.caseId,
    proposalId: text(source.proposalId, "quality_proposal_invalid"),
    proposalTitle: text(source.proposalTitle, "quality_proposal_invalid"),
    generationId: text(source.generationId, "quality_generation_invalid"),
    selection: {
      productServiceId: nullableText(selection.productServiceId, "quality_selection_invalid"),
      productImageAssetIds: strings(selection.productImageAssetIds, "quality_selection_invalid"),
      stylePresetId: nullableText(selection.stylePresetId, "quality_selection_invalid"),
      avatarId: nullableText(selection.avatarId, "quality_selection_invalid"),
    },
    timing: {
      proposalMs: integer(timing.proposalMs, "quality_timing_invalid"),
      planningMs: integer(timing.planningMs, "quality_timing_invalid"),
      renderMs: integer(timing.renderMs, "quality_timing_invalid"),
      totalMs: integer(timing.totalMs, "quality_timing_invalid"),
    },
    attempts: {
      proposal: integer(attempts.proposal, "quality_attempts_invalid", 1),
      planning: integer(attempts.planning, "quality_attempts_invalid", 1),
      renderByScene: Array.isArray(attempts.renderByScene)
        ? attempts.renderByScene.map((item) => integer(item, "quality_attempts_invalid", 1))
        : (() => { throw new Error("quality_attempts_invalid"); })(),
    },
    stagedIds: {
      productImageAssetIds: strings(stagedIds.productImageAssetIds, "quality_staged_ids_invalid"),
      styleReferenceItemIds: strings(stagedIds.styleReferenceItemIds, "quality_staged_ids_invalid"),
      avatarImageAssetIds: strings(stagedIds.avatarImageAssetIds, "quality_staged_ids_invalid"),
      attachmentIds: strings(stagedIds.attachmentIds, "quality_staged_ids_invalid"),
    },
    scenes: source.scenes.map((item) => {
      const scene = row(item, "quality_scene_invalid");
      if (!["queued", "processing", "completed", "failed"].includes(scene.status)) throw new Error("quality_scene_invalid");
      return {
        index: integer(scene.index, "quality_scene_invalid", 1),
        status: scene.status,
        imageUrl: nullableText(scene.imageUrl, "quality_scene_invalid"),
      };
    }),
  };
}

export function buildQualityReport(runs) {
  if (!Array.isArray(runs)) throw new Error("quality_runs_invalid");
  const parsed = runs.map(parseRun);
  if (new Set(parsed.map(({ caseId }) => caseId)).size !== parsed.length) throw new Error("quality_case_duplicate");
  return {
    contractVersion: "manual-ai-content-visual-quality-report.v1",
    sourceUrl: QUALITY_SOURCE_URL,
    cases: QUALITY_CASES,
    runs: parsed,
  };
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderQualityReportHtml(report) {
  const cards = report.cases.map((qualityCase) => {
    const run = report.runs.find(({ caseId }) => caseId === qualityCase.id);
    const scenes = run?.scenes.map((scene) => `<li><strong>${scene.index}장</strong> ${escapeHtml(scene.status)}${scene.imageUrl ? ` <a href="${escapeHtml(scene.imageUrl)}">이미지 열기</a>` : ""}</li>`).join("") ?? "";
    return `<article><h2>${escapeHtml(qualityCase.label)}</h2>${run ? `<p>생성 ID: <code>${escapeHtml(run.generationId)}</code></p><p>구성안: ${escapeHtml(run.proposalTitle)}</p><p>총 ${run.timing.totalMs}ms · 기획 ${run.timing.planningMs}ms · 렌더 ${run.timing.renderMs}ms</p><ul>${scenes}</ul><details><summary>동결 선택 및 실제 stage ID</summary><pre>${escapeHtml(JSON.stringify({ selection: run.selection, stagedIds: run.stagedIds, attempts: run.attempts }, null, 2))}</pre></details>` : "<p>아직 실행하지 않음</p>"}</article>`;
  }).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>수동 콘텐츠 비주얼 품질 비교</title><style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:auto;padding:32px;background:#f5f4ef;color:#17231e}header,article{background:#fff;border:1px solid #dbe3df;border-radius:16px;padding:20px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}code,pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#176e4d}@media(max-width:760px){main{grid-template-columns:1fr}}</style></head><body><header><h1>수동 콘텐츠 비주얼 품질 비교</h1><p><a href="${escapeHtml(report.sourceUrl)}">고정 원문</a></p><p>여섯 케이스의 결과를 사람이 직접 비교합니다.</p></header><main>${cards}</main></body></html>`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--manifest") {
    process.stdout.write(`${JSON.stringify({ sourceUrl: QUALITY_SOURCE_URL, cases: QUALITY_CASES }, null, 2)}\n`);
    return;
  }
  const inputIndex = args.indexOf("--input");
  const outputIndex = args.indexOf("--out");
  if (inputIndex < 0 || outputIndex < 0 || !args[inputIndex + 1] || !args[outputIndex + 1]) {
    throw new Error("usage: node scripts/ai-content-quality-cases.mjs --input runs.json --out report-directory");
  }
  const inputPath = path.resolve(args[inputIndex + 1]);
  const outputDirectory = path.resolve(args[outputIndex + 1]);
  const report = buildQualityReport(JSON.parse(await readFile(inputPath, "utf8")));
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDirectory, "index.html"), renderQualityReportHtml(report), "utf8");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
