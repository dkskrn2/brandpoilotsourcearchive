import { useLayoutEffect, useRef } from "react";
import type { BrandIntelligenceResult } from "../../features/brand-intelligence/types";
import type { ContentCategory } from "../../types";
import { Alert } from "../ui/Alert";

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
}

function AutoResizeTextarea({
  value,
  onChange,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & {
  value: string;
  onChange(value: string): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [value]);

  useLayoutEffect(() => {
    const handleResize = () => {
      if (textareaRef.current) resizeTextarea(textareaRef.current);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <textarea
      {...props}
      ref={textareaRef}
      className={`auto-resize-textarea ${props.className ?? ""}`.trim()}
      style={{ ...props.style, overflowY: "hidden" }}
      value={value}
      onInput={(event) => resizeTextarea(event.currentTarget)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function NarrativeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      <AutoResizeTextarea rows={4} value={value} onChange={onChange} />
    </label>
  );
}

export function BrandAnalysisReviewStep({
  draft,
  saving,
  error,
  onChange,
  onConfirm,
  categories = [],
}: {
  draft: BrandIntelligenceResult;
  saving: boolean;
  error: string | null;
  onChange(value: BrandIntelligenceResult): void;
  onConfirm(): Promise<void>;
  categories?: ContentCategory[];
}) {
  const required = [draft.companyOverview, draft.businessDescription, draft.primaryTarget, draft.differentiators, draft.coreAppeal, draft.primaryCategory.name];
  const canConfirm = required.every((value) => value.trim())
    && (categories.length === 0 || Boolean(draft.primaryCategory.code));
  const selectedCategory = categories.find((category) => category.code === draft.primaryCategory.code);
  const update = <K extends keyof BrandIntelligenceResult>(key: K, value: BrandIntelligenceResult[K]) => (
    onChange({ ...draft, [key]: value })
  );
  return (
    <section className="brand-intelligence-review brand-intelligence-review--wide">
      <section className="panel brand-intelligence-step">
        <div className="panel-head"><h2>분석 결과 확인</h2></div>
        <div className="panel-body brand-review-fields">
          <NarrativeField label="기업 개요" value={draft.companyOverview} onChange={(value) => update("companyOverview", value)} />
          <NarrativeField label="사업 소개" value={draft.businessDescription} onChange={(value) => update("businessDescription", value)} />
          <div className="brand-category-fields">
            <label className="field-stack">
              <span className="field-label">대표 분야</span>
              {categories.length ? (
                <select
                  aria-label="분석 결과 대표 분야"
                  value={draft.primaryCategory.code ?? ""}
                  onChange={(event) => {
                    const category = categories.find((item) => item.code === event.target.value);
                    if (!category) return;
                    const allowed = new Map(category.subcategories.map((item) => [item.code, item]));
                    onChange({
                      ...draft,
                      primaryCategory: { code: category.code, name: category.name },
                      subcategories: draft.subcategories.filter((item) => item.code === null || (item.code && allowed.has(item.code))),
                    });
                  }}
                >
                  <option value="">대표 분야를 선택하세요</option>
                  {categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}
                </select>
              ) : (
                <input value={draft.primaryCategory.name} onChange={(event) => update("primaryCategory", { ...draft.primaryCategory, name: event.target.value })} />
              )}
              {categories.length && !draft.primaryCategory.code && draft.primaryCategory.name ? <small>분석 제안: {draft.primaryCategory.name}</small> : null}
            </label>
            <label className="field-stack">
              <span className="field-label">직접 입력 세부 분야</span>
              <input
                value={draft.subcategories.filter((item) => item.code === null).map((item) => item.name).join(", ")}
                onChange={(event) => update("subcategories", [
                  ...draft.subcategories.filter((item) => item.code !== null),
                  ...event.target.value.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ code: null, name })),
                ])}
                placeholder="쉼표로 구분"
              />
            </label>
          </div>
          {selectedCategory?.subcategories.length ? (
            <fieldset className="brand-subcategory-options">
              <legend>세부 분야 선택</legend>
              {selectedCategory.subcategories.map((subcategory) => {
                const selected = draft.subcategories.some((item) => item.code === subcategory.code);
                return (
                  <label key={subcategory.code}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => update("subcategories", selected
                        ? draft.subcategories.filter((item) => item.code !== subcategory.code)
                        : [...draft.subcategories, { code: subcategory.code, name: subcategory.name }])}
                    />
                    <span>{subcategory.name}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <NarrativeField label="핵심 타깃" value={draft.primaryTarget} onChange={(value) => update("primaryTarget", value)} />
          <NarrativeField label="차별점" value={draft.differentiators} onChange={(value) => update("differentiators", value)} />
          <NarrativeField label="핵심 소구점" value={draft.coreAppeal} onChange={(value) => update("coreAppeal", value)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>경쟁사와 근거</h2></div>
        <div className="panel-body brand-competitor-list">
          {draft.competitors.length === 0 ? <p className="muted">확인된 경쟁사가 없습니다.</p> : draft.competitors.map((competitor, index) => (
            <article key={`${competitor.name}-${index}`}>
              <input
                aria-label={`경쟁사 ${index + 1} 이름`}
                value={competitor.name}
                onChange={(event) => update("competitors", draft.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
              />
              <AutoResizeTextarea
                aria-label={`경쟁사 ${index + 1} 설명`}
                rows={3}
                value={competitor.description}
                onChange={(value) => update("competitors", draft.competitors.map((item, itemIndex) => itemIndex === index ? { ...item, description: value } : item))}
              />
              <div className="evidence-links">{competitor.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">근거 보기</a>)}</div>
            </article>
          ))}
          {draft.sourceGaps.length > 0 && <Alert title="추가 확인이 필요한 정보" variant="info">{draft.sourceGaps.join(" · ")}</Alert>}
          {error && <Alert title="저장하지 못했습니다" variant="bad">{error}</Alert>}
          <div className="form-actions">
            <button type="button" className="button primary" disabled={!canConfirm || saving} onClick={() => void onConfirm()}>
              {saving ? "저장하는 중" : "확인하고 저장"}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
