import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEMO_BRAND_ID } from "../../lib/apiClient";
import { aiContentApiGateway } from "./aiContentApiGateway";
import type { AiContentGateway, AiContentUsage } from "./types";

interface AiContentUsageContextValue {
  usage: AiContentUsage | null;
  loading: boolean;
  refresh(): Promise<void>;
}

const AiContentUsageContext = createContext<AiContentUsageContextValue>({ usage: null, loading: false, refresh: async () => undefined });

export function AiContentUsageProvider({ children, gateway = aiContentApiGateway, brandId = DEMO_BRAND_ID }: {
  children: React.ReactNode;
  gateway?: AiContentGateway;
  brandId?: string;
}) {
  const [usage, setUsage] = useState<AiContentUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const latestRequestId = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++latestRequestId.current;
    setLoading(true);
    try {
      const nextUsage = await gateway.getUsage(brandId);
      if (requestId === latestRequestId.current) setUsage(nextUsage);
    } catch {
      if (requestId === latestRequestId.current) setUsage(null);
    } finally {
      if (requestId === latestRequestId.current) setLoading(false);
    }
  }, [brandId, gateway]);
  useEffect(() => {
    void refresh();
    return () => { latestRequestId.current += 1; };
  }, [refresh]);
  const value = useMemo(() => ({ usage, loading, refresh }), [usage, loading, refresh]);
  return <AiContentUsageContext.Provider value={value}>{children}</AiContentUsageContext.Provider>;
}

export function useAiContentUsage() { return useContext(AiContentUsageContext); }
