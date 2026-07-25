import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { BrandUiStatus } from "../types";
import { api, apiClient, BRAND_STATUS_CHANGED_EVENT, DEMO_BRAND_ID } from "./apiClient";

type BrandStatusClient = Pick<ReturnType<typeof apiClient>, "getBrandUiStatus">;

interface BrandStatusContextValue {
  status: BrandUiStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const BrandStatusContext = createContext<BrandStatusContextValue>({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {}
});

interface BrandStatusProviderProps {
  children: ReactNode;
  brandId?: string;
  client?: BrandStatusClient;
  initialStatus?: BrandUiStatus;
}

export function BrandStatusProvider({
  children,
  brandId = DEMO_BRAND_ID,
  client = api,
  initialStatus
}: BrandStatusProviderProps) {
  const [status, setStatus] = useState<BrandUiStatus | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(!initialStatus);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const nextStatus = await client.getBrandUiStatus(brandId);
      setStatus(nextStatus);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "brand_status_failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialStatus) return;
    let ignore = false;
    setLoading(true);
    client.getBrandUiStatus(brandId)
      .then((nextStatus) => {
        if (!ignore) {
          setStatus(nextStatus);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (!ignore) {
          setError(requestError instanceof Error ? requestError.message : "brand_status_failed");
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [brandId, client, initialStatus]);

  useEffect(() => {
    function handleStatusChanged() {
      void refresh();
    }
    window.addEventListener(BRAND_STATUS_CHANGED_EVENT, handleStatusChanged);
    return () => {
      window.removeEventListener(BRAND_STATUS_CHANGED_EVENT, handleStatusChanged);
    };
  }, [brandId, client]);

  const value = useMemo(() => ({ status, loading, error, refresh }), [status, loading, error]);

  return <BrandStatusContext.Provider value={value}>{children}</BrandStatusContext.Provider>;
}

export function useBrandStatus() {
  return useContext(BrandStatusContext);
}
