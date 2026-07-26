import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ReferenceBrand, ReferenceItem } from "../../types";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { ReferenceCard } from "./ReferenceCard";

export function ReferenceBrandDetailDialog({
  brand,
  onClose,
  loadItems,
}: {
  brand: ReferenceBrand;
  onClose(): void;
  loadItems(referenceBrandId: string): Promise<ReferenceItem[]>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState<ReferenceItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", keydown);
    void loadItems(brand.id).then(setItems).catch(() => setFailed(true));
    return () => {
      document.removeEventListener("keydown", keydown);
      previousFocus.current?.focus();
    };
  }, [brand.id, loadItems, onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel reference-brand-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-brand-title">
        <header>
          <div>
            <h2 id="reference-brand-title">{brand.displayName}</h2>
            <p className="muted">@{brand.handle} · 저장한 공개 {brand.platform} 출처</p>
          </div>
          <button ref={closeRef} className="button" type="button" aria-label="닫기" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </header>
        <a className="button" href={brand.publicSourceUrl} target="_blank" rel="noreferrer">공개 프로필 원본 보기</a>
        {items === null && !failed ? <ListSkeleton rows={3} columns={3} label="저장한 콘텐츠를 불러오는 중입니다." /> : null}
        {failed ? <p role="alert">저장한 콘텐츠를 불러오지 못했습니다.</p> : null}
        {items?.length === 0 ? <EmptyState title="저장한 콘텐츠가 없습니다" description="이 출처에서 실제로 저장한 콘텐츠만 여기에 표시됩니다." /> : null}
        {items?.length ? <div className="reference-card-grid">{items.map((item) => <ReferenceCard key={item.id} item={item} onSelect={() => undefined} />)}</div> : null}
      </section>
    </div>
  );
}
