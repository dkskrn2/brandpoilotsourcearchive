import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PublishArtifactAsset } from "../../types";

export function ArtifactCarousel({ assets }: { assets: readonly PublishArtifactAsset[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [assets]);
  if (assets.length === 0) return null;

  const activeIndex = Math.min(index, assets.length - 1);
  const active = assets[activeIndex];
  const ratio = active.width && active.height ? `${active.width} / ${active.height}` : "1 / 1";
  return (
    <div className="artifact-carousel" aria-label="카드뉴스 이미지">
      <div className="artifact-carousel__stage" style={{ aspectRatio: ratio }}>
        <div className="artifact-carousel__track" style={{ transform: activeIndex === 0 ? "translateX(0%)" : `translateX(-${activeIndex * 100}%)` }}>
          {assets.map((asset, slideIndex) => (
            <div className="artifact-carousel__slide" key={`${asset.url}-${slideIndex}`} aria-hidden={slideIndex !== activeIndex}>
              <img
                src={asset.url}
                alt={`카드뉴스 슬라이드 ${slideIndex + 1}`}
                draggable={false}
                loading={slideIndex === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            </div>
          ))}
        </div>
        {assets.length > 1 ? (
          <>
            <button type="button" className="artifact-carousel__arrow artifact-carousel__arrow--previous" aria-label="이전 이미지" onClick={() => setIndex((current) => (current - 1 + assets.length) % assets.length)}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" className="artifact-carousel__arrow artifact-carousel__arrow--next" aria-label="다음 이미지" onClick={() => setIndex((current) => (current + 1) % assets.length)}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
      {assets.length > 1 ? (
        <div className="artifact-carousel__footer">
          <span>{activeIndex + 1} / {assets.length}</span>
          <div className="artifact-carousel__dots" aria-hidden="true">
            {assets.map((asset, dotIndex) => <i key={`${asset.url}-${dotIndex}`} className={dotIndex === activeIndex ? "is-active" : ""} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
