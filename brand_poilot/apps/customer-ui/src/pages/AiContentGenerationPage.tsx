import { useEffect, useRef, useState } from "react";
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
  ContentOrchestration,
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

type ReviewTab = "planning" | "copy" | "final" | "publish";

const reviewTabs: Array<{ id: ReviewTab; label: string }> = [
  { id: "planning", label: "기획 근거" },
  { id: "copy", label: "카피" },
  { id: "final", label: "완성본" },
  { id: "publish", label: "게시" },
];

const familyLabels: Record<ContentOrchestration["contentFamily"], string> = {
  informational: "정보성",
  marketing: "마케팅성",
};

const strategyLabels: Record<ContentOrchestration["strategy"], string> = {
  problem_solution: "문제 해결",
  how_to: "방법 안내",
  comparison: "비교",
  faq: "FAQ",
  insight: "인사이트",
  benefit: "혜택",
  social_proof: "사회적 증거",
  brand_story: "브랜드 스토리",
  cta: "행동 유도",
};

const formatLabels: Record<ContentOrchestration["outputFormat"], string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  single_image: "단일 이미지",
  channel_text: "채널 텍스트",
};

const referenceRoleLabels: Record<ContentOrchestration["references"][number]["roles"][number], string> = {
  planning: "기획",
  copy_pattern: "카피 패턴",
  visual_composition: "시각 구성",
};

function snapshotName(value: Record<string, unknown>) {
  for (const key of ["name", "title", "label"]) {
    if (typeof value[key] === "string" && value[key]) return String(value[key]);
  }
  return Object.keys(value).length ? JSON.stringify(value) : "저장된 snapshot";
}

function subjectLabel(orchestration: ContentOrchestration) {
  if (orchestration.subject.mode === "brand_topic") return orchestration.subject.topic;
  if (orchestration.subject.mode === "product_service") return `제품·서비스 ${orchestration.subject.productServiceId}`;
  return `신규 주제 분석 ${orchestration.subject.subjectAnalysisId}`;
}

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
  const [selectedReviewTab, setSelectedReviewTab] = useState<ReviewTab | null>(null);
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
  const terminal = ["completed", "partial_failed", "failed"].includes(generation.status);
  const reviewing = terminal || generation.outputs.some((output) =>
    output.status === "completed" || output.status === "failed",
  );
  const orchestration = generation.draft.orchestration ?? null;
  const evidenceSnapshot = generation.evidenceSnapshot ?? null;
  const activeReviewTab = selectedReviewTab ?? (orchestration ? "planning" : "final");

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
    } catch (err: unknown) {
      if (err instanceof ApiRequestError
        && err.status === 410
        && err.errorCode === "ai_content_attachment_retention_expired") {
        setGeneration((current) => current
          ? { ...current, retryableUntil: new Date(Date.now()).toISOString() }
          : current);
        return;
      }
      setActionError(err instanceof Error ? err.message : "결과를 다시 생성하지 못했습니다.");
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
      setActionError(err instanceof Error ? err.message : "결과 다운로드에 실패했습니다.");
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
    <div className="content ai-content-generation-page">
      <PageHeader
        title="AI 콘텐츠 생성 결과"
        description={`${generation.title}`}
        actions={<span className="muted small">생성 작업 상태: {generationStatusLabels[generation.status]}</span>}
      />
      {actionError ? <div className="alert bad" role="alert">{actionError}</div> : null}
      {!reviewing ? outputList : (
        <section className="ai-content-review" aria-label="변경·검토·보완">
          <div className="tabs" role="tablist" aria-label="콘텐츠 검토">
            {reviewTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeReviewTab === tab.id}
                aria-controls={`content-review-${tab.id}`}
                id={`content-review-tab-${tab.id}`}
                className={activeReviewTab === tab.id ? "active" : ""}
                onClick={() => setSelectedReviewTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            id={`content-review-${activeReviewTab}`}
            role="tabpanel"
            aria-labelledby={`content-review-tab-${activeReviewTab}`}
          >
            {activeReviewTab === "planning" ? (
              <section className="panel content-review-evidence">
                <h2>생성 시점 기획 근거</h2>
                {orchestration ? (
                  <>
                    <dl>
                      <div><dt>콘텐츠 성격</dt><dd>{familyLabels[orchestration.contentFamily]}</dd></div>
                      <div><dt>선택 구현안</dt><dd>{evidenceSnapshot?.proposal ? snapshotName(evidenceSnapshot.proposal) : generation.title}</dd></div>
                      <div><dt>전략</dt><dd>{strategyLabels[orchestration.strategy]}</dd></div>
                      <div><dt>형식</dt><dd>{formatLabels[orchestration.outputFormat]}</dd></div>
                      <div><dt>주제</dt><dd>{subjectLabel(orchestration)}</dd></div>
                      <div><dt>타깃 snapshot</dt><dd>{snapshotName(orchestration.target.snapshot)}</dd></div>
                    </dl>
                    <h3>URL·레퍼런스 근거 snapshot</h3>
                    {(evidenceSnapshot?.references.length ?? 0) > 0 ? (
                      <ul>
                        {evidenceSnapshot!.references.map((reference) => (
                          <li key={reference.id}>
                            {reference.title}
                            {reference.url ? <> · <a href={reference.url} target="_blank" rel="noreferrer">원본 URL</a></> : null}
                            {reference.roles.length ? ` · ${reference.roles.map((role) => referenceRoleLabels[role as keyof typeof referenceRoleLabels] ?? role).join(", ")}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : orchestration.references.length ? (
                      <ul>
                        {orchestration.references.map((reference) => (
                          <li key={reference.referenceItemId}>
                            {reference.referenceItemId} · {reference.roles.map((role) => referenceRoleLabels[role]).join(", ")}
                          </li>
                        ))}
                      </ul>
                    ) : <p className="muted">선택한 레퍼런스가 없습니다.</p>}
                    <h3>아바타 snapshot</h3>
                    <p>{evidenceSnapshot?.avatar
                      ? snapshotName(evidenceSnapshot.avatar)
                      : orchestration.avatar ? snapshotName(orchestration.avatar.snapshot) : "사용하지 않음"}</p>
                  </>
                ) : (
                  <p className="muted">기존 생성 건에는 orchestration snapshot이 없어 저장된 초안과 결과만 표시합니다.</p>
                )}
              </section>
            ) : null}

            {activeReviewTab === "copy" ? (
              <section className="panel content-review-copy">
                <h2>결과 카피</h2>
                {generation.outputs.some((output) => output.artifact?.text) ? (
                  generation.outputs.map((output) => output.artifact?.text
                    ? <article key={output.id}><h3>{output.title}</h3><p>{output.artifact.text}</p></article>
                    : null)
                ) : <p className="muted">완료된 카피가 없습니다.</p>}
              </section>
            ) : null}

            {activeReviewTab === "final" ? (
              <>
                <p className="small muted">개별·선택·전체 ZIP을 받을 수 있으며 이미 받은 파일을 다시 다운로드해도 신규 다운로드 사용량은 차감되지 않습니다.</p>
                {outputList}
              </>
            ) : null}

            {activeReviewTab === "publish" ? outputList : null}
          </div>
        </section>
      )}
    </div>
  );
}
