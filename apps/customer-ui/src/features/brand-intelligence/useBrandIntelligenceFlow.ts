import { useCallback, useEffect, useState } from "react";
import type { BrandAnalysis, BrandIntelligenceGateway, BrandIntelligenceResult } from "./types";

export function useBrandIntelligenceFlow({
  brandId,
  analysisId,
  gateway,
}: {
  brandId: string;
  analysisId: string | null;
  gateway: BrandIntelligenceGateway;
}) {
  const [analysis, setAnalysis] = useState<BrandAnalysis | null>(null);
  const [draft, setDraft] = useState<BrandIntelligenceResult | null>(null);
  const [loading, setLoading] = useState(Boolean(analysisId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!analysisId) return null;
    const next = await gateway.getAnalysis(brandId, analysisId);
    setAnalysis(next);
    if (next.effectiveResult) setDraft((current) => current ?? next.effectiveResult);
    return next;
  }, [analysisId, brandId, gateway]);

  useEffect(() => {
    if (!analysisId) {
      setLoading(false);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await refresh();
        if (stopped || !next) return;
        setError(null);
        if (["queued", "extracting", "analyzing"].includes(next.status)) timer = setTimeout(poll, 2_000);
      } catch {
        if (!stopped) setError("분석 상태를 불러오지 못했습니다.");
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [analysisId, refresh]);

  return { analysis, draft, setDraft, loading, error, refresh };
}
