import { RefreshCw, ShieldCheck } from "lucide-react";

export function BrandCenterHeader({
  readiness,
  approvedAt,
  busy,
  onReanalyze,
  onReviewChanges,
}: {
  readiness: string;
  approvedAt: string | null;
  busy: boolean;
  onReanalyze(): void;
  onReviewChanges(): void;
}) {
  return (
    <header className="brand-center-header" data-guide="page-header">
      <div>
        <span className="brand-center-eyebrow">BRAND OPERATING SYSTEM</span>
        <h1>브랜드 센터</h1>
        <p>AI가 이해한 브랜드 정보와 사용자가 승인한 실행 기준을 분리해 관리합니다.</p>
        <div className="brand-center-meta">
          <span><ShieldCheck size={15} aria-hidden="true" /> 준비도 {readiness}</span>
          <span>마지막 승인 {approvedAt ? new Date(approvedAt).toLocaleString("ko-KR") : "아직 없음"}</span>
        </div>
      </div>
      <div className="brand-center-actions">
        <button className="button" type="button" disabled={busy} onClick={onReanalyze}>
          <RefreshCw size={16} aria-hidden="true" /> AI 재분석
        </button>
        <button className="button primary" type="button" disabled={busy} onClick={onReviewChanges}>
          변경 검토
        </button>
      </div>
    </header>
  );
}
