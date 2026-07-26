import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";
import {
  classifyLibraryError,
  type LibraryGateway,
  type ProductServiceItem,
  type ProductServiceProfile,
} from "../../features/libraries/libraryGateway";

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
}

export function ProductServiceEditor({
  brandId,
  gateway,
  item,
  creating,
  onSaved,
  onCancelCreate,
}: Props) {
  const version = item?.draft ?? item?.activeVersion ?? null;
  const [profile, setProfile] = useState<ProductServiceProfile>(() => version?.profile ?? emptyProfile());
  const [mode, setMode] = useState<"analysis" | "manual">("analysis");
  const [analysisId, setAnalysisId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(version?.profile ?? emptyProfile());
    setNotice(null);
    setError(null);
  }, [item?.id, version?.id, creating]);

  const approved = Boolean(item?.activeVersion);
  const editable = creating || Boolean(item?.draft);

  async function importAnalysis() {
    if (!analysisId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await gateway.createProductServiceFromAnalysis(brandId, analysisId.trim());
      onSaved(saved);
      setNotice(`분석 결과를 초안으로 저장했습니다. 항목 ID: ${saved.id}`);
    } catch (cause) {
      const kind = classifyLibraryError(cause);
      setError(kind === "not_found"
        ? "완료된 분석을 찾을 수 없습니다. 분석 화면에서 ID와 완료 상태를 확인해 주세요."
        : "분석 결과를 초안으로 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

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
      onSaved(saved);
      setNotice(`보관함에 저장했습니다. 항목 ID: ${saved.id}`);
    } catch {
      setError("초안을 저장하지 못했습니다. 필수 입력과 URL 형식을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await gateway.approveProductService(brandId, item.id);
      onSaved(saved);
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
        URL·문서·이미지 또는 직접 입력은 기존 subject analysis에서 처리합니다. 분석이 끝난 뒤 표시되는 분석 ID로 이 보관함 초안을 만듭니다.
      </Alert>
      <div className="library-analysis-actions">
        <Link className="button primary" to="/ai-content/new">AI 분석 열기</Link>
        <label>완료된 분석 ID<input aria-label="완료된 분석 ID" value={analysisId} onChange={(event) => setAnalysisId(event.target.value)} /></label>
        <button className="button" type="button" disabled={!analysisId.trim() || busy} onClick={() => void importAnalysis()}>
          {busy ? <InlineSpinner label="분석 결과 가져오는 중" /> : null}분석 결과로 초안 만들기
        </button>
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
        {editable ? <button className="button" type="submit" disabled={busy}>{busy ? <InlineSpinner label="제품·서비스 저장 중" /> : null}보관함에 저장</button> : null}
        {item?.draft ? <button className="button primary" type="button" disabled={busy} onClick={() => void approve()}>승인</button> : null}
        {creating ? <button className="button quiet" type="button" onClick={() => setMode("analysis")}>AI 분석으로 시작</button> : null}
      </div>
    </form>
  </section>;
}
