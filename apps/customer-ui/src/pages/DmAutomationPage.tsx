import { useEffect, useState } from "react";
import { DmAttentionPanel } from "../components/dm/DmAttentionPanel";
import { DmConversationList } from "../components/dm/DmConversationList";
import { DmConversationThread } from "../components/dm/DmConversationThread";
import { DmKnowledgePanel } from "../components/dm/DmKnowledgePanel";
import { PageHeader } from "../components/layout/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  DmAttentionItem,
  DmAttentionType,
  DmConversationDetail,
  DmConversationFilter,
  DmConversationSummary,
  KnowledgeImport,
  WikiStatus
} from "../types";

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

export function DmAutomationPage() {
  const [section, setSection] = useState("conversations");
  const [conversationFilter, setConversationFilter] = useState<DmConversationFilter>("all");
  const [conversations, setConversations] = useState<DmConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DmConversationDetail | null>(null);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationLoadingMore, setConversationLoadingMore] = useState(false);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attentionFilter, setAttentionFilter] = useState<DmAttentionType | "all">("all");
  const [attentionItems, setAttentionItems] = useState<DmAttentionItem[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [imports, setImports] = useState<KnowledgeImport[]>([]);
  const [wikiStatus, setWikiStatus] = useState<WikiStatus | null>(null);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [knowledgeNotice, setKnowledgeNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"faq" | "product" | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function loadConversations(filter = conversationFilter, cursor?: string) {
    if (cursor) setConversationLoadingMore(true);
    else setConversationLoading(true);
    setConversationError(null);
    try {
      const page = await api.listDmConversations(DEMO_BRAND_ID, { filter, cursor });
      setConversations((current) => cursor
        ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]
        : page.items);
      setConversationNextCursor(page.nextCursor);
      if (!cursor && selectedId && !page.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch {
      if (!cursor) {
        setConversations([]);
        setSelectedId(null);
        setDetail(null);
        setConversationNextCursor(null);
      }
      setConversationError("DM 대화 목록을 불러오지 못했습니다.");
    } finally {
      if (cursor) setConversationLoadingMore(false);
      else setConversationLoading(false);
    }
  }

  async function loadConversation(conversationId: string) {
    setSelectedId(conversationId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await api.getDmConversation(DEMO_BRAND_ID, conversationId));
    } catch {
      setDetail(null);
      setDetailError("선택한 대화 내용을 불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadAttention(type = attentionFilter) {
    setAttentionLoading(true);
    setAttentionError(null);
    try {
      setAttentionItems(await api.listDmAttentionItems(DEMO_BRAND_ID, type === "all" ? undefined : type));
    } catch {
      setAttentionItems([]);
      setAttentionError("확인 필요 항목을 불러오지 못했습니다.");
    } finally {
      setAttentionLoading(false);
    }
  }

  async function loadKnowledge() {
    setKnowledgeLoading(true);
    setKnowledgeError(null);
    try {
      const [nextImports, nextStatus] = await Promise.all([
        api.listKnowledgeImports(DEMO_BRAND_ID),
        api.getWikiStatus(DEMO_BRAND_ID)
      ]);
      setImports(nextImports);
      setWikiStatus(nextStatus);
    } catch {
      setImports([]);
      setWikiStatus(null);
      setKnowledgeError("지식 데이터와 Wiki 상태를 불러오지 못했습니다.");
    } finally {
      setKnowledgeLoading(false);
    }
  }

  useEffect(() => { void loadConversations("all"); }, []);

  function changeConversationFilter(filter: DmConversationFilter) {
    setConversationFilter(filter);
    setConversationNextCursor(null);
    void loadConversations(filter);
  }

  function changeAttentionFilter(filter: DmAttentionType | "all") {
    setAttentionFilter(filter);
    void loadAttention(filter);
  }

  async function resolveAttention(item: DmAttentionItem) {
    setResolvingId(item.id);
    try {
      await api.resolveDmAttentionItem(item.id);
      await Promise.all([
        loadAttention(attentionFilter),
        loadConversations(conversationFilter),
        selectedId === item.conversationId ? loadConversation(item.conversationId) : Promise.resolve()
      ]);
    } catch {
      setAttentionError("확인 완료 상태를 저장하지 못했습니다.");
    } finally {
      setResolvingId(null);
    }
  }

  async function uploadKnowledge(entryType: "faq" | "product", file: File) {
    setUploading(entryType);
    setKnowledgeError(null);
    setKnowledgeNotice(null);
    try {
      const result = await api.importKnowledge(DEMO_BRAND_ID, { entryType, fileName: file.name, fileBase64: await fileToBase64(file) });
      setKnowledgeNotice(`${entryType === "faq" ? "FAQ" : "제품"} 반영: 유효 ${result.validRows}행, 중복 ${result.duplicateRows}행, 오류 ${result.invalidRows}행`);
      await loadKnowledge();
    } catch {
      setKnowledgeError(`${entryType === "faq" ? "FAQ" : "제품"} 파일을 업로드하지 못했습니다. 파일 형식과 필수 열을 확인하세요.`);
    } finally {
      setUploading(null);
    }
  }

  async function refreshWiki() {
    setRefreshing(true);
    setKnowledgeError(null);
    try {
      await api.refreshWiki(DEMO_BRAND_ID);
      setKnowledgeNotice("Wiki 재생성 작업을 등록했습니다. 기존 활성 버전은 새 버전이 준비될 때까지 유지됩니다.");
      await loadKnowledge();
    } catch {
      setKnowledgeError("Wiki 재생성 작업을 등록하지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="content dm-automation-page">
      <PageHeader title="DM 자동답변" description="Instagram DM 대화와 담당자 확인 항목, 자동답변 지식을 관리합니다." />
      <Tabs
        defaultId="conversations"
        activeId={section}
        onChange={(next) => {
          setSection(next);
          if (next === "attention") void loadAttention(attentionFilter);
          if (next === "knowledge") void loadKnowledge();
        }}
        items={[
          {
            id: "conversations",
            label: "대화",
            content: (
              <div className={`dm-conversation-layout${selectedId ? " has-selection" : ""}`}>
                <DmConversationList conversations={conversations} selectedId={selectedId} filter={conversationFilter} loading={conversationLoading} loadingMore={conversationLoadingMore} nextCursor={conversationNextCursor} error={conversationError} onFilterChange={changeConversationFilter} onSelect={(id) => void loadConversation(id)} onLoadMore={() => {
                  if (conversationNextCursor) void loadConversations(conversationFilter, conversationNextCursor);
                }} />
                <DmConversationThread detail={detail} loading={detailLoading} error={detailError} resolving={Boolean(resolvingId)} onBack={() => { setSelectedId(null); setDetail(null); }} onResolve={(attentionId) => {
                  const item = detail?.attentionItems.find((candidate) => candidate.id === attentionId);
                  if (item) void resolveAttention(item);
                }} />
              </div>
            )
          },
          {
            id: "attention",
            label: "확인 필요",
            content: <DmAttentionPanel items={attentionItems} filter={attentionFilter} loading={attentionLoading} error={attentionError} resolvingId={resolvingId} onFilterChange={changeAttentionFilter} onResolve={(item) => void resolveAttention(item)} />
          },
          {
            id: "knowledge",
            label: "지식 데이터",
            content: <DmKnowledgePanel imports={imports} wikiStatus={wikiStatus} loading={knowledgeLoading} error={knowledgeError} uploading={uploading} refreshing={refreshing} notice={knowledgeNotice} onUpload={(type, file) => void uploadKnowledge(type, file)} onRefresh={() => void refreshWiki()} />
          }
        ]}
      />
    </section>
  );
}
