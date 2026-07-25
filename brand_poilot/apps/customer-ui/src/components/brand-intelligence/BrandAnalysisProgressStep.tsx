import type { BrandAnalysisStatus } from "../../features/brand-intelligence/types";
import { InlineSpinner } from "../ui/LoadingState";

const labels: Record<BrandAnalysisStatus, string> = {
  queued: "분석을 준비하고 있습니다",
  extracting: "URL과 문서에서 정보를 정리하고 있습니다",
  analyzing: "기업과 시장 정보를 분석하고 있습니다",
  review_ready: "분석이 완료되었습니다",
  confirmed: "브랜드 정보가 저장되었습니다",
  failed: "분석을 완료하지 못했습니다",
};

export function BrandAnalysisProgressStep({ status }: { status: BrandAnalysisStatus }) {
  const activeIndex = status === "queued" ? 0 : status === "extracting" ? 1 : 2;
  return (
    <section className="panel brand-intelligence-step">
      <div className="brand-analysis-progress">
        <InlineSpinner label={labels[status]} />
        <h2>{labels[status]}</h2>
        <ol>
          {["자료 등록", "내용 추출", "브랜드·시장 분석"].map((label, index) => (
            <li key={label} className={index <= activeIndex ? "is-active" : ""}>{label}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
