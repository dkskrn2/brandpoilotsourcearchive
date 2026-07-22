export interface ContentQualityEvidence {
  claim: string;
  support: string;
  sourceUrl?: string | null;
}

export interface ContentQualityBrief {
  version: "content-quality.v1";
  hook: string;
  readerPayoff: string;
  whyNow: string;
  specificClaims: string[];
  evidence: ContentQualityEvidence[];
  sourceGaps: string[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("content_quality_brief_invalid");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, code = "content_quality_brief_invalid") {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function textList(value: unknown, code = "content_quality_brief_invalid") {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((item) => text(item, code));
}

export function parseContentQualityBrief(value: unknown): ContentQualityBrief {
  const source = record(value);
  if (source.version !== "content-quality.v1") throw new Error("content_quality_brief_invalid");
  const specificClaims = textList(source.specificClaims);
  const evidenceSource = Array.isArray(source.evidence) ? source.evidence : [];
  if (evidenceSource.length < 2 || specificClaims.length < 2) {
    throw new Error("content_quality_evidence_insufficient");
  }
  const evidence = evidenceSource.map((item) => {
    const entry = record(item);
    const claimIndex = Number(entry.claimIndex);
    const indexedClaim = Number.isInteger(claimIndex) && claimIndex >= 1 && claimIndex <= specificClaims.length
      ? specificClaims[claimIndex - 1]
      : undefined;
    const claim = text(entry.claim ?? indexedClaim, "content_quality_evidence_invalid");
    const support = text(entry.support, "content_quality_evidence_invalid");
    if (claim.length < 2 || support.length < 10) throw new Error("content_quality_evidence_invalid");
    const sourceUrl = entry.sourceUrl === null || entry.sourceUrl === undefined
      ? undefined
      : text(entry.sourceUrl, "content_quality_evidence_invalid");
    if (sourceUrl) {
      try { new URL(sourceUrl); } catch { throw new Error("content_quality_evidence_invalid"); }
    }
    return { claim, support, ...(sourceUrl !== undefined ? { sourceUrl } : {}) };
  });
  return {
    version: "content-quality.v1",
    hook: text(source.hook),
    readerPayoff: text(source.readerPayoff),
    whyNow: text(source.whyNow),
    specificClaims,
    evidence,
    sourceGaps: textList(source.sourceGaps),
  };
}
