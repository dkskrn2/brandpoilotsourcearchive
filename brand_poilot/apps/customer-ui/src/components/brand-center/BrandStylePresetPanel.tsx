import { useEffect, useMemo, useState } from "react";
import type { BrandStylePreset, BrandStylePresetInput, LibraryGateway } from "../../features/libraries/libraryGateway";
import type { ReferenceItem } from "../../types";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";

type StylePresetGateway = Pick<LibraryGateway,
  "listStylePresets" | "listReferenceItems" | "createStylePreset" | "updateStylePreset" | "setDefaultStylePreset" | "archiveStylePreset"
>;

const emptyInput = (): BrandStylePresetInput => ({
  contractVersion: "brand-style-preset.v1",
  name: "",
  description: "",
  visualTokens: { colors: [], fonts: [], notes: [] },
  referenceItemIds: [],
  isDefault: false,
});

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function presetInput(preset: BrandStylePreset): BrandStylePresetInput {
  return {
    contractVersion: "brand-style-preset.v1",
    name: preset.name,
    description: preset.description,
    visualTokens: preset.visualTokens,
    referenceItemIds: preset.referenceItemIds,
    isDefault: preset.isDefault,
  };
}

export function BrandStylePresetPanel({ brandId, gateway }: { brandId: string; gateway: StylePresetGateway }) {
  const [presets, setPresets] = useState<BrandStylePreset[]>([]);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState<BrandStylePresetInput>(emptyInput);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imageReferences = useMemo(() => references.filter((item) => (
    item.kind === "upload" && item.archivedAt === null && item.previewUrl && typeof item.format === "string"
      && ["image/png", "image/jpeg", "image/webp"].includes(item.format.toLowerCase())
  )), [references]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [loadedPresets, loadedReferences] = await Promise.all([
        gateway.listStylePresets(brandId),
        gateway.listReferenceItems(brandId),
      ]);
      setPresets(loadedPresets.filter(({ status }) => status === "active"));
      setReferences(loadedReferences);
    } catch {
      setError("스타일 프리셋을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [brandId]);

  function edit(preset: BrandStylePreset) {
    setSelectedId(preset.id);
    setInput(presetInput(preset));
    setMessage(null);
    setError(null);
  }

  async function save() {
    if (!input.name.trim() || input.referenceItemIds.length === 0) {
      setError("스타일 이름과 참고 이미지 1개 이상을 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const normalizedInput = {
        ...input,
        name: input.name.trim(),
        description: input.description.trim(),
        visualTokens: {
          colors: csv(input.visualTokens.colors.join(",")),
          fonts: csv(input.visualTokens.fonts.join(",")),
          notes: csv(input.visualTokens.notes.join(",")),
        },
      };
      const current = presets.find(({ id }) => id === selectedId) ?? null;
      const saved = current
        ? await gateway.updateStylePreset(brandId, current.id, current.revision, normalizedInput)
        : await gateway.createStylePreset(brandId, normalizedInput);
      setPresets((items) => [...items.filter(({ id }) => id !== saved.id), saved]);
      setSelectedId(saved.id);
      setInput(presetInput(saved));
      setMessage("저장했습니다.");
    } catch {
      setError("스타일 프리셋을 저장하지 못했습니다. 선택한 참고 이미지를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(preset: BrandStylePreset) {
    setBusy(true);
    try {
      await gateway.setDefaultStylePreset(brandId, preset.id);
      await load();
    } catch {
      setError("기본 스타일을 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function archive(preset: BrandStylePreset) {
    setBusy(true);
    try {
      await gateway.archiveStylePreset(brandId, preset.id);
      setPresets((items) => items.filter(({ id }) => id !== preset.id));
      if (selectedId === preset.id) { setSelectedId(null); setInput(emptyInput()); }
    } catch {
      setError("스타일 프리셋을 보관하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel brand-style-preset-panel" aria-label="브랜드 스타일 프리셋">
    <div className="panel-body">
      <header className="library-editor-head">
        <div><p className="eyebrow">콘텐츠 생성 스타일</p><h2>브랜드 스타일 프리셋</h2><p>구성안 선택 뒤 기본 프리셋이 자동 선택되며, 생성 전에 다른 프리셋이나 사용 안 함을 선택할 수 있습니다.</p></div>
        <button className="button" type="button" onClick={() => { setSelectedId(null); setInput(emptyInput()); setMessage(null); }}>새 스타일</button>
      </header>
      {loading ? <InlineSpinner label="브랜드 스타일 불러오는 중" /> : null}
      {message ? <Alert title="처리 결과" variant="ok">{message}</Alert> : null}
      {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
      <div className="brand-style-preset-layout">
        <aside className="brand-style-preset-list" aria-label="저장된 스타일 프리셋">
          {presets.map((preset) => <article key={preset.id} className={selectedId === preset.id ? "is-selected" : ""}>
            <button type="button" onClick={() => edit(preset)}><strong>{preset.name}</strong><span>{preset.isDefault ? "기본 · " : ""}참고 {preset.referenceItemIds.length}개</span></button>
            <div><button className="button quiet" type="button" disabled={busy || preset.isDefault} onClick={() => void makeDefault(preset)}>기본으로</button><button className="button quiet" type="button" disabled={busy} onClick={() => void archive(preset)}>보관</button></div>
          </article>)}
          {!loading && presets.length === 0 ? <p className="muted">등록된 스타일 프리셋이 없습니다.</p> : null}
        </aside>
        <div className="library-form brand-style-preset-form">
          <label>스타일 이름<input aria-label="스타일 이름" value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
          <label>스타일 설명<textarea aria-label="스타일 설명" maxLength={1_000} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
          <label>대표 색상<input aria-label="대표 색상" value={input.visualTokens.colors.join(",")} onChange={(event) => setInput({ ...input, visualTokens: { ...input.visualTokens, colors: event.target.value.split(",") } })} /></label>
          <label>폰트 방향<input aria-label="폰트 방향" value={input.visualTokens.fonts.join(",")} onChange={(event) => setInput({ ...input, visualTokens: { ...input.visualTokens, fonts: event.target.value.split(",") } })} /></label>
          <label className="is-wide">레이아웃 메모<textarea aria-label="레이아웃 메모" value={input.visualTokens.notes.join(",")} onChange={(event) => setInput({ ...input, visualTokens: { ...input.visualTokens, notes: event.target.value.split(",") } })} /></label>
          <fieldset className="is-wide style-reference-picker"><legend>참고 이미지</legend>
            {imageReferences.map((reference) => <label key={reference.id}><input type="checkbox" checked={input.referenceItemIds.includes(reference.id)} onChange={(event) => setInput({ ...input, referenceItemIds: event.target.checked ? [...input.referenceItemIds, reference.id] : input.referenceItemIds.filter((id) => id !== reference.id) })} />
              <img src={reference.previewUrl!} alt="" /><span>{reference.title}</span>
            </label>)}
            {!loading && imageReferences.length === 0 ? <p className="muted">아래 기존 스타일 이미지 영역에서 참고 이미지를 먼저 업로드해 주세요.</p> : null}
          </fieldset>
          <label className="is-wide"><input type="checkbox" checked={input.isDefault} onChange={(event) => setInput({ ...input, isDefault: event.target.checked })} />기본 스타일로 사용</label>
          <div className="form-actions is-wide"><button className="button primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? <InlineSpinner label="스타일 저장 중" /> : null}스타일 저장</button></div>
        </div>
      </div>
    </div>
  </section>;
}
