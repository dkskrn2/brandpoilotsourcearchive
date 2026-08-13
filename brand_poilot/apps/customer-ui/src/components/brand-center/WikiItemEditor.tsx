import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Alert } from "../ui/Alert";
import { InlineSpinner } from "../ui/LoadingState";
import type {
  LibraryGateway,
  FaqAliasSuggestionRun,
  ManualWikiItemType,
  WikiItem,
} from "../../features/libraries/libraryGateway";
import { FaqUtteranceEditor, faqUtteranceValidation } from "./FaqUtteranceEditor";

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
  allowedItemType?: ManualWikiItemType;
  contextTitle?: string;
  onSaved(item: WikiItem): void;
  onCancelCreate(): void;
  onDirtyChange?(dirty: boolean): void;
}

export function WikiItemEditor({
  brandId,
  gateway,
  item,
  creating,
  allowedItemType,
  contextTitle,
  onSaved,
  onCancelCreate,
  onDirtyChange,
}: Props) {
  const [itemType, setItemType] = useState<ManualWikiItemType>("faq");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [manualAliases, setManualAliases] = useState<string[]>([]);
  const [aliasRun, setAliasRun] = useState<FaqAliasSuggestionRun | null>(null);
  const [aliasDraft, setAliasDraft] = useState<string[]>([]);
  const [aliasBusy, setAliasBusy] = useState(false);
  const [aliasSuggestionsEnabled, setAliasSuggestionsEnabled] = useState(false);
  const [mode, setMode] = useState<"view" | "edit" | "create">("view");
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
      setManualAliases(item.manualAliases ?? []);
    } else {
      setItemType(allowedItemType ?? "faq");
      setTitle("");
      setContent("");
      setManualAliases([]);
    }
    setMode(creating ? "create" : "view");
    setError(null);
    setNotice(null);
    setAliasRun(null);
    setAliasDraft([]);
  }, [allowedItemType, item?.id, creating]);

  useEffect(() => {
    let active = true;
    setAliasSuggestionsEnabled(false);
    if (typeof gateway.getFaqCapabilities !== "function") return () => { active = false; };
    void gateway.getFaqCapabilities(brandId)
      .then((capabilities) => { if (active) setAliasSuggestionsEnabled(capabilities.suggestions); })
      .catch(() => { if (active) setAliasSuggestionsEnabled(false); });
    return () => { active = false; };
  }, [brandId, gateway]);

  useEffect(() => {
    if (aliasRun?.status === "completed" && aliasRun.exampleUtterances) {
      setAliasDraft(aliasRun.exampleUtterances);
    }
  }, [aliasRun?.id, aliasRun?.completedAt, aliasRun?.status]);

  useEffect(() => {
    if (!item || !aliasRun || !["queued", "running"].includes(aliasRun.status)) return;
    let active = true;
    const timer = window.setInterval(() => {
      void gateway.getLatestFaqAliasSuggestionRun(brandId, item.id)
        .then(({ run }) => { if (active && run) setAliasRun(run); })
        .catch(() => { if (active) setError("표현 예시 제안 상태를 확인하지 못했습니다."); });
    }, 2_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [aliasRun?.id, aliasRun?.status, brandId, gateway, item?.id]);

  const readOnly = item?.origin === "product_service" || item?.status === "read_only";
  const editable = !readOnly && (mode === "edit" || mode === "create");
  const dirty = editable && (
    mode === "create"
      ? Boolean(title.trim() || content.trim())
      : Boolean(item && (
        title !== item.title
        || content !== item.content
        || JSON.stringify(manualAliases) !== JSON.stringify(item.manualAliases ?? [])
      ))
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  async function saveDraft() {
    if (!title.trim() || !content.trim()) {
      setError("제목과 내용을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const aliasesChanged = item?.itemType === "faq"
        && JSON.stringify(manualAliases) !== JSON.stringify(item.manualAliases ?? []);
      const saved = item
        ? await gateway.updateWikiItem(brandId, item.id, {
          title: title.trim(),
          content: content.trim(),
          ...(aliasesChanged ? {
            manualAliases,
            expectedUpdatedAt: item.updatedAt,
          } : {}),
        })
        : await gateway.createWikiItem(brandId, {
          contractVersion: "wiki-item.v1",
          itemType: allowedItemType ?? itemType,
          title: title.trim(),
          content: content.trim(),
          provenance: { input: "manual" },
        });
      onSaved(saved);
      setTitle(saved.title);
      setContent(saved.content);
      setManualAliases(saved.manualAliases ?? []);
      setMode("view");
      setNotice(contextTitle
        ? `${contextTitle}를 저장했습니다.`
        : `초안으로 저장했습니다. 항목 ID: ${saved.id}`);
    } catch {
      setError("Wiki 항목을 저장하지 못했습니다. 입력 내용과 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function suggestAliases() {
    if (!item || item.itemType !== "faq") return;
    setAliasBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { run } = await gateway.createFaqAliasSuggestionRun(brandId, item.id);
      setAliasRun(run);
    } catch {
      setError("표현 예시 제안을 시작하지 못했습니다. FAQ 상태를 확인해 주세요.");
    } finally {
      setAliasBusy(false);
    }
  }

  async function applyAliasSuggestion() {
    if (!item || !aliasRun?.exampleUtterances) return;
    if (Object.values(faqUtteranceValidation(aliasDraft, 3)).some(Boolean)) {
      setError("표현 예시를 3~8개로 중복 없이 입력해 주세요.");
      return;
    }
    setAliasBusy(true);
    setError(null);
    try {
      const saved = await gateway.applyFaqAliasSuggestionRun(
        brandId,
        item.id,
        aliasRun.id,
        item.updatedAt,
        aliasDraft,
      );
      setManualAliases(saved.manualAliases ?? []);
      onSaved(saved);
      setAliasRun(null);
      setNotice("제안된 표현 예시를 FAQ에 적용했습니다.");
    } catch (cause) {
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 409) {
        setError("FAQ가 먼저 변경되었습니다. 최신 내용을 불러온 뒤 다시 제안해 주세요.");
      } else {
        setError("표현 예시를 적용하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setAliasBusy(false);
    }
  }

  async function changeStatus(status: "active" | "inactive") {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await gateway.updateWikiItem(brandId, item.id, { status });
      onSaved(saved);
      setNotice(status === "active"
        ? "활성화하고 Wiki 빌드를 요청했습니다."
        : "비활성화했습니다. 저장된 항목은 삭제되지 않습니다.");
    } catch {
      setError("Wiki 항목 상태를 변경하지 못했습니다. 권한을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (mode === "create") {
      onCancelCreate();
      return;
    }
    setTitle(item?.title ?? "");
    setContent(item?.content ?? "");
    setManualAliases(item?.manualAliases ?? []);
    setMode("view");
    setError(null);
  }

  if (!item && !creating) {
    return <section className="library-editor library-editor-empty">
      <h2>Wiki 항목을 선택하세요</h2>
      <p>FAQ, 정책, 사용법 또는 가이드를 선택해 상세 내용을 확인합니다.</p>
    </section>;
  }

  return <section className="library-editor" aria-label="Wiki 항목 상세">
    <header className="library-editor-head">
      <div>
        <p className="eyebrow">{item ? labels[item.itemType] : "새 Wiki 항목"}</p>
        <h2>{title || "새 Wiki 항목"}</h2>
        {item ? <><code className="stable-item-id">{item.id}</code><span className={`wiki-build-state is-${item.buildStatus}`}>{buildLabel(item)}</span></> : null}
      </div>
      {!readOnly && mode === "view" && item ? <div className="actions">
        <button className="button primary" type="button" onClick={() => setMode("edit")}>수정</button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => void changeStatus(item.status === "active" ? "inactive" : "active")}
        >
          {item.status === "active" ? "비활성화" : "활성화"}
        </button>
      </div> : null}
    </header>
    {readOnly ? <Alert title="읽기 전용 원본" variant="info">
      제품·서비스에서 관리되는 읽기 전용 항목입니다.
      <Link className="button" to={`/brand-center?tab=products&item=${item?.sourceId}`}>제품·서비스 원본 열기</Link>
    </Alert> : null}
    {notice ? <Alert title="처리 결과" variant="ok">{notice}</Alert> : null}
    {error ? <Alert title="확인해 주세요" variant="warn">{error}</Alert> : null}
    <form className="library-form" onSubmit={(event) => { event.preventDefault(); void saveDraft(); }}>
      <label>유형<select aria-label="Wiki 유형" disabled={Boolean(item) || readOnly || Boolean(allowedItemType)} value={allowedItemType ?? itemType} onChange={(event) => setItemType(event.target.value as ManualWikiItemType)}><option value="faq">FAQ</option><option value="policy">정책</option><option value="how_to">사용법</option><option value="guide">가이드</option></select></label>
      <label className="is-wide">제목<input aria-label="제목" disabled={!editable} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="is-wide">내용<textarea aria-label="내용" disabled={!editable} value={content} onChange={(event) => setContent(event.target.value)} /></label>
      {item?.itemType === "faq" ? <section className="wiki-faq-aliases is-wide" aria-label="FAQ 표현 예시">
        <div className="wiki-faq-alias-head">
          <div><strong>고객 표현 예시</strong><p>질문이 조금 달라도 이 FAQ 후보를 찾는 데 사용합니다.</p></div>
          {mode === "view" && aliasSuggestionsEnabled ? <button
            className="button"
            type="button"
            disabled={aliasBusy || aliasRun?.status === "queued" || aliasRun?.status === "running"}
            onClick={() => void suggestAliases()}
          ><Sparkles size={15} /> {aliasBusy ? "제안 시작 중" : "표현 예시 제안받기"}</button> : null}
        </div>
        {item.sourceAliases?.length ? <div className="faq-alias-source">
          <span>원본 표현 · 읽기 전용</span>
          <div>{item.sourceAliases.map((alias) => <code key={alias}>{alias}</code>)}</div>
        </div> : null}
        <FaqUtteranceEditor
          label="직접 관리하는 표현"
          values={manualAliases}
          disabled={!editable}
          onChange={setManualAliases}
        />
        <div className="faq-alias-effective">
          <span>최종 사용 표현</span>
          <div>{(editable
            ? [...(item.sourceAliases ?? []), ...manualAliases]
            : (item.effectiveAliases ?? [])
          ).map((alias) => <code key={alias}>{alias}</code>)}</div>
        </div>
        {aliasRun?.status === "failed" ? <Alert title="제안 실패" variant="warn">표현 예시를 만들지 못했습니다. 다시 시도해 주세요.</Alert> : null}
        {aliasRun && ["queued", "running"].includes(aliasRun.status) ? <p className="muted">표현 예시를 만들고 있습니다.</p> : null}
        {aliasRun?.status === "completed" && aliasRun.exampleUtterances ? <div className="faq-alias-proposal">
          <FaqUtteranceEditor values={aliasDraft} minItems={3} onChange={setAliasDraft} label="제안된 표현" />
          <button
            className="button primary"
            type="button"
            disabled={aliasBusy || Object.values(faqUtteranceValidation(aliasDraft, 3)).some(Boolean)}
            onClick={() => void applyAliasSuggestion()}
          >제안 적용</button>
        </div> : null}
      </section> : null}
      {editable ? <div className="form-actions is-wide">
        <button className="button primary" type="submit" disabled={busy}>{busy ? <InlineSpinner label="Wiki 항목 저장 중" /> : null}{contextTitle ? "저장" : "초안 저장"}</button>
        <button className="button" type="button" disabled={busy} onClick={cancel}>취소</button>
        {dirty ? <span className="brand-center-dirty">저장하지 않은 변경</span> : null}
      </div> : null}
    </form>
  </section>;
}
