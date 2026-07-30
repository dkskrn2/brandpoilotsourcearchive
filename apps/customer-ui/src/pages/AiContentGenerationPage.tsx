import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AiGenerationOutputList } from "../components/ai-content/AiGenerationOutputList";
import { aiContentPublishErrorMessage } from "../components/ai-content/AiContentPublishPanel";
import { PageHeader } from "../components/layout/PageHeader";
import { PageSkeleton } from "../components/ui/LoadingState";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import type {
  AiContentGeneration,
  AiContentGateway,
  AiContentPublishTargetInput,
  AiContentPublishTargetResult,
} from "../features/ai-content/types";
import { DEMO_BRAND_ID } from "../lib/apiClient";
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

export function AiContentGenerationPage({
  gateway = aiContentApiGateway,
  brandId = DEMO_BRAND_ID
}: AiContentGenerationPageProps) {
  const { generationId } = useParams();
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
    try {
      setRetryingOutputId(outputId);
      const nextOutput = await gateway.retryOutput(brandId, outputId, reason);
      setGeneration((current) => {
        if (!current) return current;
        return {
          ...current,
          outputs: current.outputs.map((output) => (output.id === outputId ? nextOutput : output)),
          status: current.status === "partial_failed" ? "generating" : current.status
        };
      });
      setSelectedForZip((current) => {
        const next = new Set(current);
        next.add(nextOutput.id);
        return next;
      });
    } finally {
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
    if (!generation) return;
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
      setActionError(err instanceof Error ? err.message : "결과 다운로드에 실패했습니다.");
    }
  }

  async function handlePublish(outputId: string, targets: AiContentPublishTargetInput[]) {
    setActionError(null);
    setPublishingOutputIds((current) => new Set(current).add(outputId));
    try {
      const result = await gateway.publishOutput(brandId, outputId, {
        idempotencyKey: crypto.randomUUID(),
        targets,
      });
      setPublishResults((current) => {
        const merged = new Map((current[outputId] ?? []).map((target) => [`${target.channel}:${target.deliveryFormat}`, target]));
        result.targets.forEach((target) => merged.set(`${target.channel}:${target.deliveryFormat}`, target));
        return { ...current, [outputId]: [...merged.values()] };
      });
    } catch (err: unknown) {
      const errorCode = typeof err === "object" && err !== null && "errorCode" in err
        && typeof err.errorCode === "string"
        ? err.errorCode
        : null;
      setActionError(errorCode
        ? aiContentPublishErrorMessage(errorCode)
        : err instanceof Error ? err.message : "콘텐츠 게시에 실패했습니다.");
    } finally {
      setPublishingOutputIds((current) => {
        const next = new Set(current);
        next.delete(outputId);
        return next;
      });
    }
  }

  return (
    <div className="content ai-content-generation-page">
      <PageHeader
        title="AI 콘텐츠 생성 결과"
        description={`${generation.title}`}
        actions={<span className="muted small">생성 작업 상태: {generationStatusLabels[generation.status]}</span>}
      />
      {actionError ? <div className="alert bad" role="alert">{actionError}</div> : null}
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
    </div>
  );
}
