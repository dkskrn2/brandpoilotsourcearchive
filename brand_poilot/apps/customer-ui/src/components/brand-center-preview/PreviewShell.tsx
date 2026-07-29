import {
  FileText,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  PreviewFile,
  PreviewStep,
} from "../../features/brand-center-preview/types";

const steps: Array<{
  id: PreviewStep;
  label: string;
  icon: typeof FileText;
}> = [
  { id: "sources", label: "자료 등록", icon: FileText },
  { id: "analysis", label: "AI 분석·수정", icon: Sparkles },
  { id: "generation", label: "완료", icon: CheckCircle2 },
];

interface PreviewShellProps {
  currentStep: PreviewStep;
  sourceUrl: string;
  sourceFiles: PreviewFile[];
  canEnterStep(step: PreviewStep): boolean;
  onStepSelected(step: PreviewStep): void;
  children: ReactNode;
}

export function PreviewShell({
  currentStep,
  sourceUrl,
  sourceFiles,
  canEnterStep,
  onStepSelected,
  children,
}: PreviewShellProps) {
  return (
    <section className="brand-center-preview" aria-labelledby="preview-title">
      <header className="brand-center-preview__header">
        <p>BRAND CENTER</p>
        <h1 id="preview-title" aria-label="Brand Center Preview">
          브랜드 기준을 만드는 첫 단계
        </h1>
        <span>브랜드 자료를 등록하면 AI가 핵심 정보를 정리합니다.</span>
      </header>

      <nav className="brand-center-preview__steps" aria-label="브랜드 센터 진행 상태">
          {steps.map(({ id, label, icon: Icon }, index) => {
            const unlocked = canEnterStep(id);
            const current = currentStep === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={`${index + 1}. ${label}`}
                aria-current={current ? "step" : undefined}
                aria-disabled={unlocked ? undefined : true}
                onClick={() => {
                  if (unlocked) onStepSelected(id);
                }}
              >
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
      </nav>

      <div className="brand-center-preview__workspace">
        <aside className="brand-center-preview__context" aria-labelledby="source-context-title">
          <p className="brand-center-preview__eyebrow">SOURCE CONTEXT</p>
          <h2 id="source-context-title">등록 자료</h2>
          {sourceUrl.trim() || sourceFiles.length ? (
            <div className="brand-center-preview__context-list">
              {sourceUrl.trim() ? (
                <div>
                  <span>웹사이트</span>
                  <strong title={sourceUrl}>{sourceUrl}</strong>
                </div>
              ) : null}
              {sourceFiles.length ? (
                <div>
                  <span>문서</span>
                  <strong>{sourceFiles.length}개 선택됨</strong>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="brand-center-preview__context-empty">
              아직 등록된 자료가 없습니다.
            </p>
          )}
          <p className="brand-center-preview__context-note">
            선택한 파일은 이 화면에서 이름과 크기만 보관합니다.
          </p>
        </aside>

        <div className="brand-center-preview__main">{children}</div>
      </div>
    </section>
  );
}
