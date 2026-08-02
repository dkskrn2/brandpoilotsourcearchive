import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { DmKnowledgePanel } from "../dm/DmKnowledgePanel";
import { api } from "../../lib/apiClient";
import type { KnowledgeImport, WikiStatus } from "../../types";
import {
  classifyLibraryError,
  libraryGateway,
  type LibraryGateway,
  type ManualWikiItemType,
  type WikiIssue,
  type WikiItem,
} from "../../features/libraries/libraryGateway";
import { WikiItemEditor } from "./WikiItemEditor";

type Filter = "all" | "faq" | "policy" | "how_to" | "guide" | "issues";
export type CanonicalKnowledgeTab = "faq" | "how_to" | "guide";
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type KnowledgeApi = Pick<
  typeof api,
  "listKnowledgeImports" | "getWikiStatus" | "importKnowledge" | "refreshWiki"
>;

interface Props {
  brandId: string;
  initialIssueId?: string | null;
  onCloseIssue?(): void;
  gateway?: LibraryGateway;
  knowledgeApi?: KnowledgeApi;
  category?: CanonicalKnowledgeTab;
  title?: string;
  onDirtyChange?(dirty: boolean): void;
  refreshToken?: number;
}

async function fileToBase64(file: File) {
  const buffer = typeof file.arrayBuffer === "function"
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
      reader.readAsArrayBuffer(file);
    });
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function issueStatusLabel(issue: WikiIssue) {
  if (issue.status === "resolved") return "해결됨";
  if (issue.status === "pending_build") return "빌드 반영 중";
  if (issue.status === "dismissed") return "닫힘";
  return "확인 필요";
}

export function WikiLibraryPanel({
  brandId,
  initialIssueId = null,
  onCloseIssue,
  gateway = libraryGateway,
  knowledgeApi = api,
  category,
  title = "Wiki",
  onDirtyChange,
  refreshToken = 0,
}: Props) {
  const [items, setItems] = useState<WikiItem[]>([]);
  const [issues, setIssues] = useState<WikiIssue[]>([]);
  const [filter, setFilter] = useState<Filter>(category ?? "all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<WikiIssue | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyLibraryError> | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [issueSourceId, setIssueSourceId] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const issueListHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreIssueListFocus = useRef(false);

  const [imports, setImports] = useState<KnowledgeImport[]>([]);
  const [wikiStatus, setWikiStatus] = useState<WikiStatus | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeNotice, setKnowledgeNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"faq" | "product" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const showKnowledgeOperations = !category || category === "guide";

  async function loadKnowledge() {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const [nextImports, nextStatus] = await Promise.all([
        knowledgeApi.listKnowledgeImports(brandId),
        knowledgeApi.getWikiStatus(brandId),
      ]);
      setImports(nextImports);
      setWikiStatus(nextStatus);
    } catch {
      setKnowledgeError("기존 지식 업로드와 Wiki 버전 상태를 불러오지 못했습니다.");
    } finally {
      setKnowledgeLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setErrorKind(null);
    setRouteError(null);
    try {
      const [nextItems, nextIssues] = await Promise.all([
        gateway.listWikiItems(brandId),
        gateway.listWikiIssues(brandId),
      ]);
      setItems(nextItems);
      setIssues(nextIssues);
    } catch (cause) {
      setItems([]);
      setIssues([]);
      setErrorKind(classifyLibraryError(cause, "collection"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    if (showKnowledgeOperations) {
      void loadKnowledge();
    } else {
      setKnowledgeLoading(false);
    }
  }, [brandId, showKnowledgeOperations]);

  useEffect(() => {
    if (refreshToken < 1) return;
    let active = true;
    void gateway.listWikiItems(brandId)
      .then((nextItems) => { if (active) setItems(nextItems); })
      .catch(() => { if (active) setErrorKind("retryable"); });
    return () => { active = false; };
  }, [brandId, gateway, refreshToken]);

  useEffect(() => {
    setFilter(category ?? "all");
    setSelectedId(null);
    setSelectedIssue(null);
    setCreating(false);
  }, [category]);

  useEffect(() => {
    if (loading || !initialIssueId) return;
    const match = uuidPattern.test(initialIssueId)
      ? issues.find((issue) => issue.id === initialIssueId && issue.brandId === brandId)
      : undefined;
    if (match) {
      setSelectedIssue(match);
      setFilter("issues");
      setRouteError(null);
    } else {
      setSelectedIssue(null);
      setRouteError("이 브랜드에서 해당 개선 항목을 찾을 수 없습니다. 링크가 올바른지 확인하거나 지식 개선함에서 다시 선택해 주세요.");
    }
  }, [brandId, initialIssueId, issues, loading]);

  useEffect(() => {
    if (selectedIssue) {
      setIssueSourceId(selectedIssue.sourceId ?? "");
      setIssueError(null);
      detailRef.current?.focus();
    } else if (restoreIssueListFocus.current) {
      restoreIssueListFocus.current = false;
      issueListHeadingRef.current?.focus();
    }
  }, [selectedIssue?.id]);

  function acceptSaved(saved: WikiItem) {
    setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setSelectedId(saved.id);
    setCreating(false);
  }

  function canLeaveEditor() {
    return !editorDirty || window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?");
  }

  const handleEditorDirty = useCallback((dirty: boolean) => {
    setEditorDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  function closeIssue() {
    restoreIssueListFocus.current = true;
    setSelectedIssue(null);
    onCloseIssue?.();
  }

  async function resolveIssue() {
    if (!selectedIssue || !issueSourceId) return;
    const source = items.find((item) => item.id === issueSourceId);
    if (!source) return;
    const sourceKind = source.sourceKind === "service" ? "product_service" : source.sourceKind;
    if (!["faq", "policy", "guide", "product_service"].includes(sourceKind)) {
      setIssueError("이 항목 유형은 개선 항목에 연결할 수 없습니다.");
      return;
    }
    setIssueBusy(true);
    setIssueError(null);
    try {
      const resolved = await gateway.resolveWikiIssue(brandId, selectedIssue.id, {
        sourceKind: sourceKind as "faq" | "policy" | "guide" | "product_service",
        sourceId: source.id,
      });
      setIssues((current) => current.map((issue) => issue.id === resolved.id ? resolved : issue));
      setSelectedIssue(resolved);
    } catch {
      setIssueError("보완 항목을 연결하지 못했습니다. 권한과 항목 상태를 확인해 주세요.");
    } finally {
      setIssueBusy(false);
    }
  }

  async function uploadKnowledge(entryType: "faq" | "product", file: File) {
    setUploading(entryType);
    setKnowledgeError(null);
    setKnowledgeNotice(null);
    try {
      const result = await knowledgeApi.importKnowledge(brandId, {
        entryType,
        fileName: file.name,
        fileBase64: await fileToBase64(file),
      });
      setKnowledgeNotice(`유효 ${result.validRows}행, 중복 ${result.duplicateRows}행, 오류 ${result.invalidRows}행`);
      await loadKnowledge();
    } catch {
      setKnowledgeError("파일을 업로드하지 못했습니다. 형식과 필수 열을 확인해 주세요.");
    } finally {
      setUploading(null);
    }
  }

  async function refreshWiki() {
    setRefreshing(true);
    setKnowledgeError(null);
    try {
      await knowledgeApi.refreshWiki(brandId);
      setKnowledgeNotice("Wiki 재생성 작업을 등록했습니다. 기존 활성 버전은 계속 사용됩니다.");
      await loadKnowledge();
    } catch {
      setKnowledgeError("Wiki 재생성 작업을 등록하지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }

  const visibleItems = filter === "all"
    ? items
    : filter === "issues"
      ? []
      : items.filter((item) => item.itemType === filter);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const allowedItemType = (["faq", "policy", "how_to", "guide"] as string[]).includes(filter)
    ? filter as ManualWikiItemType
    : category;
  const filterOptions: Array<[Filter, string]> = category === "guide"
    ? [["guide", "가이드"], ["policy", "정책"], ["issues", "지식 개선함"]]
    : category
      ? []
      : [
        ["all", "전체"],
        ["faq", "FAQ"],
        ["policy", "정책"],
        ["how_to", "사용법"],
        ["guide", "가이드"],
        ["issues", "지식 개선함"],
      ];

  return <div className="wiki-library-workspace">
    {loading ? <ListSkeleton rows={5} columns={2} label="Wiki 보관함을 불러오는 중입니다." /> : errorKind === "unavailable" ? (
      <Alert title="Wiki 관리 배포 순서 안내" variant="info">
        서버의 Wiki 관리 API 배포가 먼저 필요합니다. API 배포 후 다시 확인하면 기존 Wiki와 개선 항목이 표시됩니다.
        <button className="button" type="button" onClick={() => void load()}>다시 확인</button>
      </Alert>
    ) : <>
      {routeError ? <Alert title="개선 항목을 열 수 없습니다" variant="warn">
      {routeError}<button className="button" type="button" onClick={() => { setFilter("issues"); setRouteError(null); issueListHeadingRef.current?.focus(); }}>지식 개선함 보기</button>
      </Alert> : null}
      {errorKind ? <Alert title="Wiki를 불러오지 못했습니다" variant="warn">연결 상태를 확인한 뒤 다시 시도해 주세요.<button className="button" type="button" onClick={() => void load()}>다시 시도</button></Alert> : null}
      {filterOptions.length ? <div
        className="library-filter-bar"
        role="group"
        aria-label={category === "guide" ? "가이드 보조 메뉴" : "Wiki 필터"}
      >
        {filterOptions.map(([value, label]) => <button
          className={filter === value ? "is-active" : ""}
          type="button"
          key={value}
          aria-pressed={filter === value}
          onClick={() => {
            if (!canLeaveEditor()) return;
            setFilter(value);
            setCreating(false);
            setSelectedId(null);
            setSelectedIssue(null);
          }}
        >{label}</button>)}
      </div> : null}
      <section className="library-split">
      <aside className="library-list" aria-label={category ? `${title} 목록` : "Wiki 목록"}>
        <header><div><h2 ref={issueListHeadingRef} tabIndex={-1}>{filter === "issues" ? "지식 개선함" : category ? title : "Wiki 항목"}</h2><p>활성 항목만 다음 Wiki 버전에 반영됩니다.</p></div>{filter !== "issues" ? <button className="button primary" type="button" onClick={() => {
          if (!canLeaveEditor()) return;
          setCreating(true);
          setSelectedId(null);
        }}>{category ? "새 항목" : "새 Wiki 항목"}</button> : null}</header>
        {filter === "issues" ? (
          issues.length ? <ul>{issues.map((issue) => <li key={issue.id}><button type="button" aria-pressed={selectedIssue?.id === issue.id} className={selectedIssue?.id === issue.id ? "is-selected" : ""} onClick={(event) => { setSelectedIssue(issue); event.currentTarget.dataset.issueCaller = "true"; }}><strong>{issue.question || issue.issueType}</strong><span>{issueStatusLabel(issue)} · {issue.severity}</span></button></li>)}</ul>
            : <EmptyState title="지식 개선 항목이 없습니다" description="답변 근거가 부족한 질문이 감지되면 여기에 표시됩니다." />
        ) : (
          visibleItems.length ? <ul>{visibleItems.map((item) => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} className={selectedId === item.id ? "is-selected" : ""} onClick={() => {
            if (!canLeaveEditor()) return;
            setSelectedId(item.id);
            setCreating(false);
          }}><strong>{item.title}</strong><span>{item.origin === "product_service" ? "제품·서비스 원본" : item.itemType} · {item.buildStatus}</span></button></li>)}</ul>
            : <EmptyState title="해당 Wiki 항목이 없습니다" description="필터를 바꾸거나 새 항목을 추가하세요." />
        )}
      </aside>
      {selectedIssue ? <section className="library-editor wiki-issue-detail" ref={detailRef} tabIndex={-1} role="region" aria-label="지식 개선 상세">
        <header className="library-editor-head"><div><p className="eyebrow">지식 개선함</p><h2>{selectedIssue.question || selectedIssue.issueType}</h2></div><button className="button" type="button" onClick={closeIssue}>닫기</button></header>
        <div className="wiki-issue-meta"><strong>{issueStatusLabel(selectedIssue)}</strong><span>{selectedIssue.buildStatus} · {selectedIssue.activeVersionId ? `마지막 성공 ${selectedIssue.activeVersionId}` : "성공 버전 없음"}</span></div>
        {selectedIssue.status === "resolved" && selectedIssue.sourceId ? <Alert title="연결된 보완 항목" variant="ok">
          해결된 개선 항목입니다. 연결된 source ID: <code>{selectedIssue.sourceId}</code>
          <button className="button" type="button" onClick={() => { setSelectedId(selectedIssue.sourceId); setFilter("all"); closeIssue(); }}>연결된 Wiki 항목 열기</button>
        </Alert> : <div className="wiki-issue-resolution">
          <Alert title={selectedIssue.status === "pending_build" ? "빌드 반영 중" : "보완이 필요합니다"} variant={selectedIssue.status === "pending_build" ? "info" : "warn"}>
            기존 Wiki 항목을 연결하면 다음 빌드에서 해결 여부를 확인합니다.
          </Alert>
          <label>연결할 Wiki 항목<select aria-label="연결할 Wiki 항목" value={issueSourceId} onChange={(event) => setIssueSourceId(event.target.value)}><option value="">선택하세요</option>{items.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <button className="button primary" type="button" disabled={!issueSourceId || issueBusy} onClick={() => void resolveIssue()}>보완 항목 연결</button>
          {issueError ? <Alert title="연결하지 못했습니다" variant="warn">{issueError}</Alert> : null}
        </div>}
      </section> : <WikiItemEditor
        brandId={brandId}
        gateway={gateway}
        item={selected}
        creating={creating}
        allowedItemType={allowedItemType}
        contextTitle={category ? title : undefined}
        onSaved={acceptSaved}
        onCancelCreate={() => setCreating(false)}
        onDirtyChange={handleEditorDirty}
      />}
      </section>
    </>}
    {showKnowledgeOperations ? <section className="wiki-import-preserved" aria-label="기존 지식 가져오기">
      <DmKnowledgePanel
        imports={imports}
        wikiStatus={wikiStatus}
        loading={knowledgeLoading}
        error={knowledgeError}
        uploading={uploading}
        refreshing={refreshing}
        notice={knowledgeNotice}
        onUpload={(type, file) => void uploadKnowledge(type, file)}
        onRefresh={() => void refreshWiki()}
      />
    </section> : null}
  </div>;
}
