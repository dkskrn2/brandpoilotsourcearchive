import { useEffect, useRef, useState } from "react";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";
import {
  type LibraryGateway,
  type ProductServiceItem,
  type ProductServiceProfile,
} from "../../features/libraries/libraryGateway";
import { ProductServiceImageManager } from "./ProductServiceImageManager";

const emptyProfile = (): ProductServiceProfile => ({
  contractVersion: "product-service.v1",
  name: "",
  kind: "product",
  description: "",
  features: [],
  benefits: [],
  cautions: [],
  audiences: [],
  appealsByTarget: {},
  evergreenPurchaseInfo: "",
  sourceUrls: [],
});

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

interface Props {
  brandId: string;
  gateway: LibraryGateway;
  item: ProductServiceItem | null;
  creating: boolean;
  onSaved(item: ProductServiceItem): void;
  onCancelCreate(): void;
  onDirtyChange?(dirty: boolean): void;
}

export function ProductServiceEditor({
  brandId,
  gateway,
  item,
  creating,
  onSaved,
  onCancelCreate,
  onDirtyChange,
}: Props) {
  const version = item?.draft ?? item?.activeVersion ?? null;
  const [profile, setProfile] = useState<ProductServiceProfile>(() => version?.profile ?? emptyProfile());
  const [editing, setEditing] = useState(creating || Boolean(item?.draft && !item.activeVersion));
  const [mode, setMode] = useState<"analysis" | "manual">("analysis");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedCreationId = useRef<string | null>(null);

  useEffect(() => {
    const savedCreation = Boolean(item?.id && item.id === savedCreationId.current);
    if (savedCreation) savedCreationId.current = null;
    setProfile(version?.profile ?? emptyProfile());
    setEditing(savedCreation ? false : creating || Boolean(item?.draft && !item.activeVersion));
    setNotice(null);
    setError(null);
  }, [item?.id, creating]);

  const approved = Boolean(item?.activeVersion);
  const editable = editing;
  const dirty = editable && JSON.stringify(profile) !== JSON.stringify(version?.profile ?? emptyProfile());

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  async function save() {
    if (!profile.name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = item
        ? await gateway.updateProductServiceDraft(brandId, item.id, profile)
        : await gateway.createProductService(brandId, profile);
      if (!item) savedCreationId.current = saved.id;
      setProfile(saved.draft?.profile ?? saved.activeVersion?.profile ?? emptyProfile());
      onSaved(saved);
      setEditing(false);
      setNotice(`보관함에 저장했습니다. 항목 ID: ${saved.id}`);
    } catch {
      setError("초안을 저장하지 못했습니다. 필수 입력과 URL 형식을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setProfile(version?.profile ?? emptyProfile());
    setEditing(false);
    setError(null);
    setNotice(null);
    if (creating) onCancelCreate();
  }

  async function approve() {
    if (!item || dirty) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await gateway.approveProductService(brandId, item.id);
      setProfile(saved.activeVersion?.profile ?? saved.draft?.profile ?? emptyProfile());
      onSaved(saved);
      setEditing(false);
      setNotice("승인했습니다. 이제 콘텐츠와 DM에서 사용할 수 있습니다.");
    } catch {
      setError("승인하지 못했습니다. 편집 가능한 초안과 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (creating && mode === "analysis") {
    return <section className="library-editor" aria-label="새 제품·서비스">
      <header className="library-editor-head">
        <div><p className="eyebrow">새 항목</p><h2>AI 분석 결과로 초안 만들기</h2></div>
        <button className="button" type="button" onClick={onCancelCreate}>취소</button>
      </header>
      <Alert title="실제 분석 흐름" variant="info">
        제품·서비스 전용 분석 경로를 준비 중입니다. 현재는 직접 입력으로 초안을 만들 수 있습니다.
      </Alert>
      <div className="library-analysis-actions">
        <button className="button primary" type="button" disabled>AI 분석 준비 중</button>
      </div>
      <button className="button quiet" type="button" onClick={() => setMode("manual")}>AI 없이 직접 입력</button>
      {error ? <Alert title="가져오지 못했습니다" variant="warn">{error}</Alert> : null}
    </section>;
  }

  if (!item && !creating) {
    return <section className="library-editor library-editor-empty">
      <h2>제품·서비스를 선택하세요</h2>
      <p>왼쪽 목록에서 항목을 선택하거나 새 초안을 만드세요.</p>
    </section>;
  }

  return <section className="library-editor" aria-label="제품·서비스 상세">
    <header className="library-editor-head">
      <div>
        <p className="eyebrow">{creating ? "직접 입력" : approved ? "승인된 항목" : "검토 중인 초안"}</p>
        <h2>{profile.name || "새 제품·서비스"}</h2>
        {item ? <code className="stable-item-id">{item.id}</code> : null}
      </div>
      {creating ? <button className="button" type="button" onClick={onCancelCreate}>취소</button> : null}
      {!creating && !editing ? <button className="button primary" type="button" onClick={() => setEditing(true)}>수정</button> : null}
    </header>
    <div className="library-usage" role="group" aria-label="사용 가능 범위">
      <span className={approved ? "is-ready" : ""}>{approved ? "콘텐츠 사용 가능" : "콘텐츠 사용 불가"}</span>
      <span className={approved ? "is-ready" : ""}>{approved ? "DM 사용 가능" : "DM 사용 불가"}</span>
    </div>
    {notice ? <Alert title="처리 결과" variant="ok">{notice}</Alert> : null}
    {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
    <form className="library-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>유형<select aria-label="유형" disabled={!editable} value={profile.kind} onChange={(event) => setProfile({ ...profile, kind: event.target.value as ProductServiceProfile["kind"] })}><option value="product">제품</option><option value="service">서비스</option></select></label>
      <label>이름<input aria-label="이름" disabled={!editable} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
      <label className="is-wide">설명<textarea aria-label="설명" disabled={!editable} value={profile.description} onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label>
      <label>기능 <small>한 줄에 하나</small><textarea aria-label="기능" disabled={!editable} value={profile.features.join("\n")} onChange={(event) => setProfile({ ...profile, features: lines(event.target.value) })} /></label>
      <label>효익 <small>한 줄에 하나</small><textarea aria-label="효익" disabled={!editable} value={profile.benefits.join("\n")} onChange={(event) => setProfile({ ...profile, benefits: lines(event.target.value) })} /></label>
      <label>주의 사항 <small>한 줄에 하나</small><textarea aria-label="주의 사항" disabled={!editable} value={profile.cautions.join("\n")} onChange={(event) => setProfile({ ...profile, cautions: lines(event.target.value) })} /></label>
      <label>상시 구매 정보<textarea aria-label="상시 구매 정보" disabled={!editable} value={profile.evergreenPurchaseInfo} onChange={(event) => setProfile({ ...profile, evergreenPurchaseInfo: event.target.value })} /></label>
      <label className="is-wide">근거 URL <small>한 줄에 하나</small><textarea aria-label="근거 URL" disabled={!editable} value={profile.sourceUrls.join("\n")} onChange={(event) => setProfile({ ...profile, sourceUrls: lines(event.target.value) })} /></label>
      <div className="form-actions is-wide">
        {editable ? <button className="button primary" type="submit" disabled={busy || !dirty}>{busy ? <InlineSpinner label="제품·서비스 저장 중" /> : null}저장</button> : null}
        {editable ? <button className="button" type="button" disabled={busy} onClick={cancel}>취소</button> : null}
        {item?.draft ? <button className="button primary" type="button" disabled={busy || dirty} onClick={() => void approve()}>승인</button> : null}
        {creating ? <button className="button quiet" type="button" onClick={() => setMode("analysis")}>AI 분석으로 시작</button> : null}
        {dirty ? <span className="brand-center-dirty">저장하지 않은 변경</span> : null}
      </div>
    </form>
    {item && version ? <ProductServiceImageManager
      brandId={brandId}
      productId={item.id}
      versionId={version.id}
      gateway={gateway}
    /> : null}
  </section>;
}
