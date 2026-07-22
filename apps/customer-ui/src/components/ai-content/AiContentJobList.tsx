import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { BadgeVariant } from "../../types";
import type { AiContentGeneration, AiContentType } from "../../features/ai-content/types";
import { Badge } from "../ui/Badge";

const typeLabels: Record<AiContentType, string> = { card_news: "카드뉴스", blog: "블로그", marketing: "마케팅 소재" };
const statusLabels: Record<AiContentGeneration["status"], { label: string; variant: BadgeVariant }> = {
  draft: { label: "작성 중", variant: "neutral" },
  analyzing: { label: "분석 중", variant: "info" },
  analysis_ready: { label: "분석 완료", variant: "info" },
  queued: { label: "생성 대기", variant: "info" },
  planning: { label: "기획 중", variant: "info" },
  generating: { label: "생성 중", variant: "info" },
  completed: { label: "완료", variant: "ok" },
  partial_failed: { label: "부분 실패", variant: "warn" },
  failed: { label: "실패", variant: "bad" }
};
const stepLabels = ["콘텐츠 유형", "제품·서비스 분석", "타깃·소구점", "레퍼런스", "프롬프트·생성"];
const WIZARD_STEP_COUNT = stepLabels.length;

export type AiContentJobFilter = "all" | AiContentType;

interface AiContentJobListProps {
  jobs: AiContentGeneration[];
  filter: AiContentJobFilter;
  onFilterChange(filter: AiContentJobFilter): void;
}

export function AiContentJobList({ jobs, filter, onFilterChange }: AiContentJobListProps) {
  const visibleJobs = filter === "all" ? jobs : jobs.filter((job) => job.type === filter);
  return (
    <section className="ai-content-jobs" aria-label="AI 콘텐츠 작업">
      <div className="ai-content-section-head">
        <div><h2>진행 중·최근 작업</h2><p>생성 상태와 완료된 결과를 한곳에서 확인합니다.</p></div>
        <div className="ai-content-filter" role="group" aria-label="콘텐츠 유형 필터">
          {(["all", "card_news", "blog", "marketing"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}>
              {value === "all" ? "전체" : typeLabels[value]}
            </button>
          ))}
        </div>
      </div>
      {visibleJobs.length === 0 ? <p className="ai-content-empty">해당 유형의 작업이 없습니다.</p> : (
        <ul className="ai-content-job-list">
          {visibleJobs.map((job) => {
            const status = statusLabels[job.status];
            const completeCount = job.outputs.filter((output) => output.status === "completed").length;
            const isActive = ["draft", "analyzing", "analysis_ready", "queued", "planning", "generating"].includes(job.status);
            const thumbnail = job.outputs
              .flatMap((output) => output.artifact?.assets ?? [])
              .find((asset) => asset.mimeType?.startsWith("image/"));
            return (
              <li key={job.id} className="ai-content-job-card">
                <Link className="ai-content-job-card__link" to={`/ai-content/${job.id}`} aria-label={`${job.title} ${status.label} 상세 보기`}>
                  <div className="ai-content-job-card__media" data-testid="job-card-media" style={{ aspectRatio: "4 / 3" }}>
                    {thumbnail ? (
                      <img src={thumbnail.url} alt={`${job.title} 첫 결과 미리보기`} />
                    ) : (
                      <span>{isActive ? "결과 준비 중" : "미리보기 없음"}</span>
                    )}
                  </div>
                  <div className="ai-content-job-card__body">
                    <div className="ai-content-job-list__main">
                      <div className="ai-content-job-list__title"><Badge>{typeLabels[job.type]}</Badge><strong>{job.title}</strong></div>
                      <small>{isActive ? `${job.currentStep} / ${WIZARD_STEP_COUNT}단계 · ${stepLabels[Math.max(0, Math.min(WIZARD_STEP_COUNT - 1, job.currentStep - 1))]}` : `${completeCount} / ${job.outputs.length}개 완료`} · {new Date(job.updatedAt).toLocaleDateString("ko-KR")}</small>
                    </div>
                    <div className="ai-content-job-card__footer">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span className="ai-content-job-card__action" aria-hidden="true">상세 보기 <ArrowRight size={15} /></span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
