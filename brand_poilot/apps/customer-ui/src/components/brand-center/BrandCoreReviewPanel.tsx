import { useRef, useState } from "react";
import type { BrandCore, BrandCoreVersion } from "../../features/brand-center/types";

function FieldStatus({ version }: { version: BrandCoreVersion }) {
  const label = version.status === "approved" ? "승인됨" : "AI 제안 · 수정 가능";
  return <span className={`brand-field-status is-${version.status}`}>{label}</span>;
}

export function BrandCoreReviewPanel({
  version,
  saving,
  onChange,
  onSave,
  onApprove,
}: {
  version: BrandCoreVersion;
  saving: boolean;
  onChange(core: BrandCore): void;
  onSave(): void;
  onApprove(): void;
}) {
  const disabled = version.status !== "draft";
  const core = version.core;
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const oneLineRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const audienceRef = useRef<HTMLInputElement>(null);
  const primaryValueRef = useRef<HTMLTextAreaElement>(null);
  const directionRef = useRef<HTMLTextAreaElement>(null);
  const updateSummary = (field: keyof BrandCore["summary"], value: string) => {
    onChange({ ...core, summary: { ...core.summary, [field]: value } });
  };
  const validateAndApprove = () => {
    const fields = [
      { value: core.summary.oneLine, ref: oneLineRef },
      { value: core.summary.description, ref: descriptionRef },
      { value: core.audiences[0]?.name, ref: audienceRef },
      { value: core.valueProposition.primary, ref: primaryValueRef },
      { value: core.messaging.brandDirection, ref: directionRef },
    ];
    const invalid = fields.find((field) => !field.value?.trim());
    if (invalid) {
      setValidationMessage("필수 정보를 입력한 뒤 승인하세요.");
      invalid.ref.current?.focus();
      return;
    }
    setValidationMessage(null);
    onApprove();
  };
  return (
    <section className="brand-core-review panel">
      <div className="panel-header">
        <div>
          <span className="brand-center-eyebrow">BRAND CORE V{version.version}</span>
          <h2>{disabled ? "현재 승인된 Brand Core" : "변경 초안 검토"}</h2>
        </div>
        <FieldStatus version={version} />
      </div>
      <div className="panel-body brand-core-form">
        <label>
          한 줄 소개
          <input
            ref={oneLineRef}
            value={core.summary.oneLine}
            disabled={disabled}
            onChange={(event) => updateSummary("oneLine", event.target.value)}
          />
        </label>
        <label>
          브랜드 설명
          <textarea
            ref={descriptionRef}
            value={core.summary.description}
            disabled={disabled}
            onChange={(event) => updateSummary("description", event.target.value)}
          />
        </label>
        <label>
          핵심 타깃
          <input
            ref={audienceRef}
            value={core.audiences[0]?.name ?? ""}
            disabled={disabled}
            onChange={(event) => {
              const first = core.audiences[0] ?? { name: "", problem: "", desiredOutcome: "" };
              onChange({ ...core, audiences: [{ ...first, name: event.target.value }, ...core.audiences.slice(1)] });
            }}
          />
        </label>
        <label>
          핵심 가치
          <textarea
            ref={primaryValueRef}
            value={core.valueProposition.primary}
            disabled={disabled}
            onChange={(event) => onChange({
              ...core,
              valueProposition: { ...core.valueProposition, primary: event.target.value },
            })}
          />
        </label>
        <label>
          브랜드 방향성
          <textarea
            ref={directionRef}
            value={core.messaging.brandDirection}
            disabled={disabled}
            onChange={(event) => onChange({
              ...core,
              messaging: { ...core.messaging, brandDirection: event.target.value },
            })}
          />
        </label>
        {version.evidence.length > 0 && (
          <details className="brand-evidence-drawer">
            <summary>근거 {version.evidence.length}개 확인</summary>
            {version.evidence.map((item, index) => (
              <article key={`${item.fieldPath}-${index}`}>
                <strong>{item.fieldPath}</strong>
                <p>{item.excerpt}</p>
                {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer">원문 열기</a>}
                <small>신뢰도는 참고 신호이며 제품 사실을 보증하지 않습니다.</small>
              </article>
            ))}
          </details>
        )}
        {!disabled && (
          <>
            {validationMessage && <p className="form-error" role="alert">{validationMessage}</p>}
            <div className="form-actions">
              <button className="button" type="button" disabled={saving} onClick={onSave}>초안 저장</button>
              <button className="button primary" type="button" disabled={saving} onClick={validateAndApprove}>Brand Core 승인</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
