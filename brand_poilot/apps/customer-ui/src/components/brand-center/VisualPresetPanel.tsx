import { useEffect, useState } from "react";
import type { Avatar, DesignStyle, LibraryGateway, VisualPreset } from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

type Gateway = Pick<LibraryGateway,
  "listDesignStyles" | "listAvatars" | "listVisualPresets" | "createVisualPreset" | "updateVisualPreset" | "setDefaultVisualPreset"
>;
const reason = { style_analyzing: "스타일 분석 중", style_analysis_failed: "스타일 분석 실패", avatar_unavailable: "아바타 사용 불가" } as const;

export function VisualPresetPanel({ brandId, gateway }: { brandId: string; gateway: Gateway }) {
  const [styles, setStyles] = useState<DesignStyle[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [presets, setPresets] = useState<VisualPreset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [designStyleId, setDesignStyleId] = useState("");
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [nextStyles, nextAvatars, nextPresets] = await Promise.all([
        gateway.listDesignStyles(brandId), gateway.listAvatars(brandId), gateway.listVisualPresets(brandId),
      ]);
      setStyles(nextStyles); setAvatars(nextAvatars.filter(({ status }) => status === "active")); setPresets(nextPresets); setError(null);
    } catch { setError("프리셋 정보를 불러오지 못했습니다."); }
  }
  useEffect(() => { void load(); }, [brandId]);
  const analysisPending = styles.some(({ analysisStatus }) => analysisStatus === "queued" || analysisStatus === "processing")
    || presets.some(({ usability }) => usability.reason === "style_analyzing");
  useEffect(() => {
    if (!analysisPending) return;
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [analysisPending, brandId]);
  function edit(item: VisualPreset) {
    setSelectedId(item.id); setName(item.name); setDesignStyleId(item.designStyleId); setAvatarId(item.avatarId); setError(null);
  }
  async function save() {
    if (!name.trim() || !designStyleId) { setError("프리셋 이름과 디자인 스타일을 선택해 주세요."); return; }
    setBusy(true); setError(null);
    try {
      const input = { contractVersion: "visual-preset-input.v1" as const, name: name.trim(), designStyleId, avatarId, isDefault: false };
      const current = presets.find(({ id }) => id === selectedId) ?? null;
      const saved = current
        ? await gateway.updateVisualPreset(brandId, current.id, current.revision, { ...input, isDefault: current.isDefault })
        : await gateway.createVisualPreset(brandId, input);
      setPresets((value) => [saved, ...value.filter(({ id }) => id !== saved.id)]); edit(saved);
    } catch { setError("프리셋을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function makeDefault(item: VisualPreset) {
    setBusy(true); setError(null);
    try { await gateway.setDefaultVisualPreset(brandId, item.id); await load(); }
    catch { setError("사용 가능한 프리셋만 기본으로 설정할 수 있습니다."); }
    finally { setBusy(false); }
  }
  return <section className="panel" aria-label="프리셋">
    <header className="panel-header"><div><p className="eyebrow">VISUAL PRESET</p><h2>프리셋</h2><p>디자인 스타일과 선택 아바타를 한 번에 사용할 조합으로 저장합니다.</p></div>
      <button className="button" type="button" onClick={() => { setSelectedId(null); setName(""); setDesignStyleId(styles[0]?.id ?? ""); setAvatarId(null); }}>새 프리셋</button></header>
    <div className="panel-body">
      {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
      <div className="brand-style-preset-layout"><aside className="brand-style-preset-list">{presets.map((item) => <article key={item.id} className={selectedId === item.id ? "is-selected" : ""}>
        <button type="button" onClick={() => edit(item)}><strong>{item.name}</strong><span>{item.isDefault ? "기본 · " : ""}{item.usability.usable ? "사용 가능" : reason[item.usability.reason!]}</span></button>
        <button className="button quiet" type="button" disabled={busy || item.isDefault || !item.usability.usable} onClick={() => void makeDefault(item)}>기본으로 설정</button>
      </article>)}</aside>
      <div className="library-form">
        <label>프리셋 이름<input aria-label="프리셋 이름" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>디자인 스타일<select aria-label="디자인 스타일 선택" value={designStyleId} onChange={(event) => setDesignStyleId(event.target.value)}><option value="">선택</option>{styles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.analysisStatus === "ready" ? "사용 가능" : "분석 중"}</option>)}</select></label>
        <label>아바타 (선택)<select aria-label="아바타 선택" value={avatarId ?? ""} onChange={(event) => setAvatarId(event.target.value || null)}><option value="">사용 안 함</option>{avatars.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="form-actions is-wide"><button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? <InlineSpinner label="프리셋 저장 중" /> : null}프리셋 저장</button></div>
      </div></div>
    </div>
  </section>;
}
