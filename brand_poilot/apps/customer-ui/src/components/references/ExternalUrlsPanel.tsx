import { useCallback, useEffect, useMemo, useState } from "react";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import type { ReferenceContentPurpose, ReferenceItem, ReferencePattern } from "../../types";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { ReferenceCard } from "./ReferenceCard";
import { ReferenceDetailDialog } from "./ReferenceDetailDialog";

export function ExternalUrlsPanel() {
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [url, setUrl] = useState("");
  const [purpose, setPurpose] = useState<ReferenceContentPurpose | "">("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<ReferenceContentPurpose | "all">("all");
  const [selected, setSelected] = useState<ReferenceItem | null>(null);

  useEffect(() => {
    let active = true;
    void api.listReferences(DEMO_BRAND_ID, { kind: "external_url" })
      .then((rows) => { if (active) setItems(rows); })
      .catch(() => { if (active) { setItems([]); setNotice("외부 URL 목록을 불러오지 못했습니다."); } });
    return () => { active = false; };
  }, []);

  async function add() {
    if (!purpose) {
      setNotice("정보성, 마케팅성 또는 둘 다 중 용도를 선택해 주세요.");
      return;
    }
    if (!url.trim() || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const created = await api.addReferenceUrl(DEMO_BRAND_ID, {
        url: url.trim(),
        title: "",
        contentPurpose: purpose,
      });
      setItems((current) => [created, ...(current ?? [])]);
      setUrl("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(message.includes("source_reference_limit_exceeded")
        ? "외부 URL은 활성 항목 기준 최대 10개까지 등록할 수 있습니다."
        : "외부 URL을 저장하지 못했습니다. 주소와 중복 여부를 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  const visibleItems = useMemo(
    () => (items ?? []).filter((item) => filter === "all" || item.contentPurpose === filter || item.contentPurpose === "both"),
    [filter, items],
  );
  const loadPattern = useCallback(
    (referenceId: string): Promise<ReferencePattern> => api.getReferencePattern(DEMO_BRAND_ID, referenceId),
    [],
  );

  async function archive(item: ReferenceItem) {
    if (!window.confirm(`${item.title} 외부 URL을 삭제할까요?`)) return;
    try {
      await api.archiveReference(DEMO_BRAND_ID, item.id);
      setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
    } catch {
      setNotice("외부 URL을 삭제하지 못했습니다.");
    }
  }

  return (
    <section className="panel external-urls-panel" aria-labelledby="external-urls-title">
      <div className="panel-head"><div><h2 id="external-urls-title">외부 URL</h2><p className="muted">활성 외부 URL은 최대 10개이며 용도에 따라 필터링할 수 있습니다.</p></div></div>
      <div className="panel-body grid">
        {notice ? <div role="alert"><Alert title="외부 URL 상태" variant="warn">{notice}</Alert></div> : null}
        <div className="reference-url-form">
          <input aria-label="외부 URL" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/report" />
          <select aria-label="콘텐츠 용도" value={purpose} onChange={(event) => setPurpose(event.target.value as ReferenceContentPurpose | "")}>
            <option value="">용도 선택</option>
            <option value="informational">정보성</option>
            <option value="marketing">마케팅성</option>
            <option value="both">둘 다</option>
          </select>
          <button className="button primary" type="button" disabled={saving} onClick={() => void add()}>URL 추가</button>
        </div>
        <label>목록 용도
          <select aria-label="외부 URL 용도 필터" value={filter} onChange={(event) => setFilter(event.target.value as ReferenceContentPurpose | "all")}>
            <option value="all">전체</option>
            <option value="informational">정보성</option>
            <option value="marketing">마케팅성</option>
            <option value="both">둘 다</option>
          </select>
        </label>
        {items === null ? <ListSkeleton rows={3} columns={4} label="외부 URL을 불러오는 중입니다." /> : null}
        {items?.length === 0 ? <EmptyState title="등록한 외부 URL이 없습니다" description="기사·사례처럼 참고할 공개 URL과 콘텐츠 용도를 등록하세요." /> : null}
        {visibleItems.length ? <div className="reference-card-grid">{visibleItems.map((item) => (
          <div className="external-reference-card" key={item.id}>
            <ReferenceCard item={item} onSelect={setSelected} />
            <button className="button" type="button" aria-label={`${item.title} 삭제`} onClick={() => void archive(item)}>삭제</button>
          </div>
        ))}</div> : null}
      </div>
      {selected ? <ReferenceDetailDialog item={selected} onClose={() => setSelected(null)} loadPattern={loadPattern} /> : null}
    </section>
  );
}
