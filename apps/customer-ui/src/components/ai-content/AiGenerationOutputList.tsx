import { useState } from "react";
import { Badge } from "../ui/Badge";
import type {
  AiContentGeneration,
  AiContentPublishTargetInput,
  AiContentPublishTargetResult,
  AiContentType,
} from "../../features/ai-content/types";
import type { ChannelConnection } from "../../types";
import { AiContentArtifactPreview } from "./AiContentArtifactPreview";
import { AiContentPublishPanel } from "./AiContentPublishPanel";

interface AiGenerationOutputListProps {
  generation: AiContentGeneration;
  downloadedKeys: ReadonlySet<string>;
  selectedForZip: ReadonlySet<string>;
  channels: readonly ChannelConnection[];
  retryingOutputId: string | null;
  publishingOutputIds: ReadonlySet<string>;
  publishResults: Readonly<Record<string, readonly AiContentPublishTargetResult[]>>;
  onRetry(outputId: string, reason: string): Promise<void>;
  onDownload(key: string): Promise<void>;
  onPublish(outputId: string, targets: AiContentPublishTargetInput[]): Promise<void>;
  onToggleSelection(outputId: string): void;
}

const typeLabels: Record<AiContentType, string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  marketing: "마케팅 소재"
};

const generationStatus: Record<AiContentGeneration["status"], string> = {
  draft: "작성 중",
  analyzing: "분석 중",
  analysis_ready: "분석 완료",
  queued: "생성 대기",
  planning: "기획 중",
  generating: "생성 중",
  completed: "완료",
  partial_failed: "부분 실패",
  failed: "실패"
};

const outputStatus: Record<import("../../features/ai-content/types").AiOutputStatus, string> = {
  queued: "대기",
  planning: "기획 중",
  generating: "생성 중",
  completed: "완료",
  failed: "실패"
};

function outputStatusVariant(status: import("../../features/ai-content/types").AiOutputStatus) {
  if (status === "failed") return "bad";
  if (status === "completed") return "ok";
  if (status === "planning" || status === "generating" || status === "queued") return "info";
  return "neutral";
}

function outputDownloadKey(outputId: string) {
  return `output:${outputId}`;
}

function generationZipKey(scope: "all" | "selected") {
  return `zip:${scope}`;
}

function isOutputDownloadComplete(status: import("../../features/ai-content/types").AiOutputStatus) {
  return status === "completed";
}

export function AiGenerationOutputList({
  generation,
  downloadedKeys,
  selectedForZip,
  channels,
  retryingOutputId,
  publishingOutputIds,
  publishResults,
  onRetry,
  onDownload,
  onPublish,
  onToggleSelection
}: AiGenerationOutputListProps) {
  const [retryReason, setRetryReason] = useState<Record<string, string>>({});
  const completedCount = generation.outputs.filter((output) => output.status === "completed").length;
  const type = generation.type;

  return (
    <section className="ai-generation-output-list" aria-labelledby="ai-generation-result-title">
      <div className="ai-generation-overview">
        <div>
          <h2 id="ai-generation-result-title">생성 결과 상세</h2>
          <p className="small muted">유형: {typeLabels[generation.type]} · {generation.title}</p>
        </div>
        <div className="ai-generation-status">
          <strong>{generationStatus[generation.status]}</strong>
          <span>{completedCount} / {generation.outputs.length}개 완료</span>
        </div>
      </div>
      <p className="small">생성 ID {generation.id}</p>

      <ul className="ai-generation-output-list__items" aria-label="생성 결과 목록">
        {generation.outputs.map((output, index) => (
          <li key={output.id} className="ai-generation-output-list__item">
            <header className="ai-generation-output-list__item-head">
              <h3>{index + 1}. {output.title}</h3>
              <Badge variant={outputStatusVariant(output.status)}>{outputStatus[output.status]}</Badge>
            </header>

            {output.failureReason ? <p className="muted small">실패 사유: {output.failureReason}</p> : null}

            <div className="ai-generation-output-list__preview">
              <AiContentArtifactPreview type={type} output={output} />
            </div>

            {output.status === "completed" ? (
              <AiContentPublishPanel
                type={type}
                assetCount={output.artifact?.assets.length ?? 0}
                channels={channels}
                publishing={publishingOutputIds.has(output.id)}
                results={publishResults[output.id] ?? []}
                onPublish={(targets) => onPublish(output.id, targets)}
              />
            ) : null}

            {type === "marketing" ? (
              <label className="ai-generation-output-list__select">
                <input
                  type="checkbox"
                  checked={selectedForZip.has(output.id)}
                  onChange={() => onToggleSelection(output.id)}
                />
                전체 ZIP 다운로드에 포함
              </label>
            ) : null}

            <div className="ai-generation-output-list__actions">
              {(() => {
                const downloadKey = outputDownloadKey(output.id);
                const isDownloaded = downloadedKeys.has(downloadKey);
                const canDownload = isOutputDownloadComplete(output.status);
                return (
                  <button
                    type="button"
                    className="button"
                    disabled={!canDownload}
                    onClick={() => void onDownload(downloadKey)}
                    aria-label={`${output.title} 결과 ZIP 다운로드`}
                  >
                    결과 ZIP{isDownloaded ? " (다운로드됨)" : ""}
                  </button>
                );
              })()}
            </div>

            {output.status === "failed" ? (
              <div className="ai-generation-output-list__retry">
                <label htmlFor={`retry-reason-${output.id}`}>다시 생성 사유</label>
                <div className="ai-generation-output-list__retry-actions">
                  <input
                    id={`retry-reason-${output.id}`}
                    type="text"
                    value={retryReason[output.id] ?? ""}
                    onChange={(event) => {
                      const reason = event.currentTarget.value;
                      setRetryReason((current) => ({ ...current, [output.id]: reason }));
                    }}
                    placeholder="다시 생성이 필요한 이유"
                    aria-label={`${output.title} 다시 생성 사유`}
                  />
                  <button
                    type="button"
                    className="button"
                    disabled={!retryReason[output.id]?.trim() || retryingOutputId === output.id}
                    onClick={async () => {
                      if (!retryReason[output.id]?.trim() || retryingOutputId) return;
                      await onRetry(output.id, retryReason[output.id] ?? "");
                    }}
                  >
                    결과 {index + 1} 다시 생성
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <footer className="ai-generation-output-list__downloads">
        {type === "marketing" ? (
          <>
            <button
              type="button"
              className="button"
              disabled={selectedForZip.size === 0}
              onClick={() => void onDownload(generationZipKey("selected"))}
              aria-label="선택 결과 ZIP"
            >
              {generationZipKey("selected") === "zip:selected" && (downloadedKeys.has("zip:selected") ? "선택 결과 ZIP (다운로드됨)" : "선택 결과 ZIP")}
            </button>
            <button
              type="button"
              className="button"
              disabled={completedCount === 0}
              onClick={() => void onDownload(generationZipKey("all"))}
              aria-label="전체 ZIP"
            >
              {downloadedKeys.has(generationZipKey("all")) ? "전체 ZIP (다운로드됨)" : "전체 ZIP"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button"
            disabled={completedCount === 0}
            onClick={() => void onDownload(generationZipKey("all"))}
            aria-label="전체 ZIP"
          >
            {downloadedKeys.has(generationZipKey("all")) ? "전체 ZIP (다운로드됨)" : "전체 ZIP"}
          </button>
        )}
      </footer>

    </section>
  );
}
