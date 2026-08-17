import { useEffect, useState } from "react";
import type { LibraryGateway, ProductServiceImageAsset } from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

type ProductImageGateway = Pick<LibraryGateway, "listProductImages" | "uploadProductImage" | "deleteProductImage">;

export function ProductServiceImageManager({
  brandId,
  productId,
  versionId,
  gateway,
}: {
  brandId: string;
  productId: string;
  versionId: string;
  gateway: ProductImageGateway;
}) {
  const [images, setImages] = useState<ProductServiceImageAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void gateway.listProductImages(brandId, productId, versionId)
      .then((loaded) => { if (active) setImages(loaded); })
      .catch(() => { if (active) setError("제품 이미지를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [brandId, gateway, productId, versionId]);

  async function upload(file: File) {
    if (busy || images.length >= 5) return;
    setBusy(true);
    setError(null);
    try {
      const hasHero = images.some(({ role }) => role === "hero");
      const saved = await gateway.uploadProductImage(brandId, productId, versionId, file, {
        role: hasHero ? "detail" : "hero",
        position: images.length + 1,
      });
      setImages((current) => [...current, saved].sort((left, right) => left.position - right.position));
    } catch {
      setError("PNG, JPG, WEBP 이미지를 5MB 이하로 등록해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(image: ProductServiceImageAsset) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await gateway.deleteProductImage(brandId, productId, image.id);
      setImages((current) => current
        .filter(({ id }) => id !== image.id)
        .sort((left, right) => left.position - right.position)
        .map((remaining, index) => ({
          ...remaining,
          role: index === 0 ? "hero" : "detail",
          position: index + 1,
        })));
    } catch {
      setError("제품 이미지를 삭제하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="product-image-manager" aria-label="제품 이미지">
    <header>
      <div><h3>제품 이미지</h3><p>선택 사항 · 최대 5장 · 첫 이미지는 대표 이미지로 사용됩니다.</p></div>
      <label className={`button${busy || images.length >= 5 ? " is-disabled" : ""}`}>
        {busy ? <InlineSpinner label="제품 이미지 처리 중" /> : null}
        이미지 추가
        <input
          className="visually-hidden"
          aria-label="제품 이미지 추가"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy || images.length >= 5}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
    </header>
    {error ? <Alert title="제품 이미지 확인" variant="warn">{error}</Alert> : null}
    {loading ? <InlineSpinner label="제품 이미지 불러오는 중" /> : null}
    {!loading && images.length === 0 ? <p className="muted">이미지가 없어도 제품 설명은 콘텐츠에 사용됩니다.</p> : null}
    {images.length ? <div className="product-image-grid">{images.map((image) => <figure key={image.id}>
      <img src={image.storageUrl} alt={`제품 ${image.role === "hero" ? "대표" : "상세"} 이미지`} />
      <figcaption><span>{image.role === "hero" ? "대표" : `상세 ${image.position}`}</span><button className="button quiet" type="button" disabled={busy} aria-label="제품 이미지 삭제" onClick={() => void remove(image)}>삭제</button></figcaption>
    </figure>)}</div> : null}
  </section>;
}
