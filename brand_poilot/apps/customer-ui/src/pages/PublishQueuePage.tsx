import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Download, ExternalLink, List, RotateCcw, X } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { PublishArtifactPreview } from "../components/publish/PublishArtifactPreview";
import { ContentArtifactDialog } from "../components/publish/ContentArtifactDialog";
import { ChannelLogo } from "../components/channels/ChannelLogo";
import type { PublishCardPreview } from "../components/publish/PublishManagementPreview";
import { PublishManagementList, type PublishManagementListFilterId } from "../components/publish/PublishManagementList";
import { CardSkeleton, InlineSpinner, ListSkeleton } from "../components/ui/LoadingState";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { PublishCalendar } from "../components/publish/PublishCalendar";
import { PublishSchedulePanel, scheduleErrorMessage } from "../components/publish/PublishSchedulePanel";
import {
  publishManagementFilters,
} from "../components/publish/publishManagementFilters";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import { dateKey, formatPublishDateTime as formatDateTime, PUBLISH_CALENDAR_USAGE_CHANGED_EVENT } from "../features/publishing/publishCalendar";
import { canReschedulePublishItem, datedItems, entryFromPublishItem, unreservedItems } from "../features/publishing/publishItems";
import { clearPublishCalendarBulkDraft, loadPublishCalendarBulkDraft, savePublishCalendarBulkDraft, type PublishCalendarBulkDraft, type PublishCalendarBulkDraftRow } from "../features/publishing/publishCalendarBulkDraft";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import type { AiContentGateway, AiGenerationOutput } from "../features/ai-content/types";
import { publishErrorPresentation } from "../features/publishing/publishPresentation";
import type { BadgeVariant, ChannelConnection, ChannelType, ContentOutput, PublishArtifact, PublishCalendarManualOptions, PublishCalendarManualSlotInput, PublishCalendarNewContentSetup, PublishCalendarSettings, PublishCalendarWeeklySettings, PublishCalendarWeeklySettingsInput, PublishCalendarWeeklyUsage, PublishItem, PublishItemReviewTarget, PublishItemTarget, PublishResult, PublishResultChannel } from "../types";

const channelLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X"
};

const channelOrder: ChannelType[] = ["instagram", "threads", "x", "linkedin", "youtube", "tiktok"];

function sortChannels<T extends { channel: ChannelType }>(channels: T[]) {
  return [...channels].sort((left, right) => channelOrder.indexOf(left.channel) - channelOrder.indexOf(right.channel));
}

const resultStatusMeta: Record<PublishResultChannel["status"], { label: string; variant: BadgeVariant; clickable: boolean }> = {
  queued: { label: "게시 대기", variant: "neutral", clickable: false },
  scheduled: { label: "예약", variant: "info", clickable: false },
  publishing: { label: "게시 중", variant: "info", clickable: false },
  published: { label: "성공", variant: "ok", clickable: true },
  failed: { label: "실패", variant: "bad", clickable: true },
  deferred: { label: "이월", variant: "warn", clickable: false },
  cancelled: { label: "취소", variant: "neutral", clickable: false }
};

type PublishView = "list" | "calendar";
type AsyncLoadStatus = "idle" | "loading" | "ready" | "error";

type PublishQueuePageProps = {
  generationGateway?: Pick<AiContentGateway, "listGenerations">;
};

const weeklySettingsIncompleteMessage = "자동 게시를 켠 상태로 저장하려면 주간 일정과 게시 가능한 연결 채널을 각각 한 개 이상 설정해 주세요.";

function apiErrorCode(error: unknown) {
  return error && typeof error === "object" && "errorCode" in error && typeof error.errorCode === "string"
    ? error.errorCode
    : null;
}

function generationOutputPreview(output: AiGenerationOutput): PublishCardPreview | null {
  const artifact = output.artifact;
  if (!artifact) return null;
  const image = artifact.assets.find((asset) => asset.mimeType?.startsWith("image/"))
    ?? (["image", "image_gallery"].includes(artifact.kind) ? artifact.assets[0] : null);
  if (image?.url) return { kind: "image", url: image.url };
  if (artifact.posterUrl) return { kind: "image", url: artifact.posterUrl };
  const video = artifact.assets.find((asset) => asset.mimeType?.startsWith("video/"))
    ?? (artifact.kind === "video" ? artifact.assets[0] : null);
  return video?.url ? { kind: "video", url: video.url, posterUrl: artifact.posterUrl } : null;
}

function resultFromPublishItem(item: PublishItem): PublishResult {
  return {
    contentId: item.itemKey,
    title: item.title,
    generatedAt: item.createdAt,
    sourceType: item.source.type,
    sourceLabel: item.source.label,
    sourceDetail: item.source.detail,
    sourceUrls: item.source.urls,
    channels: item.targets.map((target) => ({
      queueId: target.queueId,
      channelOutputId: target.channelOutputId ?? "",
      channel: target.channel,
      status: target.status,
      publishedAt: target.publishedAt,
      failedAt: target.failedAt,
      title: item.title,
      previewTitle: target.previewTitle,
      previewBody: target.previewBody,
      outputJson: target.outputJson,
      artifactPublicUrl: target.artifactPublicUrl,
      externalPostId: target.externalPostId,
      externalUrl: target.externalUrl,
      lastError: target.lastError,
      sourceSummary: target.sourceSummary ?? item.source.detail
    }))
  };
}

function contentOutputFromReviewTarget(item: PublishItem, target: PublishItemReviewTarget): ContentOutput {
  return {
    id: target.channelOutputId,
    contentId: item.itemKey,
    title: item.title,
    channel: target.channel,
    deliveryFormat: target.deliveryFormat,
    sourceMode: typeof target.outputJson.sourceMode === "string" ? target.outputJson.sourceMode as ContentOutput["sourceMode"] : null,
    status: target.status,
    topicId: item.sourceRefs.contentTopicId ?? "DB",
    generatedAt: target.generatedAt,
    sourceSummary: target.sourceSummary ?? item.source.detail ?? "DB에 저장된 생성 근거",
    previewTitle: target.previewTitle ?? item.title,
    previewBody: target.previewBody ?? "",
    outputJson: target.outputJson,
    blockReasons: target.blockReasons,
  };
}

function PublishResultDialog({
  result,
  channel,
  onClose
}: {
  result: PublishResult;
  channel: PublishResultChannel;
  onClose: () => void;
}) {
  const meta = resultStatusMeta[channel.status];
  const [artifact, setArtifact] = useState<PublishArtifact | null>(null);
  const [artifactLoading, setArtifactLoading] = useState(true);
  const [artifactError, setArtifactError] = useState(false);
  const [artifactReloadKey, setArtifactReloadKey] = useState(0);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    setArtifact(null);
    setArtifactLoading(true);
    setArtifactError(false);

    api.getPublishArtifact(channel.queueId)
      .then((nextArtifact) => {
        if (!ignore) setArtifact(nextArtifact);
      })
      .catch(() => {
        if (!ignore) setArtifactError(true);
      })
      .finally(() => {
        if (!ignore) setArtifactLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [channel.queueId, artifactReloadKey]);

  const formatLabels: Record<string, string> = {
    instagram_feed_carousel: "카드뉴스",
    instagram_story: "스토리",
    instagram_reel: "Reel",
    threads_text: "텍스트",
    tiktok_video: "영상",
    youtube_video: "영상",
    youtube_short: "Short",
    linkedin_post: "게시물",
    x_post: "텍스트",
    image_gallery: "카드뉴스",
    image: "이미지",
    video: "영상",
    html: "HTML",
    text: "텍스트",
    unknown: "알 수 없음"
  };
  const formatLabel = artifact ? formatLabels[artifact.deliveryFormat ?? artifact.kind] ?? artifact.deliveryFormat ?? "알 수 없음" : null;
  const externalPostId = channel.externalPostId?.split("/").filter(Boolean).at(-1) ?? null;
  const sourceSummary = channel.sourceSummary ?? result.sourceDetail;

  async function downloadResult() {
    setDownloadLoading(true);
    setDownloadMessage(null);
    try {
      const download = await api.downloadPublishResult(channel.queueId);
      const objectUrl = URL.createObjectURL(download.blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = download.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setDownloadMessage({ text: "게시 결과 저장을 시작했습니다.", error: false });
    } catch (error) {
      const entitlementRequired = error instanceof Error && error.message.includes("download_entitlement_required");
      setDownloadMessage({
        text: entitlementRequired
          ? "이 결과를 저장하려면 다운로드 권한이 필요합니다. 결제 페이지에서 이용 권한을 확인하세요."
          : "게시 결과 저장에 실패했습니다. 잠시 후 다시 시도하세요.",
        error: true
      });
    } finally {
      setDownloadLoading(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-panel publish-result-dialog" role="dialog" aria-modal="true" aria-label="업로드 콘텐츠 상세">
        <header className="publish-result-dialog__header">
          <div>
            <h2>{result.title}</h2>
            <div className="row-meta channel-identity"><ChannelLogo channel={channel.channel} decorative size={16} /><span>{channelLabels[channel.channel]}{formatLabel ? ` · ${formatLabel}` : ""}</span></div>
          </div>
          <div className="publish-result-dialog__header-actions">
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <button className="button publish-result-dialog__close" type="button" onClick={onClose} aria-label="닫기" title="닫기">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="publish-result-dialog__body publish-result-dialog__scroll">
          <section className="publish-result-dialog__preview" aria-label="게시 결과 미리보기">
            {artifactLoading ? (
              <ListSkeleton rows={4} columns={2} label="결과물을 불러오는 중입니다." />
            ) : artifactError ? (
              <div className="publish-result-dialog__state" role="alert">
                <strong>결과물을 불러오지 못했습니다.</strong>
                {channel.previewTitle ? <div>{channel.previewTitle}</div> : null}
                {channel.previewBody ? <p>{channel.previewBody}</p> : null}
                <button className="button" type="button" onClick={() => setArtifactReloadKey((key) => key + 1)}>
                  <RotateCcw size={16} aria-hidden="true" />
                  다시 시도
                </button>
              </div>
            ) : artifact ? (
              <PublishArtifactPreview artifact={artifact} />
            ) : null}
          </section>

          <aside className="publish-result-dialog__metadata" aria-label="업로드 정보">
            <h3>업로드 정보</h3>
            <dl>
              <div>
                <dt>채널</dt>
                <dd className="channel-identity"><ChannelLogo channel={channel.channel} decorative size={18} /><span>{channelLabels[channel.channel]}</span></dd>
              </div>
              {formatLabel ? (
                <div>
                  <dt>콘텐츠 형식</dt>
                  <dd>{formatLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt>게시 상태</dt>
                <dd><Badge variant={meta.variant}>{meta.label}</Badge></dd>
              </div>
              {channel.publishedAt ? (
                <div>
                  <dt>게시 시각</dt>
                  <dd>{formatDateTime(channel.publishedAt)}</dd>
                </div>
              ) : null}
              {channel.failedAt ? (
                <div>
                  <dt>실패 시각</dt>
                  <dd>{formatDateTime(channel.failedAt)}</dd>
                </div>
              ) : null}
              {externalPostId ? (
                <div>
                  <dt>외부 게시 ID</dt>
                  <dd>{externalPostId}</dd>
                </div>
              ) : null}
              {channel.externalUrl ? (
                <div>
                  <dt>외부 게시 URL</dt>
                  <dd><a href={channel.externalUrl} target="_blank" rel="noreferrer">원본 URL 열기</a></dd>
                </div>
              ) : null}
              {sourceSummary ? (
                <div>
                  <dt>생성 근거</dt>
                  <dd>{sourceSummary}</dd>
                </div>
              ) : null}
              {channel.lastError ? (
                <div>
                  <dt>오류 사유</dt>
                  <dd>{publishErrorPresentation(channel.lastError).message}</dd>
                </div>
              ) : null}
            </dl>
          </aside>
        </div>

        <footer className="publish-result-dialog__footer">
          <div className="publish-result-dialog__feedback" aria-live="polite">
            {downloadMessage ? (
              <span className={downloadMessage.error ? "is-error" : ""}>{downloadMessage.text}</span>
            ) : null}
          </div>
          <div className="actions">
            {channel.externalUrl ? (
              <a className="button" href={channel.externalUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={16} aria-hidden="true" />
                원본 게시물 열기
              </a>
            ) : null}
            <button
              className="button primary"
              type="button"
              aria-label="저장"
              aria-busy={downloadLoading}
              onClick={() => void downloadResult()}
              disabled={downloadLoading || artifactLoading || artifactError || !artifact}
            >
              {downloadLoading ? <InlineSpinner label="게시 결과 저장 중" /> : <Download size={16} aria-hidden="true" />}
              저장
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function PublishQueuePage({ generationGateway = aiContentApiGateway }: PublishQueuePageProps = {}) {
  const initialQuery = useMemo(() => new URLSearchParams(window.location.search), []);
  const highlightedQueueId = useMemo(() => initialQuery.get("queueId"), [initialQuery]);
  const [view, setView] = useState<PublishView>(() => initialQuery.get("view") === "calendar" ? "calendar" : "list");
  const [calendarBulkDraft, setCalendarBulkDraft] = useState<PublishCalendarBulkDraft | null>(() => loadPublishCalendarBulkDraft(initialQuery.get("calendarBatchDraft")));
  const [calendarMonth, setCalendarMonth] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date()).replace("/", "-"));
  const [calendarSettings, setCalendarSettings] = useState<PublishCalendarSettings | null>(null);
  const [calendarWeeklyCapability, setCalendarWeeklyCapability] = useState<boolean | null>(null);
  const [calendarWeeklySettings, setCalendarWeeklySettings] = useState<PublishCalendarWeeklySettings | null>(null);
  const [calendarWeeklyStatus, setCalendarWeeklyStatus] = useState<AsyncLoadStatus>("idle");
  const [calendarWeeklyUsage, setCalendarWeeklyUsage] = useState<PublishCalendarWeeklyUsage | null>(null);
  const [calendarWeeklyUsageStatus, setCalendarWeeklyUsageStatus] = useState<AsyncLoadStatus>("idle");
  const [calendarManualOptions, setCalendarManualOptions] = useState<PublishCalendarManualOptions | null>(null);
  const [calendarManualOptionsError, setCalendarManualOptionsError] = useState<string | null>(null);
  const [calendarManualOptionsLoading, setCalendarManualOptionsLoading] = useState(false);
  const [calendarChannels, setCalendarChannels] = useState<ChannelType[]>([]);
  const [calendarChannelCatalog, setCalendarChannelCatalog] = useState<ChannelConnection[]>([]);
  const [calendarChannelsStatus, setCalendarChannelsStatus] = useState<AsyncLoadStatus>("idle");
  const [calendarPublishableChannels, setCalendarPublishableChannels] = useState<ChannelType[]>([]);
  const [calendarCapabilitiesStatus, setCalendarCapabilitiesStatus] = useState<AsyncLoadStatus>("idle");
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [calendarSettingsError, setCalendarSettingsError] = useState<string | null>(null);
  const [publishItems, setPublishItems] = useState<PublishItem[]>([]);
  const [generationPreviews, setGenerationPreviews] = useState<ReadonlyMap<string, PublishCardPreview>>(() => new Map());
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<PublishManagementListFilterId>(() => {
    const requested = new URLSearchParams(window.location.search).get("status");
    if (publishManagementFilters.some((filter) => filter.id === requested)) {
      return requested as PublishManagementListFilterId;
    }
    return requested === "needs_review" || requested === "failed" ? requested : "action_required";
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedResult, setSelectedResult] = useState<{ result: PublishResult; channel: PublishResultChannel } | null>(null);
  const [selectedReviewOutput, setSelectedReviewOutput] = useState<ContentOutput | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<{ item: PublishItem; dateKey: string; mode: "create" | "edit" } | null>(null);
  const [calendarFocusItemKey, setCalendarFocusItemKey] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const scheduleTriggerRef = useRef<HTMLButtonElement | null>(null);
  const scheduleFocusItemKeyRef = useRef<string | null>(null);
  const manualOptionsRequestRef = useRef(0);
  const weeklySettingsRequestRef = useRef(0);
  const legacySettingsRequestRef = useRef(0);
  const channelsRequestRef = useRef(0);
  const capabilitiesRequestRef = useRef(0);
  const weeklyUsageRequestRef = useRef(0);
  const calendarSupportStartedRef = useRef(false);
  const reviewingOutputIdsRef = useRef(new Set<string>());
  const generationPreviewRequestRef = useRef<string | null>(null);
  const [reviewingOutputIds, setReviewingOutputIds] = useState<Set<string>>(() => new Set());

  const calendarEntries = useMemo(() => datedItems(publishItems).map((item) => ({
    ...entryFromPublishItem(item),
    operationalStatus: item.operationalStatus,
    operationalReason: item.operationalReason,
  })), [publishItems]);
  const calendarUnreservedItems = useMemo(() => unreservedItems(publishItems), [publishItems]);
  const assignableCalendarContents = useMemo(() => publishItems.flatMap((item) => item.sourceRefs.topicPublishGroupId && (item.status === "completed_unpublished" || item.status === "publish_queued")
    ? [{ id: item.sourceRefs.topicPublishGroupId, title: item.title }]
    : []), [publishItems]);
  const nextPublishItem = useMemo(
    () => publishItems.find((item) => item.targets.some((target) => target.status === "scheduled")) ?? null,
    [publishItems],
  );
  const policyQueueTargetCount = useMemo(
    () => publishItems.reduce((count, item) => count + item.targets.filter((target) => target.status === "queued").length, 0),
    [publishItems],
  );

  useEffect(() => {
    if (initialLoading || view !== "list" || !highlightedQueueId) return;
    const highlighted = document.querySelector<HTMLElement>('[data-publish-deep-link="true"]');
    if (!highlighted) return;
    highlighted.scrollIntoView?.({ behavior: "smooth", block: "center" });
    highlighted.focus();
  }, [highlightedQueueId, initialLoading, publishItems, view]);

  function changeView(nextView: PublishView) {
    setView(nextView);
    const query = new URLSearchParams(window.location.search);
    query.set("view", nextView);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}`);
  }

  function onViewTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: PublishView) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = current === "list" ? "calendar" : "list";
    changeView(next);
    document.getElementById(`publish-view-tab-${next}`)?.focus();
  }

  async function refreshPublishItems() {
    const items = await api.listPublishItems(DEMO_BRAND_ID);
    setPublishItems(items);
    return items;
  }

  async function refreshRecoveryState() {
    try {
      await refreshPublishItems();
      setNotice("게시 상태를 서버에서 다시 확인했습니다.");
    } catch {
      setNotice("목록을 새로고침하지 못해 기존 상태를 표시합니다.");
    }
  }

  async function retryPublish(queueId: string) {
    try {
      await api.retryPublishQueueItem(queueId);
      await refreshRecoveryState();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "publish_queue_not_retryable";
      setNotice(`재시도할 수 없습니다: ${reason}`);
    }
  }

  async function cancelPublish(queueId: string) {
    try {
      await api.cancelPublishQueueItem(queueId);
      await refreshRecoveryState();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "publish_queue_not_cancellable";
      setNotice(`취소할 수 없습니다: ${reason}`);
    }
  }

  useEffect(() => {
    let ignore = false;
    api.listPublishItems(DEMO_BRAND_ID)
      .then((items) => {
        if (!ignore) {
          setPublishItems(items);
          setNotice(null);
        }
      })
      .catch(() => {
        if (!ignore) {
          setPublishItems([]);
          setNotice("API 서버가 응답하지 않아 게시 관리 목록을 불러오지 못했습니다.");
        }
      })
      .finally(() => { if (!ignore) setInitialLoading(false); });

    return () => {
      ignore = true;
    };
  }, []);

  const reloadChannels = useCallback(async () => {
    const requestId = ++channelsRequestRef.current;
    setCalendarChannelsStatus("loading");
    try {
      const channels = typeof api.listChannels === "function" ? await api.listChannels(DEMO_BRAND_ID) : [];
      if (channelsRequestRef.current !== requestId) return;
      setCalendarChannelCatalog(channels);
      setCalendarChannels(channels.filter((channel) => channel.enabled && channel.status === "connected").map((channel) => channel.type));
      setCalendarChannelsStatus("ready");
    } catch {
      if (channelsRequestRef.current === requestId) setCalendarChannelsStatus("error");
    }
  }, []);

  const reloadChannelCapabilities = useCallback(async () => {
    const requestId = ++capabilitiesRequestRef.current;
    setCalendarCapabilitiesStatus("loading");
    try {
      const capabilities = await api.getChannelCapabilities(DEMO_BRAND_ID);
      if (capabilitiesRequestRef.current !== requestId) return;
      setCalendarPublishableChannels(capabilities
        .filter((capability) => capability.catalogStatus === "available" && capability.readiness === "ready" && capability.publishModes.length > 0)
        .map((capability) => capability.channel));
      setCalendarCapabilitiesStatus("ready");
    } catch {
      if (capabilitiesRequestRef.current === requestId) setCalendarCapabilitiesStatus("error");
    }
  }, []);

  const reloadWeeklyUsage = useCallback(async () => {
    const requestId = ++weeklyUsageRequestRef.current;
    setCalendarWeeklyUsageStatus("loading");
    try {
      const usage = await api.getPublishCalendarUsage(DEMO_BRAND_ID);
      if (weeklyUsageRequestRef.current !== requestId) return;
      setCalendarWeeklyUsage(usage);
      setCalendarWeeklyUsageStatus("ready");
    } catch {
      if (weeklyUsageRequestRef.current === requestId) setCalendarWeeklyUsageStatus("error");
    }
  }, []);

  const reloadLegacySettings = useCallback(async () => {
    const requestId = ++legacySettingsRequestRef.current;
    setCalendarSettingsError(null);
    try {
      const legacySettings = await api.getPublishCalendarSettings(DEMO_BRAND_ID);
      if (legacySettingsRequestRef.current !== requestId) return;
      setCalendarSettings(legacySettings);
    } catch {
      if (legacySettingsRequestRef.current !== requestId) return;
      setCalendarSettings(null);
      setCalendarSettingsError("자동 게시 설정을 불러오지 못했습니다.");
    }
  }, []);

  const reloadWeeklySettings = useCallback(async () => {
    const requestId = ++weeklySettingsRequestRef.current;
    setCalendarWeeklyStatus("loading");
    setCalendarSettingsError(null);
    try {
      const weeklySettings = await api.getPublishCalendarWeeklySettings(DEMO_BRAND_ID);
      if (weeklySettingsRequestRef.current !== requestId) return;
      if (weeklySettings) {
        legacySettingsRequestRef.current += 1;
        setCalendarWeeklyCapability(true);
        setCalendarWeeklySettings(weeklySettings);
        setCalendarSettings(null);
        setCalendarWeeklyStatus("ready");
        return;
      }
      setCalendarWeeklyCapability(false);
      setCalendarWeeklySettings(null);
      weeklyUsageRequestRef.current += 1;
      setCalendarWeeklyUsage(null);
      setCalendarWeeklyUsageStatus("idle");
      setCalendarWeeklyStatus("ready");
      await reloadLegacySettings();
    } catch {
      if (weeklySettingsRequestRef.current !== requestId) return;
      setCalendarWeeklyCapability(true);
      setCalendarWeeklyStatus("error");
      setCalendarSettingsError("주간 자동 게시 설정을 불러오지 못했습니다.");
    }
  }, [reloadLegacySettings]);

  const reloadWeeklySupport = useCallback(() => {
    void reloadWeeklySettings();
    void reloadChannels();
    void reloadChannelCapabilities();
    void reloadWeeklyUsage();
  }, [reloadChannelCapabilities, reloadChannels, reloadWeeklySettings, reloadWeeklyUsage]);

  useEffect(() => {
    if (view !== "calendar" || calendarSupportStartedRef.current) return;
    calendarSupportStartedRef.current = true;
    reloadWeeklySupport();
  }, [reloadWeeklySupport, view]);

  useEffect(() => () => {
    weeklySettingsRequestRef.current += 1;
    legacySettingsRequestRef.current += 1;
    channelsRequestRef.current += 1;
    capabilitiesRequestRef.current += 1;
    weeklyUsageRequestRef.current += 1;
  }, []);

  useEffect(() => {
    if (view !== "calendar") return;
    const outputIds = [...new Set(calendarUnreservedItems.flatMap((item) => item.contentStatus === "completed" && item.sourceRefs.generationOutputId
      ? [item.sourceRefs.generationOutputId]
      : []))].sort();
    const signature = outputIds.join(",");
    if (!signature || generationPreviewRequestRef.current === signature) return;
    generationPreviewRequestRef.current = signature;
    let ignore = false;
    const requested = new Set(outputIds);
    void generationGateway.listGenerations(DEMO_BRAND_ID)
      .then((generations) => {
        if (ignore) return;
        const previews = new Map<string, PublishCardPreview>();
        for (const output of generations.flatMap((generation) => generation.outputs)) {
          if (!requested.has(output.id)) continue;
          const preview = generationOutputPreview(output);
          if (preview) previews.set(output.id, preview);
        }
        setGenerationPreviews(previews);
      })
      .catch(() => { if (!ignore) setGenerationPreviews(new Map()); });
    return () => { ignore = true; };
  }, [calendarUnreservedItems, generationGateway, view]);

  async function loadManualOptions() {
    setCalendarManualOptions(null);
    setCalendarManualOptionsError(null);
    setCalendarManualOptionsLoading(true);
    const requestId = manualOptionsRequestRef.current + 1;
    manualOptionsRequestRef.current = requestId;
    try {
      const options = await api.getPublishCalendarManualOptions(DEMO_BRAND_ID);
      if (manualOptionsRequestRef.current === requestId) setCalendarManualOptions(options);
    } catch (error) {
      const errorCode = error && typeof error === "object" && "errorCode" in error
        && typeof error.errorCode === "string" ? error.errorCode : null;
      if (manualOptionsRequestRef.current === requestId) {
        setCalendarManualOptionsError(errorCode === "publish_calendar_subscription_inactive"
          ? scheduleErrorMessage(errorCode, null)
          : "게시 설정 선택 항목을 불러오지 못했습니다.");
      }
    } finally {
      if (manualOptionsRequestRef.current === requestId) setCalendarManualOptionsLoading(false);
    }
  }

  function openSchedulePanel(item: PublishItem, selectedDateKey: string, trigger: HTMLButtonElement) {
    scheduleTriggerRef.current = trigger;
    scheduleFocusItemKeyRef.current = item.itemKey;
    setScheduleTarget({ item, dateKey: selectedDateKey, mode: "create" });
    void loadManualOptions();
  }

  function openReschedulePanel(item: PublishItem, trigger: HTMLButtonElement) {
    if (!item.scheduledFor || !item.sourceRefs.calendarSlotId || !canReschedulePublishItem(item)) return;
    scheduleTriggerRef.current = trigger;
    scheduleFocusItemKeyRef.current = item.itemKey;
    setScheduleTarget({ item, dateKey: dateKey(item.scheduledFor), mode: "edit" });
  }

  function closeSchedulePanel() {
    setScheduleTarget(null);
    window.setTimeout(() => {
      if (scheduleTriggerRef.current?.isConnected) {
        scheduleTriggerRef.current.focus();
        return;
      }
      const itemKey = scheduleFocusItemKeyRef.current;
      const replacement = itemKey
        ? [...document.querySelectorAll<HTMLElement>("[data-publish-focus-key]")].find((element) => element.dataset.publishFocusKey === itemKey)
        : null;
      (replacement ?? document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    }, 0);
  }

  async function submitScheduledItem(input: PublishCalendarManualSlotInput) {
    try {
      await api.provisionPublishCalendarManualSlot(DEMO_BRAND_ID, input);
      let refreshFailed = false;
      try { await refreshPublishItems(); } catch { refreshFailed = true; }
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      return { ok: true as const, refreshFailed };
    } catch (error) {
      let existingCalendarDate: string | null = null;
      const errorCode = typeof error === "object" && error !== null && "errorCode" in error && typeof error.errorCode === "string"
        ? error.errorCode
        : error instanceof Error && error.message.startsWith("publish_")
          ? error.message
          : null;
      if (errorCode === "publish_calendar_content_already_scheduled") {
        try {
          const items = await refreshPublishItems();
          existingCalendarDate = items.find((item) => item.itemKey === scheduleTarget?.item.itemKey)?.calendarDate ?? null;
          setNotice("이미 예약된 콘텐츠의 기존 예약 상세를 엽니다.");
        } catch {
          setNotice("이미 예약된 콘텐츠이지만 목록을 새로고침하지 못했습니다. 새로고침 후 기존 예약을 확인하세요.");
        }
      }
      return { ok: false as const, errorCode, existingCalendarDate };
    }
  }

  async function submitRescheduledItem(input: { scheduledFor: string }) {
    const slotId = scheduleTarget?.item.sourceRefs.calendarSlotId;
    if (!slotId) return { ok: false as const, errorCode: "publish_calendar_slot_not_found" };
    try {
      await api.reschedulePublishCalendarSlot(DEMO_BRAND_ID, slotId, input);
      let refreshFailed = false;
      try { await refreshPublishItems(); } catch { refreshFailed = true; }
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      return { ok: true as const, refreshFailed };
    } catch (error) {
      const errorCode = typeof error === "object" && error !== null && "errorCode" in error && typeof error.errorCode === "string"
        ? error.errorCode
        : error instanceof Error && error.message.startsWith("publish_") ? error.message : null;
      return { ok: false as const, errorCode };
    }
  }

  function startCalendarContent(input: { scheduledFor: string; contentFormat: "card_news" | "reel"; setup: PublishCalendarNewContentSetup }) {
    const params = new URLSearchParams({
      proposalFamily: input.setup.purpose,
      proposalFormat: input.contentFormat,
      proposalChannels: "instagram",
      calendarScheduledFor: input.scheduledFor,
      calendarIdempotencyKey: crypto.randomUUID(),
    });
    if (input.setup.topicText) params.set("proposalTopic", input.setup.topicText);
    if (input.setup.topicUrl) params.set("proposalUrl", input.setup.topicUrl);
    if (input.setup.contentSuggestionId) { params.set("view", "suggestions"); params.set("suggestionId", input.setup.contentSuggestionId); }
    if (input.setup.referenceId) params.set("reference", input.setup.referenceId);
    if (input.setup.productId) params.set("product", input.setup.productId);
    if (input.setup.contentInstruction) params.set("proposalBrief", input.setup.contentInstruction);
    window.location.assign(`/ai-content/new?${params}`);
  }

  function continueCalendarBulk(draft: PublishCalendarBulkDraft, row: PublishCalendarBulkDraftRow) {
    const params = new URLSearchParams({
      proposalFamily: row.setup.purpose,
      proposalFormat: row.contentFormat,
      proposalChannels: "instagram",
      calendarBatchDraft: draft.id,
      calendarBatchRow: row.clientRowId,
    });
    if (row.setup.topicText) params.set("proposalTopic", row.setup.topicText);
    if (row.setup.topicUrl) params.set("proposalUrl", row.setup.topicUrl);
    if (row.setup.contentSuggestionId) { params.set("view", "suggestions"); params.set("suggestionId", row.setup.contentSuggestionId); }
    if (row.setup.referenceId) params.set("reference", row.setup.referenceId);
    if (row.setup.productId) params.set("product", row.setup.productId);
    if (row.setup.contentInstruction) params.set("proposalBrief", row.setup.contentInstruction);
    window.location.assign(`/ai-content/new?${params}`);
  }

  function startCalendarBulk(rows: PublishCalendarBulkDraftRow[]) {
    const draft = { id: crypto.randomUUID(), rows };
    savePublishCalendarBulkDraft(draft);
    setCalendarBulkDraft(draft);
    continueCalendarBulk(draft, rows[0]);
  }

  async function provisionCalendarBatch(draft: PublishCalendarBulkDraft) {
    if (typeof api.provisionPublishCalendarManualSlotsBatch !== "function" || draft.rows.some((row) => !row.generationId)) return false;
    try {
      const result = await api.provisionPublishCalendarManualSlotsBatch(DEMO_BRAND_ID, {
        idempotencyKey: draft.id,
        rows: draft.rows.map((row) => ({ clientRowId: row.clientRowId, scheduledFor: row.scheduledFor, channel: "instagram" as const, contentFormat: row.contentFormat, source: { kind: "existing_generation" as const, generationId: row.generationId! } })),
      });
      await refreshPublishItems();
      clearPublishCalendarBulkDraft(draft.id);
      setCalendarBulkDraft(null);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`${result.slots.length}개 콘텐츠의 게시 일정을 배정했습니다.`);
      return true;
    } catch { setNotice("일괄 게시 일정을 배정하지 못했습니다. 입력과 한도를 확인하세요."); return false; }
  }

  async function cancelCalendarSlot(slotId: string) {
    try {
      await api.cancelPublishCalendarSlot(DEMO_BRAND_ID, slotId);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      const refreshed = await Promise.allSettled([refreshPublishItems()]);
      setNotice(refreshed.some((result) => result.status === "rejected") ? "게시 슬롯을 취소했습니다. 운영 목록 새로고침은 실패했습니다." : "게시 슬롯을 취소했습니다.");
    } catch { setNotice("게시 슬롯을 취소하지 못했습니다."); }
  }

  function cancelPublishItemReservation(item: PublishItem, preferredTarget?: PublishItemTarget) {
    const cancellableTarget = preferredTarget ?? item.targets.find((target) => target.status === "queued" || target.status === "scheduled" || target.status === "deferred");
    if (item.sourceRefs.calendarSlotId) void cancelCalendarSlot(item.sourceRefs.calendarSlotId);
    else if (cancellableTarget) void cancelPublish(cancellableTarget.queueId);
  }

  async function assignCalendarSlot(slotId: string, content: { id: string; title: string }) {
    try {
      await api.assignPublishCalendarSlot(DEMO_BRAND_ID, slotId, { topicPublishGroupId: content.id, title: content.title });
      await refreshPublishItems();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice("선택한 콘텐츠를 슬롯에 배정했습니다.");
      return true;
    } catch { setNotice("콘텐츠를 슬롯에 배정하지 못했습니다."); return false; }
  }

  async function saveCalendarSettings(input: Omit<PublishCalendarSettings, "brandId" | "updatedAt">) {
    if (calendarWeeklyCapability !== false) return { ok: false as const, message: "레거시 자동 게시 설정을 사용할 수 없습니다." };
    setCalendarSaving(true);
    try {
      const settings = await api.savePublishCalendarSettings(DEMO_BRAND_ID, input);
      setCalendarSettings(settings);
      setNotice(settings.enabled ? "자동 게시 설정을 저장했습니다." : "자동 게시를 껐습니다. 기존 예약은 유지됩니다.");
      return { ok: true as const };
    } catch { return { ok: false as const, message: "자동 게시 설정을 저장하지 못했습니다." }; } finally { setCalendarSaving(false); }
  }

  async function saveCalendarWeeklySettings(input: PublishCalendarWeeklySettingsInput) {
    if (calendarWeeklyCapability !== true) return { ok: false as const, message: "주간 자동 게시 설정을 사용할 수 없습니다." };
    weeklySettingsRequestRef.current += 1;
    setCalendarSaving(true);
    try {
      const settings = await api.savePublishCalendarWeeklySettings(DEMO_BRAND_ID, input);
      weeklySettingsRequestRef.current += 1;
      setCalendarWeeklySettings(settings);
      setCalendarWeeklyStatus("ready");
      setNotice("주간 자동 게시 설정을 저장했습니다. 기존 예약은 유지됩니다.");
      return { ok: true as const };
    } catch (error) {
      setCalendarWeeklyStatus("ready");
      return { ok: false as const, message: apiErrorCode(error) === "publish_calendar_settings_incomplete"
        ? weeklySettingsIncompleteMessage
        : "주간 자동 게시 설정을 저장하지 못했습니다." };
    } finally {
      setCalendarSaving(false);
    }
  }

  async function toggleCalendarWeekly(enabled: boolean) {
    if (calendarWeeklyCapability !== true) return { ok: false as const, message: "자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요." };
    weeklySettingsRequestRef.current += 1;
    setCalendarSaving(true);
    try {
      const settings = await api.setPublishCalendarEnabled(DEMO_BRAND_ID, enabled);
      weeklySettingsRequestRef.current += 1;
      setCalendarWeeklySettings(settings);
      setCalendarWeeklyStatus("ready");
      setNotice(enabled ? "자동 게시를 켰습니다." : "자동 게시를 껐습니다. 기존 예약은 유지됩니다.");
      return { ok: true as const };
    } catch (error) {
      setCalendarWeeklyStatus("ready");
      return { ok: false as const, message: apiErrorCode(error) === "publish_calendar_settings_incomplete"
        ? weeklySettingsIncompleteMessage
        : "자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요." };
    } finally {
      setCalendarSaving(false);
    }
  }

  async function scheduleQueue() {
    try {
      const result = await api.schedulePublishQueue(DEMO_BRAND_ID);
      await refreshPublishItems();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`큐 배정 완료: 처리 ${result.processed}개, 배정 ${result.updated}개`);
    } catch {
      setNotice("큐 배정에 실패했습니다. API 서버와 게시 관리 상태를 확인하세요.");
    }
  }

  async function publishNext() {
    const target = nextPublishItem?.targets.find((row) => row.status === "scheduled");
    if (!target) {
      setNotice("게시할 예약 콘텐츠가 없습니다.");
      return;
    }

    try {
      const result = await api.publishQueueItem(target.queueId);
      await refreshPublishItems();
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      setNotice(`게시 완료: ${result.publishedUrl ?? result.status}`);
    } catch {
      setNotice("게시 실행에 실패했습니다. 큐 항목 상태를 확인하세요.");
    }
  }

  async function generateNextContent() {
    try {
      const result = await api.generateContent(DEMO_BRAND_ID);
      await refreshPublishItems();
      setNotice(`콘텐츠 생성 완료: 처리 ${result.processed}개, 생성 ${result.created}개`);
    } catch {
      setNotice("콘텐츠 생성 실행에 실패했습니다. 사용 가능한 주제표 행과 API 상태를 확인하세요.");
    }
  }

  async function reviewTargets(targets: PublishItemReviewTarget[], action: "approve" | "reject" | "regenerate", message: string) {
    const outputIds = targets.map((target) => target.channelOutputId);
    if (outputIds.some((outputId) => reviewingOutputIdsRef.current.has(outputId))) return;
    outputIds.forEach((outputId) => reviewingOutputIdsRef.current.add(outputId));
    setReviewingOutputIds((current) => new Set([...current, ...outputIds]));
    try {
      const results = await Promise.allSettled(outputIds.map((outputId) => api.reviewContentOutput(outputId, action)));
      const failedCount = results.filter((result) => result.status === "rejected").length;
      let refreshFailed = false;
      try { await refreshPublishItems(); } catch { refreshFailed = true; }
      setNotice(failedCount > 0
        ? refreshFailed
          ? `일부 검토 결과를 저장하지 못했습니다. 성공 ${outputIds.length - failedCount}개, 실패 ${failedCount}개이며 목록 새로고침도 실패했습니다. 잠시 후 다시 확인하세요.`
          : `일부 검토 결과를 저장하지 못했습니다. 성공 ${outputIds.length - failedCount}개, 실패 ${failedCount}개입니다.`
        : refreshFailed
          ? "검토 결과는 저장했지만 목록을 새로고침하지 못했습니다. 잠시 후 다시 확인하세요."
          : message);
    } catch {
      const actionLabels = { approve: "승인", reject: "거절", regenerate: "재생성 요청" };
      setNotice(`${actionLabels[action]} 처리에 실패했습니다. API 상태를 확인하세요.`);
    } finally {
      outputIds.forEach((outputId) => reviewingOutputIdsRef.current.delete(outputId));
      setReviewingOutputIds((current) => {
        const next = new Set(current);
        outputIds.forEach((outputId) => next.delete(outputId));
        return next;
      });
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="게시 관리"
        description="생성 검토, 예약, 발송 상태, 실패 사유, 완료 결과물을 하나의 운영 화면에서 관리합니다."
        actions={(
          <>
            <button className="button" type="button" onClick={generateNextContent}>콘텐츠 생성</button>
            <details open={operationsOpen}>
              <summary onClick={(event) => { event.preventDefault(); setOperationsOpen((current) => !current); }}>운영 도구</summary>
              {operationsOpen ? <div className="panel-body">
                <p className="row-meta">정책 큐 배정 대상: 게시 대기 {policyQueueTargetCount}개</p>
                <button className="button" type="button" onClick={scheduleQueue}>정책 큐 배정</button>
                <p className="row-meta">다음 게시 실행 대상: {nextPublishItem?.title ?? "예약 콘텐츠 없음"}</p>
                <button className="button primary" type="button" onClick={publishNext}>다음 게시 실행</button>
              </div> : null}
            </details>
          </>
        )}
      />

      <div className="publish-view-toolbar">
        <div className="publish-view-tabs" role="tablist" aria-label="게시 관리 보기">
          <button id="publish-view-tab-list" className={view === "list" ? "is-active" : ""} type="button" role="tab" aria-controls="publish-view-panel" aria-selected={view === "list"} tabIndex={view === "list" ? 0 : -1} onKeyDown={(event) => onViewTabKeyDown(event, "list")} onClick={() => changeView("list")}><List size={17} aria-hidden="true" /> 목록</button>
          <button id="publish-view-tab-calendar" className={view === "calendar" ? "is-active" : ""} type="button" role="tab" aria-controls="publish-view-panel" aria-selected={view === "calendar"} tabIndex={view === "calendar" ? 0 : -1} onKeyDown={(event) => onViewTabKeyDown(event, "calendar")} onClick={() => changeView("calendar")}><CalendarDays size={17} aria-hidden="true" /> 캘린더</button>
        </div>
      </div>

      {notice ? (
        <Alert title="API 상태" variant={notice.includes("실패") || notice.includes("응답하지") ? "warn" : "ok"}>
          {notice}
        </Alert>
      ) : null}

      <div id="publish-view-panel" role="tabpanel" aria-labelledby={`publish-view-tab-${view}`}>
      {initialLoading ? (
        <section className="panel"><div className="panel-body"><CardSkeleton count={6} label="게시 관리 목록을 불러오는 중입니다." /></div></section>
      ) : view === "calendar" ? (
        <PublishCalendar
          monthKey={calendarMonth}
          entries={calendarEntries}
          connectedChannels={calendarChannels}
          channelCatalog={calendarChannelCatalog}
          publishableChannels={calendarPublishableChannels}
          settings={calendarSettings}
          weeklyCapability={calendarWeeklyCapability}
          weeklySettings={calendarWeeklySettings}
          weeklyStatus={calendarWeeklyStatus}
          weeklyUsage={calendarWeeklyUsage}
          weeklyUsageStatus={calendarWeeklyUsageStatus}
          channelsStatus={calendarChannelsStatus}
          capabilitiesStatus={calendarCapabilitiesStatus}
          manualOptions={calendarManualOptions}
          manualOptionsError={calendarManualOptionsError}
          manualOptionsLoading={calendarManualOptionsLoading}
          settingsError={calendarSettingsError}
          slotsError={null}
          slotsLoading={false}
          unreservedItems={calendarUnreservedItems}
          generatedPreviews={generationPreviews}
          focusedItemKey={calendarFocusItemKey}
          onFocusedItemHandled={() => setCalendarFocusItemKey(null)}
          assignableContents={assignableCalendarContents}
          saving={calendarSaving}
          onMonthChange={setCalendarMonth}
          onStartNew={startCalendarContent}
          initialBulkDraft={calendarBulkDraft}
          onStartBulk={startCalendarBulk}
          onContinueBulk={continueCalendarBulk}
          onProvisionBatch={provisionCalendarBatch}
          onAssign={assignCalendarSlot}
          onCancel={(itemKey) => {
            const item = publishItems.find((candidate) => candidate.itemKey === itemKey);
            if (item) cancelPublishItemReservation(item);
          }}
          onScheduleItem={(item, selectedDateKey, trigger) => void openSchedulePanel(item, selectedDateKey, trigger)}
          onRescheduleItem={(itemKey, trigger) => {
            const item = publishItems.find((candidate) => candidate.itemKey === itemKey);
            if (item) openReschedulePanel(item, trigger);
          }}
          onLoadManualOptions={() => void loadManualOptions()}
          onSaveSettings={saveCalendarSettings}
          onSaveWeeklySettings={saveCalendarWeeklySettings}
          onToggleWeekly={toggleCalendarWeekly}
          onRetryWeekly={() => void reloadWeeklySettings()}
          onRetryLegacySettings={() => void reloadLegacySettings()}
          onRetryWeeklyMetadata={reloadWeeklySupport}
          onRetryWeeklyUsage={() => void reloadWeeklyUsage()}
        />
      ) : (
        <PublishManagementList
          items={publishItems}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onSelectResult={(item, target) => setSelectedResult({ result: resultFromPublishItem(item), channel: resultFromPublishItem(item).channels.find((channel) => channel.queueId === target.queueId)! })}
          onSelectReviewTarget={(item, target) => setSelectedReviewOutput(contentOutputFromReviewTarget(item, target))}
          onReviewTargets={(targets, action, message) => void reviewTargets(targets, action, message)}
          reviewingOutputIds={reviewingOutputIds}
          highlightedQueueId={highlightedQueueId}
          onRetryPublish={(queueId) => void retryPublish(queueId)}
          onVerifyPublish={() => void refreshRecoveryState()}
          onCancelPublish={cancelPublishItemReservation}
          onSchedule={(item, trigger) => void openSchedulePanel(item, dateKey(new Date()), trigger)}
          onReschedule={openReschedulePanel}
        />
      )}
      </div>

      {selectedResult ? (
        <PublishResultDialog
          result={selectedResult.result}
          channel={selectedResult.channel}
          onClose={() => setSelectedResult(null)}
        />
      ) : null}
      {selectedReviewOutput ? <ContentArtifactDialog output={selectedReviewOutput} onClose={() => setSelectedReviewOutput(null)} /> : null}
      {scheduleTarget ? <PublishSchedulePanel
        mode={scheduleTarget.mode}
        item={scheduleTarget.item}
        options={calendarManualOptions}
        optionsError={calendarManualOptionsError}
        optionsLoading={calendarManualOptionsLoading}
        initialDateKey={scheduleTarget.dateKey}
        preferredTimes={calendarWeeklyCapability === true
          ? calendarWeeklySettings?.weeklySchedule.map((row) => row.time)
          : calendarSettings?.slotTimes}
        onSubmit={scheduleTarget.mode === "edit" ? submitRescheduledItem : submitScheduledItem}
        onSaved={({ refreshFailed }) => setNotice(scheduleTarget.mode === "edit"
          ? refreshFailed
            ? "예약 시간은 변경했지만 목록을 새로고침하지 못했습니다. 새로고침 후 다시 확인하세요."
            : "예약 시간을 변경했습니다."
          : refreshFailed
            ? "게시 예약은 저장했지만 목록을 새로고침하지 못했습니다. 새로고침 후 다시 확인하세요."
            : "게시 예약을 저장했습니다.")}
        onOpenExistingReservation={(itemKey, calendarDate) => {
          setCalendarFocusItemKey(itemKey);
          if (calendarDate) setCalendarMonth(dateKey(calendarDate).slice(0, 7));
          changeView("calendar");
          closeSchedulePanel();
        }}
        onRetryOptions={() => void loadManualOptions()}
        onClose={closeSchedulePanel}
      /> : null}
    </section>
  );
}
