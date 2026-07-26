import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import {
  classifyLibraryError,
  libraryGateway,
  type LibraryGateway,
  type ProductServiceItem,
} from "../../features/libraries/libraryGateway";
import { ProductServiceEditor } from "./ProductServiceEditor";

interface Props {
  brandId: string;
  gateway?: LibraryGateway;
  initialItemId?: string | null;
  initialAnalysisId?: string | null;
  onAnalysisConsumed?(): void;
}

export function ProductServiceLibraryPanel({
  brandId,
  gateway = libraryGateway,
  initialItemId = null,
  initialAnalysisId = null,
  onAnalysisConsumed,
}: Props) {
  const [items, setItems] = useState<ProductServiceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialItemId);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ReturnType<typeof classifyLibraryError> | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [analysisImporting, setAnalysisImporting] = useState(false);
  const consumedAnalysisId = useRef<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const next = await gateway.listProductServices(brandId);
      setItems(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : null);
    } catch (cause) {
      setItems([]);
      setError(classifyLibraryError(cause, "collection"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [brandId]);

  async function consumeAnalysis(analysisId: string) {
    consumedAnalysisId.current = analysisId;
    setAnalysisImporting(true);
    setHandoffError(null);
    try {
      const saved = await gateway.createProductServiceFromAnalysis(brandId, analysisId);
      acceptSaved(saved);
      onAnalysisConsumed?.();
    } catch {
      consumedAnalysisId.current = null;
      setHandoffError("완료된 분석을 제품·서비스 초안으로 가져오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setAnalysisImporting(false);
    }
  }

  useEffect(() => {
    if (loading || !initialAnalysisId || consumedAnalysisId.current === initialAnalysisId) return;
    void consumeAnalysis(initialAnalysisId);
  }, [initialAnalysisId, loading]);

  function acceptSaved(saved: ProductServiceItem) {
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setSelectedId(saved.id);
    setCreating(false);
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;

  if (loading) return <ListSkeleton rows={5} columns={2} label="제품·서비스 보관함을 불러오는 중입니다." />;
  if (error === "unavailable") {
    return <Alert title="제품·서비스 보관함 배포 순서 안내" variant="info">
      서버의 제품·서비스 라이브러리 배포가 먼저 필요합니다. API 배포 후 다시 확인하면 기존 데이터가 표시됩니다.
      <button className="button" type="button" onClick={() => void load()}>다시 확인</button>
    </Alert>;
  }

  return <section className="library-split product-service-library">
    <aside className="library-list" aria-label="제품·서비스 목록">
      <header><div><h2>제품·서비스</h2><p>승인된 정보만 콘텐츠와 DM에서 사용됩니다.</p></div><button className="button primary" type="button" onClick={() => { setCreating(true); setSelectedId(null); }}>새 제품·서비스</button></header>
      {error ? <Alert title="목록을 불러오지 못했습니다" variant="warn">연결 상태를 확인한 뒤 다시 시도해 주세요.<button className="button" type="button" onClick={() => void load()}>다시 시도</button></Alert> : null}
      {analysisImporting ? <Alert title="분석 결과 반영 중" variant="info">완료된 AI 분석으로 제품·서비스 초안을 만들고 있습니다.</Alert> : null}
      {handoffError ? <Alert title="분석 결과를 가져오지 못했습니다" variant="warn">{handoffError}{initialAnalysisId ? <button className="button" type="button" onClick={() => void consumeAnalysis(initialAnalysisId)}>다시 시도</button> : null}</Alert> : null}
      {!error && items.length === 0 ? <EmptyState title="저장된 제품·서비스가 없습니다" description="AI 분석 또는 직접 입력으로 첫 초안을 만드세요." /> : null}
      <ul>
        {items.map((item) => <li key={item.id}>
          <button
            className={selectedId === item.id ? "is-selected" : ""}
            type="button"
            aria-pressed={selectedId === item.id}
            onClick={() => { setSelectedId(item.id); setCreating(false); }}
          >
            <strong>{item.displayName}</strong>
            <span>{item.kind === "product" ? "제품" : "서비스"} · {item.activeVersion ? "승인됨" : "초안"}</span>
          </button>
        </li>)}
      </ul>
    </aside>
    <ProductServiceEditor
      brandId={brandId}
      gateway={gateway}
      item={selected}
      creating={creating}
      onSaved={acceptSaved}
      onCancelCreate={() => setCreating(false)}
    />
  </section>;
}
