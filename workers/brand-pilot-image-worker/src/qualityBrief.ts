function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("content_quality_brief_invalid");
  return value as Record<string, unknown>;
}

export function requireQualityBrief(value: unknown) {
  const brief = record(value);
  if (brief.version !== "content-quality.v1") throw new Error("content_quality_brief_invalid");
  const claims = Array.isArray(brief.specificClaims) ? brief.specificClaims : [];
  const evidence = Array.isArray(brief.evidence) ? brief.evidence : [];
  if (claims.length < 2 || evidence.length < 2) throw new Error("content_quality_evidence_insufficient");
  for (const item of evidence) {
    const entry = record(item);
    if (typeof entry.claim !== "string" || entry.claim.trim().length < 2
      || typeof entry.support !== "string" || entry.support.trim().length < 10) {
      throw new Error("content_quality_evidence_invalid");
    }
  }
  return brief;
}
