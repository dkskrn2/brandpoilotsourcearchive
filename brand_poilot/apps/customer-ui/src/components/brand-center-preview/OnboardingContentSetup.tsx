import { useEffect, useMemo, useState } from "react";
import type {
  ContentSuggestion,
  ContentSuggestionGateway,
} from "../../features/content-suggestions/contentSuggestionGateway";
import type { ContentCategory } from "../../types";
import { ContentSuggestionCards } from "../content-suggestions/ContentSuggestionCards";
import { Alert } from "../ui/Alert";

const MAX_SUBCATEGORY_SELECTIONS = 5;

export function OnboardingContentSetup({
  brandId,
  categories,
  suggestionGateway,
  starting,
  onStart,
}: {
  brandId: string;
  categories: ContentCategory[];
  suggestionGateway: ContentSuggestionGateway;
  starting: boolean;
  onStart(input: {
    categoryCode: string;
    subcategoryCodes: string[];
    suggestionId: string;
    contentInstruction: string | null;
  }): Promise<void>;
}) {
  const [categoryCode, setCategoryCode] = useState("");
  const [subcategoryCodes, setSubcategoryCodes] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<ContentSuggestion[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const category = useMemo(
    () => categories.find((item) => item.code === categoryCode) ?? null,
    [categories, categoryCode],
  );

  useEffect(() => {
    if (!categoryCode || subcategoryCodes.length === 0) {
      setSuggestions([]);
      setSelectedSuggestionId(null);
      setSuggestionError(null);
      return;
    }
    if (!suggestionGateway.listForSelection) {
      setSuggestions([]);
      setSelectedSuggestionId(null);
      setSuggestionError("오늘의 추천 주제를 불러올 수 없습니다.");
      return;
    }
    const controller = new AbortController();
    setLoadingSuggestions(true);
    setSuggestionError(null);
    void suggestionGateway.listForSelection(
      brandId,
      categoryCode,
      subcategoryCodes,
      controller.signal,
    ).then((result) => {
      setSuggestions(result.personal);
      setSelectedSuggestionId((current) => (
        result.personal.some((item) => item.id === current) ? current : null
      ));
    }).catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") {
        setSuggestions([]);
        setSelectedSuggestionId(null);
        setSuggestionError("오늘의 추천 주제를 불러오지 못했습니다. 다시 선택해 주세요.");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingSuggestions(false);
    });
    return () => controller.abort();
  }, [brandId, categoryCode, subcategoryCodes, suggestionGateway]);

  const selectedSuggestion = suggestions.find((item) => item.id === selectedSuggestionId) ?? null;

  return (
    <section className="brand-center-preview__card onboarding-content-setup" aria-labelledby="onboarding-content-title">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">첫 카드뉴스</p>
        <h2 id="onboarding-content-title">분야를 선택하면 분석과 함께 카드뉴스를 만들어요</h2>
        <p>브랜드 분석 진행 상태는 위에서 계속 확인할 수 있습니다.</p>
      </div>

      <div className="onboarding-content-setup__body">
        <label>
          <strong>어느 분야이신가요?</strong>
          <select
            aria-label="분야"
            value={categoryCode}
            disabled={starting || categories.length === 0}
            onChange={(event) => {
              setCategoryCode(event.target.value);
              setSubcategoryCodes([]);
              setSuggestions([]);
              setSelectedSuggestionId(null);
              setSuggestionError(null);
            }}
          >
            <option value="">분야를 선택해 주세요</option>
            {categories.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
        </label>

        {categories.length === 0 ? (
          <Alert title="분야 목록을 불러오지 못했습니다." variant="warn">
            잠시 후 페이지를 새로고침해 주세요.
          </Alert>
        ) : null}

        {category ? (
          <fieldset>
            <legend>
              세부분야를 선택해 주세요
              <small>선택 {subcategoryCodes.length}/{MAX_SUBCATEGORY_SELECTIONS}</small>
            </legend>
            <div className="onboarding-content-setup__subcategories">
              {category.subcategories.map((subcategory) => {
                const selected = subcategoryCodes.includes(subcategory.code);
                return (
                <label key={subcategory.code}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={starting || (!selected && subcategoryCodes.length >= MAX_SUBCATEGORY_SELECTIONS)}
                    onChange={(event) => {
                      setSubcategoryCodes((current) => (
                        event.target.checked
                          ? [...current, subcategory.code]
                          : current.filter((code) => code !== subcategory.code)
                      ));
                      setSuggestions([]);
                      setSelectedSuggestionId(null);
                      setSuggestionError(null);
                    }}
                  />
                  <span>{subcategory.name}</span>
                </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        {loadingSuggestions ? <p role="status">오늘의 추천 주제를 찾고 있습니다...</p> : null}
        {suggestionError ? <Alert title="추천 주제 오류" variant="bad">{suggestionError}</Alert> : null}
        {!loadingSuggestions && subcategoryCodes.length > 0 && suggestions.length === 0 && !suggestionError ? (
          <p className="muted">선택한 세부분야의 추천 주제가 아직 없습니다.</p>
        ) : null}

        {suggestions.length > 0 ? (
          <fieldset>
            <legend>오늘의 추천 주제를 선택해 주세요</legend>
            <ContentSuggestionCards
              items={suggestions}
              selectedId={selectedSuggestionId}
              disabled={starting}
              onSelect={(suggestion) => setSelectedSuggestionId(suggestion.id)}
            />
          </fieldset>
        ) : null}

        {selectedSuggestion ? (
          <>
            <div className="onboarding-content-setup__sources">
              <strong>추천 근거</strong>
              {(selectedSuggestion.sources ?? []).map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
              ))}
            </div>
            <label>
              <strong>콘텐츠 지시 (선택)</strong>
              <textarea
                aria-label="콘텐츠 지시 (선택)"
                rows={4}
                value={instruction}
                disabled={starting}
                placeholder="구성안에서 꼭 고려할 내용을 입력하세요."
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="brand-center-preview__primary-action"
              disabled={starting}
              onClick={() => void onStart({
                categoryCode,
                subcategoryCodes,
                suggestionId: selectedSuggestion.id,
                contentInstruction: instruction.trim() || null,
              })}
            >
              {starting ? "카드뉴스 생성 요청 중" : "카드뉴스 만들기"}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
