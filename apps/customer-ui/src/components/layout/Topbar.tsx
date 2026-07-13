import { useState } from "react";
import { useAuth } from "../../lib/auth";
import { useBrandStatus } from "../../lib/brandStatus";
import { Badge } from "../ui/Badge";

function formatLastGenerated(value: string | null) {
  if (!value) return "마지막 생성: 생성 기록 없음";
  return `마지막 생성: ${new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

export function Topbar() {
  const { session, logout } = useAuth();
  const { status, loading, error } = useBrandStatus();
  const [loggingOut, setLoggingOut] = useState(false);
  const remainingCount = status?.onboarding.remainingCount ?? 0;
  const brandName = session?.brand.name ?? status?.brandName ?? "Brand Pilot";
  const statusLabel = error && !status
    ? "API 확인 필요"
    : loading && !status
      ? "불러오는 중"
      : remainingCount > 0
        ? `${remainingCount}개 항목 필요`
        : "준비 완료";
  const statusVariant = error && !status ? "bad" : remainingCount > 0 ? "warn" : "ok";

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="topbar">
      <div>
        <strong>{brandName}</strong>
        <span>{error && !status ? "마지막 생성: API 연결 필요" : formatLastGenerated(status?.lastGeneratedAt ?? null)}</span>
      </div>
      <div className="topbar-actions">
        <Badge variant={statusVariant}>{statusLabel}</Badge>
        <button className="button" type="button" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? "로그아웃 중" : "로그아웃"}
        </button>
      </div>
    </header>
  );
}
