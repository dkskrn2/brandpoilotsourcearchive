import { useEffect, useRef, useState } from "react";
import { isBrandCoreComplete } from "../../features/brand-center-preview/previewReducer";
import type { PreviewBrandCore } from "../../features/brand-center-preview/types";

interface BrandCorePreviewEditorProps {
  brandCore: PreviewBrandCore;
  approved: boolean;
  onChange(brandCore: PreviewBrandCore): void;
  onApprove(): void;
}

type ScalarKey =
  | "oneLine"
  | "description"
  | "target"
  | "customerProblem"
  | "primaryValue";
type ArrayKey = "differentiators" | "tone" | "priorityMessages";

const scalarFields: Array<{ key: ScalarKey; label: string }> = [
  { key: "oneLine", label: "한 줄 정의" },
  { key: "description", label: "브랜드 설명" },
  { key: "target", label: "타깃 고객" },
  { key: "customerProblem", label: "고객 문제" },
  { key: "primaryValue", label: "핵심 가치" },
];

const arrayFields: Array<{ key: ArrayKey; label: string }> = [
  { key: "differentiators", label: "차별점" },
  { key: "tone", label: "톤앤매너" },
  { key: "priorityMessages", label: "우선 메시지" },
];

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function BrandCorePreviewEditor({
  brandCore,
  approved,
  onChange,
  onApprove,
}: BrandCorePreviewEditorProps) {
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
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
  }, [
    brandCore.differentiators,
    brandCore.tone,
    brandCore.priorityMessages,
  ]);

  function approve() {
    const normalizedCore: PreviewBrandCore = {
      ...brandCore,
      differentiators: toLines(arrayDrafts.differentiators),
      tone: toLines(arrayDrafts.tone),
      priorityMessages: toLines(arrayDrafts.priorityMessages),
    };
    setArrayDrafts({
      differentiators: normalizedCore.differentiators.join("\n"),
      tone: normalizedCore.tone.join("\n"),
      priorityMessages: normalizedCore.priorityMessages.join("\n"),
    });
    onChange(normalizedCore);
    const nextErrors: Record<string, string> = {};
    for (const { key, label } of scalarFields) {
      if (!normalizedCore[key].trim()) {
        nextErrors[key] = key === "oneLine"
          ? "한 줄 정의를 입력해 주세요."
          : `${label}을 입력해 주세요.`;
      }
    }
    for (const { key, label } of arrayFields) {
      if (!normalizedCore[key].some((value) => value.trim())) {
        nextErrors[key] = `${label}을(를) 한 개 이상 입력해 주세요.`;
      }
    }
    setErrors(nextErrors);
    const firstInvalid = [...scalarFields, ...arrayFields]
      .find(({ key }) => nextErrors[key]);
    if (firstInvalid) {
      fields.current[firstInvalid.key]?.focus();
      return;
    }
    if (isBrandCoreComplete(normalizedCore)) onApprove();
  }

  return (
    <section className="brand-center-preview__review-section" aria-labelledby="brand-core-preview-title">
      <div className="brand-center-preview__section-heading">
        <div>
          <p className="brand-center-preview__eyebrow">BRAND CORE</p>
          <h3 id="brand-core-preview-title">브랜드 핵심 기준</h3>
        </div>
        <span className={approved ? "brand-center-preview__status is-approved" : "brand-center-preview__status"}>
          {approved ? "승인됨" : "검토 필요"}
        </span>
      </div>
      <div className="brand-center-preview__core-fields">
        {scalarFields.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <textarea
              ref={(node) => {
                fields.current[key] = node;
              }}
              aria-label={label}
              rows={key === "description" ? 3 : 2}
              value={brandCore[key]}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `brand-core-${key}-error` : undefined}
              onChange={(event) => {
                setErrors((current) => ({ ...current, [key]: "" }));
                onChange({ ...brandCore, [key]: event.target.value });
              }}
            />
            {errors[key] ? (
              <small id={`brand-core-${key}-error`} className="brand-center-preview__field-error">
                {errors[key]}
              </small>
            ) : null}
          </label>
        ))}
        {arrayFields.map(({ key, label }) => (
          <label key={key}>
            <span>{label}</span>
            <textarea
              ref={(node) => {
                fields.current[key] = node;
              }}
              aria-label={label}
              rows={3}
              value={arrayDrafts[key]}
              aria-invalid={Boolean(errors[key])}
              aria-describedby={errors[key] ? `brand-core-${key}-error` : undefined}
              onChange={(event) => {
                setErrors((current) => ({ ...current, [key]: "" }));
                setArrayDrafts((current) => ({
                  ...current,
                  [key]: event.target.value,
                }));
                onChange(brandCore);
              }}
              onBlur={() => {
                const lines = toLines(arrayDrafts[key]);
                setArrayDrafts((current) => ({
                  ...current,
                  [key]: lines.join("\n"),
                }));
                onChange({ ...brandCore, [key]: lines });
              }}
            />
            <small>한 줄에 한 항목씩 입력해 주세요.</small>
            {errors[key] ? (
              <small id={`brand-core-${key}-error`} className="brand-center-preview__field-error">
                {errors[key]}
              </small>
            ) : null}
          </label>
        ))}
      </div>
      <div className="brand-center-preview__section-actions">
        <button className="brand-center-preview__primary-action" type="button" onClick={approve}>
          브랜드 코어 승인
        </button>
      </div>
    </section>
  );
}
