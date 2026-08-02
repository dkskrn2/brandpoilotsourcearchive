import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { DmConversationList } from "../components/dm/DmConversationList";
import { DmConversationThread } from "../components/dm/DmConversationThread";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { InlineSpinner } from "../components/ui/LoadingState";
import { PageHeader } from "../components/layout/PageHeader";
import { Switch } from "../components/ui/Switch";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  DmAttentionItem,
  DmConversationDetail,
  DmConversationFilter,
  DmConversationSummary,
  InstagramDmSettings
} from "../types";

function isReady(settings: InstagramDmSettings) {
  return settings.brandCoreReady
    && settings.wikiReady
    && settings.messagePermissionReady
    && settings.webhookStatus === "connected"
    && settings.workerStatus === "online";
}

function canProvisionWiki(settings: InstagramDmSettings) {
  return settings.brandCoreReady
    && (settings.wikiStatus === "empty" || settings.wikiStatus === "failed")
    && settings.messagePermissionReady
    && settings.webhookStatus === "connected"
    && settings.workerStatus === "online";
}

function dmWikiStatus(settings: InstagramDmSettings) {
  return settings.wikiStatus;
}

function isActivationBlocked(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "errorCode" in error
    && (error as { errorCode?: unknown }).errorCode === "dm_activation_blocked";
}

export function DmAutomationPage() {
  const [settings, setSettings] = useState<InstagramDmSettings | null>(null);
  const [llmPreviewEnabled, setLlmPreviewEnabled] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsUpdating, setSettingsUpdating] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [conversationFilter, setConversationFilter] = useState<DmConversationFilter>("all");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversations, setConversations] = useState<DmConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DmConversationDetail | null>(null);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [conversationLoadingMore, setConversationLoadingMore] = useState(false);
  const [conversationNextCursor, setConversationNextCursor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const conversationsRef = useRef<DmConversationSummary[]>([]);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);

  function replaceConversations(next: DmConversationSummary[]) {
    conversationsRef.current = next;
    setConversations(next);
  }

  async function loadSettings() {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      setSettings(await api.getInstagramDmSettings(DEMO_BRAND_ID));
    } catch {
      setSettings(null);
      setSettingsError("DM 자동답변 준비 상태를 불러오지 못했습니다.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function toggleAutomation(enabled: boolean) {
    if (!settings || settingsUpdating || (enabled && !isReady(settings) && !canProvisionWiki(settings))) return;
    setSettingsUpdating(true);
    setSettingsError(null);
    setSettingsNotice(null);
    try {
      setSettings(await api.updateInstagramDmSettings(DEMO_BRAND_ID, { enabled }));
      setSettingsNotice(enabled ? "자동답변이 켜졌습니다." : "자동답변이 꺼졌습니다.");
    } catch (error) {
      if (enabled && isActivationBlocked(error)) {
        await loadSettings();
        return;
      }
      setSettingsError(enabled
        ? "자동답변을 켜지 못했습니다. 준비 상태를 다시 확인해 주세요."
        : "자동답변을 끄지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSettingsUpdating(false);
    }
  }

  async function loadConversations(filter = conversationFilter, cursor?: string) {
    const requestId = ++listRequestRef.current;
    if (cursor) setConversationLoadingMore(true);
    else setConversationLoading(true);
    setConversationError(null);
    try {
      const page = await api.listDmConversations(DEMO_BRAND_ID, { filter, cursor });
      if (requestId !== listRequestRef.current) return;
      const next = cursor
        ? [...conversationsRef.current, ...page.items.filter((item) => !conversationsRef.current.some((existing) => existing.id === item.id))]
        : page.items;
      replaceConversations(next);
      setConversationNextCursor(page.nextCursor);
      if (!cursor && selectedId && !page.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch {
      if (requestId !== listRequestRef.current) return;
      if (conversationsRef.current.length === 0) {
        replaceConversations([]);
        setSelectedId(null);
        setDetail(null);
        setConversationNextCursor(null);
        setConversationError("DM 대화 목록을 불러오지 못했습니다.");
      } else {
        setConversationError("새 대화를 불러오지 못했습니다. 기존 대화를 표시하고 있습니다.");
      }
    } finally {
      if (requestId === listRequestRef.current) {
        if (cursor) setConversationLoadingMore(false);
        else setConversationLoading(false);
      }
    }
  }

  async function loadConversation(conversationId: string) {
    const requestId = ++detailRequestRef.current;
    setSelectedId(conversationId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const next = await api.getDmConversation(DEMO_BRAND_ID, conversationId);
      if (requestId === detailRequestRef.current) setDetail(next);
    } catch {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setDetailError("선택한 대화 내용을 불러오지 못했습니다.");
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
    void loadConversations("all");
  }, []);

  function changeConversationFilter(filter: DmConversationFilter) {
    setConversationFilter(filter);
    setConversationNextCursor(null);
    void loadConversations(filter);
  }

  async function resolveAttention(item: DmAttentionItem) {
    setResolvingId(item.id);
    try {
      await api.resolveDmAttentionItem(item.id);
      await Promise.all([
        loadConversations(conversationFilter),
        selectedId === item.conversationId ? loadConversation(item.conversationId) : Promise.resolve()
      ]);
    } catch {
      setDetailError("확인 완료 상태를 저장하지 못했습니다.");
    } finally {
      setResolvingId(null);
    }
  }

  async function sendManualReply(body: string, idempotencyKey: ReturnType<Crypto["randomUUID"]>) {
    if (!selectedId) return;
    await api.sendManualDmReply(DEMO_BRAND_ID, selectedId, body, idempotencyKey);
    await Promise.all([
      loadConversation(selectedId),
      loadConversations(conversationFilter)
    ]);
  }

  const ready = settings ? isReady(settings) : false;

  return (
    <section className="content dm-automation-page">
      <PageHeader title="Instagram 고객응대" description="FAQ 우선 자동답변 상태를 확인하고 고객 대화와 수동 상담을 한곳에서 처리합니다." />

      <section className="panel dm-readiness-panel" aria-label="DM 자동답변 준비도">
        <div className="panel-head">
          <div>
            <h2>자동답변 설정</h2>
            <p className="muted small">FAQ를 먼저 확인하고, 선택한 경우에만 Wiki 기반 답변을 사용합니다.</p>
          </div>
          {settings ? (
            <div className="actions">
              <Badge variant={settings.enabled ? "ok" : "neutral"}>{settings.enabled ? "ON" : "OFF"}</Badge>
              <Switch
                label="DM 자동답변"
                checked={settings.enabled}
                disabled={settingsUpdating || (!settings.enabled && !ready && !canProvisionWiki(settings))}
                onChange={(enabled) => void toggleAutomation(enabled)}
              />
            </div>
          ) : null}
        </div>
        <div className="panel-body grid">
          {settingsLoading ? <div role="status" aria-label="DM 준비 상태를 불러오는 중입니다."><InlineSpinner label="DM 준비 상태 로딩 중" /> 준비 상태 확인 중</div> : null}
          {!settingsLoading && settingsError ? <Alert title="준비 상태 오류" variant="bad">{settingsError} <button className="button" type="button" onClick={() => void loadSettings()}>다시 시도</button></Alert> : null}
          {!settingsLoading && settings ? <>
            {dmWikiStatus(settings) === "building" ? (
              <Alert title="첫 Wiki 준비 중" variant="warn">
                첫 Wiki를 준비하고 있습니다. 기존 설정은 꺼진 상태이며 준비가 끝난 뒤 다시 활성화할 수 있습니다.
              </Alert>
            ) : null}
            <div className="dm-control-grid">
              <article className="dm-control-item">
                <div className="dm-control-copy">
                  <div className="dm-control-title"><strong>FAQ 답변</strong><Badge variant="ok">항상 우선</Badge></div>
                  <p>활성 FAQ와 일치하면 저장된 답변을 그대로 보냅니다.</p>
                </div>
                <a className="button" href="/brand-center?tab=faq">FAQ 관리 <ExternalLink size={14} /></a>
              </article>
              <article className="dm-control-item dm-control-item--llm">
                <div className="dm-control-copy">
                  <div className="dm-control-title"><strong>LLM 답변</strong><Badge variant="info">UI 미리보기</Badge></div>
                  <p>FAQ에 없을 때 활성 Wiki를 근거로 답변합니다.</p>
                </div>
                <Switch
                  label="LLM 답변"
                  checked={llmPreviewEnabled}
                  disabled={!settings.enabled || !settings.wikiReady}
                  onChange={setLlmPreviewEnabled}
                />
              </article>
            </div>
            <p className="dm-preview-note">UI 미리보기입니다. LLM 설정은 저장되지 않습니다.</p>
            <div className="dm-readiness-summary">
              <strong>{ready ? "자동답변 준비 완료" : "자동답변을 켤 수 없습니다"}</strong>
              <div className="actions">
                <Badge variant={settings.wikiReady ? "ok" : "warn"}>LLM 정보 {settings.wikiReady ? "준비됨" : "생성 필요"}</Badge>
                <Badge variant={settings.messagePermissionReady ? "ok" : "warn"}>메시지 권한 {settings.messagePermissionReady ? "확인됨" : "필요"}</Badge>
                <Badge variant={settings.workerStatus === "online" ? "ok" : "warn"}>워커 {settings.workerStatus === "online" ? "온라인" : "확인 필요"}</Badge>
                <Badge variant={settings.webhookStatus === "connected" ? "ok" : "neutral"}>Webhook {settings.webhookStatus === "connected" ? "연결됨" : "확인 필요"}</Badge>
              </div>
            </div>
            {!ready ? <Alert title="해결 후 활성화하세요" variant="warn">
              <span className="dm-repair-links">
                {!settings.brandCoreReady || !settings.wikiReady ? <a href="/brand-center?tab=knowledge">Wiki 보완하기 <ExternalLink size={14} /></a> : null}
                {!settings.messagePermissionReady || settings.webhookStatus !== "connected" || settings.workerStatus !== "online" ? <a href="/channels">Instagram 연결 확인 <ExternalLink size={14} /></a> : null}
              </span>
            </Alert> : null}
            <p className="dm-wiki-link">
              답변 내용은 브랜드 센터에서 관리합니다.
              <a href="/brand-center?tab=knowledge">LLM 답변 정보 관리 <ExternalLink size={14} /></a>
            </p>
          </> : null}
          {settingsUpdating ? <div role="status"><InlineSpinner label="자동답변 상태 저장 중" /> 상태 저장 중</div> : null}
          {settingsNotice ? <p className="notice success" role="status">{settingsNotice}</p> : null}
        </div>
      </section>

      <div className="dm-conversation-toolbar">
        <div><h2>고객 대화</h2><p className="muted small">최신 Instagram 메시지와 상담 필요 상태를 확인합니다.</p></div>
        <button className="button" type="button" aria-label="대화 새로고침" disabled={conversationLoading} onClick={() => void loadConversations(conversationFilter)}>
          <RefreshCw size={16} /> 새로고침
        </button>
      </div>
      <div className={`dm-conversation-layout${selectedId ? " has-selection" : ""}`}>
        <DmConversationList
          conversations={conversations}
          selectedId={selectedId}
          filter={conversationFilter}
          search={conversationSearch}
          loading={conversationLoading}
          loadingMore={conversationLoadingMore}
          nextCursor={conversationNextCursor}
          error={conversationError}
          onSearchChange={setConversationSearch}
          onFilterChange={changeConversationFilter}
          onSelect={(id) => void loadConversation(id)}
          onLoadMore={() => {
            if (conversationNextCursor) void loadConversations(conversationFilter, conversationNextCursor);
          }}
        />
        <DmConversationThread
          detail={detail}
          loading={detailLoading}
          error={detailError}
          resolving={Boolean(resolvingId)}
          onBack={() => {
            detailRequestRef.current += 1;
            setSelectedId(null);
            setDetail(null);
          }}
          onResolve={(attentionId) => {
            const item = detail?.attentionItems.find((candidate) => candidate.id === attentionId);
            if (item) void resolveAttention(item);
          }}
          onManualReply={sendManualReply}
        />
      </div>
    </section>
  );
}
