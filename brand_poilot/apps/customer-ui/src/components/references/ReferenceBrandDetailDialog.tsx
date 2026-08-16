import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReferenceBrand, ReferenceChannelMedia, ReferenceChannelMediaPage, ReferenceDetail, ReferenceItem, ReferencePattern } from "../../types";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { ReferenceCard } from "./ReferenceCard";
import { ReferenceDetailDialog } from "./ReferenceDetailDialog";
import { TrendMediaCard } from "../trends/TrendMediaCard";
import { TrendMediaDetailDialog } from "../trends/TrendMediaDetailDialog";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";

export function ReferenceBrandDetailDialog({
  brand,
  onClose,
  loadItems,
  loadDetail,
  loadPattern,
  loadMedia,
}: {
  brand: ReferenceBrand;
  onClose(): void;
  loadItems(referenceBrandId: string): Promise<ReferenceItem[]>;
  loadDetail(referenceId: string): Promise<ReferenceDetail>;
  loadPattern(referenceId: string): Promise<ReferencePattern>;
  loadMedia(referenceBrandId: string): Promise<ReferenceChannelMediaPage>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ReferenceItem | null>(null);
  const [mediaPage, setMediaPage] = useState<ReferenceChannelMediaPage | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<ReferenceChannelMedia | null>(null);
  const selectedItemRef = useRef(selectedItem);
  selectedItemRef.current = selectedItem;
  const selectedMediaRef = useRef(selectedMedia);
  selectedMediaRef.current = selectedMedia;

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (selectedItemRef.current || selectedMediaRef.current) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    void Promise.allSettled([loadItems(brand.id), loadMedia(brand.id)])
      .then(([savedItems, channelMedia]) => {
        setItems(savedItems.status === "fulfilled" ? savedItems.value : []);
        setMediaPage(channelMedia.status === "fulfilled"
          ? channelMedia.value
          : { items: [], total: 0, refreshedAt: brand.refreshedAt ?? null, cacheState: brand.cacheState ?? "pending" });
        setFailed(savedItems.status === "rejected" && channelMedia.status === "rejected");
      });
    return () => {
      document.removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, [brand.cacheState, brand.id, brand.refreshedAt, loadItems, loadMedia, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !selectedItem) onClose();
    }}>
      <section ref={dialogRef} className="modal-panel reference-brand-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-brand-title">
        <header>
          <div>
            <h2 id="reference-brand-title">{brand.displayName}</h2>
            <p className="muted">@{brand.handle} · 저장한 공개 {brand.platform} 출처</p>
          </div>
          <button ref={closeRef} className="button" type="button" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <a className="button" href={brand.publicSourceUrl} target="_blank" rel="noreferrer">공개 프로필 원본 보기</a>
        {mediaPage ? <p className="muted">Instagram 채널 캐시 {mediaPage.total}개 · {mediaPage.refreshedAt ? `${new Date(mediaPage.refreshedAt).toLocaleString("ko-KR")} 갱신` : "갱신 대기"}</p> : null}
        {items === null && !failed ? <ListSkeleton rows={3} columns={3} label="저장한 콘텐츠를 불러오는 중입니다." /> : null}
        {failed ? <p role="alert">저장한 콘텐츠를 불러오지 못했습니다.</p> : null}
        {mediaPage?.items.length ? <div className="reference-card-grid">{mediaPage.items.map((media) => (
          <TrendMediaCard
            key={media.id}
            media={media}
            onSelect={(value) => setSelectedMedia(value as ReferenceChannelMedia)}
            onBookmark={(value) => api.saveInstagramTrendSource(DEMO_BRAND_ID, value.id).then(() => undefined)}
            onUnbookmark={(value) => api.removeInstagramTrendSource(DEMO_BRAND_ID, value.id).then(() => undefined)}
          />
        ))}</div> : null}
        {mediaPage?.items.length === 0 && items?.length === 0 ? <EmptyState title="채널 콘텐츠가 없습니다" description="아직 캐시된 공개 콘텐츠가 없습니다. 다음 채널 갱신 후 다시 확인하세요." /> : null}
        {!mediaPage?.items.length && items?.length ? <div className="reference-card-grid">{items.map((item) => (
          <ReferenceCard key={item.id} item={item} onSelect={setSelectedItem} />
        ))}</div> : null}
      </section>
      {selectedItem ? (
        <ReferenceDetailDialog
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          loadDetail={loadDetail}
          loadPattern={loadPattern}
        />
      ) : null}
      {selectedMedia ? (
        <TrendMediaDetailDialog
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onSave={() => api.saveInstagramTrendSource(DEMO_BRAND_ID, selectedMedia.id)}
        />
      ) : null}
    </div>
  );
}
