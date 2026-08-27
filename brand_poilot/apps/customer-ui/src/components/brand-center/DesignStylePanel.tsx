import { useEffect, useState } from "react";
import type { DesignStyle, LibraryGateway } from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

type Gateway = Pick<LibraryGateway,
  "listDesignStyles" | "createDesignStyle" | "updateDesignStyle" | "retryDesignStyle" | "uploadReferenceFile"
>;
const statusLabel = {
  queued: "분석 대기 중", processing: "분석 중", ready: "사용 가능", failed: "분석 실패",
} as const;

export function DesignStylePanel({
  brandId,
  gateway,
  onLibraryChanged,
}: {
  brandId: string;
  gateway: Gateway;
  onLibraryChanged?: () => void;
}) {
  const [items, setItems] = useState<DesignStyle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setItems(await gateway.listDesignStyles(brandId)); setError(null); }
    catch { setError("디자인 스타일을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [brandId]);
  useEffect(() => {
    if (!items.some(({ analysisStatus }) => analysisStatus === "queued" || analysisStatus === "processing")) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [items]);

  function edit(item: DesignStyle) {
    setSelectedId(item.id); setName(item.name); setFiles([]); setError(null);
  }
  async function save() {
    const current = items.find(({ id }) => id === selectedId) ?? null;
    if (!name.trim() || (!current && files.length === 0) || files.length > 5) {
      setError("이름과 이미지 1~5장을 등록해 주세요."); return;
    }
    setBusy(true); setError(null);
    try {
      const uploadedIds: string[] = [];
      for (const file of files) {
        const uploaded = await gateway.uploadReferenceFile(brandId, file);
        uploadedIds.push(uploaded.reference.id);
      }
      const referenceItemIds = uploadedIds.length ? uploadedIds : current!.referenceItemIds;
      const input = { contractVersion: "design-style-input.v1" as const, name: name.trim(), referenceItemIds };
      const saved = current
        ? await gateway.updateDesignStyle(brandId, current.id, current.revision, input)
        : await gateway.createDesignStyle(brandId, input);
      setItems((value) => [saved, ...value.filter(({ id }) => id !== saved.id)]);
      setSelectedId(saved.id); setName(saved.name); setFiles([]);
      onLibraryChanged?.();
    } catch { setError("디자인 스타일을 저장하지 못했습니다. 이미지 형식과 상태를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  async function retry(item: DesignStyle) {
    setBusy(true); setError(null);
    try {
      const saved = await gateway.retryDesignStyle(brandId, item.id);
      setItems((value) => value.map((candidate) => candidate.id === saved.id ? saved : candidate));
      onLibraryChanged?.();
    } catch { setError("스타일 분석을 다시 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <section className="panel" aria-label="디자인 스타일">
    <header className="panel-header"><div><p className="eyebrow">DESIGN STYLE</p><h2>디자인 스타일</h2><p>참고 이미지를 등록하면 레이아웃·글자·색상·그래픽 규칙을 자동으로 분석합니다.</p></div>
      <button className="button" type="button" onClick={() => { setSelectedId(null); setName(""); setFiles([]); }}>새 스타일</button></header>
    <div className="panel-body">
      {loading ? <InlineSpinner label="디자인 스타일 불러오는 중" /> : null}
      {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
      <div className="brand-style-preset-layout">
        <aside className="brand-style-preset-list">{items.map((item) => <article key={item.id} className={selectedId === item.id ? "is-selected" : ""}>
          <button type="button" onClick={() => edit(item)}><strong>{item.name}</strong><span>{statusLabel[item.analysisStatus]} · 이미지 {item.referenceItemIds.length}장</span></button>
          {item.analysisStatus === "failed" ? <button className="button quiet" type="button" disabled={busy} onClick={() => void retry(item)}>다시 분석</button> : null}
        </article>)}</aside>
        <div className="library-form">
          <label>스타일 이름<input aria-label="스타일 이름" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="is-wide">참고 이미지<input aria-label="참고 이미지" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 5))} /></label>
          {selectedId && files.length === 0 ? <p className="muted is-wide">새 이미지를 선택하지 않으면 현재 이미지를 유지합니다.</p> : null}
          <div className="form-actions is-wide"><button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? <InlineSpinner label="스타일 저장 중" /> : null}스타일 저장</button></div>
        </div>
      </div>
    </div>
  </section>;
}
