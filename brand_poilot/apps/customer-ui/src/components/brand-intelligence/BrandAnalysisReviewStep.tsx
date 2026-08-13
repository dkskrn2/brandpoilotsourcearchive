import { useLayoutEffect, useRef, useState } from "react";
import {
  BadgeInfo,
  Building2,
  MessageSquareText,
  Package,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import type {
  BrandIntelligenceResult,
  BrandIntelligenceResultV2,
  BrandOfferingV2,
} from "../../features/brand-intelligence/types";
import type { ContentCategory } from "../../types";
import { Alert } from "../ui/Alert";

type ReviewSection = "core" | "customer" | "message" | "offerings" | "competitors";

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

  return (
    <textarea
      {...props}
      ref={textareaRef}
      className={`auto-resize-textarea ${props.className ?? ""}`.trim()}
      style={{ ...props.style, overflowY: "hidden" }}
      value={value}
      onInput={(event) => resizeTextarea(event.currentTarget)}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function TextField({
  label,
  value,
  onChange,
  ariaLabel,
  rows = 3,
}: {
  label: string;
  value: string | null;
  onChange(value: string): void;
  ariaLabel?: string;
  rows?: number;
}) {
  return (
    <label className="field-stack">
      <span className="field-label">{label}</span>
      <AutoResizeTextarea
        aria-label={ariaLabel}
        rows={rows}
        value={value ?? ""}
        onChange={onChange}
      />
    </label>
  );
}

function EditableTextList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange(items: string[]): void;
}) {
  const headingId = `brand-review-list-${label.replace(/\s+/g, "-")}`;

  return (
    <section className="brand-review-list-field" aria-labelledby={headingId}>
      <div className="brand-review-list-head">
        <div>
          <h3 id={headingId}>{label}</h3>
          <p>각 항목을 따로 확인하고 바로 수정할 수 있습니다.</p>
        </div>
        <button
          type="button"
          className="button subtle"
          aria-label={`${label} 항목 추가`}
          onClick={() => onChange([...items, ""])}
        >
          <Plus size={16} aria-hidden="true" /> 항목 추가
        </button>
      </div>
      <div className="brand-review-list-items">
        {items.length === 0 ? <p className="muted">등록된 항목이 없습니다.</p> : null}
        {items.map((item, index) => (
          <div className="brand-review-list-row" key={index}>
            <span className="brand-review-list-index" aria-hidden="true">{index + 1}</span>
            <AutoResizeTextarea
              aria-label={`${label} ${index + 1}`}
              className="brand-review-list-input"
              rows={2}
              value={item}
              onChange={(value) => onChange(items.map((current, currentIndex) => (
                currentIndex === index ? value : current
              )))}
              onBlur={() => {
                const normalized = item.normalize("NFKC").trim();
                if (!normalized) {
                  onChange(items.filter((_current, currentIndex) => currentIndex !== index));
                  return;
                }
                if (normalized !== item) {
                  onChange(items.map((current, currentIndex) => (
                    currentIndex === index ? normalized : current
                  )));
                }
              }}
            />
            <button
              type="button"
              className="button icon-button subtle"
              aria-label={`${label} ${index + 1} 삭제`}
              onClick={() => onChange(items.filter((_current, currentIndex) => currentIndex !== index))}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function OfferingEditor({
  offering,
  index,
  onChange,
  onRemove,
}: {
  offering: BrandOfferingV2;
  index: number;
  onChange(offering: BrandOfferingV2): void;
  onRemove(): void;
}) {
  const itemNumber = index + 1;
  const field = (key: keyof BrandOfferingV2, value: string) => {
    onChange({ ...offering, [key]: value || null });
  };

  return (
    <article className="brand-offering-editor">
      <div className="brand-review-item-title">
        <span>{itemNumber}</span>
        <strong>{offering.kind === "product" ? "상품" : "서비스"}</strong>
        <button
          type="button"
          className="button icon-button subtle"
          aria-label={`대표 상품 ${itemNumber} 삭제`}
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="brand-category-fields">
        <label className="field-stack">
          <span className="field-label">유형</span>
          <select
            aria-label={`대표 상품 ${itemNumber} 유형`}
            value={offering.kind}
            onChange={(event) => onChange({
              ...offering,
              kind: event.currentTarget.value as "product" | "service",
            })}
          >
            <option value="product">제품</option>
            <option value="service">서비스</option>
          </select>
        </label>
        <label className="field-stack">
          <span className="field-label">이름</span>
          <input
            aria-label={`대표 상품 ${itemNumber} 이름`}
            value={offering.name}
            onChange={(event) => onChange({ ...offering, name: event.currentTarget.value })}
          />
        </label>
      </div>
      <TextField
        label="설명"
        ariaLabel={`대표 상품 ${itemNumber} 설명`}
        value={offering.description}
        onChange={(value) => field("description", value)}
      />
      <TextField
        label="대상 고객"
        ariaLabel={`대표 상품 ${itemNumber} 대상 고객`}
        value={offering.target}
        onChange={(value) => field("target", value)}
      />
      <TextField
        label="핵심 효익"
        ariaLabel={`대표 상품 ${itemNumber} 핵심 효익`}
        value={offering.benefit}
        onChange={(value) => field("benefit", value)}
      />
      <div className="brand-category-fields">
        <label className="field-stack">
          <span className="field-label">가격</span>
          <input
            aria-label={`대표 상품 ${itemNumber} 가격`}
            value={offering.priceText ?? ""}
            onChange={(event) => field("priceText", event.currentTarget.value)}
          />
        </label>
        <label className="field-stack">
          <span className="field-label">구매 URL</span>
          <input
            aria-label={`대표 상품 ${itemNumber} 구매 URL`}
            value={offering.purchaseUrl ?? ""}
            onChange={(event) => field("purchaseUrl", event.currentTarget.value)}
          />
        </label>
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
  const [activeSection, setActiveSection] = useState<ReviewSection>("core");
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
  const arrayFieldsValid = !isV2 || [
    draft.secondaryTargets,
    draft.customerNeeds,
    draft.differentiators,
    draft.supportingAppeals,
    draft.keywords,
  ].every((items) => items.every((item) => Boolean(item.trim())));
  const canConfirm = required.every((value) => Boolean(value?.trim()))
    && (categories.length === 0 || Boolean(primaryCategory.code))
    && arrayFieldsValid
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
  const updateV2 = <K extends keyof BrandIntelligenceResultV2>(
    key: K,
    value: BrandIntelligenceResultV2[K],
  ) => {
    if (draft.contractVersion === "brand-intelligence-result.v2") {
      onChange({ ...draft, [key]: value });
    }
  };
  const sections: Array<{
    id: ReviewSection;
    label: string;
    icon: typeof BadgeInfo;
  }> = [
    { id: "core", label: "브랜드 핵심", icon: BadgeInfo },
    { id: "customer", label: "고객·니즈", icon: Target },
    { id: "message", label: "가치·소구", icon: MessageSquareText },
    ...(isV2 ? [{ id: "offerings" as const, label: "상품·서비스", icon: Package }] : []),
    { id: "competitors", label: "경쟁사", icon: Building2 },
  ];

  return (
    <section className="brand-intelligence-review brand-intelligence-review--wide">
      <div className="panel brand-review-shell">
        <nav className="brand-review-nav" aria-label="분석 결과 항목" role="tablist">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              role="tab"
              id={`brand-review-tab-${id}`}
              aria-controls={`brand-review-panel-${id}`}
              aria-selected={activeSection === id}
              className={activeSection === id ? "is-active" : ""}
              onClick={() => setActiveSection(id)}
              key={id}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="brand-review-workspace">
          <header className="brand-review-heading">
            <div>
              <span className="brand-center-eyebrow">AI ANALYSIS</span>
              <h2>분석 결과 확인</h2>
              <p>분석된 내용을 확인하고 필요한 항목을 바로 수정해 주세요.</p>
            </div>
          </header>

          <section
            className="brand-review-panel"
            id="brand-review-panel-core"
            role="tabpanel"
            aria-labelledby="brand-review-tab-core"
            hidden={activeSection !== "core"}
          >
            <div className="brand-review-section-head">
              <div><h2>브랜드 핵심</h2><p>브랜드를 설명하는 기본 정보를 확인합니다.</p></div>
            </div>
            <div className="brand-review-fields">
              {companyName !== undefined && onCompanyNameChange ? (
                <label className="field-stack">
                  <span className="field-label">회사명</span>
                  <input
                    value={companyName}
                    maxLength={100}
                    onChange={(event) => onCompanyNameChange(event.currentTarget.value)}
                  />
                </label>
              ) : null}
              {isV2 ? (
                <TextField
                  label="한 줄 정의"
                  value={draft.oneLineDefinition}
                  onChange={(value) => updateV2("oneLineDefinition", value)}
                />
              ) : null}
              <TextField
                label="기업 개요"
                value={draft.companyOverview}
                onChange={(value) => updateText("companyOverview", value)}
              />
              <TextField
                label="사업 소개"
                value={draft.businessDescription}
                onChange={(value) => updateText("businessDescription", value)}
              />
              <div className="brand-category-fields">
                <label className="field-stack">
                  <span className="field-label">대표 분야</span>
                  {categories.length ? (
                    <select
                      aria-label="분석 결과 대표 분야"
                      value={primaryCategory.code ?? ""}
                      onChange={(event) => {
                        const category = categories.find((item) => item.code === event.currentTarget.value);
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
                      {categories.map((category) => (
                        <option key={category.code} value={category.code}>{category.name}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={primaryCategory.name}
                      onChange={(event) => updateCategory({
                        ...primaryCategory,
                        name: event.currentTarget.value,
                      })}
                    />
                  )}
                  {categories.length && !primaryCategory.code && primaryCategory.name
                    ? <small>분석 제안: {primaryCategory.name}</small>
                    : null}
                </label>
                <label className="field-stack">
                  <span className="field-label">직접 입력 세부 분야</span>
                  <input
                    aria-label="직접 입력 세부 분야"
                    value={draft.subcategories
                      .filter((item) => categories.length === 0 || item.code === null)
                      .map((item) => item.name).join(", ")}
                    onChange={(event) => onChange({
                      ...draft,
                      subcategories: [
                        ...(categories.length
                          ? draft.subcategories.filter((item) => item.code !== null)
                          : []),
                        ...event.currentTarget.value.split(",").map((name) => name.trim())
                          .filter(Boolean).map((name) => ({ code: null, name })),
                      ],
                    })}
                    placeholder="쉼표로 구분"
                  />
                  {categories.length ? <small>목록에 없는 분야만 입력하세요.</small> : null}
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
            </div>
          </section>

          <section
            className="brand-review-panel"
            id="brand-review-panel-customer"
            role="tabpanel"
            aria-labelledby="brand-review-tab-customer"
            hidden={activeSection !== "customer"}
          >
            <div className="brand-review-section-head">
              <div><h2>고객·니즈</h2><p>브랜드가 가장 중요하게 바라보는 고객과 요구를 확인합니다.</p></div>
            </div>
            <div className="brand-review-fields">
              <TextField
                label="핵심 타깃"
                value={draft.primaryTarget}
                onChange={(value) => updateText("primaryTarget", value)}
              />
              {isV2 ? (
                <>
                  <EditableTextList
                    label="보조 타깃"
                    items={draft.secondaryTargets}
                    onChange={(value) => updateV2("secondaryTargets", value)}
                  />
                  <EditableTextList
                    label="고객 니즈"
                    items={draft.customerNeeds}
                    onChange={(value) => updateV2("customerNeeds", value)}
                  />
                </>
              ) : null}
            </div>
          </section>

          <section
            className="brand-review-panel"
            id="brand-review-panel-message"
            role="tabpanel"
            aria-labelledby="brand-review-tab-message"
            hidden={activeSection !== "message"}
          >
            <div className="brand-review-section-head">
              <div><h2>가치·소구</h2><p>브랜드의 가치, 차별점, 표현 기준을 확인합니다.</p></div>
            </div>
            <div className="brand-review-fields">
              {isV2 ? (
                <TextField
                  label="가치 제안"
                  value={draft.valueProposition}
                  onChange={(value) => updateV2("valueProposition", value)}
                />
              ) : null}
              {isV2 ? (
                <EditableTextList
                  label="차별점"
                  items={draft.differentiators}
                  onChange={(value) => updateV2("differentiators", value)}
                />
              ) : (
                <TextField
                  label="차별점"
                  value={draft.differentiators}
                  onChange={(value) => onChange({ ...draft, differentiators: value })}
                />
              )}
              <TextField
                label="핵심 소구점"
                value={draft.coreAppeal}
                onChange={(value) => updateText("coreAppeal", value)}
              />
              {isV2 ? (
                <>
                  <EditableTextList
                    label="보조 소구점"
                    items={draft.supportingAppeals}
                    onChange={(value) => updateV2("supportingAppeals", value)}
                  />
                  <EditableTextList
                    label="핵심 키워드"
                    items={draft.keywords}
                    onChange={(value) => updateV2("keywords", value)}
                  />
                  <TextField
                    label="관찰된 브랜드 톤"
                    value={draft.observedTone?.summary ?? ""}
                    onChange={(value) => updateV2("observedTone", value
                      ? { summary: value, sourceFactIds: draft.observedTone?.sourceFactIds ?? [] }
                      : null)}
                  />
                </>
              ) : null}
            </div>
          </section>

          {isV2 ? (
            <section
              className="brand-review-panel"
              id="brand-review-panel-offerings"
              role="tabpanel"
              aria-labelledby="brand-review-tab-offerings"
              hidden={activeSection !== "offerings"}
            >
              <div className="brand-review-section-head">
                <div><h2>대표 상품·서비스</h2><p>분석에서 확인한 항목을 그대로 검토하고 수정합니다.</p></div>
                <span className="brand-review-count">{draft.offerings.length}/5</span>
              </div>
              <div className="brand-review-offerings">
                {draft.offerings.length === 0
                  ? <p className="muted">확인된 대표 상품·서비스가 없습니다.</p>
                  : null}
                {draft.offerings.map((offering, index) => (
                  <OfferingEditor
                    key={`${offering.name}-${index}`}
                    offering={offering}
                    index={index}
                    onChange={(next) => updateV2("offerings", draft.offerings.map(
                      (item, itemIndex) => itemIndex === index ? next : item,
                    ))}
                    onRemove={() => updateV2("offerings", draft.offerings.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ))}
                  />
                ))}
                {draft.offerings.length < 5 ? (
                  <button
                    type="button"
                    className="button brand-review-add-button"
                    onClick={() => updateV2("offerings", [...draft.offerings, {
                      kind: "product",
                      name: "",
                      description: null,
                      target: null,
                      benefit: null,
                      priceText: null,
                      purchaseUrl: null,
                      sourceFactIds: [],
                    }])}
                  >
                    <Plus size={16} aria-hidden="true" /> 상품·서비스 추가
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          <section
            className="brand-review-panel"
            id="brand-review-panel-competitors"
            role="tabpanel"
            aria-labelledby="brand-review-tab-competitors"
            hidden={activeSection !== "competitors"}
          >
            <div className="brand-review-section-head">
              <div><h2>경쟁사</h2><p>분석에서 확인된 경쟁사와 근거를 검토합니다.</p></div>
            </div>
            <div className="brand-review-competitors">
              {draft.competitors.length === 0
                ? <p className="muted">확인된 경쟁사가 없습니다.</p>
                : null}
              {draft.competitors.map((competitor, index) => (
                <article key={`${competitor.name}-${index}`}>
                  <label className="field-stack">
                    <span className="field-label">경쟁사 {index + 1} 이름</span>
                    <input
                      value={competitor.name}
                      onChange={(event) => onChange({
                        ...draft,
                        competitors: draft.competitors.map((item, itemIndex) => itemIndex === index
                          ? { ...item, name: event.currentTarget.value }
                          : item),
                      })}
                    />
                  </label>
                  <TextField
                    label="설명"
                    ariaLabel={`경쟁사 ${index + 1} 설명`}
                    value={competitor.description}
                    onChange={(value) => onChange({
                      ...draft,
                      competitors: draft.competitors.map((item, itemIndex) => itemIndex === index
                        ? { ...item, description: value }
                        : item),
                    })}
                  />
                  {competitor.sourceUrls.length ? (
                    <div className="evidence-links">
                      {competitor.sourceUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">근거 보기</a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <footer className="brand-review-savebar">
            <div>{error ? <Alert title="저장하지 못했습니다" variant="bad">{error}</Alert> : null}</div>
            <button
              type="button"
              className="button primary"
              disabled={!canConfirm || saving}
              onClick={() => void onConfirm()}
            >
              {saving ? "저장하는 중" : "확인하고 저장"}
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}
