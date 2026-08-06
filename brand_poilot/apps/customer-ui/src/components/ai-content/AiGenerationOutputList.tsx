import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/Badge";
import type {
  AiContentGeneration,
  AiContentPublishTargetInput,
  AiContentPublishTargetResult,
  ContentOutputFormatV2,
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
  revisingOutputId: string | null;
  publishingOutputIds: ReadonlySet<string>;
  publishResults: Readonly<Record<string, readonly AiContentPublishTargetResult[]>>;
  onRetry(outputId: string, reason: string): Promise<void>;
  onRevise(
    outputId: string,
    action: "regenerate_hook" | "regenerate_copy" | "regenerate_card",
    cardIndex?: number,
  ): Promise<void>;
  onDownload(key: string): Promise<void>;
  onPublish(outputId: string, targets: AiContentPublishTargetInput[]): Promise<void>;
  onToggleSelection(outputId: string): void;
}

const formatLabels: Record<ContentOutputFormatV2, string> = {
  card_news: "카드뉴스",
  blog: "블로그",
  reel: "릴스",
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

const MAX_TIMEOUT_MS = 2_147_483_647;

function retryRetentionState(retryableUntil: string | null, now: number) {
  if (retryableUntil === null) return { expired: false, deadline: null };
  const deadline = Date.parse(retryableUntil);
  if (!Number.isFinite(deadline)) return { expired: false, deadline: null };
  return { expired: now >= deadline, deadline };
}

function useRetryRetentionState(retryableUntil: string | null) {
  const [, setClockTick] = useState(0);
  const parsed = retryRetentionState(retryableUntil, Date.now());
  const deadline = parsed.deadline;

  useEffect(() => {
    if (deadline === null || Date.now() >= deadline) return;
    let active = true;
    let timer: number | undefined;

    const arm = () => {
      if (!active) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setClockTick((current) => current + 1);
        return;
      }
      timer = window.setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS));
    };

    arm();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [deadline]);

  return retryRetentionState(retryableUntil, Date.now());
}

function localizedRetryDeadline(deadline: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(deadline).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const displayHour = hour % 12 || 12;
  return `${parts.year}년 ${Number(parts.month)}월 ${Number(parts.day)}일 ${hour < 12 ? "오전" : "오후"} ${displayHour}:${parts.minute}`;
}

export function AiGenerationOutputList({
  generation,
  downloadedKeys,
  selectedForZip,
  channels,
  retryingOutputId,
  revisingOutputId,
  publishingOutputIds,
  publishResults,
  onRetry,
  onRevise,
  onDownload,
  onPublish,
  onToggleSelection
}: AiGenerationOutputListProps) {
  const [retryReason, setRetryReason] = useState<Record<string, string>>({});
  const completedCount = generation.outputs.filter((output) => output.status === "completed").length;
  const outputFormat = generation.outputFormat;
  const retryRetention = useRetryRetentionState(generation.retryableUntil);

  return (
    <section className="ai-generation-output-list" aria-labelledby="ai-generation-result-title">
      <div className="ai-generation-overview">
        <div>
          <h2 id="ai-generation-result-title">생성 결과 상세</h2>
          <p className="small muted">형식: {formatLabels[outputFormat]} · {generation.title}</p>
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
              <AiContentArtifactPreview output={output} />
            </div>

            {output.status === "completed" && output.revisionCapabilities?.length ? (
              <div className="ai-generation-output-list__revision-actions" aria-label={`${output.title} 부분 재생성`}>
                {output.revisionCapabilities.includes("regenerate_hook") ? (
                  <button
                    type="button"
                    className="button"
                    disabled={revisingOutputId === output.id}
                    onClick={() => void onRevise(output.id, "regenerate_hook")}
                  >
                    훅 다시 생성
                  </button>
                ) : null}
                {output.revisionCapabilities.includes("regenerate_copy") ? (
                  <button
                    type="button"
                    className="button"
                    disabled={revisingOutputId === output.id}
                    onClick={() => void onRevise(output.id, "regenerate_copy")}
                  >
                    카피 다시 생성
                  </button>
                ) : null}
                {output.revisionCapabilities.includes("regenerate_card")
                  ? (output.artifact?.assets ?? []).map((_asset, cardIndex) => (
                    <button
                      key={cardIndex}
                      type="button"
                      className="button"
                      disabled={revisingOutputId === output.id}
                      onClick={() => void onRevise(output.id, "regenerate_card", cardIndex + 1)}
                    >
                      {cardIndex + 1}번 카드 다시 생성
                    </button>
                  ))
                  : null}
              </div>
            ) : null}

            {output.status === "completed"
              && output.publishSupported ? (
              <AiContentPublishPanel
                manifestVersion={output.manifestVersion}
                outputFormat={output.outputFormat}
                assetCount={output.artifact?.assets.length ?? 0}
                channels={channels}
                publishing={publishingOutputIds.has(output.id)}
                results={publishResults[output.id] ?? []}
                onPublish={(targets) => onPublish(output.id, targets)}
              />
            ) : null}

            {outputFormat === "reel" ? (
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

            {output.status === "failed" && retryRetention.expired ? (
              <div className="ai-generation-output-list__retry-expired" role="status">
                <p>첨부파일 보관 기간이 만료되어 이 결과를 다시 생성할 수 없습니다.</p>
                <p className="small muted">새 콘텐츠 생성 후 파일을 다시 업로드해 주세요.</p>
                <Link className="button" to="/ai-content/new">새 콘텐츠 생성</Link>
              </div>
            ) : output.status === "failed" ? (
              <div className="ai-generation-output-list__retry">
                <label htmlFor={`retry-reason-${output.id}`}>다시 생성 사유</label>
                {retryRetention.deadline !== null ? (
                  <p className="small muted">
                    다시 생성 가능 기한: {localizedRetryDeadline(retryRetention.deadline)}
                  </p>
                ) : null}
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
        {outputFormat === "reel" ? (
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
