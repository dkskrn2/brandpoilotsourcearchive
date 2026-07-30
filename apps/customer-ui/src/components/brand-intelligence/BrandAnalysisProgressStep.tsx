import { useEffect, useState } from "react";
import type { BrandAnalysisStatus } from "../../features/brand-intelligence/types";
import { InlineSpinner } from "../ui/LoadingState";

const labels: Record<BrandAnalysisStatus, string> = {
  queued: "분석을 준비하고 있습니다",
  accepting_uploads: "자료 업로드를 기다리고 있습니다",
  waiting_for_resource: "분석 자원을 기다리고 있습니다",
  extracting: "URL과 문서에서 정보를 정리하고 있습니다",
  analyzing: "기업과 시장 정보를 분석하고 있습니다",
  running: "기업과 시장 정보를 분석하고 있습니다",
  finalizing: "분석 결과를 안전하게 저장하고 있습니다",
  review_ready: "분석이 완료되었습니다",
  confirmed: "브랜드 정보가 저장되었습니다",
  failed: "분석을 완료하지 못했습니다",
  cancel_requested: "분석을 중단하고 있습니다",
  purging: "임시 자료를 정리하고 있습니다",
  cancelled: "분석이 취소되었습니다",
};

export function BrandAnalysisProgressStep({
  status,
  companyName,
  createdAt,
  ownedPageCount = 0,
  cancelling = false,
  onCancel,
}: {
  status: BrandAnalysisStatus;
  companyName?: string | null;
  createdAt?: string | null;
  ownedPageCount?: number;
  cancelling?: boolean;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const elapsedMinutes = createdAt
    ? Math.max(0, (now - new Date(createdAt).getTime()) / 60_000)
    : 0;
  const activeIndex = ["queued", "accepting_uploads", "waiting_for_resource"].includes(status)
    ? 0
    : status === "extracting"
      ? 1
      : 2;
  const cancellable = !["review_ready", "confirmed", "failed", "cancelled"].includes(status);
  return (
    <section className="panel brand-intelligence-step">
      <div className="brand-analysis-progress">
        <InlineSpinner label={labels[status]} />
        <h2>{labels[status]}</h2>
        {companyName && <p><strong>회사명</strong> {companyName}</p>}
        <p><strong>중요 페이지</strong> {ownedPageCount}/20개 읽음</p>
        <p><strong>경과 시간</strong> {elapsedMinutes.toFixed(1)}분</p>
        <p>활성 분석은 시작 후 최대 20분 동안 진행됩니다.</p>
        <ol>
          {["자료 등록", "내용 추출", "브랜드·시장 분석"].map((label, index) => (
            <li key={label} className={index <= activeIndex ? "is-active" : ""}>{label}</li>
          ))}
        </ol>
        {cancellable && onCancel && (
          <div className="form-actions">
            <button
              type="button"
              className="button"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? "중단하는 중" : "분석 취소"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
