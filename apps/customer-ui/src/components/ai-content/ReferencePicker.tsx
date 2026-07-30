import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { AiContentReference } from "../../features/ai-content/types";

interface Props { references: AiContentReference[]; selectedIds: string[]; onChange(ids: string[]): void; onReorder(from: number, to: number): void; }

export function ReferencePicker({ references, selectedIds, onChange, onReorder }: Props) {
  const [mode, setMode] = useState<"category" | "appeal" | "search" | "saved">("category");
  const [query, setQuery] = useState("");
  const selected = selectedIds.map((id) => references.find((item) => item.id === id)).filter(Boolean) as AiContentReference[];
  const visibleReferences = useMemo(() => references.filter((item) => {
    if (mode === "saved" && item.source !== "saved_trend" && item.source !== "uploaded") return false;
    if (mode === "appeal" && item.appealIds.length === 0) return false;
    if (query.trim() && !item.title.toLocaleLowerCase("ko-KR").includes(query.trim().toLocaleLowerCase("ko-KR"))) return false;
    return true;
  }), [mode, query, references]);
  const toggle = (id: string) => selectedIds.includes(id) ? onChange(selectedIds.filter((item) => item !== id)) : selectedIds.length < 5 && onChange([...selectedIds, id]);
  return <div className="reference-picker">
    <div>
      <div className="wizard-tabs" role="tablist" aria-label="레퍼런스 탐색 방식">
        {([['category','분야별'],['appeal','소구점별'],['search','직접 찾기'],['saved','내 보관함']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)}>{label}</button>)}
      </div>
      {mode === "search" ? <div className="wizard-filter-row"><label>레퍼런스 검색<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목으로 찾기" /></label></div> : null}
      <div className="wizard-filter-row">
        <label>출처<select aria-label="출처 필터"><option>전체</option><option>자체 콘텐츠</option><option>저장한 트렌드</option></select></label>
        <label>형식<select aria-label="형식 필터"><option>전체</option><option>카드뉴스</option><option>블로그</option></select></label>
        <label>카테고리<select aria-label="카테고리 필터"><option>전체</option><option>마케팅</option></select></label>
      </div>
      <div className="reference-grid">{visibleReferences.map((item) => <article key={item.id}>
        <div className="reference-placeholder" aria-hidden="true">{item.format === "blog" ? "BLOG" : "CARD"}</div>
        <h3>{item.title}</h3><p>{item.primaryCategory ?? "미분류"} · {item.source === "owned" ? "자체 콘텐츠" : "외부"}</p>
        {item.comparableMetric ? <small>{item.comparableMetric.label} {item.comparableMetric.value.toLocaleString("ko-KR")}</small> : null}
        <button type="button" className="button" aria-pressed={selectedIds.includes(item.id)} disabled={!selectedIds.includes(item.id) && selectedIds.length >= 5} onClick={() => toggle(item.id)}>레퍼런스 선택: {item.title}</button>
      </article>)}</div>
    </div>
    <aside className="selected-reference-tray" aria-label="선택한 레퍼런스">
      <h3>선택한 레퍼런스 {selected.length} / 5</h3>
      {selected.length ? <ol>{selected.map((item, index) => <li key={item.id}><span>{item.title}</span><div>
        <button type="button" title="앞으로 이동" aria-label="앞으로 이동" disabled={index === 0} onClick={() => onReorder(index, index - 1)}><ArrowLeft size={16} /></button>
        <button type="button" title="뒤로 이동" aria-label="뒤로 이동" disabled={index === selected.length - 1} onClick={() => onReorder(index, index + 1)}><ArrowRight size={16} /></button>
        <button type="button" title="선택 해제" aria-label="선택 해제" onClick={() => toggle(item.id)}><X size={16} /></button>
      </div></li>)}</ol> : <p className="wizard-muted">선택하지 않아도 다음 단계로 이동할 수 있습니다.</p>}
    </aside>
  </div>;
}
