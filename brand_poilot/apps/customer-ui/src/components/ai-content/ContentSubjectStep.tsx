import type {
  ProductServiceItem,
  WikiItem,
} from "../../features/libraries/libraryGateway";

export type ContentSubjectMode = "brand_topic" | "product_service" | "new_subject";

export function ContentSubjectStep({
  mode,
  topic,
  products,
  wikiItems,
  selectedWikiIds,
  selectedProductId,
  analyzedSubjectTitle,
  loading,
  onModeChange,
  onTopicChange,
  onWikiIdsChange,
  onProductChange,
  onStartNewAnalysis,
  onComplete,
}: {
  mode: ContentSubjectMode;
  topic: string;
  products: ProductServiceItem[];
  wikiItems: WikiItem[];
  selectedWikiIds: string[];
  selectedProductId: string | null;
  analyzedSubjectTitle?: string | null;
  loading: boolean;
  onModeChange(value: ContentSubjectMode): void;
  onTopicChange(value: string): void;
  onWikiIdsChange(value: string[]): void;
  onProductChange(value: string | null): void;
  onStartNewAnalysis(): void;
  onComplete(): void;
}) {
  const activeProducts = products.filter((item) =>
    item.status === "active"
    && item.activeVersionId
    && item.activeVersion?.status === "approved",
  );
  const activeWiki = wikiItems.filter((item) =>
    item.status === "active" && item.activeVersionId && item.buildStatus === "active",
  );
  const valid = mode === "brand_topic"
    ? Boolean(topic.trim())
    : mode === "product_service"
      ? Boolean(selectedProductId)
      : Boolean(analyzedSubjectTitle);
  const toggleWiki = (id: string) => onWikiIdsChange(
    selectedWikiIds.includes(id)
      ? selectedWikiIds.filter((item) => item !== id)
      : [...selectedWikiIds, id],
  );

  return <div className="content-subject-step">
    <div className="content-entry-tabs" role="group" aria-label="주제 자료 방식">
      <button type="button" aria-pressed={mode === "brand_topic"} onClick={() => onModeChange("brand_topic")}>브랜드 주제</button>
      <button type="button" aria-pressed={mode === "product_service"} onClick={() => onModeChange("product_service")}>저장 제품·서비스</button>
      <button type="button" aria-pressed="false" onClick={onStartNewAnalysis}>새 제품·서비스 분석</button>
    </div>
    {loading ? <p>승인된 제품·서비스와 Wiki를 불러오는 중입니다.</p> : null}
    {mode === "new_subject" ? <div className="wizard-notice">
      <strong>새 분석 완료</strong>
      <p>{analyzedSubjectTitle}</p>
    </div> : mode === "brand_topic" ? <>
      <label>브랜드 주제
        <input value={topic} onChange={(event) => onTopicChange(event.target.value)} placeholder="예: 여름 피부 관리" />
      </label>
      <fieldset>
        <legend>추천 Wiki</legend>
        {activeWiki.map((item) => <label key={item.id}>
          <input type="checkbox" checked={selectedWikiIds.includes(item.id)} onChange={() => toggleWiki(item.id)} />
          {item.title}
        </label>)}
        {!loading && activeWiki.length === 0 ? <p>활성 Wiki가 없습니다. Brand Core와 직접 입력한 주제로 진행합니다.</p> : null}
      </fieldset>
      <p className="wizard-muted">승인된 Brand Core와 선택한 활성 Wiki를 근거로 구성안을 만듭니다.</p>
    </> : <>
      <label>승인된 제품·서비스
        <select value={selectedProductId ?? ""} onChange={(event) => onProductChange(event.target.value || null)}>
          <option value="">선택</option>
          {activeProducts.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
        </select>
      </label>
      {!loading && activeProducts.length === 0 ? <p>승인된 제품·서비스가 없습니다. 새 분석을 시작하거나 브랜드 주제를 사용하세요.</p> : null}
    </>}
    <button type="button" className="button primary" disabled={!valid || loading} onClick={onComplete}>주제·자료 완료</button>
  </div>;
}
