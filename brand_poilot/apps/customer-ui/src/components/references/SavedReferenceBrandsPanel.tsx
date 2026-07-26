import { useCallback, useEffect, useState } from "react";
import type { ReferenceBrand, ReferenceItem } from "../../types";
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

  async function addBrand() {
    const value = profile.trim();
    if (!value || saving) return;
    let handle = value.replace(/^@/, "");
    let publicSourceUrl = "";
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        if (!/(^|\.)instagram\.com$/i.test(url.hostname)) throw new Error("unsupported_profile");
        handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
        publicSourceUrl = url.toString();
      } catch {
        setNotice("공개 Instagram 프로필 URL 또는 handle만 저장할 수 있습니다.");
        return;
      }
    }
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(handle)) {
      setNotice("공개 Instagram 프로필 URL 또는 handle만 저장할 수 있습니다.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const created = await api.createReferenceBrand(DEMO_BRAND_ID, {
        platform: "instagram",
        handle,
        publicSourceUrl,
      });
      setBrands((current) => [created, ...(current ?? [])]);
      setProfile("");
    } catch {
      setNotice("공개 프로필 출처를 저장하지 못했습니다. 주소와 중복 여부를 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel saved-reference-brands" aria-labelledby="saved-reference-brands-title">
      <div className="panel-head"><div><h2 id="saved-reference-brands-title">저장한 브랜드</h2><p className="muted">사용자가 저장한 공개 브랜드·작성자 출처만 표시합니다.</p></div></div>
      <div className="panel-body">
        <p className="muted">공개 Instagram 프로필 URL 또는 handle을 직접 입력합니다. 임의 계정 검색이나 계정 모니터링은 제공하지 않습니다.</p>
        {notice ? <div role="alert"><Alert title="브랜드 저장 상태" variant="warn">{notice}</Alert></div> : null}
        <div className="inline-form">
          <input aria-label="공개 Instagram 프로필" value={profile} onChange={(event) => setProfile(event.target.value)} placeholder="@brand 또는 https://www.instagram.com/brand/" />
          <button className="button primary" type="button" disabled={saving} onClick={() => void addBrand()}>브랜드 저장</button>
        </div>
        {brands === null && !failed ? <ListSkeleton rows={3} columns={3} label="저장한 브랜드를 불러오는 중입니다." /> : null}
        {failed ? <Alert title="저장한 브랜드를 불러오지 못했습니다" variant="warn">잠시 후 다시 시도해 주세요.</Alert> : null}
        {brands?.length === 0 ? <EmptyState title="저장한 브랜드가 없습니다" description="공개 프로필 URL 또는 저장한 Instagram 작성자에서 브랜드를 저장할 수 있습니다." /> : null}
        {brands?.length ? <div className="reference-brand-grid">{brands.map((brand) => (
          <button className="reference-brand-card" type="button" key={brand.id} aria-label={`${brand.displayName} 상세 보기`} onClick={() => setSelected(brand)}>
            {brand.previewUrl ? <img src={brand.previewUrl} alt="" loading="lazy" /> : <span className="reference-brand-card__fallback" aria-hidden="true">{brand.displayName.slice(0, 1)}</span>}
            <strong>{brand.displayName}</strong>
            <span>@{brand.handle}</span>
            <span className="muted">{brand.platform}</span>
          </button>
        ))}</div> : null}
      </div>
      {selected ? <ReferenceBrandDetailDialog brand={selected} onClose={() => setSelected(null)} loadItems={loadItems} /> : null}
    </section>
  );
}
