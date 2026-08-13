import { useMemo, useState, type ReactNode } from "react";
import type { ContentPurposeV2 } from "../../features/ai-content/types";
import type { ProductServiceItem } from "../../features/libraries/libraryGateway";
import type {
  ContentSuggestion,
  ContentSuggestionIntent,
  ContentSuggestionList,
} from "../../features/content-suggestions/contentSuggestionGateway";
import { ContentSuggestionCards } from "../content-suggestions/ContentSuggestionCards";

export type ContentSubjectMode = "topic_text" | "topic_url" | "suggestion" | "reference";

export function isApprovedActiveProduct(item: ProductServiceItem) {
  return item.status === "active"
    && Boolean(item.activeVersionId)
    && item.activeVersion?.status === "approved";
}

function isHttpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

export function ContentSubjectStep({
  purpose,
  mode,
  topicText,
  topicUrl,
  contentInstruction,
  products,
  selectedProductId,
  referencePicker,
  referenceValid,
  suggestions = null,
  suggestionsLoading = false,
  suggestionsError = false,
  suggestionSelectionError = false,
  selectedSuggestionId = null,
  loading,
  onModeChange,
  onTopicTextChange,
  onTopicUrlChange,
  onContentInstructionChange,
  onProductChange,
  onSuggestionSelect,
  onRetrySuggestions,
  onComplete,
}: {
  purpose: ContentPurposeV2;
  mode: ContentSubjectMode;
  topicText: string;
  topicUrl: string;
  contentInstruction: string;
  products: ProductServiceItem[];
  selectedProductId: string | null;
  referencePicker: ReactNode;
  referenceValid: boolean;
  suggestions?: ContentSuggestionList | null;
  suggestionsLoading?: boolean;
  suggestionsError?: boolean;
  suggestionSelectionError?: boolean;
  selectedSuggestionId?: string | null;
  loading: boolean;
  onModeChange(value: ContentSubjectMode): void;
  onTopicTextChange(value: string): void;
  onTopicUrlChange(value: string): void;
  onContentInstructionChange(value: string): void;
  onProductChange(value: string | null): void;
  onSuggestionSelect?(item: ContentSuggestion): void;
  onRetrySuggestions?(): void;
  onComplete(): void;
}) {
  const [intentFilter, setIntentFilter] = useState<ContentSuggestionIntent | "all">("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const approvedActiveProducts = products.filter(isApprovedActiveProduct);
  const materialValid = mode === "topic_text"
    ? Boolean(topicText.trim())
    : mode === "topic_url"
      ? isHttpUrl(topicUrl)
      : mode === "suggestion"
        ? Boolean(selectedSuggestionId && topicText.trim())
        : referenceValid;
  const selectedProductValid = approvedActiveProducts.some((item) => item.id === selectedProductId);
  const valid = materialValid && (purpose === "informational" || selectedProductValid);
  const generalSubcategories = useMemo(() => Array.from(new Map(
    (suggestions?.general ?? []).map((item) => [item.subcategoryCode, item.subcategoryName]),
  )), [suggestions]);
  const filteredGeneral = useMemo(() => (suggestions?.general ?? []).filter((item) => (
    (intentFilter === "all" || item.intent === intentFilter)
    && (subcategoryFilter === "all" || item.subcategoryCode === subcategoryFilter)
  )), [intentFilter, subcategoryFilter, suggestions]);
  const selectSuggestion = (item: ContentSuggestion) => onSuggestionSelect?.(item);

  return <div className="content-subject-step">
    <div className="content-entry-tabs" role="group" aria-label="소재 선택 방식">
      <button type="button" aria-pressed={mode === "topic_text"} onClick={() => onModeChange("topic_text")}>직접 입력</button>
      <button type="button" aria-pressed={mode === "topic_url"} onClick={() => onModeChange("topic_url")}>URL</button>
      <button type="button" aria-pressed={mode === "suggestion"} onClick={() => onModeChange("suggestion")}>오늘의 주제</button>
      <button type="button" aria-pressed={mode === "reference"} onClick={() => onModeChange("reference")}>레퍼런스</button>
    </div>

    {mode === "topic_text" ? <label>콘텐츠 주제
      <input
        value={topicText}
        onChange={(event) => onTopicTextChange(event.target.value)}
        placeholder="예: 여름 피부 관리"
      />
    </label> : null}
    {mode === "topic_url" ? <label>주제 URL
      <input
        type="url"
        value={topicUrl}
        onChange={(event) => onTopicUrlChange(event.target.value)}
        placeholder="https://example.com/article"
      />
    </label> : null}
    {mode === "suggestion" ? <div className="content-suggestion-picker">
      {suggestionsLoading ? <p>오늘의 주제를 불러오는 중입니다.</p> : null}
      {suggestionsError ? <div className="content-suggestion-state" role="alert">
        <p>오늘의 주제를 불러오지 못했습니다.</p>
        <button type="button" className="button" onClick={onRetrySuggestions}>다시 시도</button>
      </div> : null}
      {suggestionSelectionError && !suggestionsError ? <div className="content-suggestion-state" role="alert">
        <p>선택한 오늘의 주제를 찾지 못했습니다. 아래 목록에서 다시 선택해 주세요.</p>
      </div> : null}
      {!suggestionsLoading && !suggestionsError ? <>
        {suggestions?.personal.length
          ? <ContentSuggestionCards items={suggestions.personal} selectedId={selectedSuggestionId} onSelect={selectSuggestion} />
          : null}
        {suggestions?.general.length ? <section className="content-suggestion-general" aria-labelledby="content-suggestion-general-title">
          <div className="content-suggestion-general__head">
            <h3 id="content-suggestion-general-title">전체 주제</h3>
            <div className="content-suggestion-filters">
              <label>주제 유형
                <select value={intentFilter} onChange={(event) => setIntentFilter(event.target.value as ContentSuggestionIntent | "all")}>
                  <option value="all">전체</option>
                  <option value="informational">정보성</option>
                  <option value="trend">트렌드</option>
                </select>
              </label>
              <label>세부분야
                <select value={subcategoryFilter} onChange={(event) => setSubcategoryFilter(event.target.value)}>
                  <option value="all">전체</option>
                  {generalSubcategories.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </label>
            </div>
          </div>
          {filteredGeneral.length
            ? <ContentSuggestionCards items={filteredGeneral} selectedId={selectedSuggestionId} onSelect={selectSuggestion} />
            : <p>선택한 조건에 맞는 주제가 없습니다.</p>}
        </section> : null}
        {!suggestions?.personal.length && !suggestions?.general.length
          ? <p>아직 추천할 오늘의 주제가 없습니다. 직접 입력을 이용해 주세요.</p>
          : null}
      </> : null}
    </div> : null}
    {mode === "reference" ? referencePicker : null}

    {purpose === "marketing" ? <label>제품·서비스
      <select
        required
        value={selectedProductId ?? ""}
        onChange={(event) => onProductChange(event.target.value || null)}
      >
        <option value="">승인된 제품·서비스 선택</option>
        {approvedActiveProducts.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select>
    </label> : null}
    {purpose === "marketing" && loading ? <p>승인된 제품·서비스를 불러오는 중입니다.</p> : null}
    {purpose === "marketing" && !loading && approvedActiveProducts.length === 0
      ? <p>사용할 수 있는 승인·활성 제품·서비스가 없습니다.</p>
      : null}

    <label>콘텐츠 지시 (선택)
      <textarea
        value={contentInstruction}
        onChange={(event) => onContentInstructionChange(event.target.value)}
        placeholder="구성안에서 꼭 고려할 내용을 입력하세요."
      />
    </label>
    <button type="button" className="button primary" disabled={!valid || loading} onClick={onComplete}>주제·자료 완료</button>
  </div>;
}
