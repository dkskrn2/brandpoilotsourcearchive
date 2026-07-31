import { useLayoutEffect, useRef } from "react";
import type {
  BrandIntelligenceResult,
  BrandIntelligenceResultV2,
  BrandOfferingV2,
} from "../../features/brand-intelligence/types";
import type { ContentCategory } from "../../types";
import { Alert } from "../ui/Alert";

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "auto";
  if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange(value: string): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (textareaRef.current) resizeTextarea(textareaRef.current);
  }, [value]);
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      <textarea
        ref={textareaRef}
        className="auto-resize-textarea"
        rows={3}
        style={{ overflowY: "hidden" }}
        value={value ?? ""}
        onInput={(event) => resizeTextarea(event.currentTarget)}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function OfferingEditor({
  offering,
  index,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveDown,
}: {
  offering: BrandOfferingV2;
  index: number;
  onChange(offering: BrandOfferingV2): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  canMoveDown: boolean;
}) {
  const field = (key: keyof BrandOfferingV2, value: string) => {
    onChange({ ...offering, [key]: value || null });
  };
  return (
    <article className="brand-offering-editor">
      <div className="brand-category-fields">
        <label className="field-stack">
          <span className="field-label">유형</span>
          <select value={offering.kind} onChange={(event) => onChange({ ...offering, kind: event.target.value as "product" | "service" })}>
            <option value="product">제품</option>
            <option value="service">서비스</option>
          </select>
        </label>
        <label className="field-stack">
          <span className="field-label">이름</span>
          <input aria-label={`대표 상품 ${index + 1} 이름`} value={offering.name} onChange={(event) => onChange({ ...offering, name: event.target.value })} />
        </label>
      </div>
      <TextField label="설명" value={offering.description} onChange={(value) => field("description", value)} />
      <TextField label="대상 고객" value={offering.target} onChange={(value) => field("target", value)} />
      <TextField label="핵심 효익" value={offering.benefit} onChange={(value) => field("benefit", value)} />
      <div className="brand-category-fields">
        <label className="field-stack"><span className="field-label">가격</span><input value={offering.priceText ?? ""} onChange={(event) => field("priceText", event.target.value)} /></label>
        <label className="field-stack"><span className="field-label">구매 URL</span><input value={offering.purchaseUrl ?? ""} onChange={(event) => field("purchaseUrl", event.target.value)} /></label>
      </div>
      <div className="form-actions">
        <button type="button" className="button" disabled={index === 0} onClick={onMoveUp}>위로</button>
        <button type="button" className="button" disabled={!canMoveDown} onClick={onMoveDown}>아래로</button>
        <button type="button" className="button" onClick={onRemove}>삭제</button>
      </div>
    </article>
  );
}

export function BrandAnalysisReviewStep({
  companyName,
  draft,
  saving,
  error,
  onCompanyNameChange,
  onChange,
  onConfirm,
  categories = [],
}: {
  companyName?: string;
  draft: BrandIntelligenceResult;
  saving: boolean;
  error: string | null;
  onCompanyNameChange?(value: string): void;
  onChange(value: BrandIntelligenceResult): void;
  onConfirm(): Promise<void>;
  categories?: ContentCategory[];
}) {
  const isV2 = draft.contractVersion === "brand-intelligence-result.v2";
  const primaryCategory = draft.primaryCategory ?? { code: null, name: "" };
  const selectedCategory = categories.find((category) => category.code === primaryCategory.code);
  const differentiators = isV2 ? draft.differentiators.join("\n") : draft.differentiators;
  const required = [
    draft.companyOverview,
    draft.businessDescription,
    primaryCategory.name,
    draft.primaryTarget,
    differentiators,
    draft.coreAppeal,
    ...(isV2 ? [draft.valueProposition] : []),
  ];
  const canConfirm = required.every((value) => Boolean(value?.trim()))
    && (categories.length === 0 || Boolean(primaryCategory.code))
    && (!isV2 || (
      draft.offerings.length <= 5
      && draft.offerings.every((offering) => Boolean(offering.name.trim()))
    ));

  const updateText = (
    key: "companyOverview" | "businessDescription" | "primaryTarget" | "coreAppeal",
    value: string,
  ) => onChange({ ...draft, [key]: value });
  const updateCategory = (value: { code: string | null; name: string }) => (
    onChange({ ...draft, primaryCategory: value })
  );
  const updateDifferentiators = (value: string) => {
    onChange({
      ...draft,
      differentiators: isV2
        ? value.split("\n").map((item) => item.trim()).filter(Boolean)
        : value,
    } as BrandIntelligenceResult);
  };

  const updateV2 = <K extends keyof BrandIntelligenceResultV2>(
    key: K,
    value: BrandIntelligenceResultV2[K],
  ) => {
    if (draft.contractVersion === "brand-intelligence-result.v2") {
      onChange({ ...draft, [key]: value });
    }
  };

  return (
    <section className="brand-intelligence-review brand-intelligence-review--wide">
      <section className="panel brand-intelligence-step">
        <div className="panel-head"><h2>분석 결과 확인</h2></div>
        <div className="panel-body brand-review-fields">
          {companyName !== undefined && onCompanyNameChange && (
            <label className="field-stack">
              <span className="field-label">회사명</span>
              <input
                value={companyName}
                maxLength={100}
                onChange={(event) => onCompanyNameChange(event.currentTarget.value)}
              />
            </label>
          )}
          {isV2 && <TextField label="한 줄 정의" value={draft.oneLineDefinition} onChange={(value) => updateV2("oneLineDefinition", value)} />}
          <TextField label="기업 개요" value={draft.companyOverview} onChange={(value) => updateText("companyOverview", value)} />
          <TextField label="사업 소개" value={draft.businessDescription} onChange={(value) => updateText("businessDescription", value)} />
          <div className="brand-category-fields">
            <label className="field-stack">
              <span className="field-label">대표 분야</span>
              {categories.length ? (
                <select
                  aria-label="분석 결과 대표 분야"
                  value={primaryCategory.code ?? ""}
                  onChange={(event) => {
                    const category = categories.find((item) => item.code === event.target.value);
                    if (!category) return;
                    const allowed = new Set(category.subcategories.map((item) => item.code));
                    onChange({
                      ...draft,
                      primaryCategory: { code: category.code, name: category.name },
                      subcategories: draft.subcategories.filter((item) => item.code === null
                        || (item.code !== null && allowed.has(item.code))),
                    });
                  }}
                >
                  <option value="">대표 분야를 선택하세요</option>
                  {categories.map((category) => <option key={category.code} value={category.code}>{category.name}</option>)}
                </select>
              ) : (
                <input value={primaryCategory.name} onChange={(event) => updateCategory({ ...primaryCategory, name: event.target.value })} />
              )}
              {categories.length && !primaryCategory.code && primaryCategory.name
                ? <small>분석 제안: {primaryCategory.name}</small>
                : null}
            </label>
            <label className="field-stack">
              <span className="field-label">직접 입력 세부 분야</span>
              <input
                value={draft.subcategories
                  .filter((item) => categories.length === 0 || item.code === null)
                  .map((item) => item.name).join(", ")}
                onChange={(event) => onChange({
                  ...draft,
                  subcategories: [
                    ...(categories.length
                      ? draft.subcategories.filter((item) => item.code !== null)
                      : []),
                    ...event.target.value.split(",").map((name) => name.trim()).filter(Boolean)
                      .map((name) => ({ code: null, name })),
                  ],
                })}
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
                      onChange={() => onChange({
                        ...draft,
                        subcategories: selected
                          ? draft.subcategories.filter((item) => item.code !== subcategory.code)
                          : [...draft.subcategories, { code: subcategory.code, name: subcategory.name }],
                      })}
                    />
                    <span>{subcategory.name}</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <TextField label="핵심 타깃" value={draft.primaryTarget} onChange={(value) => updateText("primaryTarget", value)} />
          {draft.contractVersion === "brand-intelligence-result.v2" && (
            <>
              <TextField label="보조 타깃 (한 줄에 하나)" value={draft.secondaryTargets.join("\n")} onChange={(value) => updateV2("secondaryTargets", value.split("\n").map((item) => item.trim()).filter(Boolean))} />
              <TextField label="고객 니즈 (한 줄에 하나)" value={draft.customerNeeds.join("\n")} onChange={(value) => updateV2("customerNeeds", value.split("\n").map((item) => item.trim()).filter(Boolean))} />
              <TextField label="가치 제안" value={draft.valueProposition} onChange={(value) => updateV2("valueProposition", value)} />
            </>
          )}
          <TextField label="차별점 (한 줄에 하나)" value={differentiators} onChange={updateDifferentiators} />
          <TextField label="핵심 소구점" value={draft.coreAppeal} onChange={(value) => updateText("coreAppeal", value)} />
          {draft.contractVersion === "brand-intelligence-result.v2" && (
            <>
              <TextField label="보조 소구점 (한 줄에 하나)" value={draft.supportingAppeals.join("\n")} onChange={(value) => updateV2("supportingAppeals", value.split("\n").map((item) => item.trim()).filter(Boolean))} />
              <TextField label="핵심 키워드 (한 줄에 하나)" value={draft.keywords.join("\n")} onChange={(value) => updateV2("keywords", value.split("\n").map((item) => item.trim()).filter(Boolean))} />
              <TextField
                label="관찰된 브랜드 톤"
                value={draft.observedTone?.summary ?? ""}
                onChange={(value) => updateV2("observedTone", value
                  ? { summary: value, sourceFactIds: draft.observedTone?.sourceFactIds ?? [] }
                  : null)}
              />
            </>
          )}
        </div>
      </section>

      {draft.contractVersion === "brand-intelligence-result.v2" && (
        <section className="panel">
          <div className="panel-head"><h2>대표 상품·서비스 ({draft.offerings.length}/5)</h2></div>
          <div className="panel-body brand-review-fields">
            {draft.offerings.map((offering, index) => (
              <OfferingEditor
                key={`${offering.name}-${index}`}
                offering={offering}
                index={index}
                onChange={(next) => updateV2("offerings", draft.offerings.map((item, itemIndex) => itemIndex === index ? next : item))}
                onRemove={() => updateV2("offerings", draft.offerings.filter((_item, itemIndex) => itemIndex !== index))}
                onMoveUp={() => {
                  if (index === 0) return;
                  const next = [...draft.offerings];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  updateV2("offerings", next);
                }}
                onMoveDown={() => {
                  if (index === draft.offerings.length - 1) return;
                  const next = [...draft.offerings];
                  [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                  updateV2("offerings", next);
                }}
                canMoveDown={index < draft.offerings.length - 1}
              />
            ))}
            {draft.offerings.length < 5 && (
              <button type="button" className="button" onClick={() => updateV2("offerings", [...draft.offerings, {
                kind: "product",
                name: "",
                description: null,
                target: null,
                benefit: null,
                priceText: null,
                purchaseUrl: null,
                sourceFactIds: [],
              }])}>상품·서비스 추가</button>
            )}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-head"><h2>경쟁사</h2></div>
        <div className="panel-body brand-review-fields">
          {draft.competitors.map((competitor, index) => (
            <article key={`${competitor.name}-${index}`}>
              <label className="field-stack">
                <span className="field-label">경쟁사 {index + 1} 이름</span>
                <input value={competitor.name} onChange={(event) => onChange({
                  ...draft,
                  competitors: draft.competitors.map((item, itemIndex) => itemIndex === index
                    ? { ...item, name: event.target.value }
                    : item),
                })} />
              </label>
              <TextField label="설명" value={competitor.description} onChange={(value) => onChange({
                ...draft,
                competitors: draft.competitors.map((item, itemIndex) => itemIndex === index
                  ? { ...item, description: value }
                  : item),
              })} />
              <p>{competitor.sourceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">근거 보기</a>)}</p>
            </article>
          ))}
        </div>
      </section>

      {error && <Alert title="저장하지 못했습니다" variant="bad">{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="button primary" disabled={!canConfirm || saving} onClick={() => void onConfirm()}>
          {saving ? "저장하는 중" : "확인하고 저장"}
        </button>
      </div>
    </section>
  );
}
