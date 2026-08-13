import { normalizeFaqUtterance } from "./faqUtterancePolicy.js";

export interface FaqMatchCandidate {
  knowledgeEntryId: string;
  question: string;
  aliases: string[];
}

export type FaqMatchResult =
  | { kind: "none" }
  | { kind: "conflict"; candidateIds: string[] }
  | {
      kind: "candidate";
      knowledgeEntryId: string;
      score: number;
      matchedExpression: string;
    };

function bigrams(value: string) {
  const chars = Array.from(value.replace(/\s+/gu, ""));
  if (chars.length < 2) return chars;
  return Array.from({ length: chars.length - 1 }, (_, index) => `${chars[index]}${chars[index + 1]}`);
}

function diceBigrams(a: string[], b: string[]) {
  if (!a.length || !b.length) return a.length === b.length ? 1 : 0;
  const counts = new Map<string, number>();
  for (const value of a) counts.set(value, (counts.get(value) ?? 0) + 1);
  let intersection = 0;
  for (const value of b) {
    const count = counts.get(value) ?? 0;
    if (!count) continue;
    intersection += 1;
    counts.set(value, count - 1);
  }
  return (2 * intersection) / (a.length + b.length);
}

function osaDistance(a: string[], b: string[]) {
  let previousPrevious = new Uint16Array(b.length + 1);
  let previous = new Uint16Array(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) previous[index] = index;
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Uint16Array(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j]!, previousPrevious[j - 2]! + 1);
      }
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[b.length]!;
}

function osaSimilarity(left: string[], right: string[]) {
  const length = Math.max(left.length, right.length);
  return length ? 1 - (osaDistance(left, right) / length) : 1;
}

interface PreparedExpression {
  display: string;
  normalized: string;
}

interface PreparedCandidate {
  candidate: FaqMatchCandidate;
  expressions: PreparedExpression[];
}

const MAX_FUZZY_QUERY_CHARS = 160;
const MAX_FUZZY_EXPRESSION_CHARS = 160;
const MAX_OSA_CANDIDATES = 12;

function prepareCandidates(candidates: FaqMatchCandidate[]) {
  return candidates.map((candidate) => ({
    candidate,
    expressions: [candidate.question, ...candidate.aliases].map((display) => {
      const normalized = normalizeFaqUtterance(display);
      return {
        display,
        normalized,
      };
    }),
  }));
}

export function rankFaqCandidates(
  query: string,
  candidates: FaqMatchCandidate[],
): FaqMatchResult {
  const normalizedQuery = normalizeFaqUtterance(query);
  if (
    Array.from(normalizedQuery).length < 2
    || /https?:\/\//iu.test(query)
    || !/[\p{L}\p{N}]/u.test(normalizedQuery)
  ) return { kind: "none" };

  const preparedCandidates = prepareCandidates(candidates);
  const exactCandidates = preparedCandidates.filter(({ expressions }) => (
    expressions.some((expression) => expression.normalized === normalizedQuery)
  ));
  if (exactCandidates.length > 1) {
    return {
      kind: "conflict",
      candidateIds: exactCandidates.map(({ candidate }) => candidate.knowledgeEntryId).sort(),
    };
  }
  if (exactCandidates.length === 1) {
    const exact = exactCandidates[0]!;
    return {
      kind: "candidate",
      knowledgeEntryId: exact.candidate.knowledgeEntryId,
      score: 1,
      matchedExpression: exact.expressions.find((expression) => (
        expression.normalized === normalizedQuery
      ))!.display,
    };
  }
  if (Array.from(normalizedQuery).length > MAX_FUZZY_QUERY_CHARS) return { kind: "none" };

  const queryBigrams = bigrams(normalizedQuery);
  const queryDecomposed = Array.from(normalizedQuery.normalize("NFKD"));

  const fuzzyCandidates = preparedCandidates.map(({ candidate, expressions }) => ({
    candidate,
    expressions: expressions.map((expression) => ({
      ...expression,
      bigrams: bigrams(expression.normalized),
      decomposed: Array.from(expression.normalized.normalize("NFKD")),
    })).filter((expression) => expression.decomposed.length <= MAX_FUZZY_EXPRESSION_CHARS),
  })).map(({ candidate, expressions }) => ({
    candidate,
    expressions,
    cheapScore: expressions.reduce((best, expression) => (
      Math.max(best, diceBigrams(queryBigrams, expression.bigrams))
    ), 0),
  })).filter(({ expressions }) => expressions.length > 0)
    .sort((left, right) => right.cheapScore - left.cheapScore
      || left.candidate.knowledgeEntryId.localeCompare(right.candidate.knowledgeEntryId))
    .slice(0, MAX_OSA_CANDIDATES);

  const ranked = fuzzyCandidates.map(({ candidate, expressions }) => {
    let best = { score: 0, expression: candidate.question };
    for (const expression of expressions) {
      if (!expression.normalized) continue;
      const score = (0.65 * diceBigrams(queryBigrams, expression.bigrams))
        + (0.35 * osaSimilarity(queryDecomposed, expression.decomposed));
      if (score > best.score) best = { score, expression: expression.display };
    }
    return { candidate, ...best };
  }).sort((left, right) => right.score - left.score
    || left.candidate.knowledgeEntryId.localeCompare(right.candidate.knowledgeEntryId));

  const top = ranked[0];
  if (!top || top.score < 0.5) return { kind: "none" };
  const second = ranked[1];
  if (second && top.score - second.score < 0.04) {
    return {
      kind: "conflict",
      candidateIds: [top.candidate.knowledgeEntryId, second.candidate.knowledgeEntryId],
    };
  }
  return {
    kind: "candidate",
    knowledgeEntryId: top.candidate.knowledgeEntryId,
    score: Number(top.score.toFixed(6)),
    matchedExpression: top.expression,
  };
}
