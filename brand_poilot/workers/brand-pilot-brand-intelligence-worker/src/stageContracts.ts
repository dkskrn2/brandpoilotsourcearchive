export interface OwnedFact {
  id: string;
  claim: string;
  sourceId: string;
  segmentId: string;
  sourceUrl: string | null;
  quotes: string[];
  category: string;
  support: "supported" | "conflicting" | "missing";
}

export interface ExternalCandidate {
  url: string;
  reason: string;
}

export interface StageEnvelope<T> {
  stageVersion: string;
  output: T;
}

export interface RegisteredSegment {
  sourceId: string;
  sourceUrl: string | null;
  normalizedText: string;
}

function fail(code: string): never {
  throw new Error(code);
}

function strictObject(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, maximum = 4_000): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    fail(code);
  }
  return normalized;
}

function normalizedForQuote(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function httpsUrl(value: unknown, code: string): string {
  const raw = text(value, code, 2_048);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fail(code);
  }
}

export function parseOwnedFactEnvelope(
  value: unknown,
  segments: ReadonlyMap<string, RegisteredSegment>,
): StageEnvelope<OwnedFact[]> {
  const envelope = strictObject(value, ["stageVersion", "output"], "owned_fact_envelope_invalid");
  if (envelope.stageVersion !== "owned-facts.v1" || !Array.isArray(envelope.output)
    || envelope.output.length > 500) {
    fail("owned_fact_envelope_invalid");
  }
  const ids = new Set<string>();
  const output = envelope.output.map((item): OwnedFact => {
    const source = strictObject(item, [
      "id", "claim", "sourceId", "segmentId", "sourceUrl", "quotes", "category", "support",
    ], "owned_fact_invalid");
    const id = text(source.id, "owned_fact_invalid", 200);
    if (ids.has(id)) fail("owned_fact_id_duplicate");
    ids.add(id);
    const segmentId = text(source.segmentId, "owned_fact_invalid", 200);
    const segment = segments.get(segmentId);
    const sourceId = text(source.sourceId, "owned_fact_invalid", 200);
    if (!segment || segment.sourceId !== sourceId) {
      fail("owned_fact_source_registry_mismatch");
    }
    if (source.support !== "supported" && source.support !== "conflicting"
      && source.support !== "missing") {
      fail("owned_fact_invalid");
    }
    if (!Array.isArray(source.quotes) || source.quotes.length > 10) {
      fail("owned_fact_invalid");
    }
    const normalizedSegment = normalizedForQuote(segment.normalizedText);
    const quotes = source.quotes.map((quote) => {
      const normalizedQuote = normalizedForQuote(text(quote, "owned_fact_invalid", 2_000));
      if (!normalizedSegment.includes(normalizedQuote)) fail("owned_fact_quote_mismatch");
      return normalizedQuote;
    });
    if (source.support !== "missing" && quotes.length === 0) fail("owned_fact_quote_mismatch");
    const sourceUrl = source.sourceUrl === null
      ? null
      : httpsUrl(source.sourceUrl, "owned_fact_invalid");
    if (sourceUrl !== segment.sourceUrl) {
      fail("owned_fact_source_registry_mismatch");
    }
    return {
      id,
      claim: text(source.claim, "owned_fact_invalid"),
      sourceId,
      segmentId,
      sourceUrl,
      quotes,
      category: text(source.category, "owned_fact_invalid", 200),
      support: source.support,
    };
  });
  return { stageVersion: "owned-facts.v1", output };
}

export function parseExternalCandidateEnvelope(
  value: unknown,
): StageEnvelope<ExternalCandidate[]> {
  const envelope = strictObject(
    value,
    ["stageVersion", "output"],
    "external_candidate_envelope_invalid",
  );
  if (envelope.stageVersion !== "external-candidates.v1"
    || !Array.isArray(envelope.output) || envelope.output.length > 50) {
    fail("external_candidate_envelope_invalid");
  }
  const seen = new Set<string>();
  const output: ExternalCandidate[] = [];
  for (const item of envelope.output) {
    const source = strictObject(item, ["url", "reason"], "external_candidate_invalid");
    const candidateUrl = httpsUrl(source.url, "external_candidate_invalid");
    if (seen.has(candidateUrl)) continue;
    seen.add(candidateUrl);
    output.push({
      url: candidateUrl,
      reason: text(source.reason, "external_candidate_invalid", 1_000),
    });
  }
  return { stageVersion: "external-candidates.v1", output };
}
