import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PreviewAsyncState,
  PreviewBrandCore,
  PreviewKnowledgeItem,
} from "../../features/brand-center-preview/types";
import { Alert } from "../ui/Alert";
import { ListSkeleton } from "../ui/LoadingState";
import { PREVIEW_PHASE_DURATION_MS } from "../../features/brand-center-preview/previewAdapter";

interface AnalysisStepProps {
  state: PreviewAsyncState;
  error: string | null;
  brandCore: PreviewBrandCore;
  brandCoreApproved: boolean;
  knowledge: PreviewKnowledgeItem[];
  onBrandCoreChange(brandCore: PreviewBrandCore): void;
  onKnowledgeChange(item: PreviewKnowledgeItem): void;
  onRetry(): void;
  onComplete(): void;
}

const knowledgeKindLabels: Record<PreviewKnowledgeItem["kind"], string> = {
  faq: "자주 묻는 질문",
  policy: "정책",
  how_to: "이용 방법",
  guide: "가이드",
  product_service: "제품·서비스",
};

type ScalarKey = "oneLine" | "description" | "target" | "customerProblem" | "primaryValue";
type ArrayKey = "differentiators" | "tone" | "priorityMessages";

const coreScalarFields: Array<{
  key: ScalarKey;
  label: string;
  inputLabel: string;
  rows: number;
}> = [
  { key: "oneLine", label: "한 줄 소개", inputLabel: "한 줄 정의", rows: 2 },
  { key: "description", label: "브랜드 설명", inputLabel: "브랜드 설명", rows: 3 },
  { key: "target", label: "핵심 고객", inputLabel: "타깃 고객", rows: 2 },
  { key: "customerProblem", label: "고객 문제", inputLabel: "고객 문제", rows: 2 },
  { key: "primaryValue", label: "주요 가치", inputLabel: "핵심 가치", rows: 2 },
];

const coreArrayFields: Array<{
  key: ArrayKey;
  label: string;
  inputLabel: string;
}> = [
  { key: "differentiators", label: "차별점", inputLabel: "차별점" },
  { key: "tone", label: "브랜드 톤", inputLabel: "톤앤매너" },
  { key: "priorityMessages", label: "우선 메시지", inputLabel: "우선 메시지" },
];

function toLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function StatusBadge({ label }: { label: string }) {
  return <strong className="brand-center-preview__draft-badge">{label}</strong>;
}

export function AnalysisStep({
  state,
  error,
  brandCore,
  brandCoreApproved,
  knowledge,
  onBrandCoreChange,
  onKnowledgeChange,
  onRetry,
  onComplete,
}: AnalysisStepProps) {
  const coreStatus = brandCoreApproved ? "승인 완료" : null;
  const visibleKnowledge = knowledge.filter((item) => item.kind !== "policy");
  const [openKnowledgeKind, setOpenKnowledgeKind] =
    useState<PreviewKnowledgeItem["kind"]>("faq");
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [arrayDrafts, setArrayDrafts] = useState<Record<ArrayKey, string>>({
    differentiators: brandCore.differentiators.join("\n"),
    tone: brandCore.tone.join("\n"),
    priorityMessages: brandCore.priorityMessages.join("\n"),
  });

  useEffect(() => {
    setArrayDrafts({
      differentiators: brandCore.differentiators.join("\n"),
      tone: brandCore.tone.join("\n"),
      priorityMessages: brandCore.priorityMessages.join("\n"),
    });
  }, [brandCore.differentiators, brandCore.tone, brandCore.priorityMessages]);

  useEffect(() => {
    if (state !== "loading") {
      setLoadingPhase(0);
      return;
    }
    const timer = window.setInterval(() => {
      setLoadingPhase((current) => Math.min(current + 1, 2));
    }, PREVIEW_PHASE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [state]);

  function knowledgeStatus(item: PreviewKnowledgeItem) {
    if (item.origin === "user") return "직접 입력";
    return item.reviewStatus === "approved" ? "승인 완료" : null;
  }

  return (
    <section className="brand-center-preview__card" aria-labelledby="analysis-step-title">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">STEP 2</p>
        <h2 id="analysis-step-title">AI가 브랜드 핵심을 정리합니다</h2>
        <p>등록한 자료에서 브랜드 설명과 주요 메시지를 추려 보여드립니다.</p>
      </div>

      {state === "idle" ? (
        <div className="brand-center-preview__analysis-idle">
          <Sparkles size={22} aria-hidden="true" />
          <div>
            <strong>등록한 자료를 분석할 준비가 되었습니다.</strong>
            <p>분석을 시작하면 브랜드 핵심과 제안 정보를 한 번에 정리합니다.</p>
          </div>
          <button
            type="button"
            className="brand-center-preview__primary-action"
            onClick={onRetry}
          >
            AI 분석 시작
          </button>
        </div>
      ) : null}

      {state === "loading" ? (
        <div className="brand-center-preview__analysis-surface brand-center-preview__phase-loader" aria-busy="true">
          <strong aria-live="polite">{[
            "자료를 읽는 중",
            "브랜드 핵심을 정리하는 중",
            "지식 초안을 만드는 중",
          ][loadingPhase]}<span aria-hidden="true">...</span></strong>
          <ListSkeleton
            rows={4}
            columns={1}
            label="브랜드 자료를 분석하고 있습니다."
          />
        </div>
      ) : null}

      {state === "failed" ? (
        <div className="brand-center-preview__analysis-error">
          <Alert title="자료를 분석하지 못했습니다." variant="bad">
            {error ?? "잠시 후 다시 시도해 주세요."}
          </Alert>
          <button
            type="button"
            className="brand-center-preview__primary-action"
            onClick={onRetry}
          >
            다시 분석
          </button>
        </div>
      ) : null}

      {state === "succeeded" ? (
        <div className="brand-center-preview__analysis-surface">
          <div className="brand-center-preview__analysis-label">
            <Sparkles size={17} aria-hidden="true" />
            <span>AI 분석 결과</span>
          </div>
          <div className="brand-center-preview__result-grid">
            {coreScalarFields.map(({ key, label, inputLabel, rows }) => (
              <article key={key}>
                <header><span>{label}</span>{coreStatus ? <StatusBadge label={coreStatus} /> : null}</header>
                <textarea
                  aria-label={inputLabel}
                  rows={rows}
                  value={brandCore[key]}
                  onChange={(event) => onBrandCoreChange({
                    ...brandCore,
                    [key]: event.target.value,
                  })}
                />
              </article>
            ))}
            {coreArrayFields.map(({ key, label, inputLabel }) => (
              <article key={key}>
                <header><span>{label}</span>{coreStatus ? <StatusBadge label={coreStatus} /> : null}</header>
                <textarea
                  aria-label={inputLabel}
                  rows={3}
                  value={arrayDrafts[key]}
                  onChange={(event) => setArrayDrafts((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))}
                  onBlur={() => {
                    const lines = toLines(arrayDrafts[key]);
                    setArrayDrafts((current) => ({ ...current, [key]: lines.join("\n") }));
                    onBrandCoreChange({ ...brandCore, [key]: lines });
                  }}
                />
              </article>
            ))}
          </div>

          <section className="brand-center-preview__knowledge" aria-labelledby="preview-knowledge-title">
            <div className="brand-center-preview__knowledge-heading">
              <p className="brand-center-preview__eyebrow">PROPOSED KNOWLEDGE</p>
              <h3 id="preview-knowledge-title">AI 제안 정보</h3>
            </div>
            <div className="brand-center-preview__knowledge-accordions">
              {(["faq", "how_to", "guide", "product_service"] as const).map((kind) => {
                const expanded = openKnowledgeKind === kind;
                const kindItems = visibleKnowledge.filter((item) => item.kind === kind);
                return (
                  <section key={kind} className="brand-center-preview__knowledge-accordion">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`knowledge-panel-${kind}`}
                      onClick={() => setOpenKnowledgeKind(kind)}
                    >
                      <span>{knowledgeKindLabels[kind]}</span>
                      <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                    </button>
                    <div id={`knowledge-panel-${kind}`} hidden={!expanded}>
                      <div className="brand-center-preview__knowledge-list">
                        {kindItems.map((item) => {
                          const status = knowledgeStatus(item);
                          return <article key={item.id}>
                            <header>
                              <span>{knowledgeKindLabels[item.kind]}</span>
                              {status ? <StatusBadge label={status} /> : null}
                            </header>
                            <h4>{item.title}</h4>
                            <textarea
                              aria-label={`${item.title} 내용`}
                              rows={3}
                              value={item.content}
                              onChange={(event) => onKnowledgeChange({
                                ...item,
                                content: event.target.value,
                              })}
                            />
                          </article>;
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
          <div className="brand-center-preview__section-actions">
            <button
              type="button"
              className="brand-center-preview__primary-action"
              onClick={onComplete}
            >
              완료
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
