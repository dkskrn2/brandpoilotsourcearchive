import type {
  BrandProfile,
  BrandProfileInput,
  BrandUiStatus,
  BillingSummary,
  ChannelConnection,
  ChannelConnectionRequest,
  ChannelType,
  ContentOutput,
  ContentCategory,
  BrandContentFormat,
  InstagramDeliveryFormat,
  InstagramFormatSettings,
  InstagramFormatSettingsInput,
  InstagramTrendFavoriteInput,
  InstagramTrendListInput,
  InstagramTrendPage,
  InstagramTrendSaveSource,
  InstagramTrendSearchHistory,
  InstagramDmHistory,
  InstagramDmSettings,
  DmAttentionItem,
  DmConversationDetail,
  DmConversationFilter,
  DmConversationPage,
  KnowledgeImport,
  KnowledgeImportInput,
  PipelineRunResult,
  PublishArtifact,
  PublishSlot,
  PublishResult,
  SourceSnapshot,
  SourceCrawlRun,
  SourceCreateResult,
  SourceUrl,
  SupportRequest,
  SupportRequestCategory,
  SupportRequestStatus,
  TopicRow,
  TopicUploadSummary,
  WikiStatus
} from "../types";

export let DEMO_BRAND_ID = "00000000-0000-4000-8000-000000000100";
export const BRAND_STATUS_CHANGED_EVENT = "brand-pilot:status-changed";

export function setActiveBrandId(brandId: string) {
  DEMO_BRAND_ID = brandId;
}

interface ApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export interface AuthSession {
  user: { id: string; displayName: string | null; email: string | null };
  workspace: { id: string; name: string };
  brand: { id: string; name: string };
}

interface ApiChannel {
  channel: ChannelType;
  status: ChannelConnection["status"];
  accountLabel: string | null;
  lastHealthyAt: string | null;
  lastPublishedAt: string | null;
  lastError: string | null;
}

interface ApiPublishQueueItem {
  id: string;
  title: string;
  channel: ChannelType;
  status: "queued" | "scheduled" | "publishing" | "published" | "failed" | "deferred" | "cancelled" | "empty";
  approvalType: "manual" | "auto" | "empty";
  scheduledFor: string | null;
  lastError: string | null;
  sourceType: PublishSlot["sourceType"];
  sourceLabel: string;
  sourceDetail: string | null;
  sourceUrls: string[];
  queuedAt: string;
  renderStatus: string | null;
  topicPublishGroupId: string | null;
  slotDate: string | null;
  slotNumber: number | null;
}

function apiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
}

async function request<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const headers = {
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...(init.headers ?? {})
  };
  const response = await fetcher(url, {
    ...init,
    credentials: "include",
    headers
  });
  if (!response.ok) {
    let errorCode: string | null = null;
    try {
      const payload = await response.clone().json();
      errorCode = typeof payload?.error === "string" ? payload.error : null;
    } catch {
      errorCode = null;
    }
    throw new Error(errorCode ? `API request failed: ${response.status}:${errorCode}` : `API request failed: ${response.status}`);
  }
  const payload = await response.json() as T;
  if (init.method !== "GET" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(BRAND_STATUS_CHANGED_EVENT));
  }
  return payload;
}

async function requestBlob(fetcher: typeof fetch, url: string, init: RequestInit): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetcher(url, { ...init, credentials: "include" });
  if (!response.ok) {
    let errorCode: string | null = null;
    try {
      const payload = await response.clone().json();
      errorCode = typeof payload?.error === "string" ? payload.error : null;
    } catch {
      errorCode = null;
    }
    throw new Error(errorCode ? `API request failed: ${response.status}:${errorCode}` : `API request failed: ${response.status}`);
  }
  return {
    blob: await response.blob(),
    fileName: fileNameFromContentDisposition(response.headers.get("content-disposition")) ?? "brand-pilot-published-results.zip"
  };
}

function fileNameFromContentDisposition(value: string | null) {
  if (!value) return null;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="([^"]+)"/i)?.[1] ?? value.match(/filename=([^;]+)/i)?.[1]?.trim() ?? null;
}

function mapChannel(channel: ApiChannel): ChannelConnection {
  const labels: Record<ChannelType, string> = {
    instagram: "Instagram",
    threads: "Threads",
    tiktok: "TikTok",
    youtube: "YouTube",
    x: "X"
  };
  return {
    type: channel.channel,
    label: labels[channel.channel],
    status: channel.status,
    accountLabel: channel.accountLabel ?? "연결 전",
    lastHealthyAt: channel.lastHealthyAt ?? "-",
    lastPublishedAt: channel.lastPublishedAt ?? "-",
    alertTitle: channel.lastError ? "연결 확인 필요" : undefined,
    alertBody: channel.lastError ?? undefined
  };
}

function mapPublishQueueItem(item: ApiPublishQueueItem): PublishSlot {
  return {
    id: item.id,
    channel: item.channel,
    time: item.scheduledFor ? new Date(item.scheduledFor).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "대기",
    title: item.title,
    approvalType: item.approvalType,
    status: item.status,
    sourceType: item.sourceType,
    sourceLabel: item.sourceLabel,
    sourceDetail: item.sourceDetail,
    sourceUrls: Array.isArray(item.sourceUrls) ? item.sourceUrls : [],
    queuedAt: item.queuedAt,
    lastError: item.lastError,
    renderStatus: item.renderStatus ?? null,
    topicPublishGroupId: item.topicPublishGroupId ?? null,
    slotDate: item.slotDate ?? null,
    slotNumber: item.slotNumber ?? null,
    scheduledFor: item.scheduledFor ?? null
  };
}

export function apiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? apiBaseUrl();
  const fetcher =
    options.fetcher ??
    (import.meta.env.MODE === "test"
      ? (() => Promise.reject(new Error("API disabled in component tests"))) as typeof fetch
      : fetch);

  return {
    getAuthSession() {
      return request<AuthSession>(fetcher, `${baseUrl}/auth/me`, { method: "GET" });
    },
    logout() {
      return request<{ ok: true }>(fetcher, `${baseUrl}/auth/logout`, { method: "POST" });
    },
    getBrandUiStatus(brandId: string) {
      return request<BrandUiStatus>(fetcher, `${baseUrl}/brands/${brandId}/ui-status`, { method: "GET" });
    },
    listContentCategories() {
      return request<ContentCategory[]>(fetcher, `${baseUrl}/content-categories`, { method: "GET" });
    },
    getInstagramTrends(brandId: string, input: InstagramTrendListInput) {
      const query = new URLSearchParams({
        hashtag: input.hashtag,
        type: input.type,
        sort: input.sort,
        page: String(input.page)
      });
      return request<InstagramTrendPage>(fetcher, `${baseUrl}/brands/${brandId}/instagram-trends?${query.toString()}`, { method: "GET" });
    },
    searchInstagramTrends(brandId: string, hashtag: string) {
      return request<InstagramTrendPage>(fetcher, `${baseUrl}/brands/${brandId}/instagram-trends/search`, {
        method: "POST",
        body: JSON.stringify({ hashtag })
      });
    },
    listInstagramTrendSearches(brandId: string) {
      return request<InstagramTrendSearchHistory[]>(fetcher, `${baseUrl}/brands/${brandId}/instagram-trend-searches`, { method: "GET" });
    },
    setInstagramTrendFavorite(brandId: string, hashtagId: string, isFavorite: InstagramTrendFavoriteInput["isFavorite"]) {
      return request<InstagramTrendSearchHistory>(
        fetcher,
        `${baseUrl}/brands/${brandId}/instagram-trend-searches/${hashtagId}/favorite`,
        { method: "PUT", body: JSON.stringify({ isFavorite }) }
      );
    },
    saveInstagramTrendSource(brandId: string, mediaId: string) {
      return request<InstagramTrendSaveSource>(fetcher, `${baseUrl}/brands/${brandId}/instagram-trends/${mediaId}/save-source`, { method: "POST" });
    },
    getBillingSummary(brandId: string) {
      return request<BillingSummary>(fetcher, `${baseUrl}/brands/${brandId}/billing/summary`, { method: "GET" });
    },
    getBrandProfile(brandId: string) {
      return request<BrandProfile>(fetcher, `${baseUrl}/brands/${brandId}/profile`, { method: "GET" });
    },
    updateBrandProfile(brandId: string, profile: BrandProfileInput) {
      return request<BrandProfile>(fetcher, `${baseUrl}/brands/${brandId}/profile`, {
        method: "PUT",
        body: JSON.stringify(profile)
      });
    },
    uploadBrandLogo(brandId: string, payload: { fileName: string; mimeType: string; fileBase64: string }) {
      return request<BrandProfile>(fetcher, `${baseUrl}/brands/${brandId}/logo`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    deleteBrandLogo(brandId: string) {
      return request<BrandProfile>(fetcher, `${baseUrl}/brands/${brandId}/logo`, { method: "DELETE" });
    },
    getInstagramFormats(brandId: string) {
      return request<InstagramFormatSettings>(fetcher, `${baseUrl}/brands/${brandId}/instagram-formats`, { method: "GET" });
    },
    updateInstagramFormats(brandId: string, settings: InstagramFormatSettingsInput) {
      return request<InstagramFormatSettings>(fetcher, `${baseUrl}/brands/${brandId}/instagram-formats`, {
        method: "PUT",
        body: JSON.stringify(settings)
      });
    },
    checkInstagramFormatCapability(brandId: string, format: InstagramDeliveryFormat) {
      return request<BrandContentFormat>(fetcher, `${baseUrl}/brands/${brandId}/instagram-formats/${format}/check`, {
        method: "POST"
      });
    },
    listSources(brandId: string) {
      return request<SourceUrl[]>(fetcher, `${baseUrl}/brands/${brandId}/sources`, { method: "GET" });
    },
    listSourceSnapshots(brandId: string) {
      return request<SourceSnapshot[]>(fetcher, `${baseUrl}/brands/${brandId}/source-snapshots`, { method: "GET" });
    },
    listSourceCrawlRuns(brandId: string) {
      return request<SourceCrawlRun[]>(fetcher, `${baseUrl}/brands/${brandId}/source-crawl-runs`, { method: "GET" });
    },
    createSource(brandId: string, payload: { sourceType: SourceUrl["sourceType"]; url: string }) {
      return request<SourceCreateResult>(fetcher, `${baseUrl}/brands/${brandId}/sources`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    updateSource(sourceId: string, payload: { sourceType?: SourceUrl["sourceType"]; url?: string; enabled?: boolean }) {
      return request<SourceUrl>(fetcher, `${baseUrl}/sources/${sourceId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    },
    retrySource(brandId: string, sourceId: string) {
      return request<SourceCrawlRun>(fetcher, `${baseUrl}/brands/${brandId}/sources/${sourceId}/crawl`, { method: "POST" });
    },
    deleteSource(sourceId: string) {
      return request<{ id: string }>(fetcher, `${baseUrl}/sources/${sourceId}`, { method: "DELETE" });
    },
    async listChannels(brandId: string) {
      const channels = await request<ApiChannel[]>(fetcher, `${baseUrl}/brands/${brandId}/channels`, { method: "GET" });
      return channels.map(mapChannel);
    },
    getChannelConnectionRequest(brandId: string) {
      return request<ChannelConnectionRequest>(fetcher, `${baseUrl}/brands/${brandId}/channel-connection-request`, { method: "GET" });
    },
    updateChannelConnectionRequest(
      brandId: string,
      payload: Partial<ChannelConnectionRequest> & { submit?: boolean }
    ) {
      return request<ChannelConnectionRequest>(fetcher, `${baseUrl}/brands/${brandId}/channel-connection-request`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    },
    saveChannelCredentials(
      brandId: string,
      channel: ChannelType,
      payload: {
        accountLabel?: string;
        externalAccountId?: string;
        secretValue: string;
        maskedDisplay?: string;
        provider?: "meta";
        credentialType?: "oauth" | "api_token";
      }
    ) {
      return request<ApiChannel>(fetcher, `${baseUrl}/brands/${brandId}/channels/${channel}/credentials`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }).then(mapChannel);
    },
    checkChannel(brandId: string, channel: ChannelType) {
      return request<ApiChannel>(fetcher, `${baseUrl}/brands/${brandId}/channels/${channel}/check`, { method: "POST" }).then(mapChannel);
    },
    listSupportRequests(brandId: string) {
      return request<SupportRequest[]>(fetcher, `${baseUrl}/brands/${brandId}/support-requests`, { method: "GET" });
    },
    createSupportRequest(
      brandId: string,
      payload: {
        category: SupportRequestCategory;
        title: string;
        message: string;
        contactEmail?: string | null;
      }
    ) {
      return request<SupportRequest>(fetcher, `${baseUrl}/brands/${brandId}/support-requests`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    updateSupportRequestStatus(requestId: string, status: SupportRequestStatus) {
      return request<SupportRequest>(fetcher, `${baseUrl}/support-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
    },
    listContentOutputs(brandId: string) {
      return request<ContentOutput[]>(fetcher, `${baseUrl}/brands/${brandId}/content-outputs`, { method: "GET" });
    },
    reviewContentOutput(outputId: string, action: "approve" | "reject" | "regenerate", reason?: string) {
      return request<{ id: string; status: ContentOutput["status"] }>(fetcher, `${baseUrl}/content-outputs/${outputId}/review`, {
        method: "POST",
        body: JSON.stringify({ action, reason })
      });
    },
    listPublishQueue(brandId: string) {
      return request<ApiPublishQueueItem[]>(fetcher, `${baseUrl}/brands/${brandId}/publish-queue`, { method: "GET" }).then((items) => items.map(mapPublishQueueItem));
    },
    listPublishResults(brandId: string) {
      return request<PublishResult[]>(fetcher, `${baseUrl}/brands/${brandId}/publish-results`, { method: "GET" });
    },
    getPublishArtifact(queueId: string) {
      return request<PublishArtifact>(fetcher, `${baseUrl}/publish-queue/${queueId}/artifacts`, { method: "GET" });
    },
    downloadPublishResult(queueId: string) {
      return requestBlob(fetcher, `${baseUrl}/publish-queue/${queueId}/download`, { method: "GET" });
    },
    downloadPublishedResults(brandId: string) {
      return requestBlob(fetcher, `${baseUrl}/brands/${brandId}/publish-queue/download`, { method: "GET" });
    },
    createTopicUpload(brandId: string, payload: { fileName: string; csvText: string }) {
      return request<TopicUploadSummary>(fetcher, `${baseUrl}/brands/${brandId}/topic-uploads`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    },
    listTopicRows(brandId: string, status?: TopicRow["status"]) {
      const query = status ? `?${new URLSearchParams({ status }).toString()}` : "";
      return request<TopicRow[]>(fetcher, `${baseUrl}/brands/${brandId}/topic-rows${query}`, { method: "GET" });
    },
    importKnowledge(brandId: string, payload: KnowledgeImportInput) {
      return request<KnowledgeImport>(fetcher, `${baseUrl}/brands/${brandId}/knowledge-imports`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    importFaq(brandId: string, payload: { fileName: string; fileBase64: string }) {
      return request<KnowledgeImport>(fetcher, `${baseUrl}/brands/${brandId}/knowledge-imports`, {
        method: "POST",
        body: JSON.stringify({ ...payload, entryType: "faq" }),
      });
    },
    listKnowledgeImports(brandId: string) {
      return request<KnowledgeImport[]>(fetcher, `${baseUrl}/brands/${brandId}/knowledge-imports`, { method: "GET" });
    },
    refreshWiki(brandId: string) {
      return request<{ id: string; status: string }>(fetcher, `${baseUrl}/brands/${brandId}/wiki/refresh`, { method: "POST" });
    },
    getInstagramDmSettings(brandId: string) {
      return request<InstagramDmSettings>(fetcher, `${baseUrl}/brands/${brandId}/instagram-dm/settings`, { method: "GET" });
    },
    updateInstagramDmSettings(brandId: string, payload: Partial<Pick<InstagramDmSettings, "enabled" | "fallbackMessage" | "errorMessage">>) {
      return request<InstagramDmSettings>(fetcher, `${baseUrl}/brands/${brandId}/instagram-dm/settings`, { method: "PUT", body: JSON.stringify(payload) });
    },
    listInstagramDmHistory(brandId: string) {
      return request<InstagramDmHistory[]>(fetcher, `${baseUrl}/brands/${brandId}/instagram-dm/history`, { method: "GET" });
    },
    listDmConversations(
      brandId: string,
      options: { filter?: DmConversationFilter; cursor?: string; limit?: number } = {}
    ) {
      const params = new URLSearchParams();
      if (options.filter && options.filter !== "all") params.set("filter", options.filter);
      if (options.cursor) params.set("cursor", options.cursor);
      if (options.limit) params.set("limit", String(options.limit));
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return request<DmConversationPage>(fetcher, `${baseUrl}/brands/${brandId}/dm/conversations${query}`, { method: "GET" });
    },
    getDmConversation(brandId: string, conversationId: string) {
      return request<DmConversationDetail>(fetcher, `${baseUrl}/brands/${brandId}/dm/conversations/${conversationId}`, { method: "GET" });
    },
    listDmAttentionItems(brandId: string, type?: DmAttentionItem["type"]) {
      const query = type ? `?${new URLSearchParams({ type }).toString()}` : "";
      return request<DmAttentionItem[]>(fetcher, `${baseUrl}/brands/${brandId}/dm/attention-items${query}`, { method: "GET" });
    },
    resolveDmAttentionItem(attentionId: string) {
      return request<{ conversationId: string; automationStatus: "active"; attentionStatus: "resolved" }>(
        fetcher,
        `${baseUrl}/dm/attention-items/${attentionId}`,
        { method: "PATCH", body: JSON.stringify({ status: "resolved" }) }
      );
    },
    getWikiStatus(brandId: string) {
      return request<WikiStatus>(fetcher, `${baseUrl}/brands/${brandId}/wiki/status`, { method: "GET" });
    },
    crawlSources(brandId: string) {
      return request<PipelineRunResult>(fetcher, `${baseUrl}/brands/${brandId}/sources/crawl`, { method: "POST" });
    },
    generateContent(brandId: string) {
      return request<PipelineRunResult>(fetcher, `${baseUrl}/brands/${brandId}/content-generation/run`, { method: "POST" });
    },
    schedulePublishQueue(brandId: string) {
      return request<PipelineRunResult>(fetcher, `${baseUrl}/brands/${brandId}/publish-queue/schedule`, { method: "POST" });
    },
    publishQueueItem(queueId: string) {
      return request<{ id: string; status: string; publishedUrl: string | null }>(fetcher, `${baseUrl}/publish-queue/${queueId}/publish`, { method: "POST" });
    }
  };
}

export const api = apiClient();
