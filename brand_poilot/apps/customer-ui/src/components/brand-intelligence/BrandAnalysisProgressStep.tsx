import { useEffect, useState } from "react";
import type { BrandAnalysisStatus } from "../../features/brand-intelligence/types";
import { InlineSpinner } from "../ui/LoadingState";

const labels: Record<BrandAnalysisStatus, string> = {
  queued: "분석 작업을 준비하고 있습니다",
  accepting_uploads: "자료 업로드를 기다리고 있습니다",
  waiting_for_resource: "분석 자원을 기다리고 있습니다",
  extracting: "중요 페이지와 문서를 정리하고 있습니다",
  analyzing: "브랜드 핵심과 시장 정보를 분석하고 있습니다",
  running: "브랜드 핵심과 시장 정보를 분석하고 있습니다",
  finalizing: "분석 결과를 검증하고 있습니다",
  review_ready: "분석이 완료되었습니다",
  confirmed: "브랜드 정보가 저장되었습니다",
  failed: "분석을 완료하지 못했습니다",
  cancel_requested: "분석을 중단하고 있습니다",
  purging: "임시 자료를 안전하게 정리하고 있습니다",
  cancelled: "분석이 취소되었습니다",
};

export function BrandAnalysisProgressStep({
  status,
  companyName,
  currentStage,
  selectedPageCount = 0,
  successfulPageCount = 0,
  requiredPageCount = 0,
  completedCliStageCount = 0,
  totalCliStageCount = 8,
  queuedAt,
  activeStartedAt,
  cancelling = false,
  onCancel,
}: {
  status: BrandAnalysisStatus;
  companyName?: string | null;
  currentStage?: string | null;
  selectedPageCount?: number;
  successfulPageCount?: number;
  requiredPageCount?: number;
  completedCliStageCount?: number;
  totalCliStageCount?: number;
  queuedAt?: string | null;
  activeStartedAt?: string | null;
  cancelling?: boolean;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = (value?: string | null) => value
    ? Math.max(0, (now - new Date(value).getTime()) / 60_000).toFixed(1)
    : "0.0";
  const waitingMinutes = queuedAt
    ? Math.max(
        0,
        ((activeStartedAt ? new Date(activeStartedAt).getTime() : now)
          - new Date(queuedAt).getTime()) / 60_000,
      ).toFixed(1)
    : "0.0";
  const isWaiting = ["queued", "accepting_uploads", "waiting_for_resource"].includes(status);
  const cancellable = !["review_ready", "confirmed", "failed", "cancelled"].includes(status);

  return (
    <section className="panel brand-intelligence-step">
      <div className="brand-analysis-progress">
        <InlineSpinner label={labels[status]} />
        <h2>{labels[status]}</h2>
        {companyName && <p><strong>회사명</strong> {companyName}</p>}
        {currentStage && <p><strong>현재 단계</strong> {currentStage}</p>}
        <p><strong>자사 중요 페이지</strong> {successfulPageCount}/20개 수집</p>
        {requiredPageCount > 0 && <p><strong>완료 기준</strong> 최소 {requiredPageCount}개 성공</p>}
        <p><strong>CLI 분석</strong> {completedCliStageCount}/{totalCliStageCount || 8}단계</p>
        <p><strong>자원 대기</strong> {waitingMinutes}분</p>
        <p><strong>실제 분석</strong> {activeStartedAt ? `${minutes(activeStartedAt)}분 / 최대 20분` : "아직 시작하지 않음"}</p>
        {isWaiting && <p className="muted">자원 대기 시간은 20분 제한에 포함되지 않습니다.</p>}
        {cancellable && onCancel && (
          <div className="form-actions">
            <button type="button" className="button" disabled={cancelling} onClick={onCancel}>
              {cancelling ? "중단 및 정리 중" : "분석 취소"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
