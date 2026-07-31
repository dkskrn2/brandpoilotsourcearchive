import { useRef, useState } from "react";
import type { BrandCore, BrandCoreVersion } from "../../features/brand-center/types";

function FieldStatus({ version }: { version: BrandCoreVersion }) {
  const label = version.status === "approved"
    ? "승인됨"
    : version.status === "superseded"
      ? "대체됨"
      : "수정 초안";
  return <span className={`brand-field-status is-${version.status}`}>{label}</span>;
}

export function BrandCoreReviewPanel({
  version,
  saving,
  onChange,
  onSave,
  onApprove,
  onEdit,
  onCancel,
  dirty,
  editing,
}: {
  version: BrandCoreVersion;
  editing: boolean;
  saving: boolean;
  onChange(core: BrandCore): void;
  onSave(): void;
  onApprove(): void;
  onEdit(): void;
  onCancel(): void;
  dirty: boolean;
}) {
  const disabled = !editing || version.status !== "draft";
  const core = version.core;
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const companyOverview = core.companyOverview ?? core.summary.oneLine;
  const businessDescription = core.businessDescription ?? core.summary.description;
  const primaryCategory = core.primaryCategory ?? { code: null, name: "" };
  const subcategories = core.subcategories ?? [];
  const primaryTarget = core.primaryTarget ?? core.audiences[0]?.name ?? "";
  const differentiators = core.differentiators ?? core.valueProposition.differentiators;
  const coreAppeal = core.coreAppeal ?? core.valueProposition.primary;
  const companyOverviewRef = useRef<HTMLTextAreaElement>(null);
  const businessDescriptionRef = useRef<HTMLTextAreaElement>(null);
  const primaryCategoryRef = useRef<HTMLInputElement>(null);
  const primaryTargetRef = useRef<HTMLTextAreaElement>(null);
  const differentiatorsRef = useRef<HTMLTextAreaElement>(null);
  const coreAppealRef = useRef<HTMLTextAreaElement>(null);
  const validateAndApprove = () => {
    const fields = [
      { value: companyOverview, ref: companyOverviewRef },
      { value: businessDescription, ref: businessDescriptionRef },
      { value: primaryCategory.name, ref: primaryCategoryRef },
      { value: primaryTarget, ref: primaryTargetRef },
      { value: differentiators.join("\n"), ref: differentiatorsRef },
      { value: coreAppeal, ref: coreAppealRef },
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
      <div className="panel-head">
        <div>
          <span className="brand-center-eyebrow">BRAND CORE V{version.version}</span>
          <h2>
            {editing
              ? "변경 초안 검토"
              : version.status === "approved"
                ? "현재 승인된 Brand Core"
                : version.status === "superseded"
                  ? "이전 Brand Core"
                  : "저장된 변경 초안"}
          </h2>
        </div>
        <div className="brand-core-heading-actions">
          <FieldStatus version={version} />
          {!editing && version.status !== "superseded" ? (
            <button className="button primary" type="button" disabled={saving} onClick={onEdit}>
              브랜드 코어 수정
            </button>
          ) : null}
        </div>
      </div>
      <div className="panel-body brand-core-form">
        <label>
          기업 개요
          <textarea
            ref={companyOverviewRef}
            value={companyOverview}
            disabled={disabled}
            onChange={(event) => onChange({
              ...core,
              companyOverview: event.target.value,
              summary: { ...core.summary, oneLine: event.target.value },
            })}
          />
        </label>
        <label>
          사업 소개
          <textarea
            ref={businessDescriptionRef}
            value={businessDescription}
            disabled={disabled}
            onChange={(event) => onChange({
              ...core,
              businessDescription: event.target.value,
              summary: { ...core.summary, description: event.target.value },
            })}
          />
        </label>
        <div className="brand-core-category-fields">
          <label>
            대표 분야
            <input
              ref={primaryCategoryRef}
              value={primaryCategory.name}
              disabled={disabled}
              onChange={(event) => onChange({
                ...core,
                primaryCategory: { ...primaryCategory, name: event.target.value },
              })}
            />
          </label>
          <label>
            직접 입력 세부 분야
            <input
              value={subcategories.map((item) => item.name).join(", ")}
              disabled={disabled}
              onChange={(event) => onChange({
                ...core,
                subcategories: event.target.value.split(",")
                  .map((name) => name.normalize("NFKC").trim())
                  .filter(Boolean)
                  .map((name) => ({ code: null, name })),
              })}
            />
          </label>
        </div>
        <label>
          핵심 타깃
          <textarea
            ref={primaryTargetRef}
            value={primaryTarget}
            disabled={disabled}
            onChange={(event) => {
              const first = core.audiences[0] ?? { name: "", problem: "", desiredOutcome: "" };
              onChange({
                ...core,
                primaryTarget: event.target.value,
                audiences: [{ ...first, name: event.target.value }, ...core.audiences.slice(1)],
              });
            }}
          />
        </label>
        <label>
          차별점
          <textarea
            ref={differentiatorsRef}
            value={differentiators.join("\n")}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value.split("\n").map((item) => item.trim()).filter(Boolean);
              onChange({
                ...core,
                differentiators: next,
                valueProposition: { ...core.valueProposition, differentiators: next },
                messaging: { ...core.messaging, brandDirection: next.join("\n") },
              });
            }}
          />
        </label>
        <label>
          핵심 소구점
          <textarea
            ref={coreAppealRef}
            value={coreAppeal}
            disabled={disabled}
            onChange={(event) => onChange({
              ...core,
              coreAppeal: event.target.value,
              valueProposition: { ...core.valueProposition, primary: event.target.value },
            })}
          />
        </label>
        {editing && version.status === "draft" && (
          <>
            {validationMessage && <p className="form-error" role="alert">{validationMessage}</p>}
            <div className="form-actions">
              <button className="button primary" type="button" disabled={saving || !dirty} onClick={onSave}>저장</button>
              <button className="button" type="button" disabled={saving} onClick={onCancel}>취소</button>
              <button className="button primary" type="button" disabled={saving} onClick={validateAndApprove}>Brand Core 승인</button>
              {dirty ? <span className="brand-center-dirty">저장하지 않은 변경</span> : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
