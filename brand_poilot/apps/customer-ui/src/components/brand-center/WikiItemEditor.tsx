import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";
import type {
  LibraryGateway,
  ManualWikiItemType,
  WikiItem,
} from "../../features/libraries/libraryGateway";

const labels: Record<ManualWikiItemType | "product" | "service", string> = {
  faq: "FAQ",
  policy: "정책",
  how_to: "사용법",
  guide: "가이드",
  product: "제품",
  service: "서비스",
};

function buildLabel(item: WikiItem) {
  const lastSuccess = item.activeVersionId ? `마지막 성공 ${item.activeVersionId}` : "성공 버전 없음";
  return `${item.buildStatus} · ${lastSuccess}`;
}

interface Props {
  brandId: string;
  gateway: LibraryGateway;
  item: WikiItem | null;
  creating: boolean;
  onSaved(item: WikiItem): void;
  onCancelCreate(): void;
}

export function WikiItemEditor({
  brandId,
  gateway,
  item,
  creating,
  onSaved,
  onCancelCreate,
}: Props) {
  const [itemType, setItemType] = useState<ManualWikiItemType>("faq");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      if (["faq", "policy", "how_to", "guide"].includes(item.itemType)) {
        setItemType(item.itemType as ManualWikiItemType);
      }
      setTitle(item.title);
      setContent(item.content);
    } else {
      setItemType("faq");
      setTitle("");
      setContent("");
    }
    setError(null);
    setNotice(null);
  }, [item?.id, creating]);

  async function save(status?: "draft" | "active" | "inactive") {
    if (!title.trim() || !content.trim()) {
      setError("제목과 내용을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = item
        ? await gateway.updateWikiItem(brandId, item.id, { title, content, ...(status ? { status } : {}) })
        : await gateway.createWikiItem(brandId, {
          contractVersion: "wiki-item.v1",
          itemType,
          title,
          content,
          provenance: { input: "manual" },
        });
      onSaved(saved);
      setNotice(status === "active" ? "활성화하고 Wiki 빌드를 요청했습니다." : `저장했습니다. 항목 ID: ${saved.id}`);
    } catch {
      setError("Wiki 항목을 저장하지 못했습니다. 입력 내용과 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!item && !creating) {
    return <section className="library-editor library-editor-empty">
      <h2>Wiki 항목을 선택하세요</h2>
      <p>FAQ, 정책, 사용법 또는 가이드를 선택해 상세 내용을 확인합니다.</p>
    </section>;
  }

  const readOnly = item?.origin === "product_service" || item?.status === "read_only";

  return <section className="library-editor" aria-label="Wiki 항목 상세">
    <header className="library-editor-head">
      <div>
        <p className="eyebrow">{item ? labels[item.itemType] : "새 Wiki 항목"}</p>
        <h2>{title || "새 Wiki 항목"}</h2>
        {item ? <><code className="stable-item-id">{item.id}</code><span className={`wiki-build-state is-${item.buildStatus}`}>{buildLabel(item)}</span></> : null}
      </div>
      {creating ? <button className="button" type="button" onClick={onCancelCreate}>취소</button> : null}
    </header>
    {readOnly ? <Alert title="읽기 전용 원본" variant="info">
      제품·서비스에서 관리되는 읽기 전용 항목입니다.
      <Link className="button" to={`/brand-center?tab=products&item=${item?.sourceId}`}>제품·서비스 원본 열기</Link>
    </Alert> : null}
    {notice ? <Alert title="처리 결과" variant="ok">{notice}</Alert> : null}
    {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
    <form className="library-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>유형<select aria-label="Wiki 유형" disabled={Boolean(item) || readOnly} value={itemType} onChange={(event) => setItemType(event.target.value as ManualWikiItemType)}><option value="faq">FAQ</option><option value="policy">정책</option><option value="how_to">사용법</option><option value="guide">가이드</option></select></label>
      <label className="is-wide">제목<input aria-label="Wiki 제목" disabled={readOnly} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="is-wide">내용<textarea aria-label="Wiki 내용" disabled={readOnly} value={content} onChange={(event) => setContent(event.target.value)} /></label>
      {!readOnly ? <div className="form-actions is-wide">
        <button className="button" type="submit" disabled={busy}>{busy ? <InlineSpinner label="Wiki 항목 저장 중" /> : null}초안 저장</button>
        {item ? <button className="button primary" type="button" disabled={busy} onClick={() => void save("active")}>활성화</button> : null}
      </div> : null}
    </form>
  </section>;
}
