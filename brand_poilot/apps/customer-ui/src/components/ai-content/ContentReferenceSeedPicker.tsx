import { useEffect, useRef, useState } from "react";
import type {
  AiContentGateway,
  ContentOutputFormatV2,
  ContentReferenceRoleV2,
  ContentReferenceSelectionV2,
} from "../../features/ai-content/types";
import { api } from "../../lib/apiClient";
import type { AiContentReferenceSeed, InstagramTrendMedia } from "../../types";

type ReferenceGateway = Pick<AiContentGateway, "listReferenceSeeds">;
type TrendGateway = Pick<typeof api, "searchInstagramTrends" | "saveInstagramTrendSource">;

const roleLabels: Array<[ContentReferenceRoleV2, string]> = [
  ["planning", "기획"],
  ["copy_pattern", "카피 패턴"],
  ["visual_composition", "비주얼 구성"],
];

export function ContentReferenceSeedPicker({
  brandId,
  format,
  selected,
  onChange,
  referenceGateway,
  trendGateway = api,
  initialReferenceId = null,
  onInitialReferenceInvalid,
}: {
  brandId: string;
  format: ContentOutputFormatV2;
  selected: ContentReferenceSelectionV2[];
  onChange(value: ContentReferenceSelectionV2[]): void;
  referenceGateway: ReferenceGateway;
  trendGateway?: TrendGateway;
  initialReferenceId?: string | null;
  onInitialReferenceInvalid?(): void;
}) {
  const [tab, setTab] = useState<"popular" | "trend">("popular");
  const [items, setItems] = useState<AiContentReferenceSeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [trendItems, setTrendItems] = useState<InstagramTrendMedia[]>([]);
  const [savedTrendReferenceIds, setSavedTrendReferenceIds] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [savingMediaId, setSavingMediaId] = useState<string | null>(null);
  const initialHandled = useRef<string | null>(null);
  const scopeKey = `${brandId}\u0000${format}`;
  const activeScope = useRef(scopeKey);
  const selectedRef = useRef(selected);
  const onChangeRef = useRef(onChange);
  activeScope.current = scopeKey;
  selectedRef.current = selected;
  onChangeRef.current = onChange;

  function commitSelection(next: ContentReferenceSelectionV2[]) {
    selectedRef.current = next;
    onChangeRef.current(next);
  }

  useEffect(() => () => {
    activeScope.current = "";
    selectedRef.current = [];
  }, []);

  useEffect(() => {
    setItems([]);
    setQuery("");
    setTrendItems([]);
    setSavedTrendReferenceIds({});
    setSearching(false);
    setSavingMediaId(null);
    setError(null);
  }, [scopeKey]);

  useEffect(() => {
    let current = true;
    const requestedScope = scopeKey;
    setLoading(true);
    setError(null);
    void referenceGateway.listReferenceSeeds(brandId, format).then((next) => {
      if (!current || activeScope.current !== requestedScope) return;
      setItems(next);
      setLoading(false);
      const initialKey = initialReferenceId ? `${requestedScope}\u0000${initialReferenceId}` : null;
      if (initialReferenceId && initialKey && initialHandled.current !== initialKey) {
        initialHandled.current = initialKey;
        const available = next.some((item) => item.id === initialReferenceId);
        const latestSelected = selectedRef.current;
        if (available && !latestSelected.some((item) => item.referenceId === initialReferenceId) && latestSelected.length < 5) {
          commitSelection([...latestSelected, { referenceId: initialReferenceId, roles: ["planning"] }]);
        } else if (!available) {
          onInitialReferenceInvalid?.();
        }
      }
    }).catch(() => {
      if (!current || activeScope.current !== requestedScope) return;
      setItems([]);
      setLoading(false);
      setError("레퍼런스를 불러오지 못했습니다. 다시 시도해 주세요.");
    });
    return () => { current = false; };
  }, [brandId, format, initialReferenceId, referenceGateway]);

  function toggleReference(referenceId: string) {
    const latestSelected = selectedRef.current;
    const exists = latestSelected.some((item) => item.referenceId === referenceId);
    if (exists) {
      commitSelection(latestSelected.filter((item) => item.referenceId !== referenceId));
      return;
    }
    if (latestSelected.length >= 5) return;
    commitSelection([...latestSelected, { referenceId, roles: ["planning"] }]);
  }

  function toggleRole(referenceId: string, role: ContentReferenceRoleV2) {
    commitSelection(selectedRef.current.map((item) => {
      if (item.referenceId !== referenceId) return item;
      if (item.roles.includes(role)) {
        return item.roles.length === 1
          ? item
          : { ...item, roles: item.roles.filter((itemRole) => itemRole !== role) };
      }
      return { ...item, roles: [...item.roles, role] };
    }));
  }

  function roleToggles(referenceId: string, title: string, selection: ContentReferenceSelectionV2) {
    return <div className="content-reference-role-toggles" aria-label={`${title} 역할`}>
      {roleLabels.map(([role, label]) => {
        const active = selection.roles.includes(role);
        return <button
          key={role}
          type="button"
          aria-label={`${label} 역할 ${active ? "해제" : "추가"}`}
          aria-pressed={active}
          disabled={active && selection.roles.length === 1}
          onClick={() => toggleRole(referenceId, role)}
        >{label}</button>;
      })}
    </div>;
  }

  async function search() {
    if (!query.trim() || searching) return;
    const requestedScope = scopeKey;
    setSearching(true);
    setError(null);
    try {
      const result = await trendGateway.searchInstagramTrends(brandId, query.trim());
      if (activeScope.current !== requestedScope) return;
      setTrendItems(result.items);
    } catch {
      if (activeScope.current !== requestedScope) return;
      setTrendItems([]);
      setError("트렌드를 검색하지 못했습니다. 연결 상태를 확인해 주세요.");
    } finally {
      if (activeScope.current === requestedScope) setSearching(false);
    }
  }

  async function saveTrend(item: InstagramTrendMedia) {
    if (savingMediaId || selectedRef.current.length >= 5) return;
    const requestedScope = scopeKey;
    setSavingMediaId(item.instagramMediaId);
    setError(null);
    try {
      const saved = await trendGateway.saveInstagramTrendSource(brandId, item.instagramMediaId);
      if (activeScope.current !== requestedScope) return;
      setSavedTrendReferenceIds((current) => ({
        ...current,
        [item.instagramMediaId]: saved.referenceItemId,
      }));
      const latestSelected = selectedRef.current;
      if (latestSelected.length < 5 && !latestSelected.some((selection) => selection.referenceId === saved.referenceItemId)) {
        commitSelection([...latestSelected, { referenceId: saved.referenceItemId, roles: ["planning"] }]);
      }
    } catch {
      if (activeScope.current !== requestedScope) return;
      setError("트렌드를 레퍼런스로 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (activeScope.current === requestedScope) setSavingMediaId(null);
    }
  }

  return <section className="content-reference-seed-picker" aria-label="레퍼런스 선택">
    <div className="content-reference-tabs" role="tablist" aria-label="레퍼런스 탐색 방식">
      <button type="button" role="tab" aria-selected={tab === "popular"} onClick={() => setTab("popular")}>인기 레퍼런스</button>
      <button type="button" role="tab" aria-selected={tab === "trend"} onClick={() => setTab("trend")}>트렌드 탐색</button>
    </div>
    <p className="wizard-muted">선택 {selected.length} / 5 · 각 자료의 활용 역할을 지정하세요.</p>

    {tab === "popular" ? <div className="content-reference-seed-list">
      {loading ? <p>같은 업종의 인기 레퍼런스를 불러오는 중입니다.</p> : null}
      {!loading && items.length === 0 && !error ? <p>현재 형식에서 사용할 수 있는 레퍼런스가 없습니다.</p> : null}
      {items.map((item) => {
        const selection = selected.find((selectedItem) => selectedItem.referenceId === item.id);
        return <article key={item.id} className="content-reference-seed-card">
          {item.previewUrl ? <img src={item.previewUrl} alt="" /> : null}
          <div><strong>{item.title}</strong><small>{item.primaryCategory}</small></div>
          <button
            type="button"
            aria-label={selection ? `선택 해제: ${item.title}` : `레퍼런스 선택: ${item.title}`}
            aria-pressed={Boolean(selection)}
            disabled={!selection && selected.length >= 5}
            onClick={() => toggleReference(item.id)}
          >{selection ? "선택됨" : "선택"}</button>
          {selection ? roleToggles(item.id, item.title, selection) : null}
        </article>;
      })}
    </div> : <div className="content-reference-trend-search">
      <label>트렌드 검색어
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="#해시태그" />
      </label>
      <button type="button" disabled={!query.trim() || searching} onClick={() => void search()}>{searching ? "검색 중" : "검색"}</button>
      <div className="content-reference-trend-results">
        {trendItems.map((item) => {
          const referenceId = savedTrendReferenceIds[item.instagramMediaId];
          const selection = referenceId
            ? selected.find((value) => value.referenceId === referenceId)
            : undefined;
          const title = item.caption?.trim() || item.permalink;
          return <article key={item.id}>
            <strong>{title}</strong>
            <small>좋아요 {item.likeCount ?? 0} · 댓글 {item.commentsCount ?? 0}</small>
            <button
              type="button"
              aria-pressed={Boolean(selection)}
              disabled={Boolean(savingMediaId) || !selection && selected.length >= 5}
              onClick={() => referenceId ? toggleReference(referenceId) : void saveTrend(item)}
            >{savingMediaId === item.instagramMediaId
              ? "저장 중"
              : selection
                ? "선택됨"
                : referenceId
                  ? "선택"
                  : "레퍼런스로 저장하고 선택"}</button>
            {selection ? roleToggles(referenceId, title, selection) : null}
          </article>;
        })}
      </div>
    </div>}
    {error ? <p role="alert" className="wizard-error">{error}</p> : null}
  </section>;
}
