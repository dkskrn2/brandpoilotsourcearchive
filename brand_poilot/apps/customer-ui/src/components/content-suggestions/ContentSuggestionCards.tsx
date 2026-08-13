import type { ContentSuggestion } from "../../features/content-suggestions/contentSuggestionGateway";

const intentLabels: Record<ContentSuggestion["intent"], string> = {
  informational: "정보성",
  trend: "트렌드",
};

export function ContentSuggestionCards({
  items,
  selectedId = null,
  onSelect,
}: {
  items: ContentSuggestion[];
  selectedId?: string | null;
  onSelect(item: ContentSuggestion): void;
}) {
  return <div className="content-suggestion-grid">
    {items.map((item) => <article
      className={`content-suggestion-card${selectedId === item.id ? " is-selected" : ""}`}
      key={item.id}
    >
      <div className="content-suggestion-card__meta">
        <span className={`content-suggestion-intent is-${item.intent}`}>{intentLabels[item.intent]}</span>
        <span>{item.subcategoryName}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.whyNow}</p>
      <button
        type="button"
        className="button primary"
        aria-pressed={selectedId === item.id}
        onClick={() => onSelect(item)}
      >AI 콘텐츠로 만들기</button>
    </article>)}
  </div>;
}
