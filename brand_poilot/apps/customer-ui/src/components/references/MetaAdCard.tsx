import { ExternalLink, Heart } from "lucide-react";
import { useEffect, useState } from "react";
import type { MetaAdLibraryItem } from "../../types";

function dateLabel(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("ko-KR");
}

export function MetaAdCard({
  ad,
  onSave,
  onRemove,
}: {
  ad: MetaAdLibraryItem;
  onSave: (ad: MetaAdLibraryItem) => Promise<unknown>;
  onRemove: (ad: MetaAdLibraryItem) => Promise<unknown>;
}) {
  const [saved, setSaved] = useState(ad.isSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => setSaved(ad.isSaved), [ad.isSaved]);

  const advertiser = ad.pageName?.trim() || "광고주 정보 없음";
  const body = ad.creativeBody?.trim() || ad.creativeDescription?.trim() || "광고 문구가 제공되지 않았습니다.";
  const start = dateLabel(ad.deliveryStartedAt);
  const stop = dateLabel(ad.deliveryStoppedAt);

  async function toggleSaved() {
    if (busy) return;
    const previous = saved;
    setSaved(!previous);
    setBusy(true);
    setError(false);
    try {
      if (previous) await onRemove(ad);
      else await onSave(ad);
    } catch {
      setSaved(previous);
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="meta-ad-card">
      <header className="meta-ad-card__head">
        <div>
          <span className="reference-source-label">Meta 광고 라이브러리</span>
          <h3>{advertiser}</h3>
          {ad.pageId ? <span className="muted small">Page ID {ad.pageId}</span> : null}
        </div>
        <button
          className="meta-ad-card__save"
          type="button"
          disabled={busy}
          aria-pressed={saved}
          aria-label={saved ? `${advertiser} 저장 해제` : `${advertiser} 라이브러리에 저장`}
          onClick={() => void toggleSaved()}
        >
          <Heart size={19} fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </header>
      <div className="meta-ad-card__copy">
        {ad.activeStatus !== "ACTIVE" ? (
          <span className="reference-source-state is-unavailable">
            현재 광고 라이브러리에서 확인되지 않음
          </span>
        ) : null}
        {ad.creativeTitle ? <strong>{ad.creativeTitle}</strong> : null}
        <p>{body}</p>
        {ad.creativeCaption ? <p className="muted small">{ad.creativeCaption}</p> : null}
      </div>
      <div className="meta-ad-card__metadata">
        {ad.publisherPlatforms.map((platform) => <span className="meta-ad-card__chip" key={platform}>{platform}</span>)}
        {start ? <span>{start}{stop ? ` ~ ${stop}` : "부터 게재 중"}</span> : null}
      </div>
      <footer className="meta-ad-card__footer">
        {ad.snapshotUrl ? (
          <a className="button" href={ad.snapshotUrl} target="_blank" rel="noreferrer">
            Meta 원본 보기 <ExternalLink size={15} aria-hidden="true" />
          </a>
        ) : <span className="muted small">Meta 원본 링크 없음</span>}
      </footer>
      {error ? <p className="alert alert--warn" role="alert">저장 상태를 변경하지 못했습니다.</p> : null}
    </article>
  );
}
