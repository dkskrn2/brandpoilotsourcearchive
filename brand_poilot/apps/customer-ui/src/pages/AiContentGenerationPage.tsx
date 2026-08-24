import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AiGenerationOutputList } from "../components/ai-content/AiGenerationOutputList";
import { aiContentPublishErrorMessage } from "../components/ai-content/AiContentPublishPanel";
import { AiContentGenerationStatusPanel } from "../components/ai-content/AiContentGenerationStatusPanel";
import { AiContentAssetProgress } from "../components/ai-content/AiContentAssetProgress";
import { AiContentPhaseProgress } from "../components/ai-content/AiContentPhaseProgress";
import { PageHeader } from "../components/layout/PageHeader";
import { PageSkeleton } from "../components/ui/LoadingState";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import { PUBLISH_CALENDAR_USAGE_CHANGED_EVENT } from "../features/publishing/publishCalendar";
import type {
  AiContentGeneration,
  AiContentGateway,
  AiContentPublishTargetInput,
  AiContentPublishTargetResult,
} from "../features/ai-content/types";
import { ApiRequestError, DEMO_BRAND_ID } from "../lib/apiClient";
import type { ChannelConnection } from "../types";
import { useAiContentUsage } from "../features/ai-content/AiContentUsageContext";

interface AiContentGenerationPageProps {
  gateway?: AiContentGateway;
  brandId?: string;
}

const generationStatusLabels: Record<AiContentGeneration["status"], string> = {
  draft: "초안",
  analyzing: "분석 중",
  analysis_ready: "분석 완료",
  queued: "대기",
  planning: "기획 중",
  generating: "생성 중",
  completed: "완료",
  partial_failed: "부분 실패",
  failed: "실패"
};

const v3FormatLabels: Record<string, string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  reel: "릴스",
};

const publishStatusPollIntervalMs = 2_000;
const publishStatusPollLimit = 60;

function publishTargetKey(target: AiContentPublishTargetResult) {
  return `${target.channel}:${target.deliveryFormat}`;
}

function downloadErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.errorCode === "ai_content_download_limit_reached") {
    return "오늘 신규 다운로드 20회를 모두 사용했습니다. 같은 결과는 다시 다운로드해도 차감되지 않습니다.";
  }
  return error instanceof Error ? error.message : "결과 다운로드에 실패했습니다.";
}

function retryErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.errorCode === "generation_weekly_quota_exceeded") {
    return "이번 주 콘텐츠 생성 한도를 모두 사용했습니다. 다음 구독 주기에 다시 사용할 수 있습니다.";
  }
  if (error instanceof ApiRequestError && error.errorCode === "generation_subscription_inactive") {
    return "콘텐츠 생성을 사용하려면 구독 플랜을 확인해 주세요.";
  }
  return error instanceof Error ? error.message : "결과를 다시 생성하지 못했습니다.";
}

export function AiContentGenerationPage({
  gateway = aiContentApiGateway,
  brandId = DEMO_BRAND_ID
}: AiContentGenerationPageProps) {
  const { generationId } = useParams();
  const navigate = useNavigate();
  const [generation, setGeneration] = useState<AiContentGeneration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryingOutputId, setRetryingOutputId] = useState<string | null>(null);
  const [downloadedKeys, setDownloadedKeys] = useState<Set<string>>(new Set());
  const [selectedForZip, setSelectedForZip] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<ChannelConnection[]>([]);
  const [publishingOutputIds, setPublishingOutputIds] = useState<Set<string>>(new Set());
  const [publishResults, setPublishResults] = useState<Record<string, AiContentPublishTargetResult[]>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLocks = useRef({
    retry: new Set<string>(),
    download: new Set<string>(),
    publish: new Set<string>(),
  });
  const { refresh: refreshUsage } = useAiContentUsage();

  useEffect(() => {
    if (!generationId) return;

    let active = true;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        let nextGeneration = await gateway.getGeneration(brandId, generationId);
        if (!active) return;
        setLoading(false);
        for (;;) {
          const outputSet = nextGeneration.outputs.filter((output) => output.status === "completed").map((output) => output.id);
          setGeneration(nextGeneration);
          setSelectedForZip((current) => current.size ? current : new Set(outputSet));
          if (["completed", "partial_failed", "failed"].includes(nextGeneration.status) || !active) break;
          await new Promise((resolve) => window.setTimeout(resolve, 3_000));
          if (!active) break;
          nextGeneration = await gateway.getGeneration(brandId, generationId);
        }
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "generation_not_found");
        setLoading(false);
      }
    };
    void load();

    return () => {
      active = false;
    };
  }, [brandId, gateway, generationId]);

  useEffect(() => {
    let active = true;
    void gateway.listChannels(brandId)
      .then((items) => { if (active) setChannels(items); })
      .catch(() => { if (active) setChannels([]); });
    return () => { active = false; };
  }, [brandId, gateway]);

  if (!generationId) {
    return (
      <div className="content ai-content-generation-page">
        <PageHeader title="AI 콘텐츠 결과" description="생성 ID가 없습니다." />
      </div>
    );
  }

  if (loading) {
    return <PageSkeleton label="AI 생성 상세를 불러오는 중입니다." />;
  }

  if (error || !generation) {
    return (
      <div className="content ai-content-generation-page">
        <PageHeader title="AI 콘텐츠 결과" description="요청한 생성 결과를 찾을 수 없습니다." />
      </div>
    );
  }

  const completedOutputIds = generation.outputs.filter((output) => output.status === "completed").map((output) => output.id);
  const displayFormat = v3FormatLabels[generation.outputFormat] ?? generation.outputFormat;
  const terminal = ["completed", "partial_failed", "failed"].includes(generation.status);
  const reviewing = terminal || generation.outputs.some((output) =>
    output.status === "completed" || output.status === "failed",
  );

  function toggleSelection(outputId: string) {
    setSelectedForZip((current) => {
      const next = new Set(current);
      if (next.has(outputId)) {
        next.delete(outputId);
      } else {
        next.add(outputId);
      }
      return next;
    });
  }

  async function retryOutput(outputId: string, reason: string) {
    if (actionLocks.current.retry.has(outputId)) return;
    actionLocks.current.retry.add(outputId);
    try {
      setActionError(null);
      setRetryingOutputId(outputId);
      const retryGeneration = await gateway.retryOutput(brandId, outputId, reason);
      window.dispatchEvent(new Event(PUBLISH_CALENDAR_USAGE_CHANGED_EVENT));
      navigate(`/ai-content/${retryGeneration.id}`);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError
        && err.status === 410
        && err.errorCode === "ai_content_attachment_retention_expired") {
        setGeneration((current) => current
          ? { ...current, retryableUntil: new Date(Date.now()).toISOString() }
          : current);
        return;
      }
      setActionError(retryErrorMessage(err));
    } finally {
      actionLocks.current.retry.delete(outputId);
      setRetryingOutputId(null);
    }
  }

  function markDownloaded(key: string) {
    setDownloadedKeys((current) => new Set(current).add(key));
  }

  function saveBlob(result: { blob: Blob; fileName: string }) {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload(key: string) {
    if (!generation || actionLocks.current.download.has(key)) return;
    actionLocks.current.download.add(key);
    setActionError(null);
    try {
      if (key.startsWith("output:")) {
        const outputId = key.slice("output:".length);
        saveBlob(await gateway.downloadOutput(brandId, outputId));
        markDownloaded(key);
        await refreshUsage();
        return;
      }
      const outputIds = key === "zip:selected" ? completedOutputIds.filter((outputId) => selectedForZip.has(outputId)) : undefined;
      saveBlob(await gateway.downloadGeneration(brandId, generation.id, outputIds));
      markDownloaded(key);
      await refreshUsage();
    } catch (err: unknown) {
      setActionError(downloadErrorMessage(err));
    } finally {
      actionLocks.current.download.delete(key);
    }
  }

  async function handlePublish(outputId: string, targets: AiContentPublishTargetInput[]) {
    if (actionLocks.current.publish.has(outputId)) return;
    actionLocks.current.publish.add(outputId);
    setActionError(null);
    setPublishingOutputIds((current) => new Set(current).add(outputId));
    try {
      const result = await gateway.publishOutput(brandId, outputId, {
        idempotencyKey: crypto.randomUUID(),
        targets,
      });
      const mergeTargets = (nextTargets: AiContentPublishTargetResult[]) => setPublishResults((current) => {
        const merged = new Map((current[outputId] ?? []).map((target) => [publishTargetKey(target), target]));
        nextTargets.forEach((target) => merged.set(publishTargetKey(target), target));
        return { ...current, [outputId]: [...merged.values()] };
      });
      mergeTargets(result.targets);

      await Promise.all(result.targets.map(async (initialTarget) => {
        if (!initialTarget.queueId || ["published", "failed"].includes(initialTarget.status)) return;
        let currentTarget = initialTarget;
        for (let attempt = 0; attempt < publishStatusPollLimit; attempt += 1) {
          try {
            currentTarget = await gateway.getPublishQueueResult(brandId, initialTarget.queueId);
          } catch {
            if (attempt + 1 < publishStatusPollLimit) {
              await new Promise((resolve) => window.setTimeout(resolve, publishStatusPollIntervalMs));
            }
            continue;
          }
          mergeTargets([currentTarget]);
          if (["published", "failed"].includes(currentTarget.status)) return;
          await new Promise((resolve) => window.setTimeout(resolve, publishStatusPollIntervalMs));
        }
      }));
    } catch (err: unknown) {
      const errorCode = typeof err === "object" && err !== null && "errorCode" in err
        && typeof err.errorCode === "string"
        ? err.errorCode
        : null;
      setActionError(errorCode
        ? aiContentPublishErrorMessage(errorCode)
        : err instanceof Error ? err.message : "콘텐츠 게시에 실패했습니다.");
    } finally {
      actionLocks.current.publish.delete(outputId);
      setPublishingOutputIds((current) => {
        const next = new Set(current);
        next.delete(outputId);
        return next;
      });
    }
  }

  const outputList = (
    <AiGenerationOutputList
      generation={generation}
      downloadedKeys={downloadedKeys}
      selectedForZip={selectedForZip}
      channels={channels}
      retryingOutputId={retryingOutputId}
      publishingOutputIds={publishingOutputIds}
      publishResults={publishResults}
      onRetry={retryOutput}
      onDownload={handleDownload}
      onPublish={handlePublish}
      onToggleSelection={toggleSelection}
    />
  );

  return (
    <div className="content ai-content-generation-page ai-content-flow">
      <AiContentPhaseProgress current={reviewing ? "reviewing" : "generating"} />
      <PageHeader
        title={reviewing ? "생성 결과를 확인하세요" : "콘텐츠를 만들고 있습니다"}
        description={`${generation.title}`}
        actions={<span className="muted small">생성 작업 상태: {generationStatusLabels[generation.status]}</span>}
      />
      <AiContentGenerationStatusPanel
        status={generation.status}
        generationId={generation.id}
        completedCount={completedOutputIds.length}
        outputCount={generation.outputs.length}
      />
      {!reviewing && generation.progress
        ? <AiContentAssetProgress progress={generation.progress} />
        : null}
      {actionError ? <div className="alert bad" role="alert">{actionError}</div> : null}
      {reviewing ? (
        <section className="ai-content-review ai-content-review--unified" aria-label="결과 확인">
          <div className="ai-content-result-layout">
            <div className="ai-content-result-primary">
              <p className="small muted">결과 확인, 다운로드와 지원되는 게시 작업을 한 화면에서 진행할 수 있습니다. 이미 받은 파일을 다시 다운로드해도 신규 다운로드 사용량은 차감되지 않습니다.</p>
              {outputList}
            </div>
            <aside className="ai-content-result-summary" aria-label="결과 정보">
              <span className="ai-content-result-summary__eyebrow">RESULT DETAILS</span>
              <h2>결과 정보</h2>
              <dl>
                <div><dt>상태</dt><dd>{generationStatusLabels[generation.status]}</dd></div>
                <div><dt>형식</dt><dd>{displayFormat}</dd></div>
                <div><dt>완료 결과</dt><dd>{completedOutputIds.length} / {generation.outputs.length}</dd></div>
                <div><dt>콘텐츠 제목</dt><dd>{generation.title}</dd></div>
                <div><dt>생성 ID</dt><dd><code>{generation.id}</code></dd></div>
              </dl>
              <p>다운로드와 지원되는 게시 작업은 각각 실행되며 기존 기능은 그대로 유지됩니다.</p>
            </aside>
          </div>
        </section>
      ) : null}
    </div>
  );
}
