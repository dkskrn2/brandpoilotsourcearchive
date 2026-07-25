import { Navigate, Outlet, useLocation } from "react-router-dom";
import { isBrandProfileComplete, isBrandSetupPath } from "../../lib/brandSetup";
import { useBrandStatus } from "../../lib/brandStatus";

export function BrandSetupGate() {
  const location = useLocation();
  const { status, loading } = useBrandStatus();

  if (isBrandSetupPath(location.pathname)) {
    return <Outlet />;
  }

  if (loading && !status) {
    return <section className="content"><div className="panel"><div className="panel-body">브랜드 설정 상태를 확인하고 있습니다.</div></div></section>;
  }

  if (!isBrandProfileComplete(status)) {
    return <Navigate to="/onboarding/brand-intelligence" replace />;
  }

  return <Outlet />;
}
