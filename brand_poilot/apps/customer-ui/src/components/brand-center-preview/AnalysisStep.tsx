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
  onReset?(): void;
  onComplete(): void;
  companyName?: string;
  statusText?: string;
  ownedPageProgress?: string;
  cliProgress?: string;
  waitingMinutes?: string;
  activeMinutes?: string;
  cancelling?: boolean;
  onCancel?(): void;
}

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
  onBrandCoreChange,
  onRetry,
  onReset,
  onComplete,
  companyName,
  statusText,
  ownedPageProgress,
  cliProgress,
  waitingMinutes,
  activeMinutes,
  cancelling = false,
  onCancel,
}: AnalysisStepProps) {
  const coreStatus = brandCoreApproved ? "승인 완료" : null;
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
          <p>보통 수분~10분 정도 소요되며 자료에 따라 더 길어질 수 있습니다.</p>
          {companyName && <p><strong>회사명</strong> {companyName}</p>}
          {statusText && <p><strong>현재 단계</strong> {statusText}</p>}
          {ownedPageProgress && <p><strong>자사 중요 페이지</strong> {ownedPageProgress}</p>}
          {cliProgress && <p><strong>CLI 분석</strong> {cliProgress}</p>}
          {waitingMinutes && <p><strong>자원 대기</strong> {waitingMinutes}</p>}
          {activeMinutes && <p><strong>실제 분석</strong> {activeMinutes} / 최대 20분</p>}
          {!activeMinutes && <p>자원 대기 시간은 최대 20분 분석 제한에 포함되지 않습니다.</p>}
          <ListSkeleton
            rows={4}
            columns={1}
            label="브랜드 자료를 분석하고 있습니다."
          />
          {onCancel && (
            <button type="button" className="button" disabled={cancelling} onClick={onCancel}>
              {cancelling ? "중단 및 정리 중" : "분석 취소"}
            </button>
          )}
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
          {onReset ? (
            <button
              type="button"
              className="button"
              onClick={onReset}
            >
              입력 다시하기
            </button>
          ) : null}
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
