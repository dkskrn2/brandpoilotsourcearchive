import { useEffect, useState } from "react";
import type { LibraryGateway, ProductImageImportStatus, ProductServiceImageAsset } from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

type ProductImageGateway = Pick<LibraryGateway, "listProductImages" | "uploadProductImage" | "deleteProductImage">
  & Partial<Pick<LibraryGateway, "getProductImageImportStatus" | "retryProductImageImport">>;

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
  const [importStatus, setImportStatus] = useState<ProductImageImportStatus | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      const status = await (gateway.getProductImageImportStatus?.(brandId, productId, versionId).catch(() => null)
        ?? Promise.resolve(null));
      const loaded = await gateway.listProductImages(brandId, productId, versionId);
      if (active) { setImages(loaded); setImportStatus(status); }
    })()
      .catch(() => { if (active) setError("제품 이미지를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [brandId, gateway, productId, versionId]);

  useEffect(() => {
    if (importStatus?.status !== "pending" && importStatus?.status !== "processing") return;
    let active = true;
    const timer = window.setInterval(() => {
      if (!gateway.getProductImageImportStatus) return;
      void gateway.getProductImageImportStatus(brandId, productId, versionId).then(async (status) => {
        if (!active) return;
        setImportStatus(status);
        if (status?.status === "succeeded") {
          const loaded = await gateway.listProductImages(brandId, productId, versionId);
          if (active) setImages(loaded);
        }
      }).catch(() => undefined);
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [brandId, gateway, importStatus?.status, productId, versionId]);

  async function retryImport() {
    if (busy || !gateway.retryProductImageImport) return;
    setBusy(true);
    setError(null);
    try {
      setImportStatus(await gateway.retryProductImageImport(brandId, productId, versionId));
    } catch {
      setError("제품 이미지 가져오기를 다시 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

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
    } catch (uploadError) {
      const code = uploadError instanceof Error ? uploadError.message : "";
      setError(code === "product_image_blob_upload_failed"
        ? "브라우저에서 이미지 저장소로 업로드하지 못했습니다. 다시 시도해 주세요."
        : code === "product_image_confirm_failed"
          ? "업로드한 이미지를 서버에서 확인하지 못했습니다. 다시 시도해 주세요."
          : "PNG, JPG, WEBP 이미지를 5MB 이하로 등록해 주세요.");
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
    {importStatus?.status === "failed" ? <Alert title="제품 페이지 이미지" variant="warn">
      제품 페이지 이미지를 가져오지 못했습니다. <button className="button quiet" type="button" disabled={busy}
        onClick={() => void retryImport()}>제품 이미지 다시 가져오기</button>
    </Alert> : null}
    {importStatus?.status === "pending" || importStatus?.status === "processing"
      ? <p className="muted"><InlineSpinner label="제품 페이지 이미지 가져오는 중" /> 제품 페이지에서 이미지를 가져오는 중입니다.</p>
      : null}
    {loading ? <InlineSpinner label="제품 이미지 불러오는 중" /> : null}
    {!loading && images.length === 0 ? <p className="muted">이미지가 없어도 제품 설명은 콘텐츠에 사용됩니다.</p> : null}
    {images.length ? <div className="product-image-grid">{images.map((image) => <figure key={image.id}>
      <img src={image.storageUrl} alt={`제품 ${image.role === "hero" ? "대표" : "상세"} 이미지`} />
      <figcaption><span>{image.role === "hero" ? "대표" : `상세 ${image.position}`}</span><button className="button quiet" type="button" disabled={busy} aria-label="제품 이미지 삭제" onClick={() => void remove(image)}>삭제</button></figcaption>
    </figure>)}</div> : null}
  </section>;
}
