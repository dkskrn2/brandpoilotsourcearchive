import { Heart } from "lucide-react";
import type { ReferenceItem } from "../../types";

const purposeLabels = {
  informational: "정보성",
  marketing: "마케팅성",
  both: "둘 다",
} as const;

function formatLabel(value: string | null) {
  return value ? value.toUpperCase() : "형식 없음";
}

export function ReferenceCard({
  item,
  onSelect,
  onFavorite,
}: {
  item: ReferenceItem;
  onSelect(item: ReferenceItem): void;
  onFavorite?(item: ReferenceItem): void;
}) {
  const patternAvailable = item.metadata.patternAvailable === true;
  return (
    <article className="reference-card">
      <button
        className="reference-card__detail"
        type="button"
        aria-label={`${item.title} 상세 보기`}
        onClick={() => onSelect(item)}
      >
        <span className="reference-card__preview">
          {item.previewUrl ? (
            <img src={item.previewUrl} alt={`${item.title} 미리보기`} loading="lazy" />
          ) : (
            <span className="reference-card__fallback">미리보기 없음</span>
          )}
        </span>
        <span className="reference-card__body">
          <span className="reference-card__meta">
            <span>{item.origin}</span>
            <span>{formatLabel(item.format)}</span>
            <span>{purposeLabels[item.contentPurpose] ?? item.contentPurpose}</span>
          </span>
          <h3>{item.title}</h3>
          <span className="muted">{new Date(item.createdAt).toLocaleString("ko-KR")} 저장</span>
          <span className={patternAvailable ? "reference-pattern-state available" : "reference-pattern-state"}>
            {patternAvailable ? "패턴 있음" : "패턴 분석 없음"}
          </span>
        </span>
      </button>
      {onFavorite ? (
        <button
          className="reference-card__favorite"
          type="button"
          aria-label={`${item.title} ${item.favorite ? "즐겨찾기 해제" : "즐겨찾기"}`}
          aria-pressed={item.favorite}
          onClick={() => onFavorite(item)}
        >
          <Heart size={18} fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      ) : (
        <span className="reference-card__favorite-state">
          <Heart size={16} fill={item.favorite ? "currentColor" : "none"} aria-hidden="true" />
          {item.favorite ? "즐겨찾기됨" : "즐겨찾기 아님"}
        </span>
      )}
    </article>
  );
}
