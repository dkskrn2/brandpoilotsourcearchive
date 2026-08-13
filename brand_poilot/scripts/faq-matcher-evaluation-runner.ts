import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { rankFaqCandidates, type FaqMatchCandidate } from "../apps/api/src/faqMatcher.js";
import { normalizeFaqUtterance } from "../apps/api/src/faqUtterancePolicy.js";

interface EvaluationCase {
  query: string;
  expectedKind: "expanded_exact" | "clarification" | "conflict" | "none";
  expectedFaqId?: string;
}

interface EvaluationFixture {
  clarifyThreshold: number;
  candidates: FaqMatchCandidate[];
  cases: EvaluationCase[];
}

async function main() {
const fixture = JSON.parse(await readFile(
  resolve(process.cwd(), "scripts/fixtures/faq-matcher-evaluation.json"),
  "utf8",
)) as EvaluationFixture;

function classify(row: EvaluationCase) {
  const normalized = normalizeFaqUtterance(row.query);
  const exact = fixture.candidates.filter((candidate) => [candidate.question, ...candidate.aliases]
    .some((expression) => normalizeFaqUtterance(expression) === normalized));
  if (exact.length === 1) return { kind: "expanded_exact" as const, faqId: exact[0]!.knowledgeEntryId };
  if (exact.length > 1) return { kind: "conflict" as const, faqId: null };
  const ranked = rankFaqCandidates(row.query, fixture.candidates);
  if (ranked.kind === "conflict") return { kind: "conflict" as const, faqId: null };
  if (ranked.kind === "candidate" && ranked.score >= fixture.clarifyThreshold) {
    return { kind: "clarification" as const, faqId: ranked.knowledgeEntryId };
  }
  return { kind: "none" as const, faqId: null };
}

const classified = fixture.cases.map((row) => ({ row, actual: classify(row) }));
const predictedExpanded = classified.filter(({ actual }) => actual.kind === "expanded_exact");
const correctExpanded = predictedExpanded.filter(({ row, actual }) => (
  row.expectedKind === "expanded_exact" && row.expectedFaqId === actual.faqId
));
const predictedClarification = classified.filter(({ actual }) => actual.kind === "clarification");
const correctClarification = predictedClarification.filter(({ row, actual }) => (
  row.expectedKind === "clarification" && row.expectedFaqId === actual.faqId
));

const benchmarkCandidates = Array.from({ length: 200 }, (_, index) => ({
  knowledgeEntryId: `benchmark-${index}`,
  question: `상품 ${index} 배송 일정 문의`,
  aliases: [`상품 ${index} 언제 와요`, `상품 ${index} 발송일`],
}));
const latencies = Array.from({ length: 100 }, (_, index) => {
  const requestCandidates = benchmarkCandidates.map((candidate) => ({
    ...candidate,
    aliases: [...candidate.aliases],
  }));
  const started = performance.now();
  rankFaqCandidates(`상품 ${index} 언제 와요`, requestCandidates);
  return performance.now() - started;
}).sort((left, right) => left - right);
const percentile = (value: number) => latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)]!;

const metrics = {
  cases: fixture.cases.length,
  expandedExactPrecision: predictedExpanded.length ? correctExpanded.length / predictedExpanded.length : 1,
  clarificationPrecision: predictedClarification.length ? correctClarification.length / predictedClarification.length : 1,
  falseExpandedExactCount: predictedExpanded.length - correctExpanded.length,
  conflictCount: classified.filter(({ actual }) => actual.kind === "conflict").length,
  noneCount: classified.filter(({ actual }) => actual.kind === "none").length,
  mismatchCount: classified.filter(({ row, actual }) => (
    row.expectedKind !== actual.kind || (row.expectedFaqId && row.expectedFaqId !== actual.faqId)
  )).length,
  p50MatcherLatencyMs: Number(percentile(0.5).toFixed(3)),
  p95MatcherLatencyMs: Number(percentile(0.95).toFixed(3)),
};

console.log(JSON.stringify(metrics));
if (metrics.mismatchCount) {
  console.error(JSON.stringify(classified.filter(({ row, actual }) => (
    row.expectedKind !== actual.kind || (row.expectedFaqId && row.expectedFaqId !== actual.faqId)
  ))));
}
if (
  metrics.cases < 60
  || metrics.expandedExactPrecision !== 1
  || metrics.falseExpandedExactCount !== 0
  || metrics.clarificationPrecision < 0.9
  || metrics.p95MatcherLatencyMs > 25
  || metrics.mismatchCount !== 0
) process.exitCode = 1;
}

void main();
