import type { AiGenerationStatus } from "../../features/ai-content/types";

export const aiContentGenerationStatusLabels: Record<AiGenerationStatus, string> = {
  draft: "생성 준비 중입니다.",
  analyzing: "입력 내용을 분석하고 있습니다.",
  analysis_ready: "분석을 완료하고 생성을 준비하고 있습니다.",
  queued: "생성 순서를 기다리고 있습니다.",
  planning: "선택한 구성안으로 콘텐츠를 기획하고 있습니다.",
  generating: "콘텐츠를 생성하고 있습니다.",
  completed: "콘텐츠 생성이 완료되었습니다.",
  partial_failed: "일부 결과만 완료되었습니다.",
  failed: "콘텐츠 생성에 실패했습니다.",
};

export function AiContentGenerationStatusPanel({
  status,
  generationId,
  completedCount,
  outputCount,
}: {
  status: AiGenerationStatus;
  generationId: string;
  completedCount?: number;
  outputCount?: number;
}) {
  const tone = status === "completed"
    ? "success"
    : status === "partial_failed"
      ? "warning"
      : status === "failed"
        ? "error"
        : "progress";
  const summary = status === "completed" && outputCount !== undefined
    ? `${outputCount}개 결과가 모두 완성되었습니다.`
    : status === "partial_failed" && completedCount !== undefined && outputCount !== undefined
      ? `${outputCount}개 중 ${completedCount}개 결과를 확인할 수 있습니다.`
      : status === "failed"
        ? "완료된 결과가 없습니다. 아래 실패 사유를 확인해 주세요."
        : "완료되거나 확인이 필요한 결과가 생기면 이 화면에 자동으로 표시됩니다.";
  return (
    <section
      className={`ai-content-generation-status ai-content-result-hero is-${tone} is-${status}`}
      role="region"
      aria-label={status === "completed" ? "생성 완료 요약" : "생성 상태 요약"}
    >
      <div className="ai-content-result-hero__message" role="status">
        <span className="ai-content-result-hero__icon" aria-hidden="true">
          {tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "error" ? "×" : "•••"}
        </span>
        <div>
          <span className="ai-content-generation-status__eyebrow">현재 생성 상태</span>
          <h2>{aiContentGenerationStatusLabels[status]}</h2>
          <p>{summary}</p>
        </div>
      </div>
      <p className="ai-content-generation-status__id">생성 ID <code>{generationId}</code></p>
    </section>
  );
}
