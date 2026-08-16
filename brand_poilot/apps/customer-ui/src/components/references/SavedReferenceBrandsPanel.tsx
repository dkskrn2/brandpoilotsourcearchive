import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReferenceBrand, ReferenceChannelMediaPage, ReferenceDetail, ReferenceItem, ReferencePattern } from "../../types";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { ReferenceBrandDetailDialog } from "./ReferenceBrandDetailDialog";

export function SavedReferenceBrandsPanel() {
  const [brands, setBrands] = useState<ReferenceBrand[] | null>(null);
  const [selected, setSelected] = useState<ReferenceBrand | null>(null);
  const [failed, setFailed] = useState(false);
  const [profile, setProfile] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const visibleBrands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalized) return brands ?? [];
    return (brands ?? []).filter((brand) =>
      `${brand.displayName} ${brand.handle}`.toLocaleLowerCase("ko-KR").includes(normalized));
  }, [brands, query]);

  useEffect(() => {
    let active = true;
    void api.listReferenceBrands(DEMO_BRAND_ID)
      .then((items) => { if (active) setBrands(items); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const loadItems = useCallback(
    (referenceBrandId: string): Promise<ReferenceItem[]> =>
      api.listReferenceBrandItems(DEMO_BRAND_ID, referenceBrandId),
    [],
  );
  const loadDetail = useCallback(
    (referenceId: string): Promise<ReferenceDetail> => api.getReference(DEMO_BRAND_ID, referenceId),
    [],
  );
  const loadPattern = useCallback(
    (referenceId: string): Promise<ReferencePattern> => api.getReferencePattern(DEMO_BRAND_ID, referenceId),
    [],
  );
  const loadMedia = useCallback(
    (referenceBrandId: string): Promise<ReferenceChannelMediaPage> =>
      api.listReferenceChannelMedia(DEMO_BRAND_ID, referenceBrandId),
    [],
  );

  async function addBrand() {
    const value = profile.trim();
    if (!value || saving) return;
    setSaving(true);
    setNotice(null);
    try {
      const created = await api.resolveReferenceChannel(DEMO_BRAND_ID, value);
      setBrands((current) => [created, ...(current ?? []).filter((item) => item.id !== created.id)]);
      setProfile("");
    } catch {
      setNotice("공개 Instagram 프로 채널을 조회하지 못했습니다. Business 또는 Creator 계정과 주소를 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel saved-reference-brands" aria-labelledby="saved-reference-brands-title">
      <div className="panel-head"><div><h2 id="saved-reference-brands-title">브랜드·작성자</h2><p className="muted">사용자가 저장한 공개 브랜드·작성자 출처만 표시합니다.</p></div></div>
      <div className="panel-body">
        <p className="muted">공개 Instagram Business 또는 Creator 채널을 확인하고 최근 콘텐츠를 채널 캐시에 보관합니다. 하트한 콘텐츠만 내 라이브러리에 저장됩니다.</p>
        {notice ? <div role="alert"><Alert title="브랜드 저장 상태" variant="warn">{notice}</Alert></div> : null}
        <div className="inline-form">
          <input aria-label="공개 Instagram 프로필" value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="@brand 또는 https://www.instagram.com/brand/" />
          <button className="button primary" type="button" disabled={saving} onClick={() => void addBrand()}>브랜드 저장</button>
        </div>
        <input
          type="search"
          aria-label="채널 검색"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="저장한 채널명 또는 @handle 검색"
        />
        {brands === null && !failed ? <ListSkeleton rows={3} columns={3} label="저장한 브랜드를 불러오는 중입니다." /> : null}
        {failed ? <Alert title="저장한 브랜드를 불러오지 못했습니다" variant="warn">잠시 후 다시 시도해 주세요.</Alert> : null}
        {brands?.length === 0 ? <EmptyState title="저장한 브랜드가 없습니다" description="공개 프로필 URL 또는 저장한 Instagram 작성자에서 브랜드를 저장할 수 있습니다." /> : null}
        {brands?.length && visibleBrands.length === 0 ? <EmptyState title="검색 결과가 없습니다" description="다른 채널명이나 handle로 검색해 보세요." /> : null}
        {visibleBrands.length ? <div className="reference-brand-grid">{visibleBrands.map((brand) => (
          <button className="reference-brand-card" type="button" key={brand.id} aria-label={`${brand.displayName} 상세 보기`} onClick={() => setSelected(brand)}>
            {brand.previewUrl ? <img src={brand.previewUrl} alt="" loading="lazy" /> : <span className="reference-brand-card__fallback" aria-hidden="true">{brand.displayName.slice(0, 1)}</span>}
            <strong>{brand.displayName}</strong>
            <span>@{brand.handle}</span>
            <span className="muted">{brand.platform}</span>
          </button>
        ))}</div> : null}
      </div>
      {selected ? (
        <ReferenceBrandDetailDialog
          brand={selected}
          onClose={() => setSelected(null)}
          loadItems={loadItems}
          loadDetail={loadDetail}
          loadPattern={loadPattern}
          loadMedia={loadMedia}
        />
      ) : null}
    </section>
  );
}
