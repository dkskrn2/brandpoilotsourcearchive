import { CheckCircle2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PreviewAsyncState,
  PreviewBrandCore,
  PreviewFile,
  PreviewKnowledgeItem,
} from "../../features/brand-center-preview/types";
import { InlineSpinner } from "../ui/LoadingState";
import { PREVIEW_PHASE_DURATION_MS } from "../../features/brand-center-preview/previewAdapter";

const cards = [
  {
    title: "브랜드의 기준을 한곳에",
    body: "흩어진 자료를 하나의 선명한 브랜드 기준으로 정리하세요.",
  },
  {
    title: "AI 제안도 직접 검토",
    body: "자동 생성된 초안과 직접 등록한 정보를 함께 확인합니다.",
  },
  {
    title: "승인된 정보만 활용",
    body: "검토가 끝난 브랜드 정보만 콘텐츠 제작 기준으로 사용합니다.",
  },
  {
    title: "일관된 콘텐츠 완성",
    body: "팀이 같은 목소리로 더 빠르게 콘텐츠를 만들 수 있습니다.",
  },
] as const;

interface CardGenerationStepProps {
  state: PreviewAsyncState;
  error: string | null;
  sourceUrl: string;
  sourceFiles: PreviewFile[];
  brandCore: PreviewBrandCore;
  knowledge: PreviewKnowledgeItem[];
  onGenerate(): void;
}

export function CardGenerationStep({
  state,
  error,
  sourceUrl,
  sourceFiles,
  brandCore,
  knowledge,
  onGenerate,
}: CardGenerationStepProps) {
  const approvedKnowledge = knowledge.filter(
    (item) => item.reviewStatus !== "ai_draft",
  );
  const loading = state === "loading";
  const [loadingPhase, setLoadingPhase] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadingPhase(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingPhase((current) => Math.min(current + 1, 2));
    }, PREVIEW_PHASE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [loading]);

  return (
    <section className="brand-center-preview__card">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">STEP 3</p>
        <h2>완료</h2>
        <p>브랜드 정보를 저장하고 카드뉴스 초안을 자동으로 만듭니다.</p>
      </div>

      <div className="brand-center-preview__generation-surface">
        <section
          className="brand-center-preview__generation-summary"
          aria-labelledby="generation-input-title"
        >
          <div className="brand-center-preview__generation-title">
            <CheckCircle2 size={20} aria-hidden="true" />
            <h3 id="generation-input-title">승인된 입력</h3>
          </div>
          <dl>
            <div>
              <dt>자료</dt>
              <dd>
                {sourceUrl.trim() ? "웹사이트 1개" : null}
                {sourceUrl.trim() && sourceFiles.length ? " · " : null}
                {sourceFiles.length ? `문서 ${sourceFiles.length}개` : null}
              </dd>
            </div>
            <div>
              <dt>Brand Core</dt>
              <dd>{brandCore.oneLine}</dd>
            </div>
            <div>
              <dt>브랜드 지식</dt>
              <dd>{approvedKnowledge.length}개 승인됨</dd>
            </div>
          </dl>
        </section>

        {state === "failed" ? (
          <div className="brand-center-preview__generation-error" role="alert">
            <strong>{error}</strong>
            <p>검토를 마친 Brand Core와 지식은 그대로 유지됩니다.</p>
            <button
              className="brand-center-preview__primary-action"
              type="button"
              onClick={onGenerate}
            >
              다시 생성
            </button>
          </div>
        ) : null}

        {state === "succeeded" ? (
          <div className="brand-center-preview__generation-result">
            <div className="brand-center-preview__generation-success" role="status">
              <CheckCircle2 size={20} aria-hidden="true" />
              <div>
                <h2>브랜드 준비가 완료되었습니다</h2>
                <p>정리한 브랜드 정보를 바탕으로 카드뉴스 초안 4장을 만들었습니다.</p>
              </div>
            </div>
            <div className="brand-center-preview__card-grid">
              {cards.map((card, index) => (
                <article
                  key={card.title}
                  aria-label={`카드 ${index + 1}`}
                  className={`brand-center-preview__generated-card is-card-${index + 1}`}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}

        {state === "idle" || loading ? (
          <div className="brand-center-preview__generation-action">
            {loading ? (
              <div
                aria-live="polite"
                aria-label="카드뉴스 생성 중"
                aria-busy="true"
              >
                <InlineSpinner label="카드뉴스 생성 중" />
                <strong>{[
                  "브랜드 정보를 저장하는 중",
                  "카드뉴스 초안을 만드는 중",
                  "결과를 정리하는 중",
                ][loadingPhase]}</strong>
                <span>현재 편집 내용은 이 미리보기 안에서 유지됩니다.</span>
              </div>
            ) : (
              <div>
                <Sparkles size={22} aria-hidden="true" />
                <strong>생성 준비가 완료되었습니다.</strong>
                <span>이 미리보기는 외부 요청 없이 로컬에서 동작합니다.</span>
              </div>
            )}
            {!loading ? (
              <button
                className="brand-center-preview__primary-action"
                type="button"
                onClick={onGenerate}
              >
                다시 시작
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
